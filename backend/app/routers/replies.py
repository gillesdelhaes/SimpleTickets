"""Ticket Replies — list and create replies with Slack two-way sync."""
import logging

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.auth.deps import get_current_user
from app.database import get_session
from app.models import Ticket, TicketHistory, TicketReply, User
from app.models.ticket_status_config import TicketStatusConfig
from app.schemas.reply import ReplyCreate, ReplyRead
from app.utils import get_ticket_or_404, utcnow

logger = logging.getLogger(__name__)

router = APIRouter(tags=["replies"])


def _to_read(reply: TicketReply, author_name: str | None) -> ReplyRead:
    return ReplyRead(
        id=reply.id,
        ticket_id=reply.ticket_id,
        author_id=reply.author_id,
        author_name=author_name or reply.slack_author_name,
        body=reply.body,
        is_internal=reply.is_internal,
        slack_ts=reply.slack_ts,
        created_at=reply.created_at,
    )


# ── GET /tickets/{id}/replies ──────────────────────────────────────────────────


@router.get("/tickets/{ticket_id}/replies", response_model=list[ReplyRead])
async def list_replies(
    ticket_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ReplyRead]:
    """List replies for a ticket, ordered oldest-first."""
    await get_ticket_or_404(session, ticket_id)

    Author = aliased(User, flat=True)

    stmt = (
        select(TicketReply, Author.name.label("author_name"))
        .outerjoin(Author, TicketReply.author_id == Author.id)
        .where(TicketReply.ticket_id == ticket_id)
        .order_by(TicketReply.created_at.asc())
    )

    rows = (await session.execute(stmt)).all()

    return [_to_read(row[0], row[1]) for row in rows]


# ── POST /tickets/{id}/replies ─────────────────────────────────────────────────


@router.post(
    "/tickets/{ticket_id}/replies",
    response_model=ReplyRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_reply(
    ticket_id: int,
    body: ReplyCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ReplyRead:
    """
    Add a reply to a ticket.
    Replying to a resolved ticket with a public reply re-opens it to in_progress.
    """
    ticket = await get_ticket_or_404(session, ticket_id)
    now = utcnow()

    is_internal = body.is_internal

    # Resolved status names — used to decide whether to re-open the ticket
    resolved_result = await session.execute(
        select(TicketStatusConfig.name).where(
            TicketStatusConfig.is_resolved_state == True  # noqa: E712
        )
    )
    resolved_names = {row[0] for row in resolved_result.all()}

    # Default fallback if the table is empty
    if not resolved_names:
        resolved_names = {"resolved", "closed"}

    # Re-open status — first non-resolved, non-paused active status by sort order
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
    reopen_row = reopen_result.scalar_one_or_none()
    reopen_status = reopen_row if reopen_row else "in_progress"

    # Public reply on a resolved/closed ticket → re-open
    old_status = ticket.status
    reopened = False
    if old_status in resolved_names and not is_internal:
        ticket.status = reopen_status
        ticket.resolved_at = None
        ticket.updated_at = now
        reopened = True
        session.add(
            TicketHistory(
                ticket_id=ticket.id,
                actor_id=current_user.id,
                field_changed="status",
                old_value=old_status if isinstance(old_status, str) else old_status.value,
                new_value=reopen_status,
                created_at=now,
            )
        )

    # Record first response timestamp — only for the first public tech/admin reply
    if not is_internal and ticket.first_responded_at is None:
        ticket.first_responded_at = now
        ticket.updated_at = now

    reply = TicketReply(
        ticket_id=ticket_id,
        author_id=current_user.id,
        body=body.body,
        is_internal=is_internal,
        created_at=now,
    )
    session.add(reply)
    await session.commit()
    await session.refresh(reply)

    # ── Web → Slack thread sync ──────────────────────────────────────────────
    # Post public replies back to the originating Slack thread. Store the
    # returned Slack ts as reply.slack_ts so inbound dedup works correctly.
    if not is_internal and ticket.slack_channel_id and ticket.slack_message_ts:
        try:
            from app.slack.service import post_reply_to_slack, post_ticket_update_to_slack

            # If the ticket was re-opened, post the status change first
            if reopened:
                await post_ticket_update_to_slack(
                    ticket,
                    {"status": (old_status if isinstance(old_status, str) else old_status.value, reopen_status)},
                    current_user.name,
                )

            slack_ts = await post_reply_to_slack(ticket, body.body, current_user.name)
            if slack_ts and reply.slack_ts is None:
                reply.slack_ts = slack_ts
                await session.commit()
        except Exception:  # noqa: BLE001
            logger.exception(
                "Failed to sync reply to Slack for ticket %s", ticket.display_id
            )

    return _to_read(reply, current_user.name)
