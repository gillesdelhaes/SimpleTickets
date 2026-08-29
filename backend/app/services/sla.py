"""
SLA Engine.

Responsibilities:
  1. Breach detection: every minute, find tickets whose sla_deadline has
     passed and mark them sla_breached=True.
  2. Pause / resume: when a ticket enters a status with pauses_sla=True the
     SLA clock stops; when it leaves, accumulated paused seconds are recorded
     and the deadline is extended accordingly.
  3. Status endpoint helper: compute current SLA state for a single ticket
     without touching the database.
  4. Business-hours SLA: deadline computation skips outside-of-hours time
     when business_hours_enabled is set in app_settings.

The scheduler is started in the FastAPI lifespan and runs in-process via
APScheduler's AsyncIOScheduler — no separate worker needed.
"""
import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Ticket, TicketHistory
from app.models.ticket_status_config import TicketStatusConfig

logger = logging.getLogger(__name__)


# ── Business-hours SLA deadline computation ───────────────────────────────────


def _add_business_minutes(
    local_dt: datetime,
    minutes: int,
    biz_days: set[int],
    biz_start_h: int,
    biz_start_m: int,
    biz_end_h: int,
    biz_end_m: int,
) -> datetime:
    """Walk `minutes` of business time forward from local_dt (tz-aware local time)."""
    biz_start_mins = biz_start_h * 60 + biz_start_m
    biz_end_mins = biz_end_h * 60 + biz_end_m

    def _next_biz(dt: datetime) -> datetime:
        cur = dt.hour * 60 + dt.minute
        if dt.weekday() in biz_days:
            if biz_start_mins <= cur < biz_end_mins:
                return dt
            if cur < biz_start_mins:
                return dt.replace(hour=biz_start_h, minute=biz_start_m, second=0, microsecond=0)
        nxt = (dt + timedelta(days=1)).replace(
            hour=biz_start_h, minute=biz_start_m, second=0, microsecond=0
        )
        for _ in range(7):
            if nxt.weekday() in biz_days:
                return nxt
            nxt += timedelta(days=1)
        return nxt

    dt = _next_biz(local_dt)
    remaining = minutes
    while remaining > 0:
        mins_to_eod = biz_end_mins - (dt.hour * 60 + dt.minute)
        if remaining <= mins_to_eod:
            return dt + timedelta(minutes=remaining)
        remaining -= mins_to_eod
        nxt = (dt + timedelta(days=1)).replace(
            hour=biz_start_h, minute=biz_start_m, second=0, microsecond=0
        )
        for _ in range(7):
            if nxt.weekday() in biz_days:
                break
            nxt += timedelta(days=1)
        dt = nxt
    return dt


def _business_seconds_between(
    start: datetime, end: datetime,
    biz_days: set[int], biz_start_h: int, biz_start_m: int, biz_end_h: int, biz_end_m: int,
) -> int:
    """Business seconds in [start, end] (both tz-aware local). Weekends/off-hours count 0."""
    if end <= start:
        return 0
    total = 0
    day = start.replace(hour=0, minute=0, second=0, microsecond=0)
    while day.date() <= end.date():
        if day.weekday() in biz_days:
            win_lo = day.replace(hour=biz_start_h, minute=biz_start_m, second=0, microsecond=0)
            win_hi = day.replace(hour=biz_end_h, minute=biz_end_m, second=0, microsecond=0)
            lo = max(win_lo, start)
            hi = min(win_hi, end)
            if hi > lo:
                total += int((hi - lo).total_seconds())
        day += timedelta(days=1)
    return total


