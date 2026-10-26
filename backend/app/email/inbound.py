"""
Inbound mail: every 30 s, fetch new messages from the connected mailbox and
turn them into tickets or replies.

  • A message on a thread we know (same Gmail thread, a Message-ID we sent
    or received, or "[TKT-0042]" in the subject from that ticket's requester)
    is added to that ticket. A resolved or closed ticket is reopened.
  • Anything else opens a new ticket and gets an acknowledgement.

Safety:
  • Only the requester and the people on the opening email's To/Cc (and
    staff) can reply publicly. Anyone else's message on the thread becomes
    an internal note marked "unverified sender", so a forwarded thread can't
    be used to read or steer someone else's ticket.
  • Mail that fails DMARC for its claimed domain, auto-replies, bounces and
    mailing lists are never ticketed (labelled SimpleTickets/Ignored).
  • At most 10 new tickets per sender per hour.
  • Only mail that arrived after the mailbox was connected is considered,
    and every handled message is labelled — nothing is ever deleted.
"""
import json
import logging
import time
import uuid
from datetime import timedelta
from pathlib import Path
from typing import Optional

import aiofiles
import magic
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal
from app.email.gmail import LABEL_DONE, LABEL_IGNORED, LABEL_NOTE, Gmail, GmailAuthError, GmailError
from app.email.parse import ParsedEmail, ParsedFile, parse_raw, remove_marker, strip_quoted
from app.models import SLAPolicy, Ticket, TicketAttachment, TicketHistory, TicketReply, User
from app.models.enums import Priority
from app.models.ticket_status_config import TicketStatusConfig
from app.services.settings_service import get_setting, set_setting
from app.services.sla import compute_sla_deadline, transition_status
from app.services.storage_quota import MAX_TOTAL_ATTACHMENT_BYTES, total_attachment_bytes
from app.utils import utcnow

logger = logging.getLogger(__name__)

_NEW_TICKETS_PER_HOUR = 10
_MAX_PARTICIPANTS = 30
_MAX_FAILURES = 3
# Gmail message id → consecutive processing failures (a poison message is
# labelled Ignored after a few tries instead of blocking every poll)
_failures: dict[str, int] = {}
# After an auth failure, don't hammer Google's token endpoint every 30 s
_auth_backoff_until = 0.0


# ── Participants ──────────────────────────────────────────────────────────────


def participants(ticket: Ticket) -> dict[str, list[str]]:
    """{'allowed': who may reply publicly, 'cc': who we copy on outgoing mail}"""
    try:
        data = json.loads(ticket.email_participants or "{}")
    except ValueError:
        data = {}
    return {"allowed": list(data.get("allowed", [])), "cc": list(data.get("cc", []))}


def _set_participants(ticket: Ticket, allowed: list[str], cc: list[str]) -> None:
    def dedupe(xs: list[str]) -> list[str]:
        return list(dict.fromkeys(x for x in xs if x))[:_MAX_PARTICIPANTS]
    ticket.email_participants = json.dumps({"allowed": dedupe(allowed), "cc": dedupe(cc)})


def _append_references(ticket: Ticket, message_id: Optional[str]) -> None:
    if not message_id:
        return
    refs = (ticket.email_references or "").split()
    if message_id not in refs:
        refs.append(message_id)
    ticket.email_references = " ".join(refs[-30:])
    ticket.email_last_message_id = message_id


# ── Poll job ──────────────────────────────────────────────────────────────────


