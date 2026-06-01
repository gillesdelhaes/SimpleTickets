"""
Internal service for creating tickets from Slack events and syncing replies
between SimpleTickets and Slack threads.

Called by Slack handlers and HTTP routers — bypasses HTTP, writes directly to DB.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import aiofiles
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings, settings_manager
from app.database import AsyncSessionLocal
from app.models import Category, SLAPolicy, Ticket, TicketHistory, TicketReply, User
from app.models.enums import Priority
from app.models.ticket_attachment import TicketAttachment
from app.models.ticket_status_config import TicketStatusConfig

logger = logging.getLogger(__name__)

# ── Status display labels for Slack messages ───────────────────────────────────

_STATUS_LABELS: dict[str, str] = {
    "open": "Open 🆕",
    "in_progress": "In Progress 🚀",
    "pending_user": "Pending User ⏳",
    "resolved": "Resolved ✅",
    "closed": "Closed 🔒",
}

_PRIORITY_LABELS: dict[str, str] = {
    "low": "Low",
    "medium": "Medium",
    "high": "High",
    "critical": "Critical 🚨",
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ── User lookup ────────────────────────────────────────────────────────────────


async def get_user_by_slack_id(session: AsyncSession, slack_user_id: str) -> Optional[User]:
    """Find an active SimpleTickets (technician/admin) user by their Slack user ID."""
    result = await session.execute(
        select(User).where(
            User.slack_user_id == slack_user_id,
            User.is_active == True,  # noqa: E712
        )
    )
    return result.scalar_one_or_none()


# ── Ticket creation ────────────────────────────────────────────────────────────


async def create_ticket_from_slack(
    *,
    title: str,
    description: str,
    priority: Priority = Priority.medium,
    category_id: Optional[int] = None,
    submitter_id: Optional[int] = None,
    slack_submitter_name: Optional[str] = None,
    slack_submitter_id: Optional[str] = None,
    slack_channel_id: Optional[str] = None,
    slack_message_ts: Optional[str] = None,
) -> Ticket:
    """
    Create a ticket from a Slack event (emoji reaction or slash command).
    Opens its own DB session — safe to call from Bolt async handlers.
    """
    async with AsyncSessionLocal() as session:
        now = _utcnow()

        # Validate category
        if category_id is not None:
            cat = await session.get(Category, category_id)
            if cat is None or cat.is_archived:
                category_id = None

        # SLA deadline
        sla_result = await session.execute(
            select(SLAPolicy).where(SLAPolicy.priority == priority)
        )
        sla_policy = sla_result.scalar_one_or_none()
        sla_policy_id = None
        sla_deadline = None
        first_response_deadline = None
        if sla_policy:
            sla_policy_id = sla_policy.id
            sla_deadline = now + timedelta(minutes=sla_policy.resolution_minutes)
            first_response_deadline = now + timedelta(minutes=sla_policy.first_response_minutes)

        # Use the default status for new tickets
        default_status_result = await session.execute(
            select(TicketStatusConfig.name).where(TicketStatusConfig.is_default == True)  # noqa: E712
        )
        default_status = default_status_result.scalar_one_or_none() or "open"

        ticket = Ticket(
            title=title[:255],
            description=description,
            status=default_status,
            priority=priority,
            category_id=category_id,
            submitter_id=submitter_id,
            slack_submitter_name=slack_submitter_name if not submitter_id else None,
            slack_submitter_id=slack_submitter_id,
            sla_policy_id=sla_policy_id,
            sla_deadline=sla_deadline,
            first_response_deadline=first_response_deadline,
            slack_channel_id=slack_channel_id,
            slack_message_ts=slack_message_ts,
            created_at=now,
            updated_at=now,
        )
        session.add(ticket)
        await session.flush()

        await session.commit()
        await session.refresh(ticket)

        logger.info(
            "Created ticket %s from Slack (submitter_id=%s, slack_channel=%s)",
            ticket.display_id,
            submitter_id,
            slack_channel_id,
        )
        return ticket


# ── Web → Slack sync ───────────────────────────────────────────────────────────


async def notify_reporter_dm(ticket: Ticket, slack_user_id: str) -> None:
    """
    Send a DM to a Slack user when a ticket is opened on their behalf via the web portal.

    Posts the confirmation to the user's DM channel (using the Slack user ID as
    the channel), then saves the returned channel_id + ts on the ticket so all
    future web-portal replies and status updates thread back to the user.
    """
    from app.slack.bot import get_slack_client

    client = get_slack_client()
    if client is None:
        return

    try:
        result = await client.chat_postMessage(
            channel=slack_user_id,
            text=(
                f"📋 A ticket has been opened on your behalf.\n"
                f"*{ticket.display_id}* — {ticket.title}\n"
                f"Our team will be in touch shortly. Reply here to add a comment."
            ),
        )
        dm_channel_id: Optional[str] = result.get("channel")
        message_ts: Optional[str] = result.get("ts")
        if dm_channel_id and message_ts:
            async with AsyncSessionLocal() as session:
                t = await session.get(Ticket, ticket.id)
                if t:
                    t.slack_channel_id = dm_channel_id
                    t.slack_message_ts = message_ts
                    await session.commit()
    except Exception:  # noqa: BLE001
        logger.exception("notify_reporter_dm: failed to DM user %s", slack_user_id)


async def post_reply_to_slack(ticket: Ticket, reply_body: str, author_name: str) -> Optional[str]:
    """
    Post a web portal reply to the originating Slack thread.

    Returns the Slack message ts if successful (used to set reply.slack_ts for
    deduplication), or None if Slack is not configured / sync is disabled.
    """
    if not settings_manager.slack_two_way_sync:
        return None
    if not (ticket.slack_channel_id and ticket.slack_message_ts):
        return None

    from app.slack.bot import get_slack_client
    client = get_slack_client()
    if client is None:
        return None

    try:
        result = await client.chat_postMessage(
            channel=ticket.slack_channel_id,
            thread_ts=ticket.slack_message_ts,
            text=f"*{author_name}:* {reply_body}",
        )
        ts: Optional[str] = result.get("ts")
        logger.debug(
            "Synced web reply to Slack thread %s (ticket %s, ts=%s)",
            ticket.slack_message_ts, ticket.display_id, ts,
        )
        return ts
    except Exception:  # noqa: BLE001
        logger.exception(
            "Failed to post reply to Slack thread for ticket %s", ticket.display_id
        )
        return None


async def post_ticket_update_to_slack(
    ticket: Ticket,
    changes: dict,
    actor_name: str,
    *,
    assignee_name: Optional[str] = None,
    category_name: Optional[str] = None,
) -> None:
    """
    Post a single combined update message to the originating Slack thread
    covering any combination of status, priority, assignee, and category changes.
    Silently no-ops if Slack is not configured / sync is disabled / no thread anchor.
    """
    if not settings_manager.slack_two_way_sync:
        return
    if not (ticket.slack_channel_id and ticket.slack_message_ts):
        return

    from app.slack.bot import get_slack_client
    client = get_slack_client()
    if client is None:
        return

    lines: list[str] = []

    if "status" in changes:
        _, new_val = changes["status"]
        label = _STATUS_LABELS.get(new_val or "", new_val or "")
        lines.append(f"• Status → *{label}*")

    if "priority" in changes:
        _, new_val = changes["priority"]
        label = _PRIORITY_LABELS.get(new_val or "", (new_val or "").capitalize())
        lines.append(f"• Priority → *{label}*")

    if "assignee_id" in changes:
        _, new_val = changes["assignee_id"]
        if new_val:
            lines.append(f"• Assigned to → *{assignee_name or 'Unknown'}*")
        else:
            lines.append("• Assignee → *Unassigned*")

    if "category_id" in changes:
        _, new_val = changes["category_id"]
        if new_val:
            lines.append(f"• Category → *{category_name or 'Unknown'}*")
        else:
            lines.append("• Category → *Removed*")

    if not lines:
        return

    text = f"🔄 *{ticket.display_id}* updated by {actor_name}\n" + "\n".join(lines)

    try:
        await client.chat_postMessage(
            channel=ticket.slack_channel_id,
            thread_ts=ticket.slack_message_ts,
            text=text,
        )
        logger.debug("Posted field update to Slack thread for ticket %s", ticket.display_id)
    except Exception:  # noqa: BLE001
        logger.exception(
            "Failed to post field update to Slack for ticket %s", ticket.display_id
        )


# ── Slack → Web sync ───────────────────────────────────────────────────────────


async def handle_slack_thread_message(
    *,
    channel_id: str,
    thread_ts: str,
    message_ts: str,
    slack_user_id: str,
    text: str,
    client: Any,
    files: Optional[list[dict]] = None,
) -> None:
    """
    Sync an inbound Slack thread reply to SimpleTickets as a public reply.

    Called from the Bolt 'message' event handler when a human posts a reply
    inside a ticket's Slack thread. Creates a TicketReply with slack_ts set
    so the reply is never re-posted back to Slack (deduplication).
    """
    if not settings_manager.slack_two_way_sync:
        return

    async with AsyncSessionLocal() as session:
        # Find the ticket whose Slack thread matches
        result = await session.execute(
            select(Ticket).where(
                Ticket.slack_channel_id == channel_id,
                Ticket.slack_message_ts == thread_ts,
            )
        )
        ticket = result.scalar_one_or_none()
        if ticket is None:
            return  # thread doesn't belong to any ticket

        # Dedup: skip if this Slack ts is already recorded on a reply
        existing = await session.execute(
            select(TicketReply).where(
                TicketReply.ticket_id == ticket.id,
                TicketReply.slack_ts == message_ts,
            )
        )
        if existing.scalar_one_or_none() is not None:
            logger.debug(
                "Skipping already-synced Slack ts=%s for ticket %s", message_ts, ticket.display_id
            )
            return

        # Match Slack user → SimpleTickets user (tech/admin only)
        author_id: Optional[int] = None
        author_name_fallback = "Slack user"

        if slack_user_id:
            try:
                matched = await get_user_by_slack_id(session, slack_user_id)
                if matched:
                    author_id = matched.id
                    author_name_fallback = matched.name
                else:
                    # Unknown Slack user — try to fetch display name for logging
                    user_info = await client.users_info(user=slack_user_id)
                    profile = user_info.get("user", {}).get("profile", {})
                    author_name_fallback = (
                        profile.get("display_name") or profile.get("real_name", "Slack user")
                    )
            except Exception:  # noqa: BLE001
                logger.exception(
                    "handle_slack_thread_message: user lookup failed for %s", slack_user_id
                )

        now = _utcnow()

        # Re-open resolved/closed tickets when the user replies from Slack
        resolved_result = await session.execute(
            select(TicketStatusConfig.name).where(
                TicketStatusConfig.is_resolved_state == True  # noqa: E712
            )
        )
        resolved_names = {row[0] for row in resolved_result.all()} or {"resolved", "closed"}
        if ticket.status in resolved_names:
            old_status = ticket.status
            ticket.status = "in_progress"
            ticket.resolved_at = None
            ticket.updated_at = now
            session.add(
                TicketHistory(
                    ticket_id=ticket.id,
                    actor_id=None,
                    field_changed="status",
                    old_value=old_status,
                    new_value="in_progress",
                    created_at=now,
                )
            )
            logger.info(
                "Re-opened ticket %s (was %s) due to Slack reply from %s",
                ticket.display_id, old_status.value, author_name_fallback,
            )

        # Record first response if this is a tech/admin replying and none recorded yet
        if author_id is not None and ticket.first_responded_at is None:
            ticket.first_responded_at = now
            ticket.updated_at = now

        reply = TicketReply(
            ticket_id=ticket.id,
            author_id=author_id,
            body=text or "(no content)",
            is_internal=False,
            slack_ts=message_ts,
            slack_author_name=author_name_fallback if author_id is None else None,
            created_at=now,
        )
        session.add(reply)
        await session.commit()

        logger.info(
            "Synced Slack thread reply %s → ticket %s (author=%s)",
            message_ts,
            ticket.display_id,
            author_name_fallback if author_id is None else f"id={author_id}",
        )

        # Download any attached files from the Slack message
        if files:
            await _download_slack_files(ticket.id, reply.id, files)


# ── App Home ──────────────────────────────────────────────────────────────────

_HOME_STATUS_EMOJI: dict[str, str] = {
    "open": "🆕",
    "in_progress": "🚀",
    "pending_user": "⏳",
    "resolved": "✅",
    "closed": "🔒",
}

_HOME_PRIORITY_EMOJI: dict[str, str] = {
    "low": "🔵",
    "medium": "🟡",
    "high": "🟠",
    "critical": "🔴",
}

async def build_home_view(slack_user_id: str, client: Any) -> dict:
    """
    Build the Block Kit view for a user's App Home tab.
    Shows their open tickets with a button to jump to each Slack thread.
    """
    async with AsyncSessionLocal() as session:
        # Non-resolved statuses — tickets still active for this user
        open_result = await session.execute(
            select(TicketStatusConfig.name).where(
                TicketStatusConfig.is_resolved_state == False,  # noqa: E712
                TicketStatusConfig.is_archived == False,  # noqa: E712
            )
        )
        open_status_names = [row[0] for row in open_result.all()] or ["open", "in_progress", "pending_user"]

        result = await session.execute(
            select(Ticket)
            .where(
                Ticket.slack_submitter_id == slack_user_id,
                Ticket.status.in_(open_status_names),
            )
            .order_by(Ticket.created_at.desc())
            .limit(20)
        )
        tickets = result.scalars().all()

    blocks: list[dict] = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": "📋  My Support Tickets", "emoji": True},
        },
        {"type": "divider"},
    ]

    if not tickets:
        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "_You have no open tickets right now._\n\nUse the button below to submit a new request.",
            },
        })
    else:
        for ticket in tickets:
            status_emoji = _HOME_STATUS_EMOJI.get(ticket.status.value, "•")
            priority_emoji = _HOME_PRIORITY_EMOJI.get(ticket.priority.value, "•")

            # Try to get a permalink to the Slack thread
            view_button: dict | None = None
            if ticket.slack_channel_id and ticket.slack_message_ts:
                try:
                    pl = await client.chat_getPermalink(
                        channel=ticket.slack_channel_id,
                        message_ts=ticket.slack_message_ts,
                    )
                    permalink: str | None = pl.get("permalink")
                    if permalink:
                        view_button = {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "View thread", "emoji": False},
                            "url": permalink,
                            "action_id": f"view_thread_{ticket.id}",
                        }
                except Exception:  # noqa: BLE001
                    pass

            section: dict = {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": (
                        f"*{ticket.display_id}* · {status_emoji} {ticket.status.value.replace('_', ' ').title()}"
                        f"  {priority_emoji} {ticket.priority.value.capitalize()}\n"
                        f"{ticket.title}"
                    ),
                },
            }
            if view_button:
                section["accessory"] = view_button

            blocks.append(section)
            blocks.append({"type": "divider"})

    blocks += [
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "➕  Submit a new ticket", "emoji": True},
                    "style": "primary",
                    "action_id": "open_ticket_modal",
                }
            ],
        }
    ]

    return {"type": "home", "blocks": blocks}


# ── Slack file helpers ─────────────────────────────────────────────────────────

_UNSAFE_CHARS = re.compile(r"[^\w.\-]")

_ALLOWED_IMAGE_PREFIXES = ("image/",)
_ALLOWED_MIME_EXACT = {
    "application/pdf", "text/plain", "text/csv",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


def _allowed_mime(mime: str) -> bool:
    return any(mime.startswith(p) for p in _ALLOWED_IMAGE_PREFIXES) or mime in _ALLOWED_MIME_EXACT


async def _download_slack_files(
    ticket_id: int,
    reply_id: Optional[int],
    files: list[dict],
) -> None:
    """Download Slack file attachments and persist them as TicketAttachment records."""
    bot_token = settings_manager.slack_bot_token
    if not bot_token:
        return

    async with AsyncSessionLocal() as session:
        for file_info in files:
            slack_file_id = file_info.get("id")
            if not slack_file_id:
                continue

            # Dedup: skip if already downloaded for this ticket
            existing = await session.execute(
                select(TicketAttachment).where(
                    TicketAttachment.slack_file_id == slack_file_id,
                    TicketAttachment.ticket_id == ticket_id,
                )
            )
            if existing.scalar_one_or_none():
                continue

            url = file_info.get("url_private_download") or file_info.get("url_private")
            if not url:
                continue

            filename = file_info.get("name", "attachment")
            mimetype = file_info.get("mimetype", "application/octet-stream")
            size = file_info.get("size", 0)

            if size > 10 * 1024 * 1024:
                logger.warning("Skipping oversized Slack file %s (%d bytes)", slack_file_id, size)
                continue

            if not _allowed_mime(mimetype):
                logger.debug("Skipping disallowed MIME %s for Slack file %s", mimetype, slack_file_id)
                continue

            try:
                async with httpx.AsyncClient(timeout=30) as http:
                    resp = await http.get(
                        url,
                        headers={"Authorization": f"Bearer {bot_token}"},
                        follow_redirects=True,
                    )
                    resp.raise_for_status()
                    content = resp.content
            except Exception:
                logger.exception("Failed to download Slack file %s", slack_file_id)
                continue

            safe_name = _UNSAFE_CHARS.sub("_", Path(filename).name)[:200] or "file"
            unique_name = f"{uuid.uuid4().hex}_{safe_name}"
            storage_dir = Path(settings.storage_local_path) / str(ticket_id)
            storage_dir.mkdir(parents=True, exist_ok=True)
            abs_path = storage_dir / unique_name

            try:
                async with aiofiles.open(abs_path, "wb") as f:
                    await f.write(content)
            except Exception:
                logger.exception("Failed to write Slack file %s to disk", slack_file_id)
                continue

            session.add(TicketAttachment(
                ticket_id=ticket_id,
                reply_id=reply_id,
                filename=filename,
                storage_path=str(Path(str(ticket_id)) / unique_name),
                mime_type=mimetype,
                size_bytes=len(content),
                slack_file_id=slack_file_id,
                created_at=_utcnow(),
            ))

        await session.commit()
    logger.info("Downloaded %d Slack file(s) for ticket %d", len(files), ticket_id)


async def upload_attachments_to_slack(
    ticket: Ticket,
    reply_id: Optional[int],
) -> None:
    """
    Upload web attachments to the originating Slack thread.

    Pass reply_id=None to upload ticket-level attachments (e.g. on ticket creation).
    Pass a reply_id to upload attachments linked to a specific reply.
    Uses the files_upload_v2 (getUploadURLExternal) flow.
    Silently no-ops if Slack is not configured / no thread / no attachments.
    """
    if not settings_manager.slack_two_way_sync:
        return
    if not (ticket.slack_channel_id and ticket.slack_message_ts):
        return

    from app.slack.bot import get_slack_client
    client = get_slack_client()
    if client is None:
        return

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(TicketAttachment).where(
                TicketAttachment.ticket_id == ticket.id,
                TicketAttachment.reply_id == reply_id,
                TicketAttachment.slack_file_id.is_(None),  # not from Slack
            )
        )
        attachments = result.scalars().all()

    for att in attachments:
        abs_path = Path(settings.storage_local_path) / att.storage_path
        if not abs_path.exists():
            continue
        try:
            content = abs_path.read_bytes()

            # Step 1: get upload URL
            upload_resp = await client.files_getUploadURLExternal(
                filename=att.filename,
                length=len(content),
            )
            upload_url: str = upload_resp["upload_url"]
            file_id: str = upload_resp["file_id"]

            # Step 2: upload content
            async with httpx.AsyncClient(timeout=60) as http:
                await http.post(
                    upload_url,
                    content=content,
                    headers={"Content-Type": att.mime_type},
                )

            # Step 3: complete and share to thread
            await client.files_completeUploadExternal(
                files=[{"id": file_id, "title": att.filename}],
                channel_id=ticket.slack_channel_id,
                thread_ts=ticket.slack_message_ts,
            )

            logger.debug("Uploaded attachment %d (%s) to Slack thread", att.id, att.filename)
        except Exception:
            logger.exception("Failed to upload attachment %d to Slack", att.id)
