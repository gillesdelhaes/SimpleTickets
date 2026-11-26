"""
Reporting endpoints — aggregated metrics for the Reports page.

All endpoints accept optional `from_date` / `to_date` query params (ISO date strings).
Defaults to the last 30 days when omitted.
All chart endpoints accept optional `assignee_id`, `category_id` and `source`
to narrow the results.

The queries live in app/services/reports.py, shared with Ask, so the Reports
page and Ask always agree.
"""
import csv
import io
from datetime import date, datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require_admin, require_technician
from app.database import get_session
from app.models import AIUsage, Category, Ticket, User
from app.models.enums import Role
from app.services import reports as svc
from app.services.reports import ReportFilter

router = APIRouter(tags=["reports"], prefix="/reports")

# Characters that make a spreadsheet treat a cell as a formula on open.
_CSV_INJECTION_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _csv_safe(value) -> str:
    """Neutralise CSV/formula injection.

    Ticket titles and descriptions come from submitters (including arbitrary
    Slack users), so a cell like ``=HYPERLINK(...)`` would execute when an admin
    opens the export in Excel/Sheets. Prefix any risky leading character with a
    single quote so the app renders it as literal text.
    """
    s = "" if value is None else str(value)
    if s and s[0] in _CSV_INJECTION_PREFIXES:
        return "'" + s
    return s


async def report_filter(
    from_date: Optional[date] = Query(default=None),
    to_date: Optional[date] = Query(default=None),
    assignee_id: Optional[int] = Query(default=None),
    category_id: Optional[int] = Query(default=None),
    source: Optional[str] = Query(default=None, max_length=20),
    session: AsyncSession = Depends(get_session),
) -> ReportFilter:
    start, end = await svc.date_range(from_date, to_date, session)
    return ReportFilter(start, end, assignee_id=assignee_id, category_id=category_id, source=source)


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


# ── Charts ────────────────────────────────────────────────────────────────────


@router.get("/overview")
async def get_overview(
    f: ReportFilter = Depends(report_filter),
    _: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> dict:
    return await svc.overview(session, f)


@router.get("/volume")
async def get_volume(
    bucket: Literal["day", "week", "month"] = Query(default="day"),
    f: ReportFilter = Depends(report_filter),
    _: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await svc.volume(session, f, bucket)


@router.get("/by-priority")
async def get_by_priority(
    f: ReportFilter = Depends(report_filter),
    _: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await svc.by_priority(session, f)


@router.get("/by-status")
async def get_by_status(
    f: ReportFilter = Depends(report_filter),
    _: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await svc.by_status(session, f)


@router.get("/by-category")
async def get_by_category(
    f: ReportFilter = Depends(report_filter),
    _: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await svc.by_category(session, f)


@router.get("/by-source")
async def get_by_source(
    f: ReportFilter = Depends(report_filter),
    _: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await svc.by_source(session, f)


@router.get("/technicians")
async def get_technicians(
    f: ReportFilter = Depends(report_filter),
    _user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await svc.technicians(session, f)


@router.get("/csat-negative")
async def get_csat_negative(
    f: ReportFilter = Depends(report_filter),
    _: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """All tickets that received a negative CSAT response in the date range."""
    return await svc.csat_negative(session, f)


@router.get("/sla-breached")
async def get_sla_breached(
    f: ReportFilter = Depends(report_filter),
    _: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """All SLA-breached tickets created in the date range."""
    return await svc.sla_breached(session, f)


# ── GET /api/reports/ai-usage ─────────────────────────────────────────────────


@router.get("/ai-usage")
async def get_ai_usage(
    from_date: Optional[date] = Query(default=None),
    to_date: Optional[date] = Query(default=None),
    _: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """AI Assistant token use: totals, per day, per model, and an estimated
    cost from the prices set in Settings → AI assistant (current prices, so
    an estimate). Admin only, and team-wide — runs aren't anyone's own."""
    from app.ai.config import DEFAULT_DAILY_TOKEN_BUDGET
    from app.routers.ai import read_price
    from app.services.settings_service import get_setting

    start, end = await svc.date_range(from_date, to_date, session)
    in_range = (AIUsage.created_at >= start, AIUsage.created_at <= end)
    failed = func.count().filter(AIUsage.ok == False)  # noqa: E712

    totals = (await session.execute(
        select(
            func.coalesce(func.sum(AIUsage.input_tokens), 0).label("input"),
            func.coalesce(func.sum(AIUsage.output_tokens), 0).label("output"),
            func.count().label("runs"),
            failed.label("failures"),
            func.count(func.distinct(AIUsage.ticket_id)).label("tickets"),
        ).where(*in_range)
    )).one()
    days = (await session.execute(
        select(
            func.date_trunc("day", AIUsage.created_at).label("day"),
            func.coalesce(func.sum(AIUsage.input_tokens), 0).label("input"),
            func.coalesce(func.sum(AIUsage.output_tokens), 0).label("output"),
        ).where(*in_range).group_by(text("day")).order_by(text("day"))
    )).all()
    models = (await session.execute(
        select(
            AIUsage.model,
            func.count().label("runs"),
            failed.label("failures"),
            func.coalesce(func.sum(AIUsage.input_tokens), 0).label("input"),
            func.coalesce(func.sum(AIUsage.output_tokens), 0).label("output"),
        ).where(*in_range).group_by(AIUsage.model).order_by(func.sum(AIUsage.input_tokens + AIUsage.output_tokens).desc())
    )).all()

    price_in = await read_price("ai_price_input_per_m", session)
    price_out = await read_price("ai_price_output_per_m", session)

    def cost(tokens_in: int, tokens_out: int) -> Optional[float]:
        if price_in is None or price_out is None:
            return None
        return round((tokens_in * price_in + tokens_out * price_out) / 1_000_000, 4)

    try:
        budget = int(await get_setting("ai_daily_token_budget", session, default=str(DEFAULT_DAILY_TOKEN_BUDGET)))
    except ValueError:
        budget = DEFAULT_DAILY_TOKEN_BUDGET
    # Only ticket runs count toward tokens per ticket (Try it runs have none)
    ticket_tokens = (await session.execute(
        select(func.coalesce(func.sum(AIUsage.input_tokens + AIUsage.output_tokens), 0))
        .where(*in_range, AIUsage.ticket_id.isnot(None))
    )).scalar_one()

    return {
        "input_tokens": int(totals.input),
        "output_tokens": int(totals.output),
        "runs": totals.runs,
        "failures": totals.failures,
        "tickets": totals.tickets,
        "tokens_per_ticket": round(int(ticket_tokens) / totals.tickets) if totals.tickets else None,
        "cost": cost(int(totals.input), int(totals.output)),
        "priced": price_in is not None and price_out is not None,
        "daily_budget": budget,
        "days": [
            {"date": d.day.strftime("%Y-%m-%d"), "input": int(d.input), "output": int(d.output)}
            for d in days
        ],
        "models": [
            {"model": m.model, "runs": m.runs, "failures": m.failures, "input": int(m.input),
             "output": int(m.output), "cost": cost(int(m.input), int(m.output))}
            for m in models
        ],
    }


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
        writer.writerow([_csv_safe(c) for c in (
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
        )])

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="simpletickets_{today}.csv"'},
    )
