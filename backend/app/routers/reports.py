"""
Reporting endpoints — aggregated metrics for the Reports page.

All endpoints accept optional `from_date` / `to_date` query params (ISO date strings).
Defaults to the last 30 days when omitted.
All chart endpoints accept an optional `assignee_id` to scope results to one technician.
"""
import csv
import io
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import case, func, select, text
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require_admin, require_technician
from app.database import get_session
from app.models import Category, Ticket, User
from app.models.enums import Role
from app.models.ticket_csat import TicketCSAT
from app.models.ticket_status_config import TicketStatusConfig

router = APIRouter(tags=["reports"], prefix="/reports")


def _date_range(
    from_date: Optional[date],
    to_date: Optional[date],
) -> tuple[datetime, datetime]:
    today = datetime.now(timezone.utc).date()
    end = to_date or today
    start = from_date or (end - timedelta(days=29))
    return (
        datetime(start.year, start.month, start.day, 0, 0, 0),
        datetime(end.year, end.month, end.day, 23, 59, 59),
    )


# ── GET /api/reports/assignees ─────────────────────────────────────────────────

@router.get("/assignees")
async def list_assignees(
    _user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Return all active technicians/admins for the filter dropdown."""
    result = await session.execute(
        select(User.id, User.name)
        .where(
            User.is_active == True,  # noqa: E712
            User.role.in_([Role.technician, Role.admin]),
        )
        .order_by(User.name)
    )
    return [{"id": row.id, "name": row.name} for row in result.all()]


# ── GET /api/reports/overview ──────────────────────────────────────────────────

@router.get("/overview")
async def get_overview(
    from_date: Optional[date] = Query(default=None),
    to_date: Optional[date] = Query(default=None),
    assignee_id: Optional[int] = Query(default=None),
    _: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> dict:
    start, end = _date_range(from_date, to_date)

    resolved_subq = (
        select(TicketStatusConfig.name)
        .where(TicketStatusConfig.is_resolved_state == True)  # noqa: E712
        .scalar_subquery()
    )

    stmt = select(
        func.count().label("total"),
        func.count(case((Ticket.status.in_(resolved_subq), 1))).label("resolved"),
        func.count(case((~Ticket.status.in_(resolved_subq), 1))).label("open"),
        func.count(case((
            (Ticket.sla_deadline.isnot(None)) &
            (Ticket.resolved_at.isnot(None)) &
            (Ticket.resolved_at <= Ticket.sla_deadline),
            1
        ))).label("sla_met"),
        func.count(case((
            (Ticket.sla_deadline.isnot(None)) &
            (Ticket.resolved_at.isnot(None) | (Ticket.sla_breached == True)),  # noqa: E712
            1
        ))).label("sla_total"),
        func.avg(
            func.extract("epoch", Ticket.resolved_at - Ticket.created_at) / 3600
        ).filter(
            Ticket.resolved_at.isnot(None)
        ).label("avg_resolution_hours"),
    ).where(Ticket.created_at >= start, Ticket.created_at <= end)

    if assignee_id is not None:
        stmt = stmt.where(Ticket.assignee_id == assignee_id)

    row = (await session.execute(stmt)).one()

    sla_pct = round(row.sla_met * 100 / row.sla_total, 1) if row.sla_total else None
    avg_h = round(row.avg_resolution_hours, 1) if row.avg_resolution_hours else None

    csat_stmt = (
        select(
            func.count(TicketCSAT.id).label("csat_total"),
            func.count(case((TicketCSAT.score == True, 1))).label("csat_positive"),  # noqa: E712
        )
        .join(Ticket, TicketCSAT.ticket_id == Ticket.id)
        .where(Ticket.created_at >= start, Ticket.created_at <= end)
    )
    if assignee_id is not None:
        csat_stmt = csat_stmt.where(Ticket.assignee_id == assignee_id)
    csat_row = (await session.execute(csat_stmt)).one()
    csat_pct = (
        round(csat_row.csat_positive * 100 / csat_row.csat_total, 1)
        if csat_row.csat_total
        else None
    )

    return {
        "total": row.total,
        "resolved": row.resolved,
        "open": row.open,
        "sla_compliance_pct": sla_pct,
        "avg_resolution_hours": avg_h,
        "csat_pct": csat_pct,
        "csat_total": csat_row.csat_total,
        "csat_positive": int(csat_row.csat_positive),
    }


# ── GET /api/reports/volume ────────────────────────────────────────────────────

@router.get("/volume")
async def get_volume(
    from_date: Optional[date] = Query(default=None),
    to_date: Optional[date] = Query(default=None),
    assignee_id: Optional[int] = Query(default=None),
    _: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    start, end = _date_range(from_date, to_date)

    stmt = (
        select(
            func.date_trunc("day", Ticket.created_at).label("day"),
            func.count().label("count"),
        )
        .where(Ticket.created_at >= start, Ticket.created_at <= end)
        .group_by(text("day"))
        .order_by(text("day"))
    )
    if assignee_id is not None:
        stmt = stmt.where(Ticket.assignee_id == assignee_id)

    result = await session.execute(stmt)
    return [{"date": row.day.strftime("%Y-%m-%d"), "count": row.count} for row in result.all()]


# ── GET /api/reports/by-priority ──────────────────────────────────────────────

@router.get("/by-priority")
async def get_by_priority(
    from_date: Optional[date] = Query(default=None),
    to_date: Optional[date] = Query(default=None),
    assignee_id: Optional[int] = Query(default=None),
    _: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    start, end = _date_range(from_date, to_date)
    stmt = (
        select(Ticket.priority, func.count().label("count"))
        .where(Ticket.created_at >= start, Ticket.created_at <= end)
        .group_by(Ticket.priority)
        .order_by(func.count().desc())
    )
    if assignee_id is not None:
        stmt = stmt.where(Ticket.assignee_id == assignee_id)
    result = await session.execute(stmt)
    return [{"priority": row.priority.value, "count": row.count} for row in result.all()]


# ── GET /api/reports/by-status ────────────────────────────────────────────────

@router.get("/by-status")
async def get_by_status(
    from_date: Optional[date] = Query(default=None),
    to_date: Optional[date] = Query(default=None),
    assignee_id: Optional[int] = Query(default=None),
    _: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    start, end = _date_range(from_date, to_date)
    stmt = (
        select(Ticket.status, func.count().label("count"))
        .where(Ticket.created_at >= start, Ticket.created_at <= end)
        .group_by(Ticket.status)
        .order_by(func.count().desc())
    )
    if assignee_id is not None:
        stmt = stmt.where(Ticket.assignee_id == assignee_id)
    result = await session.execute(stmt)
    return [{"status": row.status, "count": row.count} for row in result.all()]


# ── GET /api/reports/by-category ──────────────────────────────────────────────

@router.get("/by-category")
async def get_by_category(
    from_date: Optional[date] = Query(default=None),
    to_date: Optional[date] = Query(default=None),
    assignee_id: Optional[int] = Query(default=None),
    _: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    start, end = _date_range(from_date, to_date)
    stmt = (
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
    if assignee_id is not None:
        stmt = stmt.where(Ticket.assignee_id == assignee_id)
    result = await session.execute(stmt)
    return [{"category": row.category, "count": row.count} for row in result.all()]


# ── GET /api/reports/by-source ────────────────────────────────────────────────

@router.get("/by-source")
async def get_by_source(
    from_date: Optional[date] = Query(default=None),
    to_date: Optional[date] = Query(default=None),
    assignee_id: Optional[int] = Query(default=None),
    _: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    start, end = _date_range(from_date, to_date)
    stmt = (
        select(Ticket.source, func.count().label("count"))
        .where(Ticket.created_at >= start, Ticket.created_at <= end)
        .group_by(Ticket.source)
        .order_by(func.count().desc())
    )
    if assignee_id is not None:
        stmt = stmt.where(Ticket.assignee_id == assignee_id)
    result = await session.execute(stmt)
    return [{"source": row.source, "count": row.count} for row in result.all()]


# ── GET /api/reports/technicians ──────────────────────────────────────────────

@router.get("/technicians")
async def get_technicians(
    from_date: Optional[date] = Query(default=None),
    to_date: Optional[date] = Query(default=None),
    assignee_id: Optional[int] = Query(default=None),
    _user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    start, end = _date_range(from_date, to_date)
    resolved_subq = (
        select(TicketStatusConfig.name)
        .where(TicketStatusConfig.is_resolved_state == True)  # noqa: E712
        .scalar_subquery()
    )

    csat_subq = (
        select(
            TicketCSAT.ticket_id,
            func.count(TicketCSAT.id).label("csat_count"),
            func.count(case((TicketCSAT.score == True, 1))).label("csat_pos"),  # noqa: E712
        )
        .group_by(TicketCSAT.ticket_id)
        .subquery()
    )

    stmt = (
        select(
            User.id,
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
            func.coalesce(func.sum(csat_subq.c.csat_count), 0).label("csat_total"),
            func.coalesce(func.sum(csat_subq.c.csat_pos), 0).label("csat_positive"),
        )
        .join(User, Ticket.assignee_id == User.id)
        .outerjoin(csat_subq, csat_subq.c.ticket_id == Ticket.id)
        .where(
            Ticket.resolved_at.isnot(None),
            Ticket.resolved_at >= start,
            Ticket.resolved_at <= end,
        )
        .group_by(User.id, User.name)
        .order_by(func.count(Ticket.id).desc())
    )

    if assignee_id is not None:
        stmt = stmt.where(User.id == assignee_id)

    result = await session.execute(stmt)
    return [
        {
            "name": row.name,
            "total": row.total,
            "resolved": row.resolved,
            "avg_hours": round(row.avg_hours, 1) if row.avg_hours else None,
            "sla_pct": round(float(row.sla_pct), 1) if row.sla_pct else None,
            "csat_pct": (
                round(row.csat_positive * 100 / row.csat_total, 1)
                if row.csat_total
                else None
            ),
        }
        for row in result.all()
    ]



# ── GET /api/reports/csat-negative ────────────────────────────────────────────

@router.get("/csat-negative")
async def get_csat_negative(
    from_date: Optional[date] = Query(default=None),
    to_date: Optional[date] = Query(default=None),
    _: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Return all tickets that received a negative CSAT response in the date range."""
    start, end = _date_range(from_date, to_date)
    # Latest negative CSAT per ticket within the date range
    latest_neg = (
        select(
            TicketCSAT.ticket_id,
            func.max(TicketCSAT.responded_at).label("responded_at"),
        )
        .where(
            TicketCSAT.score == False,  # noqa: E712
            TicketCSAT.responded_at >= start,
            TicketCSAT.responded_at <= end,
        )
        .group_by(TicketCSAT.ticket_id)
        .subquery()
    )
    assignee_alias = aliased(User)
    stmt = (
        select(
            Ticket.id,
            Ticket.title,
            Ticket.status,
            Ticket.priority,
            latest_neg.c.responded_at,
            assignee_alias.name.label("assignee_name"),
        )
        .join(latest_neg, latest_neg.c.ticket_id == Ticket.id)
        .outerjoin(assignee_alias, Ticket.assignee_id == assignee_alias.id)
        .order_by(latest_neg.c.responded_at.desc())
    )
    result = await session.execute(stmt)
    return [
        {
            "id": row.id,
            "title": row.title,
            "status": row.status,
            "priority": row.priority.value,
            "responded_at": row.responded_at.isoformat(),
            "assignee_name": row.assignee_name,
        }
        for row in result.all()
    ]


# ── GET /api/reports/sla-breached ─────────────────────────────────────────────

@router.get("/sla-breached")
async def get_sla_breached(
    from_date: Optional[date] = Query(default=None),
    to_date: Optional[date] = Query(default=None),
    _: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Return all SLA-breached tickets created in the date range."""
    start, end = _date_range(from_date, to_date)
    assignee_alias = aliased(User)
    stmt = (
        select(
            Ticket.id,
            Ticket.title,
            Ticket.status,
            Ticket.priority,
            Ticket.sla_deadline,
            assignee_alias.name.label("assignee_name"),
        )
        .outerjoin(assignee_alias, Ticket.assignee_id == assignee_alias.id)
        .where(
            Ticket.sla_breached == True,  # noqa: E712
            Ticket.created_at >= start,
            Ticket.created_at <= end,
        )
        .order_by(Ticket.sla_deadline.asc())
    )
    result = await session.execute(stmt)
    return [
        {
            "id": row.id,
            "title": row.title,
            "status": row.status,
            "priority": row.priority.value,
            "sla_deadline": row.sla_deadline.isoformat() if row.sla_deadline else None,
            "assignee_name": row.assignee_name,
        }
        for row in result.all()
    ]


# ── GET /api/reports/export ────────────────────────────────────────────────────

@router.get("/export")
async def export_tickets_csv(
    current_user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    """Stream all tickets as a CSV file for data portability."""
    submitter = User.__table__.alias("submitter")
    assignee = User.__table__.alias("assignee")

    rows = (await session.execute(
        select(
            Ticket.id,
            Ticket.title,
            Ticket.description,
            Ticket.status,
            Ticket.priority,
            Ticket.source,
            Category.name.label("category"),
            submitter.c.name.label("submitter_name"),
            submitter.c.email.label("submitter_email"),
            Ticket.slack_submitter_name,
            Ticket.slack_submitter_id,
            assignee.c.name.label("assignee_name"),
            Ticket.created_at,
            Ticket.updated_at,
            Ticket.resolved_at,
            Ticket.sla_deadline,
            Ticket.sla_breached,
            Ticket.first_response_deadline,
            Ticket.first_responded_at,
        )
        .outerjoin(Category, Ticket.category_id == Category.id)
        .outerjoin(submitter, Ticket.submitter_id == submitter.c.id)
        .outerjoin(assignee, Ticket.assignee_id == assignee.c.id)
        .order_by(Ticket.created_at.desc())
    )).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "ID", "Title", "Description", "Status", "Priority", "Channel",
        "Category", "Submitter", "Submitter Email / Slack ID", "Assignee",
        "Created At", "Updated At", "Resolved At",
        "SLA Deadline", "SLA Breached", "First Response Deadline", "First Responded At",
    ])
    for r in rows:
        writer.writerow([
            f"TKT-{r.id:04d}", r.title, r.description, r.status, r.priority.value, r.source,
            r.category or "",
            r.submitter_name or r.slack_submitter_name or "",
            r.submitter_email or r.slack_submitter_id or "",
            r.assignee_name or "",
            r.created_at.isoformat() if r.created_at else "",
            r.updated_at.isoformat() if r.updated_at else "",
            r.resolved_at.isoformat() if r.resolved_at else "",
            r.sla_deadline.isoformat() if r.sla_deadline else "",
            "yes" if r.sla_breached else "no",
            r.first_response_deadline.isoformat() if r.first_response_deadline else "",
            r.first_responded_at.isoformat() if r.first_responded_at else "",
        ])

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="simpletickets_{today}.csv"'},
    )
