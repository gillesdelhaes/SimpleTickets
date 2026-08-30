"""
Internal service for creating tickets from Slack events and syncing replies
between SimpleTickets and Slack threads.

Called by Slack handlers and HTTP routers — bypasses HTTP, writes directly to DB.

Multi-workspace: every ticket that has a Slack origin carries a
`workspace_id` (see models.Ticket), and every staff Slack identity is scoped
to one workspace (see models.UserSlackIdentity, since Slack user IDs are
workspace-specific). Almost every function below takes (or reads off) a
`ticket`/`workspace_id` to resolve the right bot client and the right staff
identities — see `_get_workspace`, `_get_staff_slack_id`,
`_get_submitter_slack_id`.
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

from app.config import settings
from app.services.sla import compute_sla_deadline
from app.services.settings_service import decrypt_value
from app.utils import utcnow
from app.database import AsyncSessionLocal
from app.models import Category, SLAPolicy, Ticket, TicketHistory, TicketReply, User
from app.models.enums import Priority
from app.models.slack_workspace import SlackWorkspace
from app.models.ticket_attachment import TicketAttachment
from app.models.ticket_status_config import TicketStatusConfig
from app.models.user_slack_identity import UserSlackIdentity

logger = logging.getLogger(__name__)

_PRIORITY_LABELS: dict[str, str] = {
    "low": "Low",
    "medium": "Medium",
    "high": "High",
    "critical": "Critical 🚨",
}


def slack_escape(text: str) -> str:
    """
    Escape Slack mrkdwn control characters in user-controlled text before
    interpolating it into a message. Without this, a ticket title or reply
    body containing `<!channel>`, `<!here>`, `<@Uxxxx>`, or `<https://evil|
    looks-trusted>` renders as a real channel ping, mention, or clickable
    link once posted by the bot — and titles are settable by any Slack
    workspace member (DM/`/ticket`) or any authenticated web user, not just
    staff. Per Slack's own escaping rules: & first, then < and >.
    """
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# ── Workspace / staff identity lookups ──────────────────────────────────────────


async def _get_workspace(session: AsyncSession, workspace_id: Optional[int]) -> Optional[SlackWorkspace]:
    """Fetch a workspace row, or None if there isn't one (no Slack origin)."""
    if workspace_id is None:
        return None
    return await session.get(SlackWorkspace, workspace_id)


async def get_user_by_slack_id(session: AsyncSession, workspace_id: int, slack_user_id: str) -> Optional[User]:
    """Find an active SimpleTickets (technician/admin) user by their Slack
    user ID within one specific workspace."""
    result = await session.execute(
        select(User)
        .join(UserSlackIdentity, UserSlackIdentity.user_id == User.id)
        .where(
            UserSlackIdentity.workspace_id == workspace_id,
            UserSlackIdentity.slack_user_id == slack_user_id,
            User.is_active == True,  # noqa: E712
        )
    )
    return result.scalar_one_or_none()


async def _get_staff_slack_id(session: AsyncSession, user_id: int, workspace_id: Optional[int]) -> Optional[str]:
    """Return a staff member's linked Slack user ID for one workspace, or None
    if they have no identity there (or there's no workspace to look in)."""
    if workspace_id is None:
        return None
    result = await session.execute(
        select(UserSlackIdentity.slack_user_id).where(
            UserSlackIdentity.user_id == user_id,
            UserSlackIdentity.workspace_id == workspace_id,
        )
    )
    return result.scalar_one_or_none()


async def _get_submitter_slack_id(ticket: Ticket) -> str | None:
    """Return the Slack user ID for DM notifications, scoped to the ticket's
    originating workspace. Uses slack_submitter_id if present (captured at
    creation time, already workspace-correct); falls back to the linked
    staff User's identity in that same workspace for tickets a technician
    submitted for themselves via the portal."""
    if ticket.slack_submitter_id:
        return ticket.slack_submitter_id
    if ticket.submitter_id and ticket.workspace_id:
        async with AsyncSessionLocal() as session:
            return await _get_staff_slack_id(session, ticket.submitter_id, ticket.workspace_id)
    return None