async def poll_mailbox() -> None:
    """Scheduler entry point. Never raises."""
    global _auth_backoff_until
    if time.time() < _auth_backoff_until:
        return
    async with AsyncSessionLocal() as session:
        gmail = await Gmail.from_settings(session)
        connected_at = await get_setting("gmail_connected_at", session)
    if gmail is None:
        return

    error = ""
    try:
        query = f"in:inbox -label:{LABEL_DONE}"
        if connected_at.isdigit():
            query += f" after:{connected_at}"
        ids = await gmail.list_message_ids(query)
        for gmail_id in reversed(ids):  # oldest first
            try:
                await _process(gmail, gmail_id)
                _failures.pop(gmail_id, None)
            except GmailAuthError:
                raise
            except Exception:  # noqa: BLE001
                logger.exception("Email: failed to process message %s", gmail_id)
                _failures[gmail_id] = _failures.get(gmail_id, 0) + 1
                if _failures[gmail_id] >= _MAX_FAILURES:
                    _failures.pop(gmail_id, None)
                    try:
                        await gmail.mark_handled(gmail_id, LABEL_IGNORED)
                    except GmailError:
                        pass
                    error = "A message couldn't be processed and was labelled SimpleTickets/Ignored."
    except GmailAuthError as exc:
        _auth_backoff_until = time.time() + 600
        error = str(exc)
    except GmailError as exc:
        error = str(exc)
    except Exception:  # noqa: BLE001
        logger.exception("Email poll failed")
        error = "Checking the mailbox failed. See the server logs."

    async with AsyncSessionLocal() as session:
        await set_setting("gmail_last_poll_at", utcnow().isoformat(), session)
        await set_setting("gmail_last_error", error, session)
        await session.commit()


async def check_now() -> None:
    """Run a poll immediately (Settings → Check now), ignoring auth backoff."""
    global _auth_backoff_until
    _auth_backoff_until = 0.0
    await poll_mailbox()


async def _process(gmail: Gmail, gmail_id: str) -> None:
    raw = await gmail.get_raw(gmail_id)
    p = parse_raw(raw.get("raw", ""))
    thread_id = raw.get("threadId")

    if not p.from_address or p.from_address == gmail.address:
        await gmail.mark_handled(gmail_id, LABEL_IGNORED)
        return

    extra: list[str] = []
    async with AsyncSessionLocal() as session:
        if p.message_id and await _already_seen(session, p.message_id):
            pass  # handled before, only the label was missing
        elif p.automated:
            logger.info("Email: ignoring %s message from %s", p.automated, p.from_address)
            extra.append(LABEL_IGNORED)
        else:
            ticket = await _find_ticket(session, thread_id, p)
            if ticket is not None:
                if not await _add_reply(session, ticket, p, gmail.address):
                    extra.append(LABEL_NOTE)
            elif p.dmarc_failed:
                logger.warning("Email: not ticketing %s — DMARC failed", p.from_address)
                extra.append(LABEL_IGNORED)
            elif await _over_rate_limit(session, p.from_address):
                logger.warning("Email: %s is over the new-ticket limit", p.from_address)
                extra.append(LABEL_IGNORED)
            else:
                await _create_ticket(session, p, thread_id, gmail.address)

    await gmail.mark_handled(gmail_id, *extra)


async def _already_seen(session: AsyncSession, message_id: str) -> bool:
    t = await session.execute(select(Ticket.id).where(Ticket.email_message_id == message_id).limit(1))
    if t.first():
        return True
    r = await session.execute(select(TicketReply.id).where(TicketReply.email_message_id == message_id).limit(1))
    return r.first() is not None


async def _find_ticket(session: AsyncSession, thread_id: Optional[str], p: ParsedEmail) -> Optional[Ticket]:
    if thread_id:
        t = (await session.execute(
            select(Ticket).where(Ticket.email_thread_id == thread_id).order_by(Ticket.id.desc()).limit(1)
        )).scalar_one_or_none()
        if t is not None:
            return t

    ids = list(dict.fromkeys(p.in_reply_to + p.references))
    if ids:
        t = (await session.execute(
            select(Ticket).where(Ticket.email_message_id.in_(ids)).order_by(Ticket.id.desc()).limit(1)
        )).scalar_one_or_none()
        if t is not None:
            return t
        t = (await session.execute(
            select(Ticket)
            .join(TicketReply, TicketReply.ticket_id == Ticket.id)
            .where(TicketReply.email_message_id.in_(ids))
            .order_by(Ticket.id.desc())
            .limit(1)
        )).scalar_one_or_none()
        if t is not None:
            return t

    # "[TKT-0042]" in the subject — only trusted from that ticket's own
    # requester, otherwise anyone could attach mail to any ticket number
    number = p.ticket_number
    if number:
        t = await session.get(Ticket, number)
        if t is not None and t.source == "email" and t.email_requester == p.from_address and not p.dmarc_failed:
            return t
    return None


