"""
Internal service for creating tickets from Slack events and syncing replies
between SimpleTickets and Slack threads.

Called by Slack handlers and HTTP routers — bypasses HTTP, writes directly to DB.
"""
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import aiofiles
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings, settings_manager
from app.services.sla import compute_sla_deadline
from app.utils import utcnow
from app.database import AsyncSessionLocal
from app.models import Category, SLAPolicy, Ticket, TicketHistory, TicketReply, User
from app.models.enums import Priority
from app.models.ticket_attachment import TicketAttachment
from app.models.ticket_status_config import TicketStatusConfig

logger = logging.getLogger(__name__)

_PRIORITY_LABELS: dict[str, str] = {
    "low": "Low",
    "medium": "Medium",
    "high": "High",
    "critical": "Critical 🚨",
}


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
        now = utcnow()

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
            sla_deadline = await compute_sla_deadline(now, sla_policy.resolution_minutes, session)
            first_response_deadline = await compute_sla_deadline(now, sla_policy.first_response_minutes, session)

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

        session.add(TicketHistory(
            ticket_id=ticket.id,
            actor_id=None,
            field_changed="status",
            old_value=None,
            new_value=default_status,
        ))

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


async def notify_assignee_dm(ticket: Ticket, assignee_slack_user_id: str, actor_name: str) -> None:
    """DM a technician when they are assigned a ticket."""
    if not settings_manager.slack_two_way_sync:
        return
    from app.slack.bot import get_slack_client
    client = get_slack_client()
    if client is None:
        return

    priority_str = ticket.priority.value if hasattr(ticket.priority, "value") else str(ticket.priority)
    emoji = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🔵"}.get(priority_str, "⚪")

    try:
        await client.chat_postMessage(
            channel=assignee_slack_user_id,
            text=(
                f"👤 *You've been assigned a ticket*\n"
                f"*{ticket.display_id}* — {ticket.title}\n"
                f"Priority: {emoji} {priority_str.capitalize()} · Assigned by {actor_name}"
            ),
        )
    except Exception:  # noqa: BLE001
        logger.exception("notify_assignee_dm: failed to DM assignee %s", assignee_slack_user_id)


async def notify_duplicate_dm(ticket: Ticket, canonical: Ticket, submitter_slack_id: str) -> None:
    """DM the ticket submitter when their ticket is closed as a duplicate."""
    if not settings_manager.slack_two_way_sync:
        return
    from app.slack.bot import get_slack_client
    client = get_slack_client()
    if client is None:
        return
    try:
        await client.chat_postMessage(
            channel=submitter_slack_id,
            text=(
                f"🔗 Your ticket *{ticket.display_id}* has been marked as a duplicate of "
                f"*{canonical.display_id}* — {canonical.title}\n"
                f"It has been closed. If you think this is incorrect, please reply here."
            ),
        )
    except Exception:  # noqa: BLE001
        logger.exception("notify_duplicate_dm: failed to DM %s", submitter_slack_id)


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


async def _get_submitter_slack_id(ticket: Ticket) -> str | None:
    """Return the Slack user ID for DM notifications.
    Uses slack_submitter_id if present; falls back to the linked User.slack_user_id
    for tickets submitted via the portal where only submitter_id is set."""
    if ticket.slack_submitter_id:
        return ticket.slack_submitter_id
    if ticket.submitter_id:
        async with AsyncSessionLocal() as session:
            user = await session.get(User, ticket.submitter_id)
            if user and user.slack_user_id:
                return user.slack_user_id
    return None


