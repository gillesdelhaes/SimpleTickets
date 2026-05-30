"""Ticket Replies — list and create replies with Slack two-way sync."""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.auth.deps import get_current_user
from app.database import get_session
from app.models import Ticket, TicketHistory, TicketReply, User
from app.models.enums import TicketStatus
from app.schemas.reply import ReplyCreate, ReplyRead

logger = logging.getLogger(__name__)

router = APIRouter(tags=["replies"])

_CLOSED_STATUSES = {TicketStatus.resolved, TicketStatus.closed}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def _get_ticket_or_404(session: AsyncSession, ticket_id: int) -> Ticket:
    ticket = await session.get(Ticket, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    return ticket


def _to_read(reply: TicketReply, author_name: str | None, author_avatar: str | None) -> ReplyRead:
    return ReplyRead(
        id=reply.id,
        ticket_id=reply.ticket_id,
        author_id=reply.author_id,
        author_name=author_name or reply.slack_author_name,
        author_avatar=author_avatar,
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
    await _get_ticket_or_404(session, ticket_id)

    Author = aliased(User, flat=True)

    stmt = (
        select(TicketReply, Author.name.label("author_name"), Author.avatar_url.label("author_avatar"))
        .outerjoin(Author, TicketReply.author_id == Author.id)
        .where(TicketReply.ticket_id == ticket_id)
        .order_by(TicketReply.created_at.asc())
    )

    rows = (await session.execute(stmt)).all()

    return [_to_read(row[0], row[1], row[2]) for row in rows]


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
    ticket = await _get_ticket_or_404(session, ticket_id)
    now = _utcnow()

    is_internal = body.is_internal

    # Public reply on a resolved/closed ticket → re-open to in_progress
    old_status = ticket.status
    if ticket.status in _CLOSED_STATUSES and not is_internal:
        ticket.status = TicketStatus.in_progress
        ticket.resolved_at = None
        ticket.updated_at = now
        session.add(
            TicketHistory(
                ticket_id=ticket.id,
                actor_id=current_user.id,
                field_changed="status",
                old_value=old_status.value,
                new_value=TicketStatus.in_progress.value,
                created_at=now,
            )
        )

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
            from app.slack.service import post_reply_to_slack
            slack_ts = await post_reply_to_slack(ticket, body.body, current_user.name)
            if slack_ts and reply.slack_ts is None:
                reply.slack_ts = slack_ts
                await session.commit()
        except Exception:  # noqa: BLE001
            logger.exception(
                "Failed to sync reply to Slack for ticket %s", ticket.display_id
            )

    return _to_read(reply, current_user.name, current_user.avatar_url)
