"""
In-app (bell) notifications. Callers add them inside their own session and
commit as part of the change that caused them.
"""
from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Notification, Role, Ticket, User


async def notify(
    session: AsyncSession,
    user_ids: Iterable[int],
    ticket_id: int,
    kind: str,
    *,
    actor_name: Optional[str] = None,
) -> None:
    for uid in set(user_ids):
        session.add(Notification(user_id=uid, ticket_id=ticket_id, kind=kind, actor_name=actor_name))


async def ticket_watchers(session: AsyncSession, ticket: Ticket, *, admins_only: bool = False) -> list[int]:
    """Who hears about a ticket's SLA/CSAT events: its assignee, or — when it's
    unassigned — every active staff member (admins only, if admins_only)."""
    if ticket.assignee_id is not None:
        return [ticket.assignee_id]
    stmt = select(User.id).where(User.is_active == True)  # noqa: E712
    if admins_only:
        stmt = stmt.where(User.role == Role.admin)
    return list((await session.execute(stmt)).scalars().all())