async def post_reply_to_slack(
    ticket: Ticket,
    reply_body: str,
    author_name: str,
    notify_submitter: bool = True,
) -> Optional[str]:
    """
    Post a web portal reply to the originating Slack thread, then DM the
    submitter at the top level so they get an unread notification.

    Pass notify_submitter=False when the reply was authored by the submitter
    themselves (e.g. via the App Home reply modal) to avoid a self-notification.

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

    ts: Optional[str] = None
    try:
        result = await client.chat_postMessage(
            channel=ticket.slack_channel_id,
            thread_ts=ticket.slack_message_ts,
            text=f"*{author_name}:* {reply_body}",
        )
        ts = result.get("ts")
        logger.debug(
            "Synced web reply to Slack thread %s (ticket %s, ts=%s)",
            ticket.slack_message_ts, ticket.display_id, ts,
        )
    except Exception:  # noqa: BLE001
        logger.exception(
            "Failed to post reply to Slack thread for ticket %s", ticket.display_id
        )

    # Top-level DM so the submitter sees an unread notification
    submitter_slack_id = await _get_submitter_slack_id(ticket)
    if notify_submitter and submitter_slack_id:
        try:
            await client.chat_postMessage(
                channel=submitter_slack_id,
                text=(
                    f"💬 *New reply on {ticket.display_id}*\n"
                    f"*{author_name}:* {reply_body}\n"
                    f"_Open your support thread above to reply._"
                ),
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "Failed to send reply notification DM for ticket %s", ticket.display_id
            )

    return ts


async def post_ticket_update_to_slack(
    ticket: Ticket,
    changes: dict,
    actor_name: str,
    *,
    assignee_name: Optional[str] = None,
    category_name: Optional[str] = None,
    notify_submitter: bool = True,
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
        slug = new_val or ""
        label = slug.replace("_", " ").title()
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

    # Top-level DM so the submitter sees an unread notification
    submitter_slack_id = await _get_submitter_slack_id(ticket)
    if notify_submitter and submitter_slack_id:
        try:
            await client.chat_postMessage(
                channel=submitter_slack_id,
                text=text,
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "Failed to send update notification DM for ticket %s", ticket.display_id
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

        now = utcnow()

        # Re-open resolved/closed tickets when the user replies from Slack
        resolved_result = await session.execute(
            select(TicketStatusConfig.name).where(
                TicketStatusConfig.is_resolved_state == True  # noqa: E712
            )
        )
        resolved_names = {row[0] for row in resolved_result.all()} or {"resolved", "closed"}
        if ticket.status in resolved_names:
            old_status = ticket.status
            reopen_result = await session.execute(
                select(TicketStatusConfig.name)
                .where(
                    TicketStatusConfig.is_resolved_state == False,  # noqa: E712
                    TicketStatusConfig.pauses_sla == False,  # noqa: E712
                    TicketStatusConfig.is_archived == False,  # noqa: E712
                )
                .order_by(TicketStatusConfig.sort_order)
                .limit(1)
            )
            reopen_status = reopen_result.scalar_one_or_none() or "in_progress"
            ticket.status = reopen_status
            ticket.resolved_at = None
            ticket.updated_at = now
            session.add(
                TicketHistory(
                    ticket_id=ticket.id,
                    actor_id=None,
                    field_changed="status",
                    old_value=old_status,
                    new_value=reopen_status,
                    created_at=now,
                )
            )
            logger.info(
                "Re-opened ticket %s (was %s → %s) due to Slack reply from %s",
                ticket.display_id, old_status, reopen_status, author_name_fallback,
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


def _time_ago_home(dt: datetime) -> str:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    secs = max(0, int((now - dt).total_seconds()))
    if secs < 60:
        return "just now"
    mins = secs // 60
    if mins < 60:
        return f"{mins}m ago"
    hours = mins // 60
    if hours < 24:
        return f"{hours}h ago"
    days = hours // 24
    return f"{days}d ago"


def _format_sla_home(ticket: "Ticket") -> str | None:
    if not ticket.sla_deadline:
        return None
    if ticket.sla_breached:
        return "🚨 SLA breached"
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    remaining = (ticket.sla_deadline - now).total_seconds()
    if remaining <= 0:
        return "🚨 SLA breached"
    if remaining < 3600:
        return f"⏱ SLA: {int(remaining // 60)}m left"
    if remaining < 86400:
        h, m = int(remaining // 3600), int((remaining % 3600) // 60)
        return f"⏱ SLA: {h}h {m}m left"
    return f"⏱ SLA: {int(remaining // 86400)}d left"


async def build_home_view(slack_user_id: str, client: Any, tab: str = "active") -> dict:
    """
    Build the Block Kit view for a user's App Home tab.

    Tabs:
    - active:   open + in-progress (non-resolved, non-paused)
    - pending:  tickets paused waiting on user
    - resolved: resolved / closed tickets
    """
    import json

    async with AsyncSessionLocal() as session:
        status_result = await session.execute(select(TicketStatusConfig))
        all_statuses = status_result.scalars().all()

    active_names = [s.name for s in all_statuses if not s.is_resolved_state and not s.pauses_sla and not s.is_archived] or ["open", "in_progress"]
    pending_names = [s.name for s in all_statuses if s.pauses_sla and not s.is_archived] or ["pending_user"]
    resolved_names = [s.name for s in all_statuses if s.is_resolved_state and not s.is_archived] or ["resolved", "closed"]

    if tab == "pending":
        status_filter = pending_names
    elif tab == "resolved":
        status_filter = resolved_names
    else:
        status_filter = active_names
        tab = "active"

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Ticket)
            .where(
                Ticket.slack_submitter_id == slack_user_id,
                Ticket.status.in_(status_filter),
            )
            .order_by(Ticket.created_at.desc())
            .limit(10)
        )
        tickets = result.scalars().all()

    # ── Tab strip ──────────────────────────────────────────────────────────────

    def _tab_btn(label: str, tab_id: str) -> dict:
        btn: dict = {
            "type": "button",
            "text": {"type": "plain_text", "text": label, "emoji": True},
            "action_id": f"home_tab_{tab_id}",
            "value": tab_id,
        }
        if tab_id == tab:
            btn["style"] = "primary"
        return btn

    blocks: list[dict] = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": "📋  My Support Tickets", "emoji": True},
        },
        {
            "type": "actions",
            "elements": [
                _tab_btn("🔥 Active", "active"),
                _tab_btn("⏳ Pending", "pending"),
                _tab_btn("✅ Resolved", "resolved"),
            ],
        },
        {"type": "divider"},
    ]

    # ── Ticket cards ───────────────────────────────────────────────────────────

    if not tickets:
        empty = {
            "active":   "_No active tickets right now — all clear!_ 🎉",
            "pending":  "_No tickets waiting on your response._",
            "resolved": "_No resolved tickets yet._",
        }
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": empty.get(tab, "_No tickets found._")},
        })
    else:
        for ticket in tickets:
            status_str = ticket.status.value if hasattr(ticket.status, "value") else str(ticket.status)
            priority_str = ticket.priority.value if hasattr(ticket.priority, "value") else str(ticket.priority)
            status_emoji = _HOME_STATUS_EMOJI.get(status_str, "•")
            priority_emoji = _HOME_PRIORITY_EMOJI.get(priority_str, "•")
            status_label = status_str.replace("_", " ").title()

            # View thread permalink button (accessory)
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
                            "text": {"type": "plain_text", "text": "View thread ↗", "emoji": False},
                            "url": permalink,
                            "action_id": f"view_thread_{ticket.id}",
                        }
                except Exception:  # noqa: BLE001
                    pass

            # Main section
            section: dict = {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": (
                        f"{status_emoji} *{status_label}*  ·  {priority_emoji} {priority_str.capitalize()}\n"
                        f"*{ticket.display_id}* — {ticket.title}"
                    ),
                },
            }
            if view_button:
                section["accessory"] = view_button
            blocks.append(section)

            # Context: age + SLA
            context_parts = [f"📅 Opened {_time_ago_home(ticket.created_at)}"]
            sla_text = _format_sla_home(ticket)
            if sla_text:
                context_parts.append(sla_text)
            blocks.append({
                "type": "context",
                "elements": [{"type": "mrkdwn", "text": "  ·  ".join(context_parts)}],
            })

            # Action buttons (not for resolved tab)
            if tab != "resolved":
                meta = json.dumps({"tid": ticket.id, "tab": tab})
                blocks.append({
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "💬 Reply", "emoji": True},
                            "action_id": f"home_reply_{ticket.id}",
                            "value": meta,
                        },
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "✓ Resolve", "emoji": True},
                            "action_id": f"home_resolve_{ticket.id}",
                            "value": meta,
                            "confirm": {
                                "title": {"type": "plain_text", "text": "Resolve ticket?"},
                                "text": {
                                    "type": "mrkdwn",
                                    "text": f"Mark *{ticket.display_id}* as resolved?",
                                },
                                "confirm": {"type": "plain_text", "text": "Yes, resolve"},
                                "deny": {"type": "plain_text", "text": "Cancel"},
                            },
                        },
                    ],
                })

            blocks.append({"type": "divider"})

    # ── Footer ─────────────────────────────────────────────────────────────────

    blocks.append({
        "type": "actions",
        "elements": [
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "➕  Submit a new ticket", "emoji": True},
                "style": "primary",
                "action_id": "open_ticket_modal",
            }
        ],
    })

    return {"type": "home", "blocks": blocks, "private_metadata": tab}


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
            size = file_info.get("size", 0)

            if size > 10 * 1024 * 1024:
                logger.warning("Skipping oversized Slack file %s (%d bytes)", slack_file_id, size)
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

            # Detect MIME from actual bytes — don't trust Slack's metadata
            import magic as _magic
            mimetype = _magic.from_buffer(content, mime=True)
            if not _allowed_mime(mimetype):
                logger.debug("Skipping disallowed MIME %s for Slack file %s", mimetype, slack_file_id)
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
                created_at=utcnow(),
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


# ── SLA breach warning ─────────────────────────────────────────────────────────


async def post_sla_warning_to_technicians(
    ticket: Ticket,
    session: AsyncSession,
    kind: str = "sla",
) -> None:
    """
    DM every active technician/admin who has a slack_user_id registered.
    kind='sla'            — resolution SLA breach in ~15 min
    kind='first_response' — first-response deadline in ~15 min
    Fire-and-forget — errors are logged, not raised.
    """
    if not settings_manager.slack_two_way_sync:
        return

    from app.slack.bot import get_slack_client
    client = get_slack_client()
    if client is None:
        return

    # Fetch all active staff with a Slack user ID
    result = await session.execute(
        select(User).where(
            User.slack_user_id.isnot(None),
            User.is_active == True,  # noqa: E712
            User.role.in_(["technician", "admin"]),
        )
    )
    technicians = result.scalars().all()
    if not technicians:
        return

    # Resolve assignee name
    assignee_name = "Unassigned"
    if ticket.assignee_id:
        assignee_result = await session.execute(select(User).where(User.id == ticket.assignee_id))
        assignee = assignee_result.scalar_one_or_none()
        if assignee:
            assignee_name = assignee.name or assignee.email

    # Build deadline display
    raw_deadline = ticket.first_response_deadline if kind == "first_response" else ticket.sla_deadline
    if raw_deadline is not None:
        dl = raw_deadline if raw_deadline.tzinfo else raw_deadline.replace(tzinfo=timezone.utc)
        deadline_str = dl.strftime("%H:%M UTC")
    else:
        deadline_str = "unknown"

    _PRIORITY_EMOJI = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🔵"}
    priority_str = ticket.priority.value if hasattr(ticket.priority, "value") else str(ticket.priority)
    emoji = _PRIORITY_EMOJI.get(priority_str, "⚪")

    thread_hint = ""
    if ticket.slack_channel_id and ticket.slack_message_ts:
        thread_hint = "\n_Reply in the original Slack thread or open the web portal._"

    if kind == "first_response":
        headline = "⚠️ *First response due in ~15 minutes*"
    else:
        headline = "⚠️ *SLA breach in ~15 minutes*"

    text = (
        f"{headline}\n"
        f"*{ticket.display_id}* · {ticket.title}\n"
        f"Priority: {emoji} {priority_str.capitalize()} · "
        f"Assignee: {assignee_name} · "
        f"Deadline: {deadline_str}"
        f"{thread_hint}"
    )

    for tech in technicians:
        try:
            await client.chat_postMessage(
                channel=tech.slack_user_id,  # DM when channel = user ID
                text=text,
            )
            logger.debug("Sent SLA warning DM to %s for ticket %s", tech.slack_user_id, ticket.display_id)
        except Exception:
            logger.exception("Failed to send SLA warning DM to %s", tech.slack_user_id)
