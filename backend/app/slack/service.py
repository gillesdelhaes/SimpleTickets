"""
Internal service for creating tickets from Slack events.
Called by Slack handlers — bypasses HTTP, writes directly to DB.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models import Category, SLAPolicy, Ticket, User
from app.models.enums import Channel, Priority, TicketStatus
from app.services.notifications import notify_ticket_created

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def get_user_by_email(session: AsyncSession, email: str) -> Optional[User]:
    """Find an active SimplyTickets user by email (case-insensitive)."""
    result = await session.execute(
        select(User).where(
            User.email == email.lower(),
            User.is_active == True,  # noqa: E712
        )
    )
    return result.scalar_one_or_none()


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
            channel=Channel.slack,
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

        # Fire-and-forget email notifications
        if submitter_id is not None:
            submitter = await session.get(User, submitter_id)
            if submitter:
                try:
                    await notify_ticket_created(
                        session=session,
                        ticket_id=ticket.id,
                        ticket_display_id=ticket.display_id,
                        ticket_title=ticket.title,
                        ticket_priority=ticket.priority.value,
                        submitter_id=submitter_id,
                        submitter_name=submitter.name,
                        submitter_email=submitter.email,
                    )
                except Exception:  # noqa: BLE001
                    logger.exception("Notification failed for Slack ticket %s", ticket.display_id)

        logger.info(
            "Created ticket %s from Slack (submitter_id=%s, channel=%s)",
            ticket.display_id,
            submitter_id,
            slack_channel_id,
        )
        return ticket
