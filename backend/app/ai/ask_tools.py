"""
Ask's tools: every number Ask shows comes from one of these, never from the
model. Each runs SQL (the Reports queries in services/reports.py, or the
per-ticket labels in ticket_insights) and returns a result:

    {"id": "r1", "tool": name, "args": {...}, "kind": how the UI draws it,
     "title": ..., "summary": {the key numbers}, "data": {...},
     "basis": what was counted, "note": caveat or null}

The model sees a compact copy (title, summary, the first rows) and refers to
results by id; the UI draws the full result. Tools take a RunContext so
pydantic-ai can call them, and pinned answers call them again directly with
the same arguments — no model involved.
"""
import json
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from statistics import median
from typing import Annotated, Any, Awaitable, Callable, Literal, Optional

from pydantic import Field

from pydantic_ai import RunContext
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import aliased

from app.database import AsyncSessionLocal
from app.models import Category, Ticket, TicketReply, User
from app.models.insight import TicketInsight, Topic
from app.services import reports as svc
from app.services.reports import AGE_ORDER, ReportFilter, age_bucket

Days = Annotated[
    Optional[Literal[7, 14, 30, 60, 90, 180, 365]],
    Field(description="Period in days; leave empty to use the conversation's period"),
]


# ── Context ───────────────────────────────────────────────────────────────────


@dataclass
class AskDeps:
    days: int                      # the conversation's window
    is_admin: bool = False
    results: list[dict] = field(default_factory=list)
    on_step: Optional[Callable[[str], Awaitable[None]]] = None

    async def window(self, days: Optional[int] = None, **narrow) -> ReportFilter:
        async with AsyncSessionLocal() as session:
            return await svc.last_days(_clamp_days(days or self.days), session, **narrow)

    async def record(self, tool: str, args: dict, result: dict) -> dict:
        """Keep the full result for the UI; give the model a compact copy."""
        rid = f"r{len(self.results) + 1}"
        full = {"id": rid, "tool": tool, "args": args, "note": None, **result}
        self.results.append(full)
        return for_model(full)

    async def step(self, text: str) -> None:
        if self.on_step is not None:
            try:
                await self.on_step(text)
            except Exception:  # noqa: BLE001 — progress is best effort
                pass


def _clamp_days(days: int) -> int:
    return max(1, min(int(days), 365))


# Results are cached briefly: follow-up questions often re-ask the same thing
_CACHE: dict[str, tuple[float, dict]] = {}
_CACHE_SECONDS = 120


async def _cached(key: str, make: Callable[[], Awaitable[dict]]) -> dict:
    now = time.monotonic()
    hit = _CACHE.get(key)
    if hit and now - hit[0] < _CACHE_SECONDS:
        return json.loads(json.dumps(hit[1]))
    value = await make()
    if len(_CACHE) > 200:
        _CACHE.clear()
    _CACHE[key] = (now, value)
    return json.loads(json.dumps(value))


# Lists of ticket ids are for the UI ("Open in Queue"), not worth tokens
_UI_ONLY = {"ticket_ids", "all_ids", "points"}


def _strip(value):
    if isinstance(value, dict):
        return {k: _strip(v) for k, v in value.items() if k not in _UI_ONLY}
    if isinstance(value, list):
        return [_strip(v) for v in value]
    return value


def for_model(result: dict, rows: int = 12) -> dict:
    """What the model reads: small, with the numbers it may quote. Time
    series points are summarised in "summary", so only the last few go."""
    data = result.get("data") or {}
    compact: dict[str, Any] = {}
    for key, value in data.items():
        if key == "points":
            compact["latest_points"] = _strip(value[-6:])
        elif key in _UI_ONLY:
            continue
        elif isinstance(value, list):
            compact[key] = _strip(value[:rows])
            if len(value) > rows:
                compact[f"{key}_more"] = len(value) - rows
        else:
            compact[key] = _strip(value)
    return {
        "id": result["id"], "title": result.get("title"), "summary": result.get("summary"),
        "data": compact, "basis": result.get("basis"), "note": result.get("note"),
    }


def _fmt_day(d: datetime) -> str:
    return d.strftime("%b %-d")


def _basis(n: int, f: ReportFilter, what: str = "tickets created") -> str:
    return f"{n:,} {what} {_fmt_day(f.start)} – {_fmt_day(f.end)}"


def _pct(part: float, whole: float) -> Optional[float]:
    return round(part * 100 / whole, 1) if whole else None


def _change(now: float, before: float) -> Optional[float]:
    return round((now - before) * 100 / before, 1) if before else None


async def _coverage_note(session, f: ReportFilter) -> tuple[Optional[str], dict]:
    from app.ai.labels import coverage
    cov = await coverage(session, f.start, f.end)
    note = None
    if cov["total"] and cov["labelled"] < cov["total"]:
        pct = _pct(cov["labelled"], cov["total"])
        note = f"Topics and fit are known for {cov['labelled']:,} of {cov['total']:,} tickets ({pct}%); the rest are still being read."
    return note, cov


async def _category_map(session) -> dict[int, str]:
    rows = (await session.execute(select(Category.id, Category.name))).all()
    return {r.id: r.name for r in rows}


# ── 1. Overview ───────────────────────────────────────────────────────────────


async def overview(ctx: RunContext[AskDeps], compare_previous: bool = True, days: Days = None) -> dict:
    """Headline numbers for the period: tickets created, resolved, still open,
    SLA met %, first response met % and median minutes, average hours to
    resolve, satisfaction (CSAT) %. With compare_previous, the same numbers
    for the period before, with changes."""
    deps = ctx.deps
    await deps.step("Counting tickets and checking SLA, response times and satisfaction")
    f = await deps.window(days)

    async def make():
        async with AsyncSessionLocal() as s:
            now = await svc.overview(s, f)
            before = await svc.overview(s, f.previous()) if compare_previous else None
        return {"now": now, "before": before}

    r = await _cached(f"overview:{f.start}:{compare_previous}", make)
    now, before = r["now"], r["before"]
    metrics = [
        ("Tickets created", "total", "", "neutral"),
        ("Resolved", "resolved", "", "neutral"),
        ("Still open", "open", "", "down"),
        ("SLA met", "sla_compliance_pct", "%", "up"),
        ("First response met", "first_response_pct", "%", "up"),
        ("Median first response", "median_first_response_minutes", "min", "down"),
        ("Avg time to resolve", "avg_resolution_hours", "h", "down"),
        ("Satisfaction", "csat_pct", "%", "up"),
    ]
    items = []
    summary: dict[str, Any] = {}
    for label, key, unit, better in metrics:
        value = now.get(key)
        prev = before.get(key) if before else None
        items.append({"label": label, "value": value, "previous": prev, "unit": unit, "better": better,
                      "change_pct": _change(value, prev) if value is not None and prev else None})
        summary[key] = value
        if before is not None:
            summary[f"{key}_previous"] = prev
            if value is not None and prev:
                summary[f"{key}_change_pct"] = _change(value, prev)
    summary["csat_responses"] = now.get("csat_total")
    return await deps.record("overview", {"compare_previous": compare_previous, "days": days}, {
        "kind": "stats", "title": f"Last {(f.end - f.start).days + 1} days" + (" vs the period before" if before else ""),
        "summary": summary, "data": {"items": items},
        "basis": _basis(now["total"], f),
    })


