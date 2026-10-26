"""
Outgoing mail for email tickets, sent from the connected mailbox in the
ticket's own Gmail thread.

What the requester receives:
  • an acknowledgement when their email opens a ticket
  • every public technician reply, with its attachments (internal notes never)
  • a short notice when a technician changes the ticket's status

Mail is queued in email_outbox and sent by a job every 10 s. Replies wait a
few seconds first so files the technician attaches right after sending go
out in the same email. Failed sends are retried with backoff.
"""
import base64
import logging
import re
from datetime import timedelta
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal
from app.email.gmail import Gmail, GmailAuthError, GmailError
from app.email.inbound import _append_references, participants
from app.models import EmailOutbox, Ticket, TicketAttachment, TicketReply
from app.models.ticket_status_config import TicketStatusConfig
from app.services.settings_service import get_setting, set_setting
from app.utils import utcnow

logger = logging.getLogger(__name__)

# Time for the browser to finish uploading a reply's files
_REPLY_DELAY = timedelta(seconds=15)
_MAX_ATTEMPTS = 6
_MAX_ATTACH_TOTAL = 20 * 1024 * 1024  # Gmail's limit is 25 MB after encoding
_BATCH = 20


def is_email_ticket(ticket: Ticket) -> bool:
    return ticket.source == "email" and bool(ticket.email_requester)


# ── Queueing (callers commit) ─────────────────────────────────────────────────


def queue_ack(session: AsyncSession, ticket: Ticket) -> None:
    session.add(EmailOutbox(ticket_id=ticket.id, kind="ack", body=""))


def queue_reply(session: AsyncSession, ticket: Ticket, reply: TicketReply, author_name: str) -> None:
    if not is_email_ticket(ticket) or reply.is_internal:
        return
    session.add(EmailOutbox(
        ticket_id=ticket.id, reply_id=reply.id, kind="reply", author_name=author_name,
        body=reply.body, send_after=utcnow() + _REPLY_DELAY,
    ))


async def queue_status(ticket: Ticket, new_status: str) -> None:
    """Own session — called after the status change is committed."""
    if not is_email_ticket(ticket):
        return
    async with AsyncSessionLocal() as session:
        session.add(EmailOutbox(ticket_id=ticket.id, kind="status", body=new_status))
        await session.commit()


# ── Composing ─────────────────────────────────────────────────────────────────

_SLACK_LINK = re.compile(r"<((?:https?://|mailto:)[^<>|\s]+)\|([^<>]+)>")
_SLACK_BARE = re.compile(r"<((?:https?://|mailto:)[^<>|\s]+)>")


def _plain(text: str) -> str:
    """Reply text uses Slack-style links; spell them out for email."""
    text = _SLACK_LINK.sub(lambda m: f"{m.group(2)} ({m.group(1)})" if m.group(2) != m.group(1) else m.group(1), text)
    text = _SLACK_BARE.sub(r"\1", text)
    return text.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")


def _first_name(ticket: Ticket) -> str:
    name = (ticket.slack_submitter_name or "").strip()
    if not name or "@" in name:
        return "there"
    return name.split()[0]


async def _status_text(session: AsyncSession, ticket: Ticket, status: str, sign: str) -> Optional[str]:
    cfg = (await session.execute(
        select(TicketStatusConfig).where(TicketStatusConfig.name == status)
    )).scalar_one_or_none()
    label = cfg.label if cfg else status.replace("_", " ").title()
    lines = [f"Hi {_first_name(ticket)},", "", f"Your ticket {ticket.display_id} \"{ticket.title}\" is now: {label}."]
    if cfg and cfg.is_resolved_state:
        lines += ["", "If something still isn't right, just reply to this email and we'll reopen it."]
    elif cfg and cfg.pauses_sla:
        lines += ["", "We're waiting on you — reply to this email to continue."]
    return "\n".join(lines + ["", sign])


def _subject(ticket: Ticket) -> str:
    base = re.sub(r"\s*\[TKT-\d+\]", "", ticket.email_subject or ticket.title).strip()
    if not re.match(r"^re\s*:", base, re.I):
        base = f"Re: {base}"
    return f"{base} [{ticket.display_id}]"[:255]


