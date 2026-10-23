"""
Unread reply notifications.

GET  /api/notifications/unread
  Returns the count of unread replies on tickets assigned to the current user,
  plus the set of all ticket IDs (any ticket) that have unread replies.

POST /api/tickets/{ticket_id}/mark-read
  Upserts a TicketReadMarker so subsequent calls to /unread no longer include
  replies that arrived before this moment, and marks that ticket's bell
  notifications read.

GET  /api/notifications                 latest bell notifications + unread count
POST /api/notifications/{id}/read       mark one read
POST /api/notifications/read-all        mark all read
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status as http_status
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.database import get_session
from app.models import Notification, Ticket, TicketReadMarker, User
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
        (await session.execute(unread_stmt.limit(2000))).scalars().all()
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

    # Atomic upsert — a plain select-then-insert races two concurrent first-opens
    # into a unique-constraint violation (uq_read_marker_user_ticket) → 500.
    stmt = (
        pg_insert(TicketReadMarker)
        .values(user_id=current_user.id, ticket_id=ticket_id, last_read_at=now)
        .on_conflict_do_update(
            constraint="uq_read_marker_user_ticket",
            set_={"last_read_at": now},
        )
    )
    await session.execute(stmt)
    await session.execute(
        update(Notification)
        .where(Notification.user_id == current_user.id, Notification.ticket_id == ticket_id, Notification.read_at.is_(None))
        .values(read_at=now)
    )
    await session.commit()


# ── Bell notifications (assigned, SLA, negative CSAT) ─────────────────────────


class NotificationRead(BaseModel):
    id: int
    kind: str
    ticket_id: int
    display_id: str
    ticket_title: str
    actor_name: str | None
    created_at: datetime
    read: bool


class NotificationsResponse(BaseModel):
    items: list[NotificationRead]
    unread_count: int


@router.get("/notifications", response_model=NotificationsResponse)
async def list_notifications(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NotificationsResponse:
    """The 30 most recent notifications for the current user, newest first."""
    rows = (await session.execute(
        select(Notification, Ticket.title)
        .join(Ticket, Ticket.id == Notification.ticket_id)
        .where(Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(30)
    )).all()
    unread = (await session.execute(
        select(func.count()).select_from(Notification)
        .where(Notification.user_id == current_user.id, Notification.read_at.is_(None))
    )).scalar_one()
    return NotificationsResponse(
        items=[
            NotificationRead(
                id=n.id, kind=n.kind, ticket_id=n.ticket_id, display_id=f"TKT-{n.ticket_id:04d}",
                ticket_title=title, actor_name=n.actor_name, created_at=n.created_at, read=n.read_at is not None,
            )
            for n, title in rows
        ],
        unread_count=unread,
    )


@router.post("/notifications/{notification_id}/read", status_code=204)
async def mark_notification_read(
    notification_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await session.execute(
        update(Notification)
        .where(Notification.id == notification_id, Notification.user_id == current_user.id, Notification.read_at.is_(None))
        .values(read_at=utcnow())
    )
    await session.commit()


@router.post("/notifications/read-all", status_code=204)
async def mark_all_notifications_read(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await session.execute(
        update(Notification)
        .where(Notification.user_id == current_user.id, Notification.read_at.is_(None))
        .values(read_at=utcnow())
    )
    await session.commit()
