"""
Report queries, shared by the Reports page (routers/reports.py) and Ask
(app/ai/ask_tools.py), so both always show the same numbers.

Every function takes a session and a ReportFilter. The SLA, first-response
and resolution-time definitions live here, once.
"""
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Literal, Optional

from sqlalchemy import case, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.dt import utcnow
from app.models import Category, Ticket, TicketHistory, User
from app.models.ticket_csat import TicketCSAT
from app.models.ticket_status_config import TicketStatusConfig


@dataclass
class ReportFilter:
    """A [start, end] window (naive UTC) plus optional narrowing."""
    start: datetime
    end: datetime
    assignee_id: Optional[int] = None
    category_id: Optional[int] = None
    source: Optional[str] = None

    def apply(self, stmt, *, date_col=None):
        """Narrow a statement on tickets: the window on `date_col`
        (created_at by default), then the optional filters."""
        col = Ticket.created_at if date_col is None else date_col
        stmt = stmt.where(col >= self.start, col <= self.end)
        return self.narrow(stmt)

    def narrow(self, stmt):
        if self.assignee_id is not None:
            stmt = stmt.where(Ticket.assignee_id == self.assignee_id)
        if self.category_id is not None:
            stmt = stmt.where(Ticket.category_id == self.category_id)
        if self.source is not None:
            stmt = stmt.where(Ticket.source == self.source)
        return stmt

    def previous(self) -> "ReportFilter":
        """The window of the same length right before this one."""
        length = self.end - self.start
        return ReportFilter(self.start - length - timedelta(seconds=1), self.start - timedelta(seconds=1),
                            self.assignee_id, self.category_id, self.source)


async def team_timezone(session: AsyncSession):
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
    from app.services.settings_service import get_setting

    tz_name = await get_setting("timezone", session, default="UTC")
    try:
        return ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


async def date_range(
    from_date: Optional[date],
    to_date: Optional[date],
    session: AsyncSession,
) -> tuple[datetime, datetime]:
    """
    Resolve the [start, end] window as naive-UTC bounds. The selected dates are
    interpreted as calendar days in the configured timezone, so a non-UTC team's
    "today" lines up with their local day rather than a UTC day.
    """
    tz = await team_timezone(session)
    today = datetime.now(tz).date()
    end = to_date or today
    start = from_date or (end - timedelta(days=29))
    start_local = datetime(start.year, start.month, start.day, 0, 0, 0, tzinfo=tz)
    end_local = datetime(end.year, end.month, end.day, 23, 59, 59, tzinfo=tz)
    return (
        start_local.astimezone(timezone.utc).replace(tzinfo=None),
        end_local.astimezone(timezone.utc).replace(tzinfo=None),
    )


async def last_days(days: int, session: AsyncSession, **narrow) -> ReportFilter:
    """The last `days` calendar days, today included, in the team's timezone."""
    tz = await team_timezone(session)
    today = datetime.now(tz).date()
    start, end = await date_range(today - timedelta(days=days - 1), today, session)
    return ReportFilter(start, end, **narrow)


# ── Shared SLA / resolution-time definitions ──────────────────────────────────
# One definition for every report (and Settings → Data health):
#   - The SLA clock stops while a ticket is resolved/closed or waiting on the
#     requester, and a breach is recorded the moment the clock stops past the
#     deadline (services.sla.transition_status). So a resolved ticket met its
#     SLA exactly when it isn't flagged breached.
#   - SLA compliance counts resolved tickets plus still-open tickets that have
#     already breached (they've missed it whatever happens next); open tickets
#     still within their deadline aren't decided yet and are left out.
#   - Time to resolve = creation → latest resolution, minus the time the
#     ticket sat resolved/closed before being reopened (derived from its
#     status history — see closed_time).
#   - First response = the first public tech reply *or* resolving the ticket,
#     whichever came first: resolving is an answer too, and technicians
#     shouldn't need an "on it" reply just to stop the clock. It's met when
#     that landed by first_response_deadline. A ticket with neither yet has
#     missed it once the deadline passed while the clock ran (before now, or
#     before the clock stopped — a stopped clock's later deadline is walked
#     forward on resume, so it isn't decided yet). Time to first response is
#     wall-clock creation → first response, like time to resolve.