# ── Ticket creation ────────────────────────────────────────────────────────────


async def create_ticket_from_slack(
    *,
    title: str,
    description: str,
    workspace_id: int,
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
            workspace_id=workspace_id,
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
            "Created ticket %s from Slack (submitter_id=%s, workspace_id=%s, slack_channel=%s)",
            ticket.display_id,
            submitter_id,
            workspace_id,
            slack_channel_id,
        )
        await post_ticket_created_notification(ticket, session)
        return ticket


async def post_ticket_created_notification(ticket: Ticket, session: AsyncSession) -> None:
    """
    Post a visibility announcement to the workspace's configured
    `ticket_created_target` channel whenever a new ticket is created —
    regardless of source (Slack DM, /ticket, reaction, message shortcut, or
    the web UI). No-op if no target is configured.

    Deliberately minimal content: ticket ID, title, priority, category. No
    requester name and no description — this is a one-way announcement
    channel, not a second intake surface (see the session-9 rejection of
    "monitored Slack channels" for intake, which this is not).
    Fire-and-forget — errors are logged, not raised.
    """
    if ticket.workspace_id is None:
        return
    workspace = await _get_workspace(session, ticket.workspace_id)
    if workspace is None or not workspace.ticket_created_target:
        return

    from app.slack.bot import get_slack_client
    client = get_slack_client(ticket.workspace_id)
    if client is None:
        return

    _PRIORITY_EMOJI = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🔵"}
    priority_str = ticket.priority.value if hasattr(ticket.priority, "value") else str(ticket.priority)
    emoji = _PRIORITY_EMOJI.get(priority_str, "⚪")

    category_str = ""
    if ticket.category_id is not None:
        category = await session.get(Category, ticket.category_id)
        if category:
            category_str = f" · {category.name}"

    text = (
        f"🎫 *New ticket* — {ticket.display_id}\n"
        f"{slack_escape(ticket.title)}\n"
        f"Priority: {emoji} {priority_str.capitalize()}{category_str}"
    )

    try:
        await client.chat_postMessage(channel=workspace.ticket_created_target, text=text)
    except Exception:
        logger.exception(
            "Failed to post new-ticket announcement for %s to %s",
            ticket.display_id,
            workspace.ticket_created_target,
        )


# ── Web → Slack sync ───────────────────────────────────────────────────────────


async def notify_assignee_dm(ticket: Ticket, assignee_user_id: int, actor_name: str) -> None:
    """DM a technician when they are assigned a ticket, via their Slack
    identity for the ticket's originating workspace."""
    if ticket.workspace_id is None:
        return
    async with AsyncSessionLocal() as session:
        workspace = await _get_workspace(session, ticket.workspace_id)
        if workspace is None or not workspace.two_way_sync:
            return
        assignee_slack_id = await _get_staff_slack_id(session, assignee_user_id, ticket.workspace_id)
    if not assignee_slack_id:
        return

    from app.slack.bot import get_slack_client
    client = get_slack_client(ticket.workspace_id)
    if client is None:
        return

    priority_str = ticket.priority.value if hasattr(ticket.priority, "value") else str(ticket.priority)
    emoji = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🔵"}.get(priority_str, "⚪")

    try:
        await client.chat_postMessage(
            channel=assignee_slack_id,
            text=(
                f"👤 *You've been assigned a ticket*\n"
                f"*{ticket.display_id}* — {slack_escape(ticket.title)}\n"
                f"Priority: {emoji} {priority_str.capitalize()} · Assigned by {slack_escape(actor_name)}"
            ),
        )
    except Exception:  # noqa: BLE001
        logger.exception("notify_assignee_dm: failed to DM assignee %s", assignee_slack_id)