async def _elapsed_sla_seconds(start_utc: datetime, end_utc: datetime, session: AsyncSession) -> int:
    """
    SLA-clock seconds between two naive-UTC instants. Equals wall-clock time when
    business hours are off; when on, counts only time inside working hours/days
    (so a pause over a weekend costs ~0 SLA time).
    """
    if end_utc <= start_utc:
        return 0
    from app.services.settings_service import get_setting

    enabled = (await get_setting("business_hours_enabled", session, default="false")) == "true"
    wall = int((end_utc - start_utc).total_seconds())
    if not enabled:
        return wall

    tz_name = await get_setting("timezone", session, default="UTC")
    try:
        biz_start_h, biz_start_m = (int(x) for x in (await get_setting("business_hours_start", session, default="09:00")).split(":"))
        biz_end_h, biz_end_m = (int(x) for x in (await get_setting("business_hours_end", session, default="17:00")).split(":"))
        biz_days = {int(d.strip()) for d in (await get_setting("business_days", session, default="0,1,2,3,4")).split(",") if d.strip()}
    except (ValueError, AttributeError):
        return wall
    if not biz_days or (biz_end_h * 60 + biz_end_m) <= (biz_start_h * 60 + biz_start_m):
        return wall

    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
    try:
        tz = ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("UTC")
    s = (start_utc if start_utc.tzinfo else start_utc.replace(tzinfo=timezone.utc)).astimezone(tz)
    e = (end_utc if end_utc.tzinfo else end_utc.replace(tzinfo=timezone.utc)).astimezone(tz)
    return _business_seconds_between(s, e, biz_days, biz_start_h, biz_start_m, biz_end_h, biz_end_m)


async def compute_sla_deadline(
    start_utc: datetime,
    minutes_to_add: int,
    session: AsyncSession,
) -> datetime:
    """
    Compute an SLA deadline from start_utc plus minutes_to_add.
    If business hours are enabled in app_settings, only counts time within
    configured working hours/days. Returns a naive UTC datetime.
    """
    from app.services.settings_service import get_setting

    enabled = (await get_setting("business_hours_enabled", session, default="false")) == "true"
    if not enabled:
        return start_utc + timedelta(minutes=minutes_to_add)

    tz_name = await get_setting("timezone", session, default="UTC")
    biz_start_str = await get_setting("business_hours_start", session, default="09:00")
    biz_end_str = await get_setting("business_hours_end", session, default="17:00")
    biz_days_str = await get_setting("business_days", session, default="0,1,2,3,4")

    try:
        biz_start_h, biz_start_m = (int(x) for x in biz_start_str.split(":"))
        biz_end_h, biz_end_m = (int(x) for x in biz_end_str.split(":"))
        biz_days: set[int] = {int(d.strip()) for d in biz_days_str.split(",") if d.strip()}
    except (ValueError, AttributeError):
        return start_utc + timedelta(minutes=minutes_to_add)

    if not biz_days or (biz_end_h * 60 + biz_end_m) <= (biz_start_h * 60 + biz_start_m):
        return start_utc + timedelta(minutes=minutes_to_add)

    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
    try:
        tz = ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("UTC")

    aware_utc = start_utc if start_utc.tzinfo else start_utc.replace(tzinfo=timezone.utc)
    local_end = _add_business_minutes(
        aware_utc.astimezone(tz),
        minutes_to_add,
        biz_days, biz_start_h, biz_start_m, biz_end_h, biz_end_m,
    )
    return local_end.astimezone(timezone.utc).replace(tzinfo=None)


# ── Pause / resume ─────────────────────────────────────────────────────────────


async def apply_sla_status_change(
    ticket: Ticket, new_status: str, session: AsyncSession
) -> None:
    """
    Call this whenever a ticket's status changes to update SLA pause state.
    Looks up pauses_sla from the ticket_statuses table.
    Mutates the ticket object in place — caller must commit.
    """
    result = await session.execute(
        select(TicketStatusConfig).where(TicketStatusConfig.name == new_status)
    )
    status_cfg = result.scalar_one_or_none()
    pauses = status_cfg.pauses_sla if status_cfg else False

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    if pauses and ticket.sla_paused_at is None:
        # Entering a pausing status — freeze the clock
        ticket.sla_paused_at = now

    elif not pauses and ticket.sla_paused_at is not None:
        # Leaving a pausing status — recompute the deadline by walking the SLA
        # budget that was still remaining at pause time forward from *now* (the
        # resume instant), rather than adding a flat pause-duration offset to
        # the old deadline. The flat-offset approach broke whenever business
        # hours are enabled and the pause spans outside them (e.g. an
        # overnight/weekend pending_user pause): the business time elapsed
        # during the pause is small, but the old deadline can already be in
        # the wall-clock past by the time we resume, so adding a small offset
        # to it still lands in the past — a spurious immediate breach despite
        # budget remaining. Walking forward from `now` is always correct, and
        # reduces to exactly the old formula when business hours are disabled
        # (business time equals wall-clock time in that case).
        paused_at = ticket.sla_paused_at
        paused_secs = await _elapsed_sla_seconds(paused_at, now, session)
        ticket.sla_paused_seconds = (ticket.sla_paused_seconds or 0) + paused_secs
        ticket.sla_paused_at = None

        if ticket.sla_deadline is not None:
            remaining_secs = await _elapsed_sla_seconds(paused_at, ticket.sla_deadline, session)
            ticket.sla_deadline = await compute_sla_deadline(now, remaining_secs / 60, session)