def sla_met():
    return (Ticket.sla_deadline.isnot(None)) & (Ticket.resolved_at.isnot(None)) & (Ticket.sla_breached == False)  # noqa: E712


def sla_counted():
    return (Ticket.sla_deadline.isnot(None)) & (Ticket.resolved_at.isnot(None) | (Ticket.sla_breached == True))  # noqa: E712


def fr_at():
    # Postgres LEAST ignores NULLs: NULL only when neither has happened
    return func.least(Ticket.first_responded_at, Ticket.resolved_at)


def fr_met():
    return (Ticket.first_response_deadline.isnot(None)) & (fr_at() <= Ticket.first_response_deadline)


def fr_counted():
    return (Ticket.first_response_deadline.isnot(None)) & (
        fr_at().isnot(None)
        | (Ticket.first_response_deadline < func.coalesce(Ticket.sla_paused_at, utcnow()))
    )


def fr_minutes():
    # NULL until answered or resolved, so avg / percentile skip those tickets
    return func.extract("epoch", fr_at() - Ticket.created_at) / 60


def resolved_names_subq():
    return (
        select(TicketStatusConfig.name)
        .where(TicketStatusConfig.is_resolved_state == True)  # noqa: E712
        .scalar_subquery()
    )


def closed_time():
    """
    Per ticket, seconds it spent resolved/closed *before its latest
    resolution* — i.e. closed time that ended in a reopen. Built from the
    ticket's status history: each status change lasts until the next one, and
    the spans spent in a resolved state that ended by resolved_at are summed.
    (The span after the latest resolution is not "before" it, so a ticket
    that's simply still closed contributes nothing.)
    """
    resolved_names = select(TicketStatusConfig.name).where(TicketStatusConfig.is_resolved_state == True)  # noqa: E712
    spans = (
        select(
            TicketHistory.ticket_id,
            TicketHistory.new_value,
            TicketHistory.created_at.label("start_at"),
            func.lead(TicketHistory.created_at).over(
                partition_by=TicketHistory.ticket_id,
                order_by=(TicketHistory.created_at, TicketHistory.id),
            ).label("end_at"),
        )
        .where(TicketHistory.field_changed == "status")
        .subquery()
    )
    return (
        select(
            spans.c.ticket_id,
            func.sum(func.extract("epoch", spans.c.end_at - spans.c.start_at)).label("closed_secs"),
        )
        .join(Ticket, Ticket.id == spans.c.ticket_id)
        .where(
            spans.c.new_value.in_(resolved_names),
            spans.c.end_at.isnot(None),
            spans.c.end_at <= Ticket.resolved_at,
        )
        .group_by(spans.c.ticket_id)
        .subquery()
    )


def resolution_hours(closed):
    return (
        func.extract("epoch", Ticket.resolved_at - Ticket.created_at)
        - func.coalesce(closed.c.closed_secs, 0)
    ) / 3600


def _round(v, digits=1):
    return round(float(v), digits) if v is not None else None


# ── Overview ──────────────────────────────────────────────────────────────────