async def notify_duplicate_dm(ticket: Ticket, canonical: Ticket) -> None:
    """DM the ticket submitter when their ticket is closed as a duplicate."""
    if ticket.workspace_id is None:
        return
    async with AsyncSessionLocal() as session:
        workspace = await _get_workspace(session, ticket.workspace_id)
    if workspace is None or not workspace.two_way_sync:
        return

    submitter_slack_id = await _get_submitter_slack_id(ticket)
    if not submitter_slack_id:
        return

    from app.slack.bot import get_slack_client
    client = get_slack_client(ticket.workspace_id)
    if client is None:
        return
    try:
        await client.chat_postMessage(
            channel=submitter_slack_id,
            text=(
                f"🔗 Your ticket *{ticket.display_id}* has been marked as a duplicate of "
                f"*{canonical.display_id}* — {slack_escape(canonical.title)}\n"
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
    if ticket.workspace_id is None:
        return

    from app.slack.bot import get_slack_client
    client = get_slack_client(ticket.workspace_id)
    if client is None:
        return

    try:
        result = await client.chat_postMessage(
            channel=slack_user_id,
            text=(
                f"📋 A ticket has been opened on your behalf.\n"
                f"*{ticket.display_id}* — {slack_escape(ticket.title)}\n"
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


async def send_password_reset_dm(user: User, code: str, session: AsyncSession) -> bool:
    """DM a one-time password-reset code to a staff member. Tries every
    workspace where they have a linked Slack identity, in order, until one
    succeeds (staff can be linked in several workspaces). Returns True if the
    Slack API call succeeded — the router still returns a generic response to
    the caller either way, to avoid leaking account/Slack-link state."""
    from app.slack.bot import get_slack_client, is_slack_online

    result = await session.execute(
        select(UserSlackIdentity).where(UserSlackIdentity.user_id == user.id)
    )
    identities = result.scalars().all()

    for identity in identities:
        if not await is_slack_online(identity.workspace_id):
            continue
        client = get_slack_client(identity.workspace_id)
        if client is None:
            continue
        try:
            await client.chat_postMessage(
                channel=identity.slack_user_id,
                text=f"Your SimpleTickets password reset code is {code}",
                blocks=[
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": (
                                "🔑 *Password reset requested*\n"
                                f"Your one-time code is `{code}`\n"
                                "It expires in 15 minutes and can only be used once. "
                                "If you didn't request this, you can ignore this message."
                            ),
                        },
                    }
                ],
            )
            return True
        except Exception:  # noqa: BLE001
            logger.exception(
                "send_password_reset_dm: failed to DM %s in workspace %s",
                identity.slack_user_id, identity.workspace_id,
            )
            continue

    return False



async def send_csat_dm(ticket: "Ticket") -> None:
    """DM the ticket submitter 👍/👎 when their ticket moves to a sends_csat=True status."""
    slack_user_id = await _get_submitter_slack_id(ticket)
    if not slack_user_id or ticket.workspace_id is None:
        return
    from app.slack.bot import get_slack_client
    client = get_slack_client(ticket.workspace_id)
    if client is None:
        return

    from app.services.settings_service import get_setting
    async with AsyncSessionLocal() as session:
        days_str = await get_setting("csat_auto_close_days", session, default="7")
    try:
        days = int(days_str)
    except (ValueError, TypeError):
        days = 7

    try:
        await client.chat_postMessage(
            channel=slack_user_id,
            text=f"Your ticket {ticket.display_id} has been resolved. Did we help?",
            blocks=[
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": (
                            f"✅ *{ticket.display_id}* has been marked as resolved.\n"
                            f"_{slack_escape(ticket.title)}_\n\nDid we solve your issue?"
                        ),
                    },
                },
                {
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "👍 Yes, resolved!"},
                            "style": "primary",
                            "action_id": "csat_positive",
                            "value": str(ticket.id),
                        },
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "👎 Still an issue"},
                            "style": "danger",
                            "action_id": "csat_negative",
                            "value": str(ticket.id),
                        },
                    ],
                },
                {
                    "type": "context",
                    "elements": [
                        {
                            "type": "mrkdwn",
                            "text": (
                                f"No response? The ticket closes automatically in "
                                f"{days} day{'s' if days != 1 else ''}."
                            ),
                        }
                    ],
                },
            ],
        )
        logger.debug("Sent CSAT DM to %s for ticket %s", slack_user_id, ticket.display_id)
    except Exception:  # noqa: BLE001
        logger.exception("send_csat_dm: failed to DM %s", slack_user_id)

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
    deduplication), or None if the ticket has no Slack workspace / sync is
    disabled / Slack isn't configured.
    """
    if ticket.workspace_id is None:
        return None
    async with AsyncSessionLocal() as session:
        workspace = await _get_workspace(session, ticket.workspace_id)
    if workspace is None or not workspace.two_way_sync:
        return None
    if not (ticket.slack_channel_id and ticket.slack_message_ts):
        return None

    from app.slack.bot import get_slack_client
    client = get_slack_client(ticket.workspace_id)
    if client is None:
        return None

    ts: Optional[str] = None
    try:
        result = await client.chat_postMessage(
            channel=ticket.slack_channel_id,
            thread_ts=ticket.slack_message_ts,
            text=f"*{slack_escape(author_name)}:* {slack_escape(reply_body)}",
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
                    f"*{slack_escape(author_name)}:* {slack_escape(reply_body)}\n"
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
    covering any combination of status, priority, assignee, and category
    changes. Silently no-ops if sync is disabled or there's no thread anchor.
    """
    if ticket.workspace_id is None:
        return
    from app.slack.bot import get_slack_client
    client = get_slack_client(ticket.workspace_id)
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

    async with AsyncSessionLocal() as session:
        workspace = await _get_workspace(session, ticket.workspace_id)
    if workspace is None or not workspace.two_way_sync:
        return
    if not (ticket.slack_channel_id and ticket.slack_message_ts):
        return

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
    workspace_id: int,
    files: Optional[list[dict]] = None,
) -> None:
    """
    Sync an inbound Slack thread reply to SimpleTickets as a public reply.

    Called from the Bolt 'message' event handler when a human posts a reply
    inside a ticket's Slack thread. Creates a TicketReply with slack_ts set
    so the reply is never re-posted back to Slack (deduplication).
    """
    async with AsyncSessionLocal() as session:
        workspace = await _get_workspace(session, workspace_id)
    if workspace is None or not workspace.two_way_sync:
        return

    async with AsyncSessionLocal() as session:
        # Find the ticket whose Slack thread matches, within this workspace
        result = await session.execute(
            select(Ticket).where(
                Ticket.slack_channel_id == channel_id,
                Ticket.slack_message_ts == thread_ts,
                Ticket.workspace_id == workspace_id,
            )
        )
        ticket = result.scalar_one_or_none()
        if ticket is None:
            return  # thread doesn't belong to any ticket in this workspace

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
                matched = await get_user_by_slack_id(session, workspace_id, slack_user_id)
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
            await _download_slack_files(ticket.id, reply.id, files, workspace_id)


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


