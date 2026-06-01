"""
Slack Bolt event handlers — registered on the AsyncApp in bot.py.

Interaction model:
  /ticket             → slash command opens a modal; any Slack user can submit
  DM to bot           → creates a ticket from the message text
  reaction_added      → technician/admin reacts with trigger emoji to convert a
                        channel message into a ticket (reactor must exist in DB)
  message (thread)    → syncs Slack thread replies back to the web portal
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings_manager
from app.database import AsyncSessionLocal
from app.models import Category, Ticket
from app.models.enums import Priority
from app.models.ticket_status_config import TicketStatusConfig
from app.slack.service import (
    _download_slack_files,
    build_home_view,
    create_ticket_from_slack,
    get_user_by_slack_id,
    handle_slack_thread_message,
)

logger = logging.getLogger(__name__)

# ── helpers ────────────────────────────────────────────────────────────────────


async def _fetch_categories() -> list[dict]:
    """Fetch active categories for the /ticket modal dropdown."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Category).where(Category.is_archived == False).order_by(Category.name)  # noqa: E712
        )
        return [{"text": {"type": "plain_text", "text": c.name}, "value": str(c.id)}
                for c in result.scalars().all()]


async def _slack_display_name(client: Any, slack_user_id: str) -> str:
    """Fetch Slack display name for a user ID. Falls back to the ID itself."""
    try:
        info = await client.users_info(user=slack_user_id)
        profile = info.get("user", {}).get("profile", {})
        return profile.get("display_name") or profile.get("real_name") or slack_user_id
    except Exception:  # noqa: BLE001
        return slack_user_id


async def _build_ticket_modal() -> dict:
    """
    Build the shared ticket submission modal view.

    Both the /ticket command and the App Home button use this so the UI stays
    in sync. The file_input block lets users attach files before submitting.
    """
    category_options = await _fetch_categories()

    blocks: list[dict] = [
        {
            "type": "input",
            "block_id": "title_block",
            "label": {"type": "plain_text", "text": "What can we help you with?"},
            "element": {
                "type": "plain_text_input",
                "action_id": "title_input",
                "placeholder": {"type": "plain_text", "text": "Brief summary of the issue"},
                "max_length": 200,
            },
        },
        {
            "type": "input",
            "block_id": "description_block",
            "label": {"type": "plain_text", "text": "Description"},
            "element": {
                "type": "plain_text_input",
                "action_id": "description_input",
                "multiline": True,
                "placeholder": {
                    "type": "plain_text",
                    "text": "Please describe the issue in detail…",
                },
            },
        },
        {
            "type": "input",
            "block_id": "priority_block",
            "label": {"type": "plain_text", "text": "Priority"},
            "element": {
                "type": "static_select",
                "action_id": "priority_select",
                "initial_option": {
                    "text": {"type": "plain_text", "text": "Medium"},
                    "value": "medium",
                },
                "options": [
                    {"text": {"type": "plain_text", "text": "Low"}, "value": "low"},
                    {"text": {"type": "plain_text", "text": "Medium"}, "value": "medium"},
                    {"text": {"type": "plain_text", "text": "High"}, "value": "high"},
                    {"text": {"type": "plain_text", "text": "Critical"}, "value": "critical"},
                ],
            },
        },
    ]

    if category_options:
        blocks.append(
            {
                "type": "input",
                "block_id": "category_block",
                "optional": True,
                "label": {"type": "plain_text", "text": "Category (optional)"},
                "element": {
                    "type": "static_select",
                    "action_id": "category_select",
                    "placeholder": {"type": "plain_text", "text": "Select a category"},
                    "options": category_options,
                },
            }
        )

    blocks.append(
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": "📎 Need to attach files? Reply with them in the confirmation DM after submitting.",
                }
            ],
        }
    )

    return {
        "type": "modal",
        "callback_id": "ticket_modal",
        "title": {"type": "plain_text", "text": "Submit a Ticket"},
        "submit": {"type": "plain_text", "text": "Submit"},
        "close": {"type": "plain_text", "text": "Cancel"},
        "blocks": blocks,
    }


# ── handler registration ───────────────────────────────────────────────────────