async def _staff_user(session: AsyncSession, address: str) -> Optional[User]:
    return (await session.execute(
        select(User).where(func.lower(User.email) == address, User.is_active == True)  # noqa: E712
    )).scalar_one_or_none()


async def _over_rate_limit(session: AsyncSession, address: str) -> bool:
    since = utcnow() - timedelta(hours=1)
    count = (await session.execute(
        select(func.count(Ticket.id)).where(
            Ticket.email_requester == address, Ticket.created_at >= since,
        )
    )).scalar_one()
    return count >= _NEW_TICKETS_PER_HOUR


# ── New ticket ────────────────────────────────────────────────────────────────


async def _create_ticket(session: AsyncSession, p: ParsedEmail, thread_id: Optional[str], own: str) -> Ticket:
    now = utcnow()
    user = await _staff_user(session, p.from_address)

    text = remove_marker(p.text)
    first_line = next((ln.strip() for ln in text.split("\n") if ln.strip()), "")
    title = p.clean_subject or first_line[:200] or f"Email from {p.from_name or p.from_address}"

    priority = Priority.medium
    policy = (await session.execute(select(SLAPolicy).where(SLAPolicy.priority == priority))).scalar_one_or_none()
    sla_deadline = first_response_deadline = None
    if policy:
        sla_deadline = await compute_sla_deadline(now, policy.resolution_minutes, session)
        first_response_deadline = await compute_sla_deadline(now, policy.first_response_minutes, session)
    default_status = (await session.execute(
        select(TicketStatusConfig.name).where(TicketStatusConfig.is_default == True)  # noqa: E712
    )).scalar_one_or_none() or "open"

    ticket = Ticket(
        title=title[:255],
        description=text or "(no content)",
        status=default_status,
        priority=priority,
        submitter_id=user.id if user else None,
        slack_submitter_name=None if user else (p.from_name or p.from_address),
        source="email",
        sla_policy_id=policy.id if policy else None,
        sla_deadline=sla_deadline,
        first_response_deadline=first_response_deadline,
        email_thread_id=thread_id,
        email_requester=p.from_address,
        email_subject=p.subject or title,
        email_message_id=p.message_id,
        created_at=now,
        updated_at=now,
    )
    _append_references(ticket, p.message_id)
    others = [a for a in p.to + p.cc if a != own]
    _set_participants(
        ticket,
        allowed=[p.from_address, *others],
        cc=[a for a in p.cc if a not in (own, p.from_address)],
    )
    session.add(ticket)
    await session.flush()
    session.add(TicketHistory(
        ticket_id=ticket.id, actor_id=None, field_changed="status",
        old_value=None, new_value=default_status,
    ))
    await _save_files(session, ticket.id, None, p.files)

    from app.email.identity import auto_link
    await auto_link(session, ticket)

    from app.email.outbox import queue_ack
    queue_ack(session, ticket)
    await session.commit()
    logger.info("Email: created %s from %s", ticket.display_id, p.from_address)
    return ticket


# ── Reply on an existing ticket ───────────────────────────────────────────────