# ── 2. Volume trend ───────────────────────────────────────────────────────────


def _bucket_for(days: int) -> svc.Bucket:
    return "day" if days <= 31 else "week" if days <= 180 else "month"


async def volume_trend(
    ctx: RunContext[AskDeps],
    split_by: Literal["none", "category", "priority", "source", "kind", "topic"] = "none",
    days: Days = None,
) -> dict:
    """Tickets created over time (per day, week or month depending on the
    period), optionally split by category, priority, source (Slack/email/web),
    kind (incident/request/question) or the top topics. Summary has the
    change between the start and end of the period and which series grew most."""
    deps = ctx.deps
    await deps.step("Counting tickets over time" + ("" if split_by == "none" else f" by {split_by}"))
    f = await deps.window(days)
    n_days = (f.end - f.start).days + 1
    bucket = _bucket_for(n_days)

    async def make():
        async with AsyncSessionLocal() as s:
            if split_by == "none":
                rows = [{"date": r["date"], "key": "Tickets", "count": r["count"]} for r in await svc.volume(s, f, bucket)]
            elif split_by in ("category", "priority", "source"):
                rows = await svc.volume_split(s, f, bucket, split_by)
            else:
                rows = await _volume_by_label(s, f, bucket, split_by)
        return {"rows": rows}

    rows = (await _cached(f"volume:{f.start}:{split_by}", make))["rows"]
    periods = _periods(f, bucket)
    totals_by_key: Counter = Counter()
    grid: dict[str, dict[str, int]] = {p: {} for p in periods}
    for r in rows:
        key = str(r["key"])
        grid.setdefault(r["date"], {})[key] = grid.get(r["date"], {}).get(key, 0) + r["count"]
        totals_by_key[key] += r["count"]
    # At most 6 series; the rest is "Other"
    keys = [k for k, _ in totals_by_key.most_common()]
    shown = keys[:5] if len(keys) > 6 else keys
    points = []
    for p in sorted(grid):
        values = grid[p]
        point: dict[str, Any] = {"date": p}
        for k in shown:
            point[k] = values.get(k, 0)
        if len(keys) > len(shown):
            point["Other"] = sum(v for k, v in values.items() if k not in shown)
        point["total"] = sum(values.values())
        points.append(point)
    series = shown + (["Other"] if len(keys) > len(shown) else [])
    _mark_partial(points, f, bucket)

    # Partial first/last periods (the window rarely starts on a Monday) would
    # skew the change, so it's measured on whole periods only
    full = points[:]
    if len(full) > 3 and bucket != "day":
        full = full[1:-1]
    quarter = max(1, len(full) // 4)
    first = full[:quarter]
    last = full[-quarter:]

    def avg(pts, k="total"):
        return round(sum(p.get(k, 0) for p in pts) / len(pts), 1) if pts else 0

    summary: dict[str, Any] = {
        "bucket": bucket, "total": sum(p["total"] for p in points),
        f"avg_per_{bucket}_at_start": avg(first), f"avg_per_{bucket}_at_end": avg(last),
        "change_pct": _change(avg(last), avg(first)),
    }
    if points:
        peak = max(points, key=lambda p: p["total"])
        summary["peak"] = {"date": peak["date"], "count": peak["total"]}
    if split_by != "none":
        growth = []
        for k in series:
            a, b = avg(first, k), avg(last, k)
            growth.append({"series": k, "avg_at_start": a, "avg_at_end": b, "change": round(b - a, 1),
                           "change_pct": _change(b, a), "total": totals_by_key.get(k) if k != "Other" else None})
        growth.sort(key=lambda g: g["change"], reverse=True)
        summary["by_series"] = growth
    note = None
    if split_by in ("kind", "topic"):
        async with AsyncSessionLocal() as s:
            note, _ = await _coverage_note(s, f)
    if summary["total"] < 20:
        note = (note + " " if note else "") + "Under 20 tickets: too few to call a trend."
    return await deps.record("volume_trend", {"split_by": split_by, "days": days}, {
        "kind": "timeseries", "title": "Tickets per " + bucket + ("" if split_by == "none" else f", by {split_by}"),
        "summary": summary, "data": {"bucket": bucket, "series": series, "points": points},
        "basis": _basis(summary["total"], f), "note": note,
    })


def _mark_partial(points: list[dict], f: ReportFilter, bucket: str) -> None:
    """Flag the first and last week/month when the window only covers part
    of it, so the chart can show them as partial instead of as a dip."""
    if bucket == "day" or not points:
        return
    first = datetime.strptime(points[0]["date"], "%Y-%m-%d")
    if f.start.date() > first.date():
        points[0]["partial"] = True
    last = datetime.strptime(points[-1]["date"], "%Y-%m-%d")
    end = last + timedelta(days=7) if bucket == "week" else (last.replace(day=28) + timedelta(days=4)).replace(day=1)
    if f.end < end - timedelta(seconds=1):
        points[-1]["partial"] = True


def _periods(f: ReportFilter, bucket: str) -> list[str]:
    """Every period in the window, so empty ones show as zero."""
    out = []
    d = f.start
    if bucket == "week":
        d = d - timedelta(days=d.weekday())
    elif bucket == "month":
        d = d.replace(day=1)
    d = d.replace(hour=0, minute=0, second=0, microsecond=0)
    while d <= f.end:
        out.append(d.strftime("%Y-%m-%d"))
        if bucket == "day":
            d += timedelta(days=1)
        elif bucket == "week":
            d += timedelta(days=7)
        else:
            d = (d.replace(day=28) + timedelta(days=4)).replace(day=1)
    return out


async def _volume_by_label(s, f: ReportFilter, bucket: str, by: str) -> list[dict]:
    period = func.date_trunc(bucket, Ticket.created_at)
    key = TicketInsight.kind if by == "kind" else Topic.name
    stmt = (
        select(period.label("p"), func.coalesce(key, "Not read yet").label("k"), func.count().label("n"))
        .select_from(Ticket)
        .outerjoin(TicketInsight, TicketInsight.ticket_id == Ticket.id)
        .outerjoin(Topic, Topic.id == TicketInsight.topic_id)
        .group_by(period, func.coalesce(key, "Not read yet"))
    )
    rows = (await s.execute(f.apply(stmt))).all()
    return [{"date": r.p.strftime("%Y-%m-%d"), "key": r.k, "count": r.n} for r in rows]


# ── 3. Breakdown ──────────────────────────────────────────────────────────────


async def breakdown(
    ctx: RunContext[AskDeps],
    by: Literal["category", "priority", "status", "source", "kind", "system", "requester", "assignee"],
    days: Days = None,
) -> dict:
    """How tickets created in the period split by one dimension: category,
    priority, status, source (channel), kind (incident/request/question),
    system (affected app or device), requester (who files most) or assignee."""
    deps = ctx.deps
    await deps.step(f"Counting tickets by {by}")
    f = await deps.window(days)

    async def make():
        async with AsyncSessionLocal() as s:
            if by == "category":
                rows = [{"key": r["category"], "count": r["count"]} for r in await svc.by_category(s, f)]
            elif by == "priority":
                rows = [{"key": r["priority"], "count": r["count"]} for r in await svc.by_priority(s, f)]
            elif by == "status":
                rows = [{"key": r["status"], "count": r["count"]} for r in await svc.by_status(s, f)]
            elif by == "source":
                rows = [{"key": r["source"], "count": r["count"]} for r in await svc.by_source(s, f)]
            elif by in ("kind", "system"):
                col = TicketInsight.kind if by == "kind" else TicketInsight.system
                label = func.coalesce(col, "Unknown" if by == "system" else "Not read yet")
                stmt = (
                    select(label.label("k"), func.count().label("n")).select_from(Ticket)
                    .outerjoin(TicketInsight, TicketInsight.ticket_id == Ticket.id)
                    .group_by(label).order_by(func.count().desc())
                )
                rows = [{"key": r.k, "count": r.n} for r in (await s.execute(f.apply(stmt))).all()]
            elif by == "requester":
                submitter = aliased(User)
                who = func.coalesce(submitter.name, Ticket.linked_slack_name, Ticket.slack_submitter_name,
                                    Ticket.email_requester, "Unknown")
                stmt = (
                    select(who.label("k"), func.count().label("n")).select_from(Ticket)
                    .outerjoin(submitter, submitter.id == Ticket.submitter_id)
                    .group_by(who).order_by(func.count().desc()).limit(25)
                )
                rows = [{"key": r.k, "count": r.n} for r in (await s.execute(f.apply(stmt))).all()]
            else:
                assignee = aliased(User)
                who = func.coalesce(assignee.name, "Unassigned")
                stmt = (
                    select(who.label("k"), func.count().label("n")).select_from(Ticket)
                    .outerjoin(assignee, assignee.id == Ticket.assignee_id)
                    .group_by(who).order_by(func.count().desc())
                )
                rows = [{"key": r.k, "count": r.n} for r in (await s.execute(f.apply(stmt))).all()]
        return {"rows": rows}

    rows = (await _cached(f"breakdown:{f.start}:{by}", make))["rows"]
    total = sum(r["count"] for r in rows)
    for r in rows:
        r["share_pct"] = _pct(r["count"], total)
    note = None
    if by in ("kind", "system"):
        async with AsyncSessionLocal() as s:
            note, _ = await _coverage_note(s, f)
    summary = {"total": total, "groups": len(rows)}
    if rows:
        summary.update({"top": rows[0]["key"], "top_count": rows[0]["count"], "top_share_pct": rows[0]["share_pct"]})
    return await deps.record("breakdown", {"by": by, "days": days}, {
        "kind": "bars", "title": f"Tickets by {by}", "summary": summary,
        "data": {"dimension": by, "rows": rows}, "basis": _basis(total, f), "note": note,
    })


# ── 4. People ─────────────────────────────────────────────────────────────────


async def technician_performance(ctx: RunContext[AskDeps], days: Days = None) -> dict:
    """Per technician, over tickets they resolved in the period: tickets
    resolved, average hours to resolve, SLA met %, first response met %,
    average first response minutes, satisfaction %."""
    deps = ctx.deps
    await deps.step("Comparing technicians")
    f = await deps.window(days)
    async with AsyncSessionLocal() as s:
        rows = await svc.technicians(s, f)
    total = sum(r["resolved"] for r in rows)
    return await deps.record("technician_performance", {"days": days}, {
        "kind": "table", "title": "Technicians, tickets resolved in the period",
        "summary": {"technicians": len(rows), "resolved": total},
        "data": {
            "columns": [
                {"key": "name", "label": "Technician"},
                {"key": "resolved", "label": "Resolved", "num": True},
                {"key": "avg_hours", "label": "Avg hours to resolve", "num": True},
                {"key": "sla_pct", "label": "SLA met %", "num": True},
                {"key": "first_response_pct", "label": "First response met %", "num": True},
                {"key": "csat_pct", "label": "Satisfaction %", "num": True},
            ],
            "rows": rows,
        },
        "basis": _basis(total, f, "tickets resolved"),
    })


async def workload(ctx: RunContext[AskDeps]) -> dict:
    """Open tickets right now, per assignee (and unassigned): how many, how
    many are high or critical, how many breached SLA, the oldest, and how
    many had no update for 3+ days."""
    deps = ctx.deps
    await deps.step("Counting open tickets per person")
    async with AsyncSessionLocal() as s:
        tickets = await svc.open_tickets(s)
    per: dict[str, dict] = {}
    for t in tickets:
        name = t["assignee_name"] or "Unassigned"
        p = per.setdefault(name, {"name": name, "open": 0, "high_or_critical": 0, "breached": 0,
                                  "oldest_days": 0.0, "idle_3_days": 0})
        p["open"] += 1
        p["high_or_critical"] += t["priority"] in ("high", "critical")
        p["breached"] += bool(t["sla_breached"])
        p["oldest_days"] = max(p["oldest_days"], t["age_days"])
        p["idle_3_days"] += t["idle_days"] >= 3
    rows = sorted(per.values(), key=lambda r: (r["name"] == "Unassigned", -r["open"]))
    assigned = [r for r in rows if r["name"] != "Unassigned"]
    avg_open = round(sum(r["open"] for r in assigned) / len(assigned), 1) if assigned else 0
    summary = {"open": len(tickets), "people": len(assigned), "avg_open_per_person": avg_open,
               "unassigned": per.get("Unassigned", {}).get("open", 0)}
    if assigned:
        busiest = max(assigned, key=lambda r: r["open"])
        summary.update({"busiest": busiest["name"], "busiest_open": busiest["open"]})
    return await deps.record("workload", {}, {
        "kind": "table", "title": "Open tickets per person, right now", "summary": summary,
        "data": {
            "columns": [
                {"key": "name", "label": "Assignee"},
                {"key": "open", "label": "Open", "num": True},
                {"key": "high_or_critical", "label": "High / critical", "num": True},
                {"key": "breached", "label": "SLA breached", "num": True},
                {"key": "idle_3_days", "label": "No update 3+ days", "num": True},
                {"key": "oldest_days", "label": "Oldest (days)", "num": True},
            ],
            "rows": rows,
        },
        "basis": f"{len(tickets):,} open tickets now",
    })


async def backlog(ctx: RunContext[AskDeps]) -> dict:
    """The open backlog right now: open tickets by age and by status, and
    the stuck ones (no update for 5+ days), oldest first."""
    deps = ctx.deps
    await deps.step("Looking at the open backlog")
    async with AsyncSessionLocal() as s:
        tickets = await svc.open_tickets(s)
    ages = Counter(age_bucket(t["age_days"]) for t in tickets)
    statuses = Counter(t["status"] for t in tickets)
    stuck = [t for t in tickets if t["idle_days"] >= 5]
    summary = {
        "open": len(tickets),
        "older_than_a_week": sum(1 for t in tickets if t["age_days"] >= 7),
        "breached": sum(1 for t in tickets if t["sla_breached"]),
        "stuck_5_days": len(stuck),
        "median_age_days": round(median([t["age_days"] for t in tickets]), 1) if tickets else None,
    }
    return await deps.record("backlog", {}, {
        "kind": "backlog", "title": "Open backlog", "summary": summary,
        "data": {
            "by_age": [{"key": k, "count": ages.get(k, 0)} for k in AGE_ORDER],
            "by_status": [{"key": k, "count": n} for k, n in statuses.most_common()],
            "tickets": [{"id": t["id"], "title": t["title"], "status": t["status"], "priority": t["priority"],
                         "assignee": t["assignee_name"], "idle_days": t["idle_days"]} for t in stuck[:25]],
        },
        "basis": f"{len(tickets):,} open tickets now",
    })


# ── 5. Topics ─────────────────────────────────────────────────────────────────


async def _topic_rows(s, f: ReportFilter) -> list:
    """Per ticket in the window: its topic, category, system, status, times."""
    stmt = (
        select(
            Ticket.id, Ticket.title, Ticket.status, Ticket.created_at, Ticket.resolved_at,
            Ticket.category_id, TicketInsight.topic_id, Topic.name.label("topic"),
            TicketInsight.system, TicketInsight.kind, TicketInsight.fit,
            TicketInsight.best_category_id, TicketInsight.resolution,
        )
        .join(TicketInsight, TicketInsight.ticket_id == Ticket.id)
        .join(Topic, Topic.id == TicketInsight.topic_id)
    )
    return (await s.execute(f.apply(stmt))).all()


def _topic_stats(rows, cats: dict[int, str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for r in rows:
        t = out.setdefault(r.topic, {"topic": r.topic, "topic_id": r.topic_id, "count": 0, "open": 0, "categories": Counter(),
                                     "systems": Counter(), "hours": [], "examples": [], "resolutions": Counter(),
                                     "created": []})
        t["count"] += 1
        t["categories"][cats.get(r.category_id, "Uncategorised")] += 1
        if r.system:
            t["systems"][r.system] += 1
        if r.resolved_at:
            t["hours"].append((r.resolved_at - r.created_at).total_seconds() / 3600)
        else:
            t["open"] += 1
        if r.resolution:
            t["resolutions"][r.resolution.lower()] += 1
        t["examples"].append((r.created_at, r.id))
        t["created"].append(r.created_at)
    return out


def _prev(counts: Optional[Counter], t: dict) -> Optional[int]:
    return None if counts is None else counts.get(t["topic"], 0)


def _topic_item(t: dict, total: int, prev: Optional[int] = None, with_resolutions: bool = False) -> dict:
    item = {
        "topic": t["topic"], "count": t["count"], "share_pct": _pct(t["count"], total),
        "previous_period": prev, "change_pct": _change(t["count"], prev) if prev else None,
        "open": t["open"],
        "categories": [{"name": k, "count": n} for k, n in t["categories"].most_common(4)],
        "systems": [k for k, _ in t["systems"].most_common(2)],
        "median_hours_to_resolve": round(median(t["hours"]), 1) if t["hours"] else None,
        "example_ids": [i for _, i in sorted(t["examples"], reverse=True)[:4]],
        "ticket_ids": [i for _, i in sorted(t["examples"], reverse=True)[:200]],
    }
    if with_resolutions:
        item["resolutions"] = [{"text": k, "count": n} for k, n in t["resolutions"].most_common(3)]
    return item


async def top_topics(
    ctx: RunContext[AskDeps],
    order: Literal["biggest", "growing", "self_service"] = "biggest",
    limit: int = 8,
    days: Days = None,
) -> dict:
    """What tickets are about, grouped by topic (the specific problem, across
    categories). order: biggest = most tickets; growing = rising fastest in
    the last 14 days vs before; self_service = resolved often, quickly and
    the same way (help-article or automation candidates). Each topic has its
    count, share, change vs the previous period, categories it is filed
    under, systems, median hours to resolve and example ticket ids."""
    deps = ctx.deps
    await deps.step({"biggest": "Grouping tickets by what they're about",
                     "growing": "Looking for topics that are rising",
                     "self_service": "Looking for issues fixed the same way every time"}[order])
    f = await deps.window(days)
    limit = max(1, min(int(limit), 15))

    async with AsyncSessionLocal() as s:
        cats = await _category_map(s)
        rows = await _topic_rows(s, f)
        prev_rows = await _topic_rows(s, f.previous())
        note, cov = await _coverage_note(s, f)
        _, prev_cov = await _coverage_note(s, f.previous())
    stats = _topic_stats(rows, cats)
    # Labelling goes newest first: until the period before is mostly read,
    # "change vs before" would call everything new
    prev_known = prev_cov["total"] > 0 and prev_cov["labelled"] / prev_cov["total"] >= 0.8
    prev_counts = Counter(r.topic for r in prev_rows) if prev_known else None
    labelled = len(rows)

    if order == "biggest":
        ranked = sorted(stats.values(), key=lambda t: t["count"], reverse=True)
        items = [_topic_item(t, labelled, _prev(prev_counts, t)) for t in ranked[:limit]]
        title = "Top topics"
    elif order == "growing":
        cutoff = f.end - timedelta(days=14)
        span_days = max(1.0, (cutoff - f.start).total_seconds() / 86400)
        scored = []
        for t in stats.values():
            recent = sum(1 for c in t["created"] if c >= cutoff)
            earlier = t["count"] - recent
            baseline = earlier * 14 / span_days  # expected in 14 days at the earlier rate
            if recent >= 3 and recent > baseline:
                scored.append((recent - baseline, t, recent, round(baseline, 1)))
        scored.sort(key=lambda x: x[0], reverse=True)
        items = []
        for _, t, recent, baseline in scored[:limit]:
            item = _topic_item(t, labelled, _prev(prev_counts, t))
            item.update({"last_14_days": recent, "expected_14_days": baseline,
                         "first_seen": _fmt_day(min(t["created"]))})
            items.append(item)
        title = "Rising topics (last 14 days)"
    else:
        scored = []
        for t in stats.values():
            resolved = len(t["hours"])
            if resolved < 3 or not t["resolutions"]:
                continue
            top_fix, same = t["resolutions"].most_common(1)[0]
            repeat = same / resolved
            med = median(t["hours"])
            scored.append((resolved * repeat / (1 + med / 24), t, resolved, round(repeat * 100), round(med, 1)))
        scored.sort(key=lambda x: x[0], reverse=True)
        items = []
        for _, t, resolved, repeat_pct, med in scored[:limit]:
            item = _topic_item(t, labelled, _prev(prev_counts, t), with_resolutions=True)
            item.update({"resolved": resolved, "same_fix_pct": repeat_pct})
            items.append(item)
        title = "Self-service candidates"

    summary = {"labelled_tickets": labelled, "tickets_in_period": cov["total"], "topics": len(stats),
               "shown": len(items)}
    if items:
        summary.update({"first": items[0]["topic"], "first_count": items[0]["count"]})
        top3 = sum(i["count"] for i in items[:3])
        summary["top_3_share_pct"] = _pct(top3, labelled)
    return await deps.record("top_topics", {"order": order, "limit": limit, "days": days}, {
        "kind": "topics", "title": title, "summary": summary, "data": {"order": order, "items": items},
        "basis": _basis(labelled, f, "labelled tickets created"), "note": note,
    })


async def topic_detail(ctx: RunContext[AskDeps], topic: str, days: Days = None) -> dict:
    """Everything about one topic (or affected system): weekly trend,
    categories it's filed under, systems, how they were fixed, and its
    recent tickets. topic is matched loosely, e.g. "vpn" or "SSO login"."""
    deps = ctx.deps
    await deps.step(f"Looking into “{topic[:40]}”")
    f = await deps.window(days)
    q = f"%{topic.strip()[:60]}%"
    async with AsyncSessionLocal() as s:
        cats = await _category_map(s)
        rows = [r for r in await _topic_rows(s, f)]
        matched = [r for r in rows if _like(r.topic, topic) or _like(r.system, topic)]
        if not matched:
            # Fall back to the ticket text
            ids = set((await s.execute(f.apply(
                select(Ticket.id).where(or_(Ticket.title.ilike(q), Ticket.description.ilike(q)))
            ))).scalars())
            matched = [r for r in rows if r.id in ids]
    if not matched:
        return await deps.record("topic_detail", {"topic": topic, "days": days}, {
            "kind": "empty", "title": f"Nothing found for “{topic}”",
            "summary": {"tickets": 0}, "data": {}, "basis": _basis(0, f),
        })
    topics = Counter(r.topic for r in matched)
    bucket = _bucket_for((f.end - f.start).days + 1)
    grid = Counter()
    for r in matched:
        d = r.created_at
        if bucket == "week":
            d = d - timedelta(days=d.weekday())
        elif bucket == "month":
            d = d.replace(day=1)
        grid[d.strftime("%Y-%m-%d")] += 1
    points = [{"date": p, "Tickets": grid.get(p, 0), "total": grid.get(p, 0)} for p in _periods(f, bucket)]
    _mark_partial(points, f, bucket)
    hours = [(r.resolved_at - r.created_at).total_seconds() / 3600 for r in matched if r.resolved_at]
    fixes = Counter(r.resolution.lower() for r in matched if r.resolution)
    recent = sorted(matched, key=lambda r: r.created_at, reverse=True)
    summary = {
        "tickets": len(matched), "open": sum(1 for r in matched if not r.resolved_at),
        "topics_matched": [k for k, _ in topics.most_common(5)],
        "median_hours_to_resolve": round(median(hours), 1) if hours else None,
        "first_seen": _fmt_day(min(r.created_at for r in matched)),
        "categories": dict(Counter(cats.get(r.category_id, "Uncategorised") for r in matched).most_common(4)),
        "top_fixes": dict(fixes.most_common(3)),
    }
    return await deps.record("topic_detail", {"topic": topic, "days": days}, {
        "kind": "topic", "title": topics.most_common(1)[0][0] if len(topics) == 1 else f"Tickets about “{topic}”",
        "summary": summary,
        "data": {
            "bucket": bucket, "series": ["Tickets"], "points": points,
            "systems": [{"key": k, "count": n} for k, n in Counter(r.system for r in matched if r.system).most_common(5)],
            "fixes": [{"key": k, "count": n} for k, n in fixes.most_common(5)],
            "tickets": [{"id": r.id, "title": r.title, "status": r.status,
                         "category": cats.get(r.category_id, "Uncategorised")} for r in recent[:15]],
            "ticket_ids": [r.id for r in recent[:200]],
        },
        "basis": _basis(len(matched), f, "matching tickets created"),
    })


def _like(value: Optional[str], q: str) -> bool:
    return bool(value) and q.strip().lower() in value.lower()


# ── 6. Categories ─────────────────────────────────────────────────────────────


async def _category_fit(s, f: ReportFilter) -> tuple[list[dict], dict[int, str]]:
    cats = await _category_map(s)
    rows = (await s.execute(f.apply(
        select(Ticket.id, Ticket.category_id, Ticket.resolved_by_requester, TicketInsight.fit,
               TicketInsight.best_category_id, Topic.name.label("topic"))
        .select_from(Ticket)
        .outerjoin(TicketInsight, TicketInsight.ticket_id == Ticket.id)
        .outerjoin(Topic, Topic.id == TicketInsight.topic_id)
    ))).all()
    return rows, cats


async def category_health(ctx: RunContext[AskDeps], days: Days = None) -> dict:
    """How well each category fits its tickets: tickets, fit % (share whose
    best category is the one they're in), likely misfiled tickets, how many
    distinct topics it holds, tickets per week, and a verdict (good,
    catch-all, mostly misfiled, rarely used). Uncategorised tickets show how
    many could be placed."""
    deps = ctx.deps
    await deps.step("Checking how well each category fits its tickets")
    f = await deps.window(days)
    weeks = max(1.0, ((f.end - f.start).days + 1) / 7)
    async with AsyncSessionLocal() as s:
        rows, cats = await _category_fit(s, f)
        active = {r.id: r.name for r in (await s.execute(
            select(Category.id, Category.name).where(Category.is_archived == False)  # noqa: E712
        )).all()}
        note, cov = await _coverage_note(s, f)
    per: dict[Optional[int], dict] = {cid: {"tickets": 0, "labelled": 0, "high": 0, "misfiled": 0, "topics": Counter()}
                                      for cid in active}
    for r in rows:
        if r.resolved_by_requester and r.category_id is None:
            continue  # fixed by the requester: no category by design
        p = per.setdefault(r.category_id, {"tickets": 0, "labelled": 0, "high": 0, "misfiled": 0, "topics": Counter()})
        p["tickets"] += 1
        if r.fit is None:
            continue
        p["labelled"] += 1
        p["topics"][r.topic] += 1
        if r.category_id is not None and r.fit == "high":
            p["high"] += 1
        if r.best_category_id is not None and r.best_category_id != r.category_id and r.fit != "high":
            p["misfiled"] += 1
    items = []
    for cid, p in per.items():
        name = cats.get(cid, "Uncategorised") if cid is not None else "Uncategorised"
        fit = _pct(p["high"], p["labelled"]) if cid is not None else None
        per_week = round(p["tickets"] / weeks, 1)
        topics = p["topics"]
        big_topics = [k for k, n in topics.items() if p["labelled"] and n / p["labelled"] >= 0.1]
        if cid is None:
            verdict = "placeable" if p["misfiled"] else "ok"
        elif p["tickets"] == 0:
            verdict = "unused"
        elif per_week < 0.5:
            verdict = "rarely used"
        elif fit is not None and fit < 50:
            verdict = "mostly misfiled"
        elif fit is not None and fit < 75 and len(big_topics) >= 4 and p["tickets"] >= 20:
            verdict = "catch-all"
        elif fit is not None and fit < 75:
            verdict = "mixed"
        else:
            verdict = "good"
        items.append({
            "category_id": cid, "category": name, "tickets": p["tickets"], "per_week": per_week,
            "fit_pct": fit, "misfiled": p["misfiled"], "topics": len(topics),
            "top_topics": [k for k, _ in topics.most_common(3)], "verdict": verdict,
        })
    items.sort(key=lambda i: (i["category_id"] is None, -i["tickets"]))
    total = sum(i["tickets"] for i in items)
    misfiled = sum(i["misfiled"] for i in items)
    labelled_fit = [i for i in items if i["fit_pct"] is not None and i["tickets"] >= 5]
    summary = {
        "categories": len([i for i in items if i["category_id"] is not None]), "tickets": total,
        "labelled": cov["labelled"], "likely_misfiled": misfiled, "likely_misfiled_pct": _pct(misfiled, cov["labelled"]),
        "uncategorised": next((i["tickets"] for i in items if i["category_id"] is None), 0),
        "verdicts": dict(Counter(i["verdict"] for i in items)),
    }
    if labelled_fit:
        worst = min(labelled_fit, key=lambda i: i["fit_pct"])
        summary.update({"worst_fit": worst["category"], "worst_fit_pct": worst["fit_pct"]})
    return await deps.record("category_health", {"days": days}, {
        "kind": "category_health", "title": "How well each category fits its tickets",
        "summary": summary, "data": {"rows": items}, "basis": _basis(total, f), "note": note,
    })


async def misfiled_tickets(ctx: RunContext[AskDeps], category: Optional[str] = None, limit: int = 25,
                           days: Days = None) -> dict:
    """Tickets that look like they're in the wrong category (or have none),
    each with the category that fits better. Optionally only those currently
    in one category (name). The UI lets staff move them."""
    deps = ctx.deps
    await deps.step("Finding tickets that look misfiled")
    f = await deps.window(days)
    limit = max(1, min(int(limit), 50))
    current = aliased(Category)
    best = aliased(Category)
    async with AsyncSessionLocal() as s:
        stmt = (
            select(Ticket.id, Ticket.title, Ticket.status, Ticket.category_id, current.name.label("current"),
                   TicketInsight.best_category_id, best.name.label("suggested"), TicketInsight.fit,
                   Topic.name.label("topic"))
            .join(TicketInsight, TicketInsight.ticket_id == Ticket.id)
            .join(best, best.id == TicketInsight.best_category_id)
            .outerjoin(current, current.id == Ticket.category_id)
            .outerjoin(Topic, Topic.id == TicketInsight.topic_id)
            .where(
                best.is_archived == False,  # noqa: E712
                Ticket.category_id.is_distinct_from(TicketInsight.best_category_id),
                TicketInsight.fit != "high",
                Ticket.resolved_by_requester == False,  # noqa: E712
            )
            .order_by(case((TicketInsight.fit == "low", 0), else_=1), Ticket.created_at.desc())
        )
        if category:
            stmt = stmt.where(func.lower(current.name) == category.strip().lower()) if category.lower() != "uncategorised" \
                else stmt.where(Ticket.category_id.is_(None))
        all_rows = (await s.execute(f.apply(stmt))).all()
        resolved = set(await _resolved(s))
    moves = Counter((r.current or "Uncategorised", r.suggested) for r in all_rows)
    rows = [{
        "id": r.id, "title": r.title, "status": r.status, "resolved": r.status in resolved,
        "current": r.current or "Uncategorised", "current_id": r.category_id,
        "suggested": r.suggested, "suggested_id": r.best_category_id,
        "confidence": "high" if r.fit == "low" else "medium", "topic": r.topic,
    } for r in all_rows[:limit]]
    summary = {"likely_misfiled": len(all_rows), "shown": len(rows),
               "top_moves": [{"from": a, "to": b, "count": n} for (a, b), n in moves.most_common(5)]}
    return await deps.record("misfiled_tickets", {"category": category, "limit": limit, "days": days}, {
        "kind": "misfiled", "title": "Tickets that may be in the wrong category", "summary": summary,
        "data": {"rows": rows, "all_ids": [r.id for r in all_rows[:200]],
                 "moves": [{"from": a, "to": b, "count": n} for (a, b), n in moves.most_common(8)]},
        "basis": _basis(len(all_rows), f, "likely misfiled tickets created"),
    })


async def _resolved(s) -> list[str]:
    from app.ai.labels import _resolved_names
    return await _resolved_names(s)


async def category_suggestions(ctx: RunContext[AskDeps], days: Days = None) -> dict:
    """Concrete suggestions for the category list, from the data: ADD a
    category for a sizeable topic that is scattered across categories or
    fits none; MERGE a rarely used category into the one its tickets fit;
    SPLIT a catch-all category holding many different topics; and topics
    that should NOT become a category because they appeared suddenly in the
    period (one incident, e.g. a rollout). Each has the facts behind it."""
    deps = ctx.deps
    await deps.step("Looking for gaps and overlaps in the category list")
    f = await deps.window(days)
    weeks = max(1.0, ((f.end - f.start).days + 1) / 7)
    async with AsyncSessionLocal() as s:
        rows, cats = await _category_fit(s, f)
        topic_rows = await _topic_rows(s, f)
        active = {r.id: r.name for r in (await s.execute(
            select(Category.id, Category.name).where(Category.is_archived == False)  # noqa: E712
        )).all()}
        note, cov = await _coverage_note(s, f)
        # A change applies to all of history, so say how many tickets that is
        topic_all_time = dict((await s.execute(
            select(TicketInsight.topic_id, func.count()).group_by(TicketInsight.topic_id)
        )).all())
        cat_all_time = dict((await s.execute(
            select(Ticket.category_id, func.count()).where(Ticket.category_id.isnot(None)).group_by(Ticket.category_id)
        )).all())
    labelled = [r for r in rows if r.fit is not None]
    n_labelled = len(labelled) or 1
    proposals: list[dict] = []
    stats = _topic_stats(topic_rows, cats)
    # A topic that didn't exist in the first half of the period and then came
    # in fast is one problem (a rollout, an outage), not a kind of request
    half = f.start + (f.end - f.start) / 2

    # ADD / SPIKE: sizeable topics scattered across categories or fitting none
    threshold = max(5, round(0.03 * n_labelled))
    by_topic_best: dict[str, Counter] = defaultdict(Counter)
    ids_by_topic: dict[str, list[int]] = defaultdict(list)
    for r in topic_rows:
        by_topic_best[r.topic][r.best_category_id] += 1
        ids_by_topic[r.topic].append(r.id)
    # Spikes can only be told apart from steady topics once most of the
    # period is read (labelling goes newest first, so early on all looks recent)
    mostly_read = cov["total"] and cov["labelled"] / cov["total"] >= 0.8
    for t in sorted(stats.values(), key=lambda t: t["count"], reverse=True):
        if t["count"] < threshold:
            continue
        cat_counts = t["categories"]
        top_share = cat_counts.most_common(1)[0][1] / t["count"]
        best = by_topic_best[t["topic"]]
        no_fit = best.get(None, 0) / t["count"]
        best_cat, best_n = best.most_common(1)[0]
        # Most of its tickets fit one existing category: that's misfiling
        # (misfiled_tickets), not a missing category
        has_home = best_cat is not None and best_n / t["count"] >= 0.6
        first_seen = min(t["created"])
        weeks_active = max(1.0, (f.end - first_seen).total_seconds() / (7 * 86400))
        facts = {"tickets": t["count"], "share_pct": _pct(t["count"], n_labelled),
                 "filed_under": dict(cat_counts.most_common(4)), "first_seen": _fmt_day(first_seen),
                 "per_week_since": round(t["count"] / weeks_active, 1)}
        if mostly_read and first_seen >= half and (f.end - f.start).days > 45:
            proposals.append({"type": "incident", "title": t["topic"], "topic_id": t["topic_id"], "facts": facts,
                              "reason": f"None before {_fmt_day(first_seen)}, then {facts['per_week_since']} a week: one problem (a rollout or an outage), not a lasting kind of request. Link them to one problem ticket instead of adding a category, and look again if they keep coming.",
                              "ticket_ids": ids_by_topic[t["topic"]][:200]})
        elif not has_home and (top_share < 0.7 or no_fit >= 0.5):
            proposals.append({"type": "add", "title": t["topic"], "suggested_name": t["topic"], "facts": facts,
                              "topic_id": t["topic_id"], "all_time": topic_all_time.get(t["topic_id"], t["count"]),
                              "reason": "A steady, sizeable group of tickets " + (
                                  "that fits no existing category." if no_fit >= 0.5 else
                                  f"split across {len(cat_counts)} categories, so it doesn't show up in reports."),
                              "ticket_ids": ids_by_topic[t["topic"]][:200]})

    # Per category: MERGE rarely used ones, SPLIT catch-alls
    per_cat: dict[int, dict] = {cid: {"n": 0, "best": Counter(), "topics": Counter(), "high": 0, "lab": 0} for cid in active}
    for r in rows:
        if r.category_id not in per_cat:
            continue
        p = per_cat[r.category_id]
        p["n"] += 1
        if r.fit is not None:
            p["lab"] += 1
            p["high"] += r.fit == "high"
            p["topics"][r.topic] += 1
            if r.best_category_id and r.best_category_id != r.category_id:
                p["best"][r.best_category_id] += 1
    for cid, p in per_cat.items():
        name = active[cid]
        per_week = p["n"] / weeks
        if per_week < 0.5:
            into = next((c for c, _ in p["best"].most_common() if c in active and c != cid), None)
            proposals.append({
                "type": "merge" if into else "archive", "title": name, "category_id": cid,
                "all_time": cat_all_time.get(cid, 0),
                "into_id": into, "into": active.get(into) if into else None,
                "facts": {"tickets": p["n"], "per_week": round(per_week, 1)},
                "reason": (f"Used {p['n']} times in the period, too rarely to tell you much in reports." if p["n"]
                           else "Not used at all in the period."),
            })
            continue
        big = [(k, n) for k, n in p["topics"].most_common() if p["lab"] and n / p["lab"] >= 0.1]
        fit = p["high"] / p["lab"] if p["lab"] else 1
        if p["n"] >= 20 and len(big) >= 4 and fit < 0.75:
            proposals.append({
                "type": "split", "title": name, "category_id": cid,
                "facts": {"tickets": p["n"], "fit_pct": round(fit * 100), "topics": dict(big[:6])},
                "reason": f"Holds {len(big)} different sizeable topics and only {round(fit * 100)}% of its tickets fit it best.",
            })
    order = {"add": 0, "split": 1, "merge": 2, "archive": 3, "incident": 4}
    proposals.sort(key=lambda p: (order[p["type"]], -p["facts"].get("tickets", 0)))
    summary = {"suggestions": len(proposals), "by_type": dict(Counter(p["type"] for p in proposals)),
               "labelled": cov["labelled"], "add_threshold_tickets": threshold}
    return await deps.record("category_suggestions", {"days": days}, {
        "kind": "proposals", "title": "Suggested changes to the categories", "summary": summary,
        "data": {"items": proposals}, "basis": _basis(cov["labelled"], f, "labelled tickets created"), "note": note,
    })


# ── 7. Ticket lists ───────────────────────────────────────────────────────────


async def problem_tickets(
    ctx: RunContext[AskDeps],
    which: Literal["sla_breached", "negative_feedback", "stuck", "reopened"],
    days: Days = None,
) -> dict:
    """Tickets that went wrong, with what they have in common (topics,
    categories): sla_breached = missed SLA; negative_feedback = thumbs down
    from the requester; stuck = open with no update for 5+ days;
    reopened = resolved then reopened."""
    deps = ctx.deps
    await deps.step({"sla_breached": "Looking at SLA breaches", "negative_feedback": "Reading negative feedback",
                     "stuck": "Finding stuck tickets", "reopened": "Finding reopened tickets"}[which])
    f = await deps.window(days)
    async with AsyncSessionLocal() as s:
        if which == "sla_breached":
            tickets = await svc.sla_breached(s, f, limit=500)
        elif which == "negative_feedback":
            tickets = await svc.csat_negative(s, f, limit=500)
        elif which == "stuck":
            tickets = [t for t in await svc.open_tickets(s) if t["idle_days"] >= 5]
        else:
            tickets = await _reopened(s, f)
        ids = [t["id"] for t in tickets]
        labels = {r.ticket_id: r for r in (await s.execute(
            select(TicketInsight.ticket_id, Topic.name.label("topic"), Ticket.category_id)
            .join(Ticket, Ticket.id == TicketInsight.ticket_id)
            .outerjoin(Topic, Topic.id == TicketInsight.topic_id)
            .where(TicketInsight.ticket_id.in_(ids or [-1]))
        )).all()}
        cats = await _category_map(s)
    for t in tickets:
        lab = labels.get(t["id"])
        t["topic"] = lab.topic if lab else None
    topics = Counter(t["topic"] for t in tickets if t.get("topic"))
    by_cat = Counter(cats.get(labels[t["id"]].category_id, "Uncategorised") for t in tickets if t["id"] in labels)
    summary = {"tickets": len(tickets),
               "top_topics": [{"topic": k, "count": n} for k, n in topics.most_common(5)],
               "top_categories": [{"category": k, "count": n} for k, n in by_cat.most_common(4)]}
    title = {"sla_breached": "SLA breaches", "negative_feedback": "Negative feedback",
             "stuck": "Stuck tickets (no update for 5+ days)", "reopened": "Reopened tickets"}[which]
    return await deps.record("problem_tickets", {"which": which, "days": days}, {
        "kind": "tickets", "title": title, "summary": summary,
        "data": {"groups": summary["top_topics"],
                 "tickets": [{k: t.get(k) for k in ("id", "title", "status", "priority", "assignee_name", "topic")}
                             for t in tickets[:30]],
                 "ticket_ids": ids[:200]},
        "basis": f"{len(tickets):,} tickets" + ("" if which == "stuck" else f", {_fmt_day(f.start)} – {_fmt_day(f.end)}"),
    })


async def _reopened(s, f: ReportFilter) -> list[dict]:
    from app.models import TicketHistory
    resolved = await _resolved(s)
    reopened_ids = select(TicketHistory.ticket_id).where(
        TicketHistory.field_changed == "status",
        TicketHistory.old_value.in_(resolved),
        TicketHistory.new_value.not_in(resolved),
    )
    assignee = aliased(User)
    rows = (await s.execute(f.apply(
        select(Ticket.id, Ticket.title, Ticket.status, Ticket.priority, assignee.name.label("assignee_name"))
        .outerjoin(assignee, assignee.id == Ticket.assignee_id)
        .where(Ticket.id.in_(reopened_ids))
        .order_by(Ticket.created_at.desc())
    ))).all()
    return [{"id": r.id, "title": r.title, "status": r.status, "priority": r.priority.value,
             "assignee_name": r.assignee_name} for r in rows]


async def find_tickets(
    ctx: RunContext[AskDeps],
    text: Optional[str] = None,
    topic: Optional[str] = None,
    category: Optional[str] = None,
    open_only: bool = False,
    limit: int = 20,
    days: Days = None,
) -> dict:
    """Find tickets by words in the title or description, topic, or category
    name. Use to answer "show me tickets about X"."""
    deps = ctx.deps
    await deps.step("Searching tickets")
    f = await deps.window(days)
    limit = max(1, min(int(limit), 50))
    async with AsyncSessionLocal() as s:
        stmt = (
            select(Ticket.id, Ticket.title, Ticket.status, Ticket.priority, Ticket.created_at,
                   Category.name.label("category"), Topic.name.label("topic"))
            .outerjoin(Category, Category.id == Ticket.category_id)
            .outerjoin(TicketInsight, TicketInsight.ticket_id == Ticket.id)
            .outerjoin(Topic, Topic.id == TicketInsight.topic_id)
            .order_by(Ticket.created_at.desc())
        )
        if text:
            q = f"%{text.strip()[:80]}%"
            stmt = stmt.where(or_(Ticket.title.ilike(q), Ticket.description.ilike(q), Topic.name.ilike(q)))
        if topic:
            stmt = stmt.where(or_(Topic.name.ilike(f"%{topic.strip()[:60]}%"), TicketInsight.system.ilike(f"%{topic.strip()[:60]}%")))
        if category:
            stmt = stmt.where(Category.name.ilike(category.strip()[:60]))
        if open_only:
            stmt = stmt.where(~Ticket.status.in_(svc.resolved_names_subq()))
        rows = (await s.execute(f.apply(stmt))).all()
    tickets = [{"id": r.id, "title": r.title, "status": r.status, "priority": r.priority.value,
                "category": r.category or "Uncategorised", "topic": r.topic,
                "created": r.created_at.strftime("%Y-%m-%d")} for r in rows]
    return await deps.record("find_tickets", {"text": text, "topic": topic, "category": category,
                                              "open_only": open_only, "limit": limit, "days": days}, {
        "kind": "tickets", "title": "Matching tickets", "summary": {"tickets": len(tickets)},
        "data": {"tickets": tickets[:limit], "ticket_ids": [t["id"] for t in tickets[:200]]},
        "basis": _basis(len(tickets), f, "matching tickets created"),
    })


async def ticket_details(ctx: RunContext[AskDeps], ticket_id: int) -> dict:
    """One ticket: status, priority, category, assignee, dates, its topic,
    the Assistant's summary and how many replies it has. ticket_id is the
    number (TKT-0042 → 42)."""
    from app.ai.triage import stored_assessment
    deps = ctx.deps
    await deps.step(f"Opening TKT-{ticket_id:04d}")
    async with AsyncSessionLocal() as s:
        t = await s.get(Ticket, ticket_id)
        if t is None:
            return await deps.record("ticket_details", {"ticket_id": ticket_id}, {
                "kind": "empty", "title": f"TKT-{ticket_id:04d} doesn't exist", "summary": {}, "data": {}, "basis": "",
            })
        cat = await s.get(Category, t.category_id) if t.category_id else None
        assignee = await s.get(User, t.assignee_id) if t.assignee_id else None
        ins = await s.get(TicketInsight, ticket_id)
        topic = await s.get(Topic, ins.topic_id) if ins and ins.topic_id else None
        replies = (await s.execute(select(func.count()).where(TicketReply.ticket_id == ticket_id))).scalar()
    a = stored_assessment(t)
    info = {
        "id": t.id, "title": t.title, "status": t.status, "priority": t.priority.value,
        "category": cat.name if cat else "Uncategorised", "assignee": assignee.name if assignee else "Unassigned",
        "created": t.created_at.strftime("%Y-%m-%d %H:%M"),
        "resolved": t.resolved_at.strftime("%Y-%m-%d %H:%M") if t.resolved_at else None,
        "sla_breached": t.sla_breached, "replies": replies, "topic": topic.name if topic else None,
        "system": ins.system if ins else None, "fix": ins.resolution if ins else None,
        "assistant_summary": a["assessment"]["summary"] if a else None,
    }
    return await deps.record("ticket_details", {"ticket_id": ticket_id}, {
        "kind": "ticket", "title": f"TKT-{t.id:04d} · {t.title}", "summary": info,
        "data": {"ticket": info}, "basis": "One ticket",
    })


# ── 8. Other ──────────────────────────────────────────────────────────────────


async def busiest_times(ctx: RunContext[AskDeps], days: Days = None) -> dict:
    """When tickets come in: per weekday and per hour of the day, in the
    team's timezone. For staffing questions."""
    deps = ctx.deps
    await deps.step("Checking when tickets come in")
    f = await deps.window(days)
    async with AsyncSessionLocal() as s:
        data = await svc.busiest_times(s, f)
    total = sum(d["count"] for d in data["by_weekday"])
    top_day = max(data["by_weekday"], key=lambda d: d["count"])
    top_hour = max(data["by_hour"], key=lambda d: d["count"])
    return await deps.record("busiest_times", {"days": days}, {
        "kind": "busy", "title": "When tickets come in",
        "summary": {"tickets": total, "busiest_day": top_day["key"], "busiest_day_count": top_day["count"],
                    "busiest_day_share_pct": _pct(top_day["count"], total),
                    "busiest_hour": top_hour["key"], "busiest_hour_count": top_hour["count"]},
        "data": data, "basis": _basis(total, f),
    })


async def triage_accuracy(ctx: RunContext[AskDeps], days: Days = None) -> dict:
    """How often the AI Assistant's suggested category matches the category
    the ticket ended up with. Tells whether "Fill in details" can be trusted
    to set categories automatically."""
    deps = ctx.deps
    await deps.step("Comparing the Assistant's category picks with the final ones")
    f = await deps.window(days)
    async with AsyncSessionLocal() as s:
        rows = (await s.execute(f.apply(
            select(Ticket.ai_assessment, Category.name)
            .join(Category, Category.id == Ticket.category_id)
            .where(Ticket.ai_assessment.isnot(None))
        ))).all()
    compared = matched = 0
    misses: Counter = Counter()
    for raw, final in rows:
        try:
            suggested = (json.loads(raw).get("assessment") or {}).get("suggested_category")
        except (ValueError, AttributeError):
            continue
        if not suggested:
            continue
        compared += 1
        if suggested.strip().lower() == final.lower():
            matched += 1
        else:
            misses[(suggested, final)] += 1
    summary = {"compared": compared, "matched": matched, "match_pct": _pct(matched, compared),
               "common_misses": [{"suggested": a, "final": b, "count": n} for (a, b), n in misses.most_common(4)]}
    note = "Fewer than 20 tickets to compare: too few to judge." if compared < 20 else None
    return await deps.record("triage_accuracy", {"days": days}, {
        "kind": "stats", "title": "Assistant category picks vs final category",
        "summary": summary,
        "data": {"items": [{"label": "Category picks that matched", "value": summary["match_pct"], "unit": "%"},
                           {"label": "Tickets compared", "value": compared, "unit": ""}]},
        "basis": _basis(compared, f, "assessed, categorised tickets created"), "note": note,
    })


TOOLS = [
    overview, volume_trend, breakdown, technician_performance, workload, backlog,
    top_topics, topic_detail, category_health, misfiled_tickets, category_suggestions,
    problem_tickets, find_tickets, ticket_details, busiest_times, triage_accuracy,
]
TOOLS_BY_NAME = {t.__name__: t for t in TOOLS}
