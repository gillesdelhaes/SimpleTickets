"""
Internal service for creating tickets from Slack events and syncing replies
between SimplyTickets and Slack threads.

Called by Slack handlers and HTTP routers — bypasses HTTP, writes directly to DB.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings_manager
from app.database import AsyncSessionLocal
from app.models import Category, SLAPolicy, Ticket, TicketReply, User
from app.models.enums import Priority, TicketStatus

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
    """Find an active SimplyTickets (technician/admin) user by their Slack user ID."""
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
        if sla_policy:
            sla_policy_id = sla_policy.id
            sla_deadline = now + timedelta(minutes=sla_policy.resolution_minutes)

        ticket = Ticket(
            title=title[:255],
            description=description,
            status=TicketStatus.open,
            priority=priority,
            category_id=category_id,
            submitter_id=submitter_id,
            slack_submitter_name=slack_submitter_name if not submitter_id else None,
            sla_policy_id=sla_policy_id,
            sla_deadline=sla_deadline,
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
) -> None:
    """
    Sync an inbound Slack thread reply to SimplyTickets as a public reply.

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

        # Match Slack user → SimplyTickets user (tech/admin only)
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

        reply = TicketReply(
            ticket_id=ticket.id,
            author_id=author_id,
            body=text or "(no content)",
            is_internal=False,
            slack_ts=message_ts,
            slack_author_name=author_name_fallback if author_id is None else None,
            created_at=_utcnow(),
        )
        session.add(reply)
        await session.commit()

        logger.info(
            "Synced Slack thread reply %s → ticket %s (author=%s)",
            message_ts,
            ticket.display_id,
            author_name_fallback if author_id is None else f"id={author_id}",
        )
