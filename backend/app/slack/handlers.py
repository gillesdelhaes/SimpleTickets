"""
Slack Bolt event handlers — registered on the AsyncApp in bot.py.

Handlers:
  reaction_added      → emoji reaction creates a ticket
  /ticket             → slash command opens a modal
  view_submission     → modal submit creates a ticket + DMs the user
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings_manager
from app.database import AsyncSessionLocal
from app.models import Category
from app.models.enums import Priority
from app.slack.service import (
    create_ticket_from_slack,
    get_user_by_email,
    handle_slack_thread_message,
)

logger = logging.getLogger(__name__)

# ── helpers ────────────────────────────────────────────────────────────────────

_MONITORED_CHANNELS: set[str] = set()


def _load_monitored_channels() -> None:
    global _MONITORED_CHANNELS
    raw = settings_manager.slack_monitored_channels.strip()
    _MONITORED_CHANNELS = {c.strip() for c in raw.split(",") if c.strip()} if raw else set()


def _channel_is_monitored(channel_id: str) -> bool:
    """Empty set = monitor ALL channels."""
    return not _MONITORED_CHANNELS or channel_id in _MONITORED_CHANNELS


def _ticket_url(ticket_id: int) -> str:
    return f"{settings_manager.app_base_url}/tickets/{ticket_id}"


async def _fetch_categories() -> list[dict]:
    """Fetch active categories for the /ticket modal dropdown."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Category).where(Category.is_archived == False).order_by(Category.name)  # noqa: E712
        )
        return [{"text": {"type": "plain_text", "text": c.name}, "value": str(c.id)}
                for c in result.scalars().all()]


# ── reaction_added ─────────────────────────────────────────────────────────────