async def overview(session: AsyncSession, f: ReportFilter) -> dict:
    resolved_subq = resolved_names_subq()
    closed = closed_time()
    stmt = select(
        func.count().label("total"),
        func.count(case((Ticket.status.in_(resolved_subq), 1))).label("resolved"),
        func.count(case((~Ticket.status.in_(resolved_subq), 1))).label("open"),
        func.count(case((sla_met(), 1))).label("sla_met"),
        func.count(case((sla_counted(), 1))).label("sla_total"),
        func.avg(resolution_hours(closed)).filter(
            Ticket.resolved_at.isnot(None)
        ).label("avg_resolution_hours"),
        func.count(case((fr_met(), 1))).label("fr_met"),
        func.count(case((fr_counted(), 1))).label("fr_total"),
        func.avg(fr_minutes()).label("avg_fr_minutes"),
        func.percentile_cont(0.5).within_group(fr_minutes()).label("median_fr_minutes"),
    ).select_from(Ticket).outerjoin(closed, closed.c.ticket_id == Ticket.id)
    row = (await session.execute(f.apply(stmt))).one()

    sla_pct = round(row.sla_met * 100 / row.sla_total, 1) if row.sla_total else None
    # `is not None`, not truthiness — a genuine 0 (0% SLA, 0h avg) is a real value,
    # not "no data", and must not render as "—".
    avg_h = _round(row.avg_resolution_hours)
    fr_pct = round(row.fr_met * 100 / row.fr_total, 1) if row.fr_total else None
    avg_fr = round(float(row.avg_fr_minutes)) if row.avg_fr_minutes is not None else None
    median_fr = round(float(row.median_fr_minutes)) if row.median_fr_minutes is not None else None

    csat_stmt = (
        select(
            func.count(TicketCSAT.id).label("csat_total"),
            func.count(case((TicketCSAT.score == True, 1))).label("csat_positive"),  # noqa: E712
        )
        .join(Ticket, TicketCSAT.ticket_id == Ticket.id)
    )
    csat_row = (await session.execute(f.apply(csat_stmt))).one()
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
        "first_response_pct": fr_pct,
        "avg_first_response_minutes": avg_fr,
        "median_first_response_minutes": median_fr,
        "csat_pct": csat_pct,
        "csat_total": csat_row.csat_total,
        "csat_positive": int(csat_row.csat_positive),
    }


# ── Volume ────────────────────────────────────────────────────────────────────

Bucket = Literal["day", "week", "month"]


async def volume(session: AsyncSession, f: ReportFilter, bucket: Bucket = "day") -> list[dict]:
    """Tickets created per day, week (starting Monday) or month."""
    period = func.date_trunc(bucket, Ticket.created_at)
    stmt = (
        select(period.label("period"), func.count().label("count"))
        .group_by(text("period"))
        .order_by(text("period"))
    )
    rows = (await session.execute(f.apply(stmt))).all()
    return [{"date": r.period.strftime("%Y-%m-%d"), "count": r.count} for r in rows]


def category_label():
    # Tickets the requester marked fixed themselves carry no category by
    # design; keep them apart from work nobody categorised
    return func.coalesce(
        Category.name,
        case((Ticket.resolved_by_requester == True, "Resolved by requester"), else_="Uncategorised"),  # noqa: E712
    )


async def volume_split(session: AsyncSession, f: ReportFilter, bucket: Bucket, by: str) -> list[dict]:
    """Tickets per period, split by category, priority or source:
    [{date, key, count}]."""
    period = func.date_trunc(bucket, Ticket.created_at)
    if by == "category":
        key = category_label()
    elif by == "priority":
        key = Ticket.priority
    elif by == "source":
        key = Ticket.source
    else:
        raise ValueError(by)
    stmt = (
        select(period.label("period"), key.label("key"), func.count().label("count"))
        .select_from(Ticket)
        .outerjoin(Category, Ticket.category_id == Category.id)
        .group_by(text("1"), text("2"))
        .order_by(text("1"))
    )
    rows = (await session.execute(f.apply(stmt))).all()
    return [
        {"date": r.period.strftime("%Y-%m-%d"), "key": getattr(r.key, "value", r.key), "count": r.count}
        for r in rows
    ]


# ── Breakdowns ────────────────────────────────────────────────────────────────

async def by_priority(session: AsyncSession, f: ReportFilter) -> list[dict]:
    stmt = select(Ticket.priority, func.count().label("count")).group_by(Ticket.priority).order_by(func.count().desc())
    rows = (await session.execute(f.apply(stmt))).all()
    return [{"priority": r.priority.value, "count": r.count} for r in rows]


async def by_status(session: AsyncSession, f: ReportFilter) -> list[dict]:
    stmt = select(Ticket.status, func.count().label("count")).group_by(Ticket.status).order_by(func.count().desc())
    rows = (await session.execute(f.apply(stmt))).all()
    return [{"status": r.status, "count": r.count} for r in rows]


