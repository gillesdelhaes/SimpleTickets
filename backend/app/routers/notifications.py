"""
Unread reply notifications.

GET  /api/notifications/unread
  Returns the count of unread replies on tickets assigned to the current user,
  plus the set of all ticket IDs (any ticket) that have unread replies.

POST /api/tickets/{ticket_id}/mark-read
  Upserts a TicketReadMarker so subsequent calls to /unread no longer include
  replies that arrived before this moment.
"""
from fastapi import APIRouter, Depends, HTTPException, status as http_status
from pydantic import BaseModel
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.database import get_session
from app.models import Ticket, TicketReadMarker, User
from app.models.ticket_reply import TicketReply
from app.utils import utcnow

router = APIRouter(tags=["notifications"])


class UnreadTicketSummary(BaseModel):
    id: int
    display_id: str
    title: str


class UnreadResponse(BaseModel):
    my_unread_count: int
    my_unread_tickets: list[UnreadTicketSummary]
    ticket_ids_with_unread: list[int]


# ── GET /api/notifications/unread ─────────────────────────────────────────────


@router.get("/notifications/unread", response_model=UnreadResponse)
async def get_unread(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UnreadResponse:
    """
    Return:
    - my_unread_count: # of tickets assigned to me with at least one unread reply
    - ticket_ids_with_unread: all ticket IDs (any ticket) with unread replies
    A reply is "unread" if it was not authored by the current user AND was
    created after the user's last_read_at for that ticket (or the ticket has
    never been opened by this user).
    """
    # Unread replies: not by me AND (no read marker OR created after last_read_at)
    unread_stmt = (
        select(TicketReply.ticket_id)
        .distinct()
        .outerjoin(
            TicketReadMarker,
            and_(
                TicketReadMarker.user_id == current_user.id,
                TicketReadMarker.ticket_id == TicketReply.ticket_id,
            ),
        )
        .where(
            or_(
                TicketReply.author_id.is_(None),
                TicketReply.author_id != current_user.id,
            ),
            or_(
                TicketReadMarker.last_read_at.is_(None),
                TicketReply.created_at > TicketReadMarker.last_read_at,
            ),
        )
    )

    unread_ticket_ids: list[int] = list(
        (await session.execute(unread_stmt)).scalars().all()
    )

    # Fetch tickets assigned to me that have unread replies
    my_unread_tickets: list[UnreadTicketSummary] = []
    if unread_ticket_ids:
        my_tickets_stmt = (
            select(Ticket.id, Ticket.title)
            .where(
                Ticket.id.in_(unread_ticket_ids),
                Ticket.assignee_id == current_user.id,
            )
            .order_by(Ticket.updated_at.desc())
        )
        rows = (await session.execute(my_tickets_stmt)).all()
        my_unread_tickets = [
            UnreadTicketSummary(id=r[0], display_id=f"TKT-{r[0]:04d}", title=r[1])
            for r in rows
        ]

    return UnreadResponse(
        my_unread_count=len(my_unread_tickets),
        my_unread_tickets=my_unread_tickets,
        ticket_ids_with_unread=unread_ticket_ids,
    )


# ── POST /api/tickets/{ticket_id}/mark-read ───────────────────────────────────


@router.post("/tickets/{ticket_id}/mark-read", status_code=204)
async def mark_read(
    ticket_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Upsert the read marker for the current user on a ticket."""
    if not await session.get(Ticket, ticket_id):
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    now = utcnow()

    result = await session.execute(
        select(TicketReadMarker).where(
            TicketReadMarker.user_id == current_user.id,
            TicketReadMarker.ticket_id == ticket_id,
        )
    )
    marker = result.scalar_one_or_none()

    if marker is None:
        marker = TicketReadMarker(
            user_id=current_user.id,
            ticket_id=ticket_id,
            last_read_at=now,
        )
        session.add(marker)
    else:
        marker.last_read_at = now

    await session.commit()
