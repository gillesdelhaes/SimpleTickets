"""
Reporting endpoints — aggregated metrics for the Reports page.

All endpoints accept optional `from_date` / `to_date` query params (ISO date strings).
Defaults to the last 30 days when omitted.
"""
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.database import get_session
from app.models import Category, Ticket, User
from app.models.ticket_status_config import TicketStatusConfig

router = APIRouter(tags=["reports"], prefix="/reports")


def _date_range(
    from_date: Optional[date],
    to_date: Optional[date],
) -> tuple[datetime, datetime]:
    today = datetime.now(timezone.utc).date()
    end = to_date or today
    start = from_date or (end - timedelta(days=29))
    # inclusive: end of the to_date day
    return (
        datetime(start.year, start.month, start.day, 0, 0, 0),
        datetime(end.year, end.month, end.day, 23, 59, 59),
    )


# ── GET /api/reports/overview ──────────────────────────────────────────────────

@router.get("/overview")
async def get_overview(
    from_date: Optional[date] = Query(default=None),
    to_date: Optional[date] = Query(default=None),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    start, end = _date_range(from_date, to_date)

    resolved_subq = (
        select(TicketStatusConfig.name)
        .where(TicketStatusConfig.is_resolved_state == True)  # noqa: E712
        .scalar_subquery()
    )

    result = await session.execute(
        select(
            func.count().label("total"),
            func.count(case((Ticket.status.in_(resolved_subq), 1))).label("resolved"),
            func.count(case((~Ticket.status.in_(resolved_subq), 1))).label("open"),
            func.count(case((
                (Ticket.sla_deadline.isnot(None)) &
                (Ticket.resolved_at.isnot(None)) &
                (Ticket.resolved_at <= Ticket.sla_deadline),
                1
            ))).label("sla_met"),
            func.count(case((Ticket.sla_deadline.isnot(None), 1))).label("sla_total"),
            func.avg(
                func.extract("epoch", Ticket.resolved_at - Ticket.created_at) / 3600
            ).filter(
                Ticket.resolved_at.isnot(None)
            ).label("avg_resolution_hours"),
        ).where(
            Ticket.created_at >= start,
            Ticket.created_at <= end,
        )
    )
    row = result.one()

    sla_pct = round(row.sla_met * 100 / row.sla_total, 1) if row.sla_total else None
    avg_h = round(row.avg_resolution_hours, 1) if row.avg_resolution_hours else None

    return {
        "total": row.total,
        "resolved": row.resolved,
        "open": row.open,
        "sla_compliance_pct": sla_pct,
        "avg_resolution_hours": avg_h,
    }


# ── GET /api/reports/volume ────────────────────────────────────────────────────

@router.get("/volume")
async def get_volume(
    from_date: Optional[date] = Query(default=None),
    to_date: Optional[date] = Query(default=None),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    start, end = _date_range(from_date, to_date)

    result = await session.execute(
        select(
            func.date_trunc("day", Ticket.created_at).label("day"),
            func.count().label("count"),
        )
        .where(Ticket.created_at >= start, Ticket.created_at <= end)
        .group_by(text("day"))
        .order_by(text("day"))
    )
    return [
        {"date": row.day.strftime("%Y-%m-%d"), "count": row.count}
        for row in result.all()
    ]


# ── GET /api/reports/by-priority ──────────────────────────────────────────────

@router.get("/by-priority")
async def get_by_priority(
    from_date: Optional[date] = Query(default=None),
    to_date: Optional[date] = Query(default=None),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    start, end = _date_range(from_date, to_date)
    result = await session.execute(
        select(Ticket.priority, func.count().label("count"))
        .where(Ticket.created_at >= start, Ticket.created_at <= end)
        .group_by(Ticket.priority)
        .order_by(func.count().desc())
    )
    return [{"priority": row.priority.value, "count": row.count} for row in result.all()]


# ── GET /api/reports/by-status ────────────────────────────────────────────────

@router.get("/by-status")
async def get_by_status(
    from_date: Optional[date] = Query(default=None),
    to_date: Optional[date] = Query(default=None),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    start, end = _date_range(from_date, to_date)
    result = await session.execute(
        select(Ticket.status, func.count().label("count"))
        .where(Ticket.created_at >= start, Ticket.created_at <= end)
        .group_by(Ticket.status)
        .order_by(func.count().desc())
    )
    return [{"status": row.status, "count": row.count} for row in result.all()]


# ── GET /api/reports/by-category ──────────────────────────────────────────────

@router.get("/by-category")
async def get_by_category(
    from_date: Optional[date] = Query(default=None),
    to_date: Optional[date] = Query(default=None),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    start, end = _date_range(from_date, to_date)
    result = await session.execute(
        select(
            func.coalesce(Category.name, "Uncategorised").label("category"),
            func.count().label("count"),
        )
        .select_from(Ticket)
        .outerjoin(Category, Ticket.category_id == Category.id)
        .where(Ticket.created_at >= start, Ticket.created_at <= end)
        .group_by(Category.name)
        .order_by(func.count().desc())
    )
    return [{"category": row.category, "count": row.count} for row in result.all()]


# ── GET /api/reports/by-source ────────────────────────────────────────────────

@router.get("/by-source")
async def get_by_source(
    from_date: Optional[date] = Query(default=None),
    to_date: Optional[date] = Query(default=None),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    start, end = _date_range(from_date, to_date)
    result = await session.execute(
        select(Ticket.source, func.count().label("count"))
        .where(Ticket.created_at >= start, Ticket.created_at <= end)
        .group_by(Ticket.source)
        .order_by(func.count().desc())
    )
    return [{"source": row.source, "count": row.count} for row in result.all()]


# ── GET /api/reports/technicians ──────────────────────────────────────────────

@router.get("/technicians")
async def get_technicians(
    from_date: Optional[date] = Query(default=None),
    to_date: Optional[date] = Query(default=None),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    start, end = _date_range(from_date, to_date)
    resolved_subq = (
        select(TicketStatusConfig.name)
        .where(TicketStatusConfig.is_resolved_state == True)  # noqa: E712
        .scalar_subquery()
    )

    result = await session.execute(
        select(
            User.name,
            func.count(Ticket.id).label("total"),
            func.count(case((Ticket.status.in_(resolved_subq), 1))).label("resolved"),
            func.avg(
                func.extract("epoch", Ticket.resolved_at - Ticket.created_at) / 3600
            ).filter(Ticket.resolved_at.isnot(None)).label("avg_hours"),
            (
                func.count(case((
                    (Ticket.sla_deadline.isnot(None)) &
                    (Ticket.resolved_at.isnot(None)) &
                    (Ticket.resolved_at <= Ticket.sla_deadline),
                    1
                ))) * 100.0 /
                func.nullif(func.count(case((
                    (Ticket.sla_deadline.isnot(None)) & (Ticket.resolved_at.isnot(None)), 1
                ))), 0)
            ).label("sla_pct"),
        )
        .join(User, Ticket.assignee_id == User.id)
        .where(Ticket.created_at >= start, Ticket.created_at <= end)
        .group_by(User.id, User.name)
        .order_by(func.count(Ticket.id).desc())
    )

    return [
        {
            "name": row.name,
            "total": row.total,
            "resolved": row.resolved,
            "avg_hours": round(row.avg_hours, 1) if row.avg_hours else None,
            "sla_pct": round(float(row.sla_pct), 1) if row.sla_pct else None,
        }
        for row in result.all()
    ]