async def _add_reply(session: AsyncSession, ticket: Ticket, p: ParsedEmail, own: str) -> bool:
    """Add the message to the ticket. Returns False when it was saved as an
    internal note because the sender isn't on the thread."""
    now = utcnow()
    parts = participants(ticket)
    staff = await _staff_user(session, p.from_address)
    verified = not p.dmarc_failed and (p.from_address in parts["allowed"] or staff is not None)

    text = strip_quoted(p.text)
    if not text:
        text = "(attachment)" if p.files else "(no content)"

    if verified:
        body = text
        # Reopen a resolved/closed ticket — same as a reply from Slack
        resolved = {r[0] for r in (await session.execute(
            select(TicketStatusConfig.name).where(TicketStatusConfig.is_resolved_state == True)  # noqa: E712
        )).all()} or {"resolved", "closed"}
        if ticket.status in resolved:
            reopen = (await session.execute(
                select(TicketStatusConfig.name)
                .where(
                    TicketStatusConfig.is_resolved_state == False,  # noqa: E712
                    TicketStatusConfig.pauses_sla == False,  # noqa: E712
                    TicketStatusConfig.is_archived == False,  # noqa: E712
                )
                .order_by(TicketStatusConfig.sort_order)
                .limit(1)
            )).scalar_one_or_none() or "in_progress"
            old = ticket.status
            await transition_status(ticket, reopen, session)
            session.add(TicketHistory(
                ticket_id=ticket.id, actor_id=None, field_changed="status",
                old_value=old, new_value=reopen, created_at=now,
            ))
        if staff is not None and ticket.first_responded_at is None:
            ticket.first_responded_at = now
        # People the sender copied in can follow up too
        new_people = [a for a in p.to + p.cc if a != own]
        _set_participants(
            ticket,
            allowed=parts["allowed"] + new_people,
            cc=parts["cc"] + [a for a in p.cc if a not in (own, ticket.email_requester)],
        )
    else:
        who = f"{p.from_name} <{p.from_address}>" if p.from_name else p.from_address
        reason = "failed the sender check (DMARC)" if p.dmarc_failed else "isn't on this ticket's email thread"
        body = f"⚠️ Unverified sender: {who} {reason}, so this was saved as an internal note.\n\n{text}"

    reply = TicketReply(
        ticket_id=ticket.id,
        author_id=staff.id if (verified and staff) else None,
        body=body,
        is_internal=not verified,
        slack_author_name=None if (verified and staff) else (p.from_name or p.from_address),
        email_message_id=p.message_id,
        created_at=now,
    )
    session.add(reply)
    _append_references(ticket, p.message_id)
    ticket.updated_at = now
    await session.flush()
    await _save_files(session, ticket.id, reply.id, p.files)
    await session.commit()
    logger.info("Email: %s from %s on %s", "reply" if verified else "unverified note", p.from_address, ticket.display_id)
    return verified


# ── Files ─────────────────────────────────────────────────────────────────────


async def _save_files(session: AsyncSession, ticket_id: int, reply_id: Optional[int], files: list[ParsedFile]) -> None:
    """Store email attachments with the same rules as web uploads: type
    sniffed from the bytes (no SVG), 10 MB each, shared storage quota."""
    if not files:
        return
    from app.routers.attachments import _is_allowed_mime, _sanitize_filename

    stored = await total_attachment_bytes(session)
    storage_dir = Path(settings.storage_local_path) / str(ticket_id)
    for f in files:
        if stored + len(f.content) > MAX_TOTAL_ATTACHMENT_BYTES:
            logger.warning("Email: storage quota reached, skipping %s on ticket %d", f.filename, ticket_id)
            break
        mime = magic.from_buffer(f.content, mime=True)
        if not _is_allowed_mime(mime):
            logger.info("Email: skipping %s (%s) on ticket %d", f.filename, mime, ticket_id)
            continue
        safe = _sanitize_filename(f.filename)
        unique = f"{uuid.uuid4().hex}_{safe}"
        storage_dir.mkdir(parents=True, exist_ok=True)
        async with aiofiles.open(storage_dir / unique, "wb") as out:
            await out.write(f.content)
        session.add(TicketAttachment(
            ticket_id=ticket_id,
            reply_id=reply_id,
            filename=f.filename,
            storage_path=str(Path(str(ticket_id)) / unique),
            mime_type=mime,
            size_bytes=len(f.content),
            created_at=utcnow(),
        ))
        stored += len(f.content)
