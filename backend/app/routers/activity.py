"""
Activity feed — unified stream of recent events across all tickets.

Returns ticket creations, field changes, and public replies merged and sorted
newest-first. Used by the dashboard activity feed.
"""
from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import aliased

from app.auth.deps import get_current_user
from app.utils import utcnow
from app.database import get_session
from app.models import Category, Ticket, TicketHistory, TicketReply, User
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(tags=["activity"], prefix="/activity")

_DISPLAY_FIELDS = {"status", "assignee_id", "priority", "category_id", "csat_response"}


@router.get("")
async def get_activity(
    limit: int = Query(default=20, le=50),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Unified activity feed: ticket creations, field changes, public replies."""
    cutoff = utcnow() - timedelta(days=14)
    events: list[dict] = []

    # ── Ticket creations ───────────────────────────────────────────────────────
    Submitter = aliased(User, flat=True)
    ticket_rows = (await session.execute(
        select(Ticket, Submitter.name.label("actor_name"))
        .outerjoin(Submitter, Ticket.submitter_id == Submitter.id)
        .where(Ticket.created_at >= cutoff)
        .order_by(Ticket.created_at.desc())
        .limit(limit)
    )).all()

    for row in ticket_rows:
        t: Ticket = row[0]
        events.append({
            "type": "ticket_created",
            "ticket_id": t.id,
            "ticket_display_id": t.display_id,
            "ticket_title": t.title,
            "actor_name": row[1] or t.slack_submitter_name,
            "created_at": t.created_at.isoformat(),
        })

    # ── Field changes ──────────────────────────────────────────────────────────
    Actor = aliased(User, flat=True)
    history_rows = (await session.execute(
        select(TicketHistory, Ticket.title.label("ticket_title"), Actor.name.label("actor_name"))
        .join(Ticket, TicketHistory.ticket_id == Ticket.id)
        .outerjoin(Actor, TicketHistory.actor_id == Actor.id)
        .where(
            TicketHistory.created_at >= cutoff,
            TicketHistory.field_changed.in_(_DISPLAY_FIELDS),
        )
        .order_by(TicketHistory.created_at.desc())
        .limit(limit)
    )).all()

    # Collect IDs to resolve
    user_ids: set[int] = set()
    cat_ids: set[int] = set()
    for row in history_rows:
        h: TicketHistory = row[0]
        if h.field_changed == "assignee_id":
            for v in (h.old_value, h.new_value):
                if v and v.isdigit():
                    user_ids.add(int(v))
        elif h.field_changed == "category_id":
            for v in (h.old_value, h.new_value):
                if v and v.isdigit():
                    cat_ids.add(int(v))

    user_names: dict[int, str] = {}
    if user_ids:
        for r in (await session.execute(select(User.id, User.name).where(User.id.in_(user_ids)))).all():
            user_names[r.id] = r.name

    cat_names: dict[int, str] = {}
    if cat_ids:
        for r in (await session.execute(select(Category.id, Category.name).where(Category.id.in_(cat_ids)))).all():
            cat_names[r.id] = r.name

    def _resolve(field: str, val: str | None) -> str | None:
        if val is None:
            return None
        if field == "assignee_id" and val.isdigit():
            return user_names.get(int(val), val)
        if field == "category_id" and val.isdigit():
            return cat_names.get(int(val), val)
        return val

    for row in history_rows:
        h: TicketHistory = row[0]
        # Skip the seed "status: None → open" entry on ticket creation
        if h.field_changed == "status" and h.old_value is None:
            continue
        events.append({
            "type": "field_changed",
            "ticket_id": h.ticket_id,
            "ticket_display_id": f"TKT-{h.ticket_id:04d}",
            "ticket_title": row[1],
            "actor_name": row[2],
            "field": h.field_changed,
            "old_value": _resolve(h.field_changed, h.old_value),
            "new_value": _resolve(h.field_changed, h.new_value),
            "created_at": h.created_at.isoformat(),
        })

    # ── Public replies ─────────────────────────────────────────────────────────
    ReplyAuthor = aliased(User, flat=True)
    reply_rows = (await session.execute(
        select(TicketReply, Ticket.title.label("ticket_title"), ReplyAuthor.name.label("actor_name"))
        .join(Ticket, TicketReply.ticket_id == Ticket.id)
        .outerjoin(ReplyAuthor, TicketReply.author_id == ReplyAuthor.id)
        .where(
            TicketReply.created_at >= cutoff,
            TicketReply.is_internal.is_(False),
        )
        .order_by(TicketReply.created_at.desc())
        .limit(limit)
    )).all()

    for row in reply_rows:
        r: TicketReply = row[0]
        events.append({
            "type": "reply_added",
            "ticket_id": r.ticket_id,
            "ticket_display_id": f"TKT-{r.ticket_id:04d}",
            "ticket_title": row[1],
            "actor_name": row[2] or r.slack_author_name,
            "body": r.body[:120] + ("…" if len(r.body) > 120 else ""),
            "created_at": r.created_at.isoformat(),
        })

    # Merge and return newest-first
    events.sort(key=lambda e: e["created_at"], reverse=True)
    return events[:limit]