def register_handlers(app: Any) -> None:
    """Register all event/action/command handlers on the Bolt AsyncApp."""

    _load_monitored_channels()

    @app.event("reaction_added")
    async def handle_reaction_added(event: dict, client: Any, say: Any) -> None:
        """
        When the trigger emoji is added to a message:
        1. Verify channel is monitored.
        2. Fetch the original message text.
        3. Match Slack user → SimplyTickets user via email.
        4. Create a ticket.
        5. Post a thread reply confirming creation (or warning if unmatched).
        """
        emoji = event.get("reaction", "")
        if emoji != settings_manager.slack_trigger_emoji:
            return

        item = event.get("item", {})
        channel_id = item.get("channel", "")
        message_ts = item.get("ts", "")

        if not _channel_is_monitored(channel_id):
            return

        # ── Fetch the original message ──────────────────────────────────────
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
            original_message = messages[0]
            message_text = original_message.get("text", "(no content)")
            slack_user_id = original_message.get("user", "")
        except Exception:  # noqa: BLE001
            logger.exception("reaction_added: failed to fetch message")
            return

        # ── Match Slack user to SimplyTickets user ──────────────────────────
        submitter_id = None
        submitter_name_fallback = None

        if slack_user_id:
            try:
                user_info = await client.users_info(user=slack_user_id)
                profile = user_info.get("user", {}).get("profile", {})
                slack_email = profile.get("email", "")
                slack_display = profile.get("display_name") or profile.get("real_name", "Unknown")

                submitter_name_fallback = slack_display

                if slack_email:
                    async with AsyncSessionLocal() as session:
                        matched = await get_user_by_email(session, slack_email)
                        if matched:
                            submitter_id = matched.id
                            submitter_name_fallback = None  # linked — no need for fallback name
            except Exception:  # noqa: BLE001
                logger.exception("reaction_added: failed to look up Slack user %s", slack_user_id)

        # ── Build title from first line of message ──────────────────────────
        first_line = message_text.split("\n")[0].strip()
        title = first_line[:200] if first_line else "Ticket from Slack"
        if len(message_text) > len(title):
            description = message_text
        else:
            description = message_text or title

        # ── Create ticket ───────────────────────────────────────────────────
        try:
            ticket = await create_ticket_from_slack(
                title=title,
                description=description,
                priority=Priority.medium,
                submitter_id=submitter_id,
                slack_submitter_name=submitter_name_fallback,
                slack_channel_id=channel_id,
                slack_message_ts=message_ts,
            )
        except Exception:  # noqa: BLE001
            logger.exception("reaction_added: ticket creation failed")
            await client.chat_postMessage(
                channel=channel_id,
                thread_ts=message_ts,
                text="⚠️ Failed to create a ticket. Please try again or submit via the portal.",
            )
            return

        # ── Post thread reply ───────────────────────────────────────────────
        ticket_link = _ticket_url(ticket.id)

        if submitter_id is not None:
            # Matched user — success
            reply_text = (
                f"✅ Ticket *<{ticket_link}|{ticket.display_id}>* created successfully!\n"
                f"Our team will get back to you shortly."
            )
        else:
            # Unmatched user — warn
            name_hint = f" (submitted by *{submitter_name_fallback}*)" if submitter_name_fallback else ""
            reply_text = (
                f"⚠️ Ticket *<{ticket_link}|{ticket.display_id}>* created{name_hint}, "
                f"but no SimplyTickets account was found for this Slack user.\n"
                f"An admin can link the ticket to an account manually."
            )

        try:
            await client.chat_postMessage(
                channel=channel_id,
                thread_ts=message_ts,
                text=reply_text,
            )
        except Exception:  # noqa: BLE001
            logger.exception("reaction_added: failed to post thread reply for %s", ticket.display_id)

    # ── Inbound thread replies (Web ← Slack sync) ─────────────────────────────

    @app.event("message")
    async def handle_message(event: dict, client: Any) -> None:
        """
        When a human posts a reply inside a SimplyTickets Slack thread,
        sync it back as a public reply on the ticket.

        Filters:
        - Must be a thread reply (thread_ts set, thread_ts != ts)
        - Must be a human message (no bot_id, no subtype)
        - Channel must be monitored (or monitoring is off)
        """
        # Skip bot messages and system events (message_changed, message_deleted, etc.)
        if event.get("subtype") is not None:
            return
        if event.get("bot_id"):
            return

        thread_ts: str = event.get("thread_ts", "")
        message_ts: str = event.get("ts", "")
        slack_user_id: str = event.get("user", "")

        # Only process replies (not the original message that started the thread)
        if not thread_ts or thread_ts == message_ts:
            return

        channel_id: str = event.get("channel", "")

        if not _channel_is_monitored(channel_id):
            return

        text: str = event.get("text", "")

        try:
            await handle_slack_thread_message(
                channel_id=channel_id,
                thread_ts=thread_ts,
                message_ts=message_ts,
                slack_user_id=slack_user_id,
                text=text,
                client=client,
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "handle_message: failed to sync thread reply ts=%s channel=%s",
                message_ts, channel_id,
            )

    # ── /ticket slash command ──────────────────────────────────────────────────

    @app.command("/ticket")
    async def handle_ticket_command(ack: Any, body: dict, client: Any) -> None:
        """
        Open a modal allowing the user to submit a ticket with title,
        description, and optional category.
        """
        await ack()

        category_options = await _fetch_categories()

        view: dict = {
            "type": "modal",
            "callback_id": "ticket_modal",
            "title": {"type": "plain_text", "text": "Submit a Ticket"},
            "submit": {"type": "plain_text", "text": "Submit"},
            "close": {"type": "plain_text", "text": "Cancel"},
            "blocks": [
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
            ],
        }

        # Add category dropdown only if categories exist
        if category_options:
            view["blocks"].append(
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

        try:
            await client.views_open(trigger_id=body["trigger_id"], view=view)
        except Exception:  # noqa: BLE001
            logger.exception("/ticket: failed to open modal for user %s", body.get("user_id"))

    # ── Modal submission ───────────────────────────────────────────────────────

    @app.view("ticket_modal")
    async def handle_modal_submission(ack: Any, body: dict, client: Any, view: dict) -> None:
        """
        Process the /ticket modal submission:
        1. Acknowledge immediately.
        2. Extract values.
        3. Match Slack user → SimplyTickets user.
        4. Create ticket.
        5. Send a DM with the ticket link.
        """
        await ack()

        state_values = view["state"]["values"]
        title = state_values["title_block"]["title_input"]["value"] or ""
        description = state_values["description_block"]["description_input"]["value"] or ""
        priority_value = (
            state_values["priority_block"]["priority_select"].get("selected_option", {}) or {}
        ).get("value", "medium")
        category_value = None
        if "category_block" in state_values:
            selected = (state_values["category_block"]["category_select"].get("selected_option") or {})
            category_value = int(selected["value"]) if selected.get("value") else None

        slack_user_id = body.get("user", {}).get("id", "")
        submitter_id = None
        submitter_name_fallback = None

        # ── Match user ──────────────────────────────────────────────────────
        if slack_user_id:
            try:
                user_info = await client.users_info(user=slack_user_id)
                profile = user_info.get("user", {}).get("profile", {})
                slack_email = profile.get("email", "")
                slack_display = profile.get("display_name") or profile.get("real_name", "Unknown")
                submitter_name_fallback = slack_display

                if slack_email:
                    async with AsyncSessionLocal() as session:
                        matched = await get_user_by_email(session, slack_email)
                        if matched:
                            submitter_id = matched.id
                            submitter_name_fallback = None
            except Exception:  # noqa: BLE001
                logger.exception("ticket_modal: user lookup failed for %s", slack_user_id)

        # ── Create ticket ───────────────────────────────────────────────────
        try:
            priority = Priority(priority_value)
        except ValueError:
            priority = Priority.medium

        try:
            ticket = await create_ticket_from_slack(
                title=title.strip() or "Ticket from Slack",
                description=description.strip() or title.strip() or "Submitted via Slack.",
                priority=priority,
                category_id=category_value,
                submitter_id=submitter_id,
                slack_submitter_name=submitter_name_fallback,
            )
        except Exception:  # noqa: BLE001
            logger.exception("ticket_modal: ticket creation failed")
            # DM the user about the failure
            try:
                await client.chat_postMessage(
                    channel=slack_user_id,
                    text="⚠️ Something went wrong creating your ticket. Please try again or use the portal.",
                )
            except Exception:  # noqa: BLE001
                pass
            return

        # ── DM the user ─────────────────────────────────────────────────────
        ticket_link = _ticket_url(ticket.id)
        dm_text = (
            f"✅ Your ticket *<{ticket_link}|{ticket.display_id}>* has been submitted!\n"
            f"*{ticket.title}*\n"
            f"Our team will get back to you shortly."
        )

        if submitter_id is None:
            dm_text += (
                f"\n\n⚠️ We couldn't link this ticket to a SimplyTickets account. "
                f"An admin can do this manually."
            )

        try:
            await client.chat_postMessage(channel=slack_user_id, text=dm_text)
        except Exception:  # noqa: BLE001
            logger.exception("ticket_modal: failed to DM user %s", slack_user_id)