async def build_home_view(slack_user_id: str, client: Any, workspace_id: int, tab: str = "active") -> dict:
    """
    Build the Block Kit view for a user's App Home tab, scoped to one
    workspace (the same Slack user ID string is meaningless outside the
    workspace it came from).

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
                Ticket.workspace_id == workspace_id,
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
        # Fetch all thread permalinks concurrently — one round-trip instead of
        # N sequential Slack calls each time App Home renders.
        import asyncio

        async def _permalink(t):
            try:
                pl = await client.chat_getPermalink(
                    channel=t.slack_channel_id, message_ts=t.slack_message_ts,
                )
                return t.id, pl.get("permalink")
            except Exception:  # noqa: BLE001
                return t.id, None

        _pl_targets = [t for t in tickets if t.slack_channel_id and t.slack_message_ts]
        permalinks: dict[int, str | None] = (
            dict(await asyncio.gather(*(_permalink(t) for t in _pl_targets))) if _pl_targets else {}
        )

        for ticket in tickets:
            status_str = ticket.status.value if hasattr(ticket.status, "value") else str(ticket.status)
            priority_str = ticket.priority.value if hasattr(ticket.priority, "value") else str(ticket.priority)
            status_emoji = _HOME_STATUS_EMOJI.get(status_str, "•")
            priority_emoji = _HOME_PRIORITY_EMOJI.get(priority_str, "•")
            status_label = status_str.replace("_", " ").title()

            # View thread permalink button (accessory) — from the batch above
            view_button: dict | None = None
            permalink = permalinks.get(ticket.id)
            if permalink:
                view_button = {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "View thread ↗", "emoji": False},
                    "url": permalink,
                    "action_id": f"view_thread_{ticket.id}",
                }

            # Main section
            section: dict = {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": (
                        f"{status_emoji} *{status_label}*  ·  {priority_emoji} {priority_str.capitalize()}\n"
                        f"*{ticket.display_id}* — {slack_escape(ticket.title)}"
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
    # Keep in sync with the web upload allowlist (routers/attachments.py) so a
    # zip attached in Slack isn't silently dropped.
    "application/zip",
    "application/x-zip-compressed",
}


def _allowed_mime(mime: str) -> bool:
    return any(mime.startswith(p) for p in _ALLOWED_IMAGE_PREFIXES) or mime in _ALLOWED_MIME_EXACT


async def _download_slack_files(
    ticket_id: int,
    reply_id: Optional[int],
    files: list[dict],
    workspace_id: int,
) -> None:
    """Download Slack file attachments and persist them as TicketAttachment records."""
    async with AsyncSessionLocal() as session:
        workspace = await _get_workspace(session, workspace_id)
    if workspace is None or not workspace.bot_token:
        return
    bot_token = decrypt_value(workspace.bot_token)
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
    Silently no-ops if the ticket has no Slack workspace / sync is disabled /
    no thread / no attachments.
    """
    if ticket.workspace_id is None:
        return
    async with AsyncSessionLocal() as session:
        workspace = await _get_workspace(session, ticket.workspace_id)
    if workspace is None or not workspace.two_way_sync:
        return
    if not (ticket.slack_channel_id and ticket.slack_message_ts):
        return

    from app.slack.bot import get_slack_client
    client = get_slack_client(ticket.workspace_id)
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
    Post the SLA warning to the ticket's workspace's configured escalation
    target (a Slack channel or a specific person), or DM every active
    technician/admin with a linked identity in that workspace if no target
    is configured.
    kind='sla'            — resolution SLA breach in ~15 min
    kind='first_response' — first-response deadline in ~15 min
    Fire-and-forget — errors are logged, not raised.
    """
    if ticket.workspace_id is None:
        return
    workspace = await _get_workspace(session, ticket.workspace_id)
    if workspace is None or not workspace.two_way_sync:
        return

    from app.slack.bot import get_slack_client
    client = get_slack_client(ticket.workspace_id)
    if client is None:
        return

    target = (workspace.sla_escalation_target or "").strip()

    if target:
        recipients = [target]
    else:
        # No target configured — fall back to DMing every active staff member
        # with a linked identity in this workspace
        result = await session.execute(
            select(UserSlackIdentity.slack_user_id)
            .join(User, User.id == UserSlackIdentity.user_id)
            .where(
                UserSlackIdentity.workspace_id == ticket.workspace_id,
                User.is_active == True,  # noqa: E712
                User.role.in_(["technician", "admin"]),
            )
        )
        recipients = [row[0] for row in result.all()]
        if not recipients:
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
        f"*{ticket.display_id}* · {slack_escape(ticket.title)}\n"
        f"Priority: {emoji} {priority_str.capitalize()} · "
        f"Assignee: {slack_escape(assignee_name)} · "
        f"Deadline: {deadline_str}"
        f"{thread_hint}"
    )

    for recipient in recipients:
        try:
            await client.chat_postMessage(
                channel=recipient,  # a channel ID posts there; a user ID opens/uses a DM
                text=text,
            )
            logger.debug("Sent SLA warning to %s for ticket %s", recipient, ticket.display_id)
        except Exception:
            logger.exception("Failed to send SLA warning to %s", recipient)
