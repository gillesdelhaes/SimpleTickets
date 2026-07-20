"""
Ticket watchers (P9) — staff who follow a ticket without being its assignee.

GET    /tickets/{id}/watchers            list active watchers
PUT    /tickets/{id}/watchers/{user_id}  add a watcher (idempotent)
DELETE /tickets/{id}/watchers/{user_id}  remove a watcher (idempotent)

Watchers receive a Slack DM (if they have a linked Slack ID in the ticket's
workspace) on status changes and public replies — see notify_ticket_watchers
in slack/service.py.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete as sa_delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require_technician
from app.database import get_session
from app.models import TicketWatcher, User
from app.models.user_slack_identity import UserSlackIdentity
from app.utils import get_ticket_or_404, utcnow

router = APIRouter(tags=["watchers"])


class WatcherRead(BaseModel):
    user_id: int
    name: str
    # False = no Slack ID linked in this ticket's workspace, so they won't receive DMs
    slack_linked: bool


@router.get("/tickets/{ticket_id}/watchers", response_model=list[WatcherRead])
async def list_watchers(
    ticket_id: int,
    _user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> list[WatcherRead]:
    ticket = await get_ticket_or_404(session, ticket_id)
    # A watcher only gets DMs if they have a Slack identity linked for THIS
    # ticket's workspace — Slack IDs are workspace-specific, so "linked" is
    # scoped per ticket, not a flat per-user flag.
    rows = (await session.execute(
        select(TicketWatcher.user_id, User.name, UserSlackIdentity.slack_user_id)
        .join(User, TicketWatcher.user_id == User.id)
        .outerjoin(
            UserSlackIdentity,
            (UserSlackIdentity.user_id == User.id)
            & (UserSlackIdentity.workspace_id == ticket.workspace_id),
        )
        .where(
            TicketWatcher.ticket_id == ticket_id,
            User.is_active == True,  # noqa: E712
        )
        .order_by(User.name)
    )).all()
    return [WatcherRead(user_id=r[0], name=r[1], slack_linked=bool(r[2])) for r in rows]


@router.put("/tickets/{ticket_id}/watchers/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def add_watcher(
    ticket_id: int,
    user_id: int,
    _user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Add a staff member as a watcher. Idempotent — re-adding is a no-op."""
    await get_ticket_or_404(session, ticket_id)
    target = await session.get(User, user_id)
    if target is None or not target.is_active:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="User not found or inactive",
        )
    # Atomic upsert — concurrent double-clicks must not 500 on uq_ticket_watcher
    stmt = (
        pg_insert(TicketWatcher)
        .values(ticket_id=ticket_id, user_id=user_id, created_at=utcnow())
        .on_conflict_do_nothing(constraint="uq_ticket_watcher")
    )
    await session.execute(stmt)
    await session.commit()


@router.delete("/tickets/{ticket_id}/watchers/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_watcher(
    ticket_id: int,
    user_id: int,
    _user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Remove a watcher. Idempotent — removing a non-watcher is a no-op."""
    await get_ticket_or_404(session, ticket_id)
    await session.execute(
        sa_delete(TicketWatcher).where(
            TicketWatcher.ticket_id == ticket_id,
            TicketWatcher.user_id == user_id,
        )
    )
    await session.commit()