# ── Scheduled breach-detection job ────────────────────────────────────────────


async def _check_sla_breaches() -> None:
    """
    Scheduled job: mark tickets whose SLA deadline has passed as breached.
    Runs every minute via APScheduler.
    Skips paused tickets and already-breached ones.
    Skips tickets in resolved/closed states (is_resolved_state=True).
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    async for session in get_session():
        try:
            # Resolved status names — breach detection doesn't apply to them
            resolved_result = await session.execute(
                select(TicketStatusConfig.name).where(
                    TicketStatusConfig.is_resolved_state == True  # noqa: E712
                )
            )
            resolved_names = [row[0] for row in resolved_result.all()]

            result = await session.execute(
                select(Ticket).where(
                    Ticket.sla_deadline.isnot(None),
                    Ticket.sla_breached == False,  # noqa: E712
                    Ticket.sla_paused_at.is_(None),
                    Ticket.status.not_in(resolved_names) if resolved_names else True,
                    Ticket.sla_deadline <= now,
                )
            )
            breached = result.scalars().all()

            if not breached:
                continue

            for ticket in breached:
                ticket.sla_breached = True
                session.add(
                    TicketHistory(
                        ticket_id=ticket.id,
                        actor_id=None,
                        field_changed="sla_breached",
                        old_value="false",
                        new_value="true",
                    )
                )
                logger.warning("SLA breached: ticket %s (%s)", ticket.display_id, ticket.id)

            await session.commit()
            logger.info("SLA check: %d ticket(s) marked breached", len(breached))

        except Exception as exc:
            logger.error("SLA breach-check failed: %s", exc)
            await session.rollback()


# ── SLA warning job (15 min before breach) ────────────────────────────────────


async def _warn_sla_breaches() -> None:
    """
    Scheduled job: DM all technicians/admins with a Slack ID when a ticket is
    within 15 minutes of breaching SLA. Runs every minute. The
    sla_breach_warned_at timestamp prevents duplicate warnings.
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    warn_before = timedelta(minutes=15)

    async for session in get_session():
        try:
            resolved_result = await session.execute(
                select(TicketStatusConfig.name).where(
                    TicketStatusConfig.is_resolved_state == True  # noqa: E712
                )
            )
            resolved_names = [row[0] for row in resolved_result.all()]

            result = await session.execute(
                select(Ticket).where(
                    Ticket.sla_deadline.isnot(None),
                    Ticket.sla_breached == False,  # noqa: E712
                    Ticket.sla_breach_warned_at.is_(None),
                    Ticket.sla_paused_at.is_(None),
                    Ticket.status.not_in(resolved_names) if resolved_names else True,
                    Ticket.sla_deadline > now,
                    Ticket.sla_deadline <= now + warn_before,
                )
            )
            tickets = result.scalars().all()

            from app.slack.service import post_sla_warning_to_technicians

            for ticket in tickets:
                await post_sla_warning_to_technicians(ticket, session, kind="sla")
                ticket.sla_breach_warned_at = now
                session.add(ticket)
                logger.info("SLA warning sent for ticket %s", ticket.display_id)

            # ── First-response deadline warnings ──────────────────────────────
            fr_result = await session.execute(
                select(Ticket).where(
                    Ticket.first_response_deadline.isnot(None),
                    Ticket.first_responded_at.is_(None),
                    Ticket.first_response_warned_at.is_(None),
                    Ticket.sla_paused_at.is_(None),
                    Ticket.status.not_in(resolved_names) if resolved_names else True,
                    Ticket.first_response_deadline > now,
                    Ticket.first_response_deadline <= now + warn_before,
                )
            )
            fr_tickets = fr_result.scalars().all()

            for ticket in fr_tickets:
                await post_sla_warning_to_technicians(ticket, session, kind="first_response")
                ticket.first_response_warned_at = now
                session.add(ticket)
                logger.info("First-response warning sent for ticket %s", ticket.display_id)

            if tickets or fr_tickets:
                await session.commit()

        except Exception as exc:
            logger.error("SLA warning job failed: %s", exc)
            await session.rollback()



