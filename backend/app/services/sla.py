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


# ── Public SLA state helpers ───────────────────────────────────────────────────


def sla_remaining_seconds(ticket: Ticket) -> int | None:
    """
    Return seconds remaining until SLA deadline, accounting for any paused time.
    Returns None if the ticket has no SLA deadline.
    Returns a negative value if the deadline has already passed.
    """
    if ticket.sla_deadline is None:
        return None

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    deadline = ticket.sla_deadline

    # If currently paused, the clock hasn't advanced since sla_paused_at
    if ticket.sla_paused_at is not None:
        effective_now = ticket.sla_paused_at
    else:
        effective_now = now

    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    if effective_now.tzinfo is None:
        effective_now = effective_now.replace(tzinfo=timezone.utc)

    return int((deadline - effective_now).total_seconds())


def sla_status_label(ticket: Ticket) -> str:
    """Return 'ok', 'warning' (< 20 % remaining), or 'breached'."""
    if ticket.sla_breached:
        return "breached"
    remaining = sla_remaining_seconds(ticket)
    if remaining is None:
        return "none"
    if remaining <= 0:
        return "breached"
    if ticket.sla_deadline is None:
        return "none"

    deadline = ticket.sla_deadline
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    created = ticket.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)

    total_seconds = (deadline - created).total_seconds()
    if total_seconds <= 0:
        return "ok"

    pct_remaining = remaining / total_seconds
    return "warning" if pct_remaining < 0.20 else "ok"


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
        # Leaving a pausing status — extend deadline by time spent paused
        paused_delta = now - ticket.sla_paused_at
        paused_secs = int(paused_delta.total_seconds())
        ticket.sla_paused_seconds = (ticket.sla_paused_seconds or 0) + paused_secs
        ticket.sla_paused_at = None

        if ticket.sla_deadline is not None:
            ticket.sla_deadline = ticket.sla_deadline + timedelta(seconds=paused_secs)


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
                return

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
    _scheduler.start()
    logger.info("SLA scheduler started — breach check + 15-min warning every 60 s")


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("SLA scheduler stopped")
