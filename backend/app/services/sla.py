"""
SLA Engine — Chunk 11.

Responsibilities:
  1. Breach detection: every minute, find tickets whose sla_deadline has
     passed and mark them sla_breached=True.
  2. Pause / resume: when a ticket enters pending_user status the SLA clock
     stops; when it leaves, accumulated paused seconds are recorded and the
     deadline is extended accordingly.
  3. Status endpoint helper: compute current SLA state for a single ticket
     without touching the database.

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
from app.models.enums import TicketStatus

logger = logging.getLogger(__name__)

_ACTIVE_STATUSES = {TicketStatus.open, TicketStatus.in_progress}
_PAUSED_STATUS = TicketStatus.pending_user
_CLOSED_STATUSES = {TicketStatus.resolved, TicketStatus.closed}


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
        # Freeze effective time at the moment the ticket was paused
        effective_now = ticket.sla_paused_at
    else:
        effective_now = now

    # Make deadline timezone-aware if stored as naive UTC
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


# ── Pause / resume ─────────────────────────────────────────────────────────────


def apply_sla_status_change(ticket: Ticket, new_status: TicketStatus) -> None:
    """
    Call this whenever a ticket's status changes to update SLA pause state.
    Mutates the ticket object in place — caller must commit.
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    if new_status == _PAUSED_STATUS and ticket.sla_paused_at is None:
        # Entering pending_user — freeze the clock
        ticket.sla_paused_at = now

    elif new_status != _PAUSED_STATUS and ticket.sla_paused_at is not None:
        # Leaving pending_user — extend deadline by time spent paused
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
    Skips paused tickets (pending_user) and already-breached ones.
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # Build a fresh async session for this background task
    async for session in get_session():
        try:
            result = await session.execute(
                select(Ticket).where(
                    Ticket.sla_deadline.isnot(None),
                    Ticket.sla_breached == False,  # noqa: E712
                    Ticket.sla_paused_at.is_(None),   # not paused
                    Ticket.status.not_in(list(_CLOSED_STATUSES)),
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
                        actor_id=None,  # system action
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


# ── Scheduler lifecycle ────────────────────────────────────────────────────────


_scheduler: AsyncIOScheduler | None = None


def start_scheduler() -> None:
    """Start the APScheduler AsyncIOScheduler. Called once at app startup."""
    global _scheduler
    _scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler.add_job(
        _check_sla_breaches,
        trigger="interval",
        minutes=1,
        id="sla_breach_check",
        max_instances=1,       # never run two breach checks concurrently
        coalesce=True,         # skip missed fires if previous run was slow
    )
    _scheduler.start()
    logger.info("SLA scheduler started — breach check every 60 s")


def stop_scheduler() -> None:
    """Graceful shutdown. Called in FastAPI lifespan teardown."""
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("SLA scheduler stopped")