# ── CSAT auto-close job ───────────────────────────────────────────────────────


async def _auto_close_resolved() -> None:
    """
    Scheduled job: close tickets that have been in a sends_csat=True status
    for longer than csat_auto_close_days with no CSAT response.
    Runs every hour.
    """
    from app.models.ticket_csat import TicketCSAT
    from app.services.settings_service import get_setting

    async for session in get_session():
        try:
            days_str = await get_setting("csat_auto_close_days", session, default="7")
            try:
                days = int(days_str)
            except (ValueError, TypeError):
                days = 7

            cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)

            csat_status_result = await session.execute(
                select(TicketStatusConfig.name).where(
                    TicketStatusConfig.sends_csat == True,  # noqa: E712
                    TicketStatusConfig.is_archived == False,  # noqa: E712
                )
            )
            csat_statuses = [r[0] for r in csat_status_result.all()]
            if not csat_statuses:
                return

            # Lookup the terminal close status (resolved, no CSAT) dynamically.
            # Ordered by sort_order so this picks the same status as
            # close_without_survey when several no-survey resolved states exist.
            close_cfg_result = await session.execute(
                select(TicketStatusConfig).where(
                    TicketStatusConfig.is_resolved_state == True,  # noqa: E712
                    TicketStatusConfig.sends_csat == False,  # noqa: E712
                    TicketStatusConfig.is_archived == False,  # noqa: E712
                ).order_by(TicketStatusConfig.sort_order).limit(1)
            )
            close_cfg = close_cfg_result.scalar_one_or_none()
            close_status = close_cfg.name if close_cfg else "closed"

            # Only skip tickets with a CSAT response AFTER the most recent resolve.
            # A ticket may have older CSAT rows from prior resolve cycles (multi-round).
            answered_after_resolve = (
                select(TicketCSAT.ticket_id)
                .where(
                    TicketCSAT.ticket_id == Ticket.id,
                    TicketCSAT.responded_at >= Ticket.resolved_at,
                )
                .correlate(Ticket)
                .exists()
            )
            result = await session.execute(
                select(Ticket).where(
                    Ticket.status.in_(csat_statuses),
                    Ticket.resolved_at.isnot(None),
                    Ticket.resolved_at <= cutoff,
                    ~answered_after_resolve,
                )
            )
            tickets = result.scalars().all()
            if not tickets:
                return

            now = datetime.now(timezone.utc).replace(tzinfo=None)
            for ticket in tickets:
                old_status = ticket.status
                await apply_sla_status_change(ticket, close_status, session)
                ticket.status = close_status
                ticket.updated_at = now
                session.add(
                    TicketHistory(
                        ticket_id=ticket.id,
                        actor_id=None,
                        field_changed="status",
                        old_value=old_status,
                        new_value=close_status,
                        created_at=now,
                    )
                )
                logger.info(
                    "Auto-closed ticket %s (no CSAT response after %d days)",
                    ticket.display_id,
                    days,
                )

            await session.commit()

        except Exception as exc:
            logger.error("CSAT auto-close job failed: %s", exc)
            await session.rollback()


# ── Scheduler lifecycle ────────────────────────────────────────────────────────


_scheduler: AsyncIOScheduler | None = None


def start_scheduler() -> None:
    global _scheduler
    _scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler.add_job(
        _check_sla_breaches,
        trigger="interval",
        minutes=1,
        id="sla_breach_check",
        max_instances=1,
        coalesce=True,
    )
    _scheduler.add_job(
        _warn_sla_breaches,
        trigger="interval",
        minutes=1,
        id="sla_breach_warn",
        max_instances=1,
        coalesce=True,
    )
    _scheduler.add_job(
        _auto_close_resolved,
        trigger="interval",
        hours=1,
        id="csat_auto_close",
        max_instances=1,
        coalesce=True,
    )
    from app.auth.jwt import prune_revoked_tokens
    _scheduler.add_job(
        prune_revoked_tokens,
        trigger="interval",
        hours=1,
        id="prune_revoked_tokens",
        max_instances=1,
        coalesce=True,
    )
    _scheduler.start()
    logger.info("SLA scheduler started — breach check + 15-min warning every 60 s")


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("SLA scheduler stopped")