def register_handlers(app: Any) -> None:
    """Register all event/action/command handlers on the Bolt AsyncApp."""

    # ── reaction_added ─────────────────────────────────────────────────────────

    @app.event("reaction_added")
    async def handle_reaction_added(event: dict, client: Any) -> None:
        """
        Convert a channel message to a ticket when a technician/admin reacts
        with the configured trigger emoji.

        The REACTOR must exist in SimpleTickets as a tech or admin (matched via
        slack_user_id). Any Slack user can be the original message author.
        """
        emoji = event.get("reaction", "")
        if emoji != settings_manager.slack_trigger_emoji:
            return

        reactor_slack_id: str = event.get("user", "")
        item = event.get("item", {})
        channel_id: str = item.get("channel", "")
        message_ts: str = item.get("ts", "")

        # No monitored-channel filter here — a tech explicitly reacting
        # is always intentional, regardless of channel configuration.

        # ── Verify reactor is a technician/admin ───────────────────────────
        async with AsyncSessionLocal() as session:
            reactor = await get_user_by_slack_id(session, reactor_slack_id)

        if reactor is None:
            logger.debug(
                "reaction_added: ignoring — reactor %s is not a SimpleTickets tech/admin",
                reactor_slack_id,
            )
            return

        # ── Fetch the original message ─────────────────────────────────────
        try:
            history = await client.conversations_history(
                channel=channel_id,
                latest=message_ts,
                limit=1,
                inclusive=True,
            )
            messages = history.get("messages", [])
            if not messages:
                logger.warning("reaction_added: no message found at ts=%s", message_ts)
                return
            original = messages[0]
            message_text: str = original.get("text", "") or ""
            author_slack_id: str = original.get("user", "")
            original_files: list[dict] = original.get("files", [])
        except Exception:  # noqa: BLE001
            logger.exception("reaction_added: failed to fetch message")
            return

        # ── Get message author display name ────────────────────────────────
        submitter_name = await _slack_display_name(client, author_slack_id) if author_slack_id else "Slack user"

        # ── Build title ────────────────────────────────────────────────────
        first_line = message_text.split("\n")[0].strip()
        title = first_line[:200] if first_line else "Ticket from Slack"
        description = message_text or title

        # ── Create ticket ──────────────────────────────────────────────────
        try:
            ticket = await create_ticket_from_slack(
                title=title,
                description=description,
                priority=Priority.medium,
                slack_submitter_name=submitter_name,
                slack_submitter_id=author_slack_id or None,
                slack_channel_id=channel_id,
                slack_message_ts=message_ts,
            )
        except Exception:  # noqa: BLE001
            logger.exception("reaction_added: ticket creation failed")
            await client.chat_postMessage(
                channel=channel_id,
                thread_ts=message_ts,
                text="⚠️ Failed to create a ticket. Please try again.",
            )
            return

        # ── Download any files from the original message ───────────────────
        if original_files:
            try:
                await _download_slack_files(ticket.id, None, original_files)
            except Exception:  # noqa: BLE001
                logger.exception("reaction_added: failed to download files for %s", ticket.display_id)

        # ── Post thread confirmation ───────────────────────────────────────
        try:
            await client.chat_postMessage(
                channel=channel_id,
                thread_ts=message_ts,
                text=f"✅ Ticket *{ticket.display_id}* created. Our team will follow up shortly.",
            )
        except Exception:  # noqa: BLE001
            logger.exception("reaction_added: failed to post thread reply for %s", ticket.display_id)

    # ── message (DM + thread sync) ─────────────────────────────────────────────

    @app.event("message")
    async def handle_message(event: dict, client: Any) -> None:
        """
        Three cases:
        1. DM thread reply → sync to existing ticket.
        2. Top-level DM with an active ticket in this channel → add as reply.
        3. Top-level DM with no active ticket → create a new ticket.
        4. Thread reply in a monitored channel → sync back to the web portal.
        """
        # Skip bot messages and system subtypes (message_changed, etc.)
        # Allow "file_share" through — Slack uses this subtype when a message
        # contains only file attachments with no text body.
        subtype = event.get("subtype")
        if subtype is not None and subtype != "file_share":
            return
        if event.get("bot_id"):
            return

        channel_type: str = event.get("channel_type", "")
        slack_user_id: str = event.get("user", "")
        text: str = event.get("text", "") or ""
        channel_id: str = event.get("channel", "")
        message_ts: str = event.get("ts", "")
        thread_ts: str = event.get("thread_ts", "")
        event_files: list[dict] = event.get("files", [])

        # Slack doesn't always populate channel_type on threaded DM replies,
        # so detect DM channels by ID prefix as a fallback.
        is_dm = channel_type == "im" or channel_id.startswith("D")

        # ── DM to bot ──────────────────────────────────────────────────────
        if is_dm:
            if not text.strip() and not event_files:
                return

            # Explicit thread reply → sync to whichever ticket owns that thread
            if thread_ts and thread_ts != message_ts:
                try:
                    await handle_slack_thread_message(
                        channel_id=channel_id,
                        thread_ts=thread_ts,
                        message_ts=message_ts,
                        slack_user_id=slack_user_id,
                        text=text,
                        client=client,
                        files=event_files,
                    )
                except Exception:  # noqa: BLE001
                    logger.exception(
                        "handle_message(DM thread): sync failed ts=%s channel=%s",
                        message_ts, channel_id,
                    )
                return

            # Top-level DM — check if this DM channel already has an active ticket.
            # If so, treat the message as a follow-up reply rather than a new ticket.
            active_ticket: Ticket | None = None
            async with AsyncSessionLocal() as session:
                resolved_result = await session.execute(
                    select(TicketStatusConfig.name).where(
                        TicketStatusConfig.is_resolved_state == True  # noqa: E712
                    )
                )
                resolved_names = [row[0] for row in resolved_result.all()] or ["resolved", "closed"]
                result = await session.execute(
                    select(Ticket)
                    .where(
                        Ticket.slack_channel_id == channel_id,
                        Ticket.status.not_in(resolved_names),
                    )
                    .order_by(Ticket.created_at.desc())
                    .limit(1)
                )
                active_ticket = result.scalar_one_or_none()

            if active_ticket is not None and active_ticket.slack_message_ts:
                try:
                    await handle_slack_thread_message(
                        channel_id=channel_id,
                        thread_ts=active_ticket.slack_message_ts,
                        message_ts=message_ts,
                        slack_user_id=slack_user_id,
                        text=text,
                        client=client,
                        files=event_files,
                    )
                except Exception:  # noqa: BLE001
                    logger.exception(
                        "handle_message(DM follow-up): sync failed for ticket %s",
                        active_ticket.display_id,
                    )
                return

            submitter_name = await _slack_display_name(client, slack_user_id) if slack_user_id else "Slack user"

            first_line = text.split("\n")[0].strip() if text.strip() else ""
            file_hint = f"{len(event_files)} attachment(s)" if event_files and not first_line else ""
            title = first_line[:200] if first_line else (file_hint or "Ticket from DM")
            description = text.strip() or title

            try:
                ticket = await create_ticket_from_slack(
                    title=title,
                    description=description,
                    priority=Priority.medium,
                    slack_submitter_name=submitter_name,
                    slack_submitter_id=slack_user_id or None,
                    slack_channel_id=channel_id,
                    slack_message_ts=message_ts,
                )
            except Exception:  # noqa: BLE001
                logger.exception("handle_message(DM): ticket creation failed for user %s", slack_user_id)
                try:
                    await client.chat_postMessage(
                        channel=channel_id,
                        text="⚠️ Something went wrong creating your ticket. Please try again.",
                    )
                except Exception:  # noqa: BLE001
                    pass
                return

            # Download any files attached to the initial DM
            if event_files:
                try:
                    await _download_slack_files(ticket.id, None, event_files)
                except Exception:  # noqa: BLE001
                    logger.exception("handle_message(DM): failed to download files for %s", ticket.display_id)

            try:
                await client.chat_postMessage(
                    channel=channel_id,
                    text=(
                        f"📋 Ticket *{ticket.display_id}* has been submitted.\n"
                        f"*{ticket.title}*\n"
                        f"Our team will get back to you shortly. Reply here to add a comment."
                    ),
                )
            except Exception:  # noqa: BLE001
                logger.exception("handle_message(DM): failed to confirm ticket to user %s", slack_user_id)
            return

        # ── Case 2: Thread reply sync ──────────────────────────────────────
        # Only process replies (thread_ts set and differs from the message ts)
        if not thread_ts or thread_ts == message_ts:
            return

        try:
            await handle_slack_thread_message(
                channel_id=channel_id,
                thread_ts=thread_ts,
                message_ts=message_ts,
                slack_user_id=slack_user_id,
                text=text,
                client=client,
                files=event_files,
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "handle_message: failed to sync thread reply ts=%s channel=%s",
                message_ts, channel_id,
            )

    # ── App Home ───────────────────────────────────────────────────────────────

    @app.event("app_home_opened")
    async def handle_app_home_opened(event: dict, client: Any) -> None:
        """Render the App Home tab with the user's open tickets."""
        slack_user_id: str = event.get("user", "")
        tab: str = event.get("tab", "")
        if tab != "home" or not slack_user_id:
            return
        try:
            view = await build_home_view(slack_user_id, client)
            await client.views_publish(user_id=slack_user_id, view=view)
        except Exception:  # noqa: BLE001
            logger.exception("app_home_opened: failed to publish home for %s", slack_user_id)

    # ── /ticket slash command ──────────────────────────────────────────────────

    @app.command("/ticket")
    async def handle_ticket_command(ack: Any, body: dict, client: Any) -> None:
        """Open a modal so the user can submit a ticket with title, description, priority, and optional attachments."""
        await ack()
        try:
            await client.views_open(trigger_id=body["trigger_id"], view=await _build_ticket_modal())
        except Exception:  # noqa: BLE001
            logger.exception("/ticket: failed to open modal for user %s", body.get("user_id"))

    # ── App Home "Submit a ticket" button ─────────────────────────────────────

    @app.action("open_ticket_modal")
    async def handle_open_ticket_modal(ack: Any, body: dict, client: Any) -> None:
        await ack()
        try:
            await client.views_open(trigger_id=body["trigger_id"], view=await _build_ticket_modal())
        except Exception:  # noqa: BLE001
            logger.exception("open_ticket_modal: failed to open modal for user %s", body.get("user", {}).get("id"))

    # ── Modal submission ───────────────────────────────────────────────────────

    @app.view("ticket_modal")
    async def handle_modal_submission(ack: Any, body: dict, client: Any, view: dict) -> None:
        """
        Process the /ticket modal submission.

        Opens a DM channel with the submitter and posts the confirmation there.
        That DM message ts is saved as slack_message_ts so web-portal replies
        thread back to the user automatically.
        """
        await ack()

        state_values = view["state"]["values"]
        title = (state_values["title_block"]["title_input"]["value"] or "").strip()
        description = (state_values["description_block"]["description_input"]["value"] or "").strip()
        priority_value = (
            (state_values["priority_block"]["priority_select"].get("selected_option") or {})
            .get("value", "medium")
        )
        category_value = None
        if "category_block" in state_values:
            selected = state_values["category_block"]["category_select"].get("selected_option") or {}
            category_value = int(selected["value"]) if selected.get("value") else None

        slack_user_id: str = body.get("user", {}).get("id", "")

        # Fetch display name (no email lookup — end users are Slack-only)
        submitter_name = await _slack_display_name(client, slack_user_id) if slack_user_id else "Slack user"

        try:
            priority = Priority(priority_value)
        except ValueError:
            priority = Priority.medium

        try:
            ticket = await create_ticket_from_slack(
                title=title or "Ticket from Slack",
                description=description or title or "Submitted via Slack.",
                priority=priority,
                category_id=category_value,
                slack_submitter_name=submitter_name,
                slack_submitter_id=slack_user_id or None,
            )
        except Exception:  # noqa: BLE001
            logger.exception("ticket_modal: ticket creation failed")
            try:
                await client.chat_postMessage(
                    channel=slack_user_id,
                    text="⚠️ Something went wrong creating your ticket. Please try again.",
                )
            except Exception:  # noqa: BLE001
                pass
            return

        # Post DM confirmation using the user ID as channel — Slack auto-routes
        # to the DM without needing conversations_open / im:write scope.
        # Save the returned channel + ts on the ticket so web replies thread here.
        if slack_user_id:
            try:
                result = await client.chat_postMessage(
                    channel=slack_user_id,
                    text=(
                        f"📋 Ticket *{ticket.display_id}* has been submitted.\n"
                        f"*{ticket.title}*\n"
                        f"Our team will get back to you shortly. Reply here to add a comment."
                    ),
                )
                dm_channel_id: str | None = result.get("channel")
                message_ts: str | None = result.get("ts")
                if dm_channel_id and message_ts:
                    async with AsyncSessionLocal() as session:
                        t = await session.get(Ticket, ticket.id)
                        if t:
                            t.slack_channel_id = dm_channel_id
                            t.slack_message_ts = message_ts
                            await session.commit()
            except Exception:  # noqa: BLE001
                logger.exception("ticket_modal: failed to DM user %s", slack_user_id)

        # Refresh App Home so the new ticket appears immediately
        if slack_user_id:
            try:
                home_view = await build_home_view(slack_user_id, client)
                await client.views_publish(user_id=slack_user_id, view=home_view)
            except Exception:  # noqa: BLE001
                pass  # non-critical