async def by_category(session: AsyncSession, f: ReportFilter) -> list[dict]:
    stmt = (
        select(category_label().label("category"), func.count().label("count"))
        .select_from(Ticket)
        .outerjoin(Category, Ticket.category_id == Category.id)
        .group_by(text("1"))  # the label; by position, as it holds bound values
        .order_by(func.count().desc())
    )
    rows = (await session.execute(f.apply(stmt))).all()
    return [{"category": r.category, "count": r.count} for r in rows]


async def by_source(session: AsyncSession, f: ReportFilter) -> list[dict]:
    stmt = select(Ticket.source, func.count().label("count")).group_by(Ticket.source).order_by(func.count().desc())
    rows = (await session.execute(f.apply(stmt))).all()
    return [{"source": r.source, "count": r.count} for r in rows]


# ── Technicians ───────────────────────────────────────────────────────────────

async def technicians(session: AsyncSession, f: ReportFilter) -> list[dict]:
    """Per technician, over tickets *resolved* in the window."""
    resolved_subq = resolved_names_subq()
    closed = closed_time()
    csat_subq = (
        select(
            TicketCSAT.ticket_id,
            func.count(TicketCSAT.id).label("csat_count"),
            func.count(case((TicketCSAT.score == True, 1))).label("csat_pos"),  # noqa: E712
        )
        .where(TicketCSAT.responded_at >= f.start, TicketCSAT.responded_at <= f.end)
        .group_by(TicketCSAT.ticket_id)
        .subquery()
    )
    stmt = (
        select(
            User.id,
            User.name,
            func.count(Ticket.id).label("total"),
            func.count(case((Ticket.status.in_(resolved_subq), 1))).label("resolved"),
            func.avg(resolution_hours(closed)).filter(Ticket.resolved_at.isnot(None)).label("avg_hours"),
            # Scoped to tickets resolved in the window, so every one is counted
            (
                func.count(case((sla_met(), 1))) * 100.0 /
                func.nullif(func.count(case((sla_counted(), 1))), 0)
            ).label("sla_pct"),
            (
                func.count(case((fr_met(), 1))) * 100.0 /
                func.nullif(func.count(case((fr_counted(), 1))), 0)
            ).label("fr_pct"),
            func.avg(fr_minutes()).label("avg_fr_minutes"),
            func.coalesce(func.sum(csat_subq.c.csat_count), 0).label("csat_total"),
            func.coalesce(func.sum(csat_subq.c.csat_pos), 0).label("csat_positive"),
        )
        .join(User, Ticket.assignee_id == User.id)
        .outerjoin(closed, closed.c.ticket_id == Ticket.id)
        .outerjoin(csat_subq, csat_subq.c.ticket_id == Ticket.id)
        .where(Ticket.resolved_at.isnot(None))
        .group_by(User.id, User.name)
        .order_by(func.count(Ticket.id).desc())
    )
    stmt = f.apply(stmt, date_col=Ticket.resolved_at)
    rows = (await session.execute(stmt)).all()
    return [
        {
            "name": r.name,
            "total": r.total,
            "resolved": r.resolved,
            "avg_hours": _round(r.avg_hours),
            "sla_pct": _round(r.sla_pct),
            "first_response_pct": _round(r.fr_pct),
            "avg_first_response_minutes": round(float(r.avg_fr_minutes)) if r.avg_fr_minutes is not None else None,
            "csat_pct": round(r.csat_positive * 100 / r.csat_total, 1) if r.csat_total else None,
        }
        for r in rows
    ]


# ── Ticket lists ──────────────────────────────────────────────────────────────