async def _compose(session: AsyncSession, gmail: Gmail, row: EmailOutbox, ticket: Ticket) -> Optional[EmailMessage]:
    team = (await get_setting("gmail_sender_name", session)).strip() or "IT Support"
    if row.kind == "reply":
        body = _plain(row.body)
        sender = f"{row.author_name} ({team})" if row.author_name else team
    elif row.kind == "ack":
        body = "\n".join([
            f"Hi {_first_name(ticket)},",
            "",
            f"Thanks, we've received your request and opened ticket {ticket.display_id}:",
            f"\"{ticket.title}\"",
            "",
            "We'll reply in this email thread. To add details or files, just reply to this email.",
            "",
            team,
        ])
        sender = team
    elif row.kind == "status":
        body = await _status_text(session, ticket, row.body, team)
        sender = team
    else:
        return None

    msg = EmailMessage()
    domain = gmail.address.split("@", 1)[1]
    msg["From"] = formataddr((sender, gmail.address))
    requester_name = ticket.slack_submitter_name if ticket.slack_submitter_name and "@" not in ticket.slack_submitter_name else ""
    msg["To"] = formataddr((requester_name, ticket.email_requester))
    cc = [a for a in participants(ticket)["cc"] if a not in (gmail.address, ticket.email_requester)]
    if cc and row.kind == "reply":
        msg["Cc"] = ", ".join(cc)
    msg["Subject"] = _subject(ticket)
    msg["Message-ID"] = make_msgid(domain=domain)
    if ticket.email_last_message_id:
        msg["In-Reply-To"] = ticket.email_last_message_id
    if ticket.email_references:
        msg["References"] = ticket.email_references
    if row.kind != "reply":
        # Tells the requester's auto-responders not to answer
        msg["Auto-Submitted"] = "auto-generated"
    msg.set_content(body)

    if row.kind == "reply" and row.reply_id:
        files = (await session.execute(
            select(TicketAttachment).where(TicketAttachment.reply_id == row.reply_id).order_by(TicketAttachment.id)
        )).scalars().all()
        total, skipped = 0, []
        for f in files:
            if total + f.size_bytes > _MAX_ATTACH_TOTAL:
                skipped.append(f.filename)
                continue
            try:
                data = (Path(settings.storage_local_path) / f.storage_path).read_bytes()
            except OSError:
                skipped.append(f.filename)
                continue
            maintype, _, subtype = f.mime_type.partition("/")
            msg.add_attachment(data, maintype=maintype or "application", subtype=subtype or "octet-stream", filename=f.filename)
            total += len(data)
        if skipped:
            logger.warning("Email: %d file(s) too large to send on %s", len(skipped), ticket.display_id)
    return msg


# ── Sending job ───────────────────────────────────────────────────────────────


async def send_due() -> None:
    """Scheduler entry point. Never raises."""
    async with AsyncSessionLocal() as session:
        gmail = await Gmail.from_settings(session)
        if gmail is None:
            return
        rows = (await session.execute(
            select(EmailOutbox)
            .where(
                EmailOutbox.sent_at.is_(None),
                EmailOutbox.attempts < _MAX_ATTEMPTS,
                EmailOutbox.send_after <= utcnow(),
            )
            .order_by(EmailOutbox.id)
            .limit(_BATCH)
        )).scalars().all()

        error = None
        for row in rows:
            ticket = await session.get(Ticket, row.ticket_id)
            if ticket is None or not is_email_ticket(ticket):
                row.sent_at = utcnow()
                row.last_error = "Not an email ticket"
                continue
            try:
                msg = await _compose(session, gmail, row, ticket)
                if msg is None:
                    row.sent_at = utcnow()
                    continue
                raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
                result = await gmail.send_raw(raw, ticket.email_thread_id)
            except (GmailError, OSError, ValueError) as exc:
                row.attempts += 1
                row.last_error = str(exc)[:1000]
                row.send_after = utcnow() + timedelta(minutes=2 ** row.attempts)
                error = f"Sending mail failed: {exc}"
                logger.warning("Email: send failed for %s (%s): %s", ticket.display_id, row.kind, exc)
                if isinstance(exc, GmailAuthError):
                    break
                continue

            message_id = str(msg["Message-ID"])
            row.sent_at = utcnow()
            row.last_error = None
            if not ticket.email_thread_id and result.get("threadId"):
                ticket.email_thread_id = result["threadId"]
            _append_references(ticket, message_id)
            if row.reply_id:
                reply = await session.get(TicketReply, row.reply_id)
                if reply is not None:
                    reply.email_message_id = message_id
            logger.info("Email: sent %s on %s", row.kind, ticket.display_id)

        if error:
            await set_setting("gmail_last_error", error, session)
        await session.commit()
