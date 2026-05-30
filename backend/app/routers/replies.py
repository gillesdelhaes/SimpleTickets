"""
Ticket Replies — Chunk 08 (extended in Chunk 21 with Slack two-way sync).

Access rules:
  GET  /tickets/{id}/replies   end_users: own ticket, public replies only
                               tech/admin: all replies including internal notes
  POST /tickets/{id}/replies   end_users: public replies on own open ticket
                               tech/admin: public or internal, any ticket
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.auth.deps import get_current_user
from app.database import get_session
from app.models import Ticket, TicketHistory, TicketReply, User
from app.models.enums import Role, TicketStatus
from app.services.notifications import notify_reply_added
from app.schemas.reply import ReplyCreate, ReplyRead

logger = logging.getLogger(__name__)

router = APIRouter(tags=["replies"])

_CLOSED_STATUSES = {TicketStatus.resolved, TicketStatus.closed}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


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
        author_name=author_name,
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
    """
    List replies for a ticket, ordered oldest-first.
    End-users see only public replies on their own tickets.
    Technicians/admins see all replies including internal notes.
    """
    ticket = await _get_ticket_or_404(session, ticket_id)

    is_privileged = current_user.role in {Role.technician, Role.admin}

    if not is_privileged and ticket.submitter_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")

    Author = aliased(User, flat=True)

    stmt = (
        select(TicketReply, Author.name.label("author_name"), Author.avatar_url.label("author_avatar"))
        .outerjoin(Author, TicketReply.author_id == Author.id)
        .where(TicketReply.ticket_id == ticket_id)
        .order_by(TicketReply.created_at.asc())
    )

    if not is_privileged:
        stmt = stmt.where(TicketReply.is_internal == False)  # noqa: E712

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

    End-users:
      - May only reply to their own tickets.
      - May not post internal notes (is_internal is forced False).
      - May not reply to resolved or closed tickets.

    Technicians/admins:
      - May reply to any ticket.
      - May post internal notes (is_internal=True).
      - Replying to a resolved ticket re-opens it to in_progress.
    """
    ticket = await _get_ticket_or_404(session, ticket_id)
    is_privileged = current_user.role in {Role.technician, Role.admin}
    now = _utcnow()

    # Access checks
    if not is_privileged:
        if ticket.submitter_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
        if ticket.status in _CLOSED_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot reply to a resolved or closed ticket",
            )

    # Force internal=False for end-users
    is_internal = body.is_internal and is_privileged

    # Technician reply on a resolved ticket → re-open to in_progress
    old_status = ticket.status
    if is_privileged and ticket.status in _CLOSED_STATUSES and not is_internal:
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

    await notify_reply_added(
        session=session,
        ticket_id=ticket.id,
        ticket_display_id=ticket.display_id,
        ticket_title=ticket.title,
        reply_body=body.body,
        is_internal=is_internal,
        author_id=current_user.id,
        author_name=current_user.name,
        submitter_id=ticket.submitter_id,
        assignee_id=ticket.assignee_id,
    )

    return _to_read(reply, current_user.name, current_user.avatar_url)