async def csat_negative(session: AsyncSession, f: ReportFilter, limit: int = 1000) -> list[dict]:
    """Tickets with a negative CSAT response in the window, latest first."""
    latest_neg = (
        select(
            TicketCSAT.ticket_id,
            func.max(TicketCSAT.responded_at).label("responded_at"),
        )
        .where(
            TicketCSAT.score == False,  # noqa: E712
            TicketCSAT.responded_at >= f.start,
            TicketCSAT.responded_at <= f.end,
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
        .limit(limit)
    )
    rows = (await session.execute(f.narrow(stmt))).all()
    return [
        {
            "id": r.id,
            "title": r.title,
            "status": r.status,
            "priority": r.priority.value,
            "responded_at": r.responded_at.isoformat(),
            "assignee_name": r.assignee_name,
        }
        for r in rows
    ]


async def sla_breached(session: AsyncSession, f: ReportFilter, limit: int = 1000) -> list[dict]:
    """SLA-breached tickets created in the window."""
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
        .where(Ticket.sla_breached == True)  # noqa: E712
        .order_by(Ticket.sla_deadline.asc())
        .limit(limit)
    )
    rows = (await session.execute(f.apply(stmt))).all()
    return [
        {
            "id": r.id,
            "title": r.title,
            "status": r.status,
            "priority": r.priority.value,
            "sla_deadline": r.sla_deadline.isoformat() if r.sla_deadline else None,
            "assignee_name": r.assignee_name,
        }
        for r in rows
    ]


# ── Open work (no window: what's open right now) ──────────────────────────────

_AGE_BUCKETS = [("< 1 day", 1), ("1–3 days", 3), ("3–7 days", 7), ("1–2 weeks", 14), ("2–4 weeks", 28)]


def age_bucket(days: float) -> str:
    for label, limit in _AGE_BUCKETS:
        if days < limit:
            return label
    return "> 4 weeks"


AGE_ORDER = [label for label, _ in _AGE_BUCKETS] + ["> 4 weeks"]


async def open_tickets(session: AsyncSession, f: Optional[ReportFilter] = None) -> list[dict]:
    """Every ticket not in a resolved state, oldest first."""
    assignee_alias = aliased(User)
    stmt = (
        select(
            Ticket.id, Ticket.title, Ticket.status, Ticket.priority, Ticket.created_at,
            Ticket.updated_at, Ticket.sla_breached, Ticket.category_id,
            Ticket.assignee_id, assignee_alias.name.label("assignee_name"),
        )
        .outerjoin(assignee_alias, Ticket.assignee_id == assignee_alias.id)
        .where(~Ticket.status.in_(resolved_names_subq()))
        .order_by(Ticket.created_at.asc())
    )
    if f is not None:
        stmt = f.narrow(stmt)
    rows = (await session.execute(stmt)).all()
    now = utcnow()
    return [
        {
            "id": r.id, "title": r.title, "status": r.status, "priority": r.priority.value,
            "age_days": round((now - r.created_at).total_seconds() / 86400, 1),
            "idle_days": round((now - r.updated_at).total_seconds() / 86400, 1),
            "sla_breached": r.sla_breached, "category_id": r.category_id,
            "assignee_id": r.assignee_id, "assignee_name": r.assignee_name,
        }
        for r in rows
    ]


async def busiest_times(session: AsyncSession, f: ReportFilter) -> dict:
    """Tickets created per weekday and per hour, in the team's timezone."""
    tz = await team_timezone(session)
    local = func.timezone(str(tz), func.timezone("UTC", Ticket.created_at))
    dow = func.extract("isodow", local)
    hour = func.extract("hour", local)
    by_day = (await session.execute(f.apply(
        select(dow.label("d"), func.count().label("n")).group_by(text("1")).order_by(text("1"))
    ))).all()
    by_hour = (await session.execute(f.apply(
        select(hour.label("h"), func.count().label("n")).group_by(text("1")).order_by(text("1"))
    ))).all()
    names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    days = {int(r.d): r.n for r in by_day}
    hours = {int(r.h): r.n for r in by_hour}
    return {
        "by_weekday": [{"key": names[i - 1], "count": days.get(i, 0)} for i in range(1, 8)],
        "by_hour": [{"key": f"{h:02d}:00", "count": hours.get(h, 0)} for h in range(24)],
    }
