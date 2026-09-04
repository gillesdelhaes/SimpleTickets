"""
Ticket CRUD.

Access: all endpoints require technician or admin role.
"""
import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

logger = logging.getLogger(__name__)
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.auth.deps import get_current_user, require_technician
from app.database import get_session
from app.models import Category, SLAPolicy, Ticket, TicketCSAT, TicketHistory, User
from app.models.enums import Priority, Role
from app.models.slack_workspace import SlackWorkspace
from app.models.ticket_status_config import TicketStatusConfig
from app.schemas.ticket import BulkTicketUpdate, CloseTicketRequest, MarkDuplicateRequest, TicketCreate, TicketListResponse, TicketRead, TicketUpdate
from app.services.audit import write_audit
from app.services.rate_limit import RateLimiter
from app.services.sla import apply_sla_status_change, compute_sla_deadline
from app.utils import client_ip, get_ticket_or_404, utcnow

# Fields worth surfacing in the timeline
_HISTORY_DISPLAY_FIELDS = {"status", "assignee_id", "priority", "category_id", "duplicate_of", "csat_response"}

router = APIRouter(prefix="/tickets", tags=["tickets"])

_ticket_create_limiter = RateLimiter(limit=30, window_seconds=60)

_PRIORITY_ORDER = case(
    {"critical": 0, "high": 1, "medium": 2, "low": 3},
    value=Ticket.priority,
    else_=4,
)


async def _get_resolved_status_names(session: AsyncSession) -> set[str]:
    """Return the set of status slugs that have is_resolved_state=True."""
    result = await session.execute(
        select(TicketStatusConfig.name).where(TicketStatusConfig.is_resolved_state == True)  # noqa: E712
    )
    return {row[0] for row in result.all()} or {"resolved", "closed"}


async def _get_default_status(session: AsyncSession) -> str:
    """Return the slug of the is_default status, falling back to 'open'."""
    result = await session.execute(
        select(TicketStatusConfig.name).where(TicketStatusConfig.is_default == True)  # noqa: E712
    )
    row = result.scalar_one_or_none()
    return row or "open"


async def _fetch_enriched(
    session: AsyncSession,
    where_clauses: list,
    *,
    order_by=None,
    limit: int | None = None,
    offset: int = 0,
) -> tuple[list[TicketRead], int]:
    """
    Query tickets with LEFT JOINs for submitter name, assignee name, and
    category name, returning (items, total_count).
    """
    Submitter = aliased(User, flat=True)
    Assignee = aliased(User, flat=True)
    DuplicateOf = aliased(Ticket, flat=True)

    base = (
        select(
            Ticket,
            Submitter.name.label("submitter_name"),
            Assignee.name.label("assignee_name"),
            Category.name.label("category_name"),
            DuplicateOf.title.label("duplicate_of_title"),
            SlackWorkspace.name.label("workspace_name"),
        )
        .outerjoin(Submitter, Ticket.submitter_id == Submitter.id)
        .outerjoin(Assignee, Ticket.assignee_id == Assignee.id)
        .outerjoin(Category, Ticket.category_id == Category.id)
        .outerjoin(DuplicateOf, Ticket.duplicate_of_id == DuplicateOf.id)
        .outerjoin(SlackWorkspace, Ticket.workspace_id == SlackWorkspace.id)
    )

    for clause in where_clauses:
        base = base.where(clause)

    # Count total before pagination
    count_stmt = select(func.count()).select_from(
        select(Ticket).where(*where_clauses).subquery()
    )
    total: int = (await session.execute(count_stmt)).scalar_one()

    if order_by is not None:
        base = base.order_by(order_by)
    else:
        base = base.order_by(Ticket.created_at.desc())

    if limit is not None:
        base = base.limit(limit).offset(offset)

    rows = (await session.execute(base)).all()

    items = []
    for row in rows:
        ticket: Ticket = row[0]
        sub_name: str | None = row[1]
        asg_name: str | None = row[2]
        cat_name: str | None = row[3]
        dup_title: str | None = row[4]
        ws_name: str | None = row[5]

        items.append(
            TicketRead(
                id=ticket.id,
                display_id=ticket.display_id,
                title=ticket.title,
                description=ticket.description,
                status=ticket.status,
                priority=ticket.priority,
                category_id=ticket.category_id,
                category_name=cat_name,
                submitter_id=ticket.submitter_id,
                submitter_name=sub_name or ticket.slack_submitter_name,
                assignee_id=ticket.assignee_id,
                assignee_name=asg_name,
                sla_policy_id=ticket.sla_policy_id,
                sla_deadline=ticket.sla_deadline,
                sla_breached=ticket.sla_breached,
                duplicate_of_id=ticket.duplicate_of_id,
                duplicate_of_title=dup_title,
                source=ticket.source,
                workspace_id=ticket.workspace_id,
                workspace_name=ws_name,
                slack_channel_id=ticket.slack_channel_id,
                slack_message_ts=ticket.slack_message_ts,
                first_response_deadline=ticket.first_response_deadline,
                first_responded_at=ticket.first_responded_at,
                created_at=ticket.created_at,
                updated_at=ticket.updated_at,
                resolved_at=ticket.resolved_at,
            )
        )

    return items, total



def _record_history(
    session: AsyncSession,
    ticket_id: int,
    actor_id: int | None,
    changes: dict[str, tuple[str | None, str | None]],
) -> None:
    """Queue TicketHistory rows (one per changed field) without flushing."""
    now = utcnow()
    for field, (old, new) in changes.items():
        session.add(
            TicketHistory(
                ticket_id=ticket_id,
                actor_id=actor_id,
                field_changed=field,
                old_value=old,
                new_value=new,
                created_at=now,
            )
        )


# ── POST /tickets ──────────────────────────────────────────────────────────────


@router.post("", response_model=TicketRead, status_code=status.HTTP_201_CREATED)
async def create_ticket(
    body: TicketCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TicketRead:
    """
    Create a ticket via the web portal.
    - Without slack_reporter_id: authenticated user becomes the submitter.
    - With slack_reporter_id: ticket is created on behalf of a Slack user;
      the bot sends them a DM and saves the thread anchor for future sync.
    - SLA deadline is calculated from the matching SLA policy (if any).
    """
    _ticket_create_limiter.check(str(current_user.id))
    now = utcnow()

    # Validate category if provided
    if body.category_id is not None:
        cat = await session.get(Category, body.category_id)
        if cat is None or cat.is_archived:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Category not found or archived",
            )

    # Look up matching SLA policy (one per priority)
    sla_result = await session.execute(
        select(SLAPolicy).where(SLAPolicy.priority == body.priority)
    )
    sla_policy = sla_result.scalar_one_or_none()

    sla_deadline: datetime | None = None
    sla_policy_id: int | None = None
    first_response_deadline: datetime | None = None
    if sla_policy:
        sla_policy_id = sla_policy.id
        sla_deadline = await compute_sla_deadline(now, sla_policy.resolution_minutes, session)
        first_response_deadline = await compute_sla_deadline(now, sla_policy.first_response_minutes, session)

    # If a Slack reporter is given, the ticket is on behalf of a Slack user —
    # submitter_id stays None and we store the Slack identity instead. That
    # reporter came from a specific workspace's user list, so workspace_id is
    # required alongside it (it's what lets replies/DMs route back correctly).
    slack_reporter = body.slack_reporter_id or None
    workspace_id: int | None = None
    if slack_reporter:
        if body.workspace_id is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="workspace_id is required when slack_reporter_id is set",
            )
        workspace = await session.get(SlackWorkspace, body.workspace_id)
        if workspace is None or not workspace.is_active:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Workspace not found or inactive",
            )
        workspace_id = workspace.id

    default_status = await _get_default_status(session)

    ticket = Ticket(
        title=body.title,
        description=body.description,
        status=default_status,
        priority=body.priority,
        category_id=body.category_id,
        submitter_id=None if slack_reporter else current_user.id,
        slack_submitter_id=slack_reporter,
        slack_submitter_name=body.slack_reporter_name if slack_reporter else None,
        sla_policy_id=sla_policy_id,
        sla_deadline=sla_deadline,
        first_response_deadline=first_response_deadline,
        source="web",
        workspace_id=workspace_id,
        created_at=now,
        updated_at=now,
    )
    session.add(ticket)
    await session.flush()  # get ticket.id before history insert

    # Seed history entry for creation
    _record_history(session, ticket.id, current_user.id, {"status": (None, default_status)})

    await session.commit()
    await session.refresh(ticket)

    # Notify the Slack reporter via DM and save the thread anchor so all
    # future replies and status updates thread back to them automatically.
    if slack_reporter:
        try:
            from app.slack.service import notify_reporter_dm
            await notify_reporter_dm(ticket, slack_reporter)
        except Exception:  # noqa: BLE001
            logger.warning(
                "Failed to DM Slack reporter %s for ticket %s",
                slack_reporter,
                ticket.display_id,
            )

    if workspace_id is not None:
        try:
            from app.slack.service import post_ticket_created_notification
            await post_ticket_created_notification(ticket, session)
        except Exception:  # noqa: BLE001
            logger.warning("Failed to post new-ticket announcement for %s", ticket.display_id)

    # Return enriched response
    items, _ = await _fetch_enriched(session, [Ticket.id == ticket.id])
    return items[0]


# ── GET /tickets ───────────────────────────────────────────────────────────────


@router.get("", response_model=TicketListResponse)
async def list_tickets(
    status_filter: list[str] = Query(default=[], alias="status"),
    priority_filter: list[Priority] = Query(default=[], alias="priority"),
    category_id: int | None = Query(default=None),
    workspace_id: int | None = Query(default=None),
    assignee_id: int | None = Query(default=None),
    unassigned: bool = Query(default=False),
    has_negative_csat: bool = Query(default=False),
    sort: str = Query(default="created_at"),
    sort_dir: str = Query(default="desc"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TicketListResponse:
    """List tickets with optional filters."""
    where: list = []

    if status_filter:
        where.append(Ticket.status.in_(status_filter))
    if priority_filter:
        where.append(Ticket.priority.in_(priority_filter))
    if category_id is not None:
        where.append(Ticket.category_id == category_id)
    if workspace_id is not None:
        where.append(Ticket.workspace_id == workspace_id)
    if assignee_id is not None:
        where.append(Ticket.assignee_id == assignee_id)
    if unassigned:
        where.append(Ticket.assignee_id.is_(None))
    if has_negative_csat:
        where.append(
            select(TicketCSAT.id)
            .where(TicketCSAT.ticket_id == Ticket.id, TicketCSAT.score == False)  # noqa: E712
            .correlate(Ticket)
            .exists()
        )

    _sort_cols = {
        "created_at": Ticket.created_at,
        "updated_at": Ticket.updated_at,
        "sla_deadline": Ticket.sla_deadline,
        "priority": _PRIORITY_ORDER,
    }
    sort_col_expr = _sort_cols.get(sort, Ticket.created_at)
    order_expr = sort_col_expr.asc() if sort_dir == "asc" else sort_col_expr.desc()

    items, total = await _fetch_enriched(
        session,
        where,
        order_by=order_expr,
        limit=limit,
        offset=offset,
    )
    return TicketListResponse(items=items, total=total)


# ── GET /tickets/{id} ──────────────────────────────────────────────────────────


@router.get("/{ticket_id}", response_model=TicketRead)
async def get_ticket(
    ticket_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TicketRead:
    """Get a single ticket by ID."""
    await get_ticket_or_404(session, ticket_id)
    items, _ = await _fetch_enriched(session, [Ticket.id == ticket_id])
    return items[0]


# ── PATCH /tickets/bulk ────────────────────────────────────────────────────────


@router.patch("/bulk")
async def bulk_update_tickets(
    body: BulkTicketUpdate,
    current_user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Apply a single field change (assignee, priority, or status) to multiple tickets."""
    if not body.ids:
        raise HTTPException(status_code=422, detail="No ticket IDs provided")
    if len(body.ids) > 100:
        raise HTTPException(status_code=422, detail="Maximum 100 tickets per bulk operation")
    if body.assignee_id is None and body.priority is None and body.status is None:
        raise HTTPException(status_code=422, detail="At least one field must be provided")

    result = await session.execute(select(Ticket).where(Ticket.id.in_(body.ids)))
    tickets = list(result.scalars().all())

    now = utcnow()

    if body.assignee_id is not None:
        assignee = await session.get(User, body.assignee_id)
        if assignee is None or not assignee.is_active:
            raise HTTPException(status_code=422, detail="Assignee not found or inactive")

    sla_policy = None
    if body.priority is not None:
        sla_result = await session.execute(
            select(SLAPolicy).where(SLAPolicy.priority == body.priority)
        )
        sla_policy = sla_result.scalar_one_or_none()

    resolved_names: set[str] = set()
    sends_csat = False
    if body.status is not None:
        valid = await session.execute(
            select(TicketStatusConfig.name).where(
                TicketStatusConfig.name == body.status,
                TicketStatusConfig.is_archived == False,  # noqa: E712
            )
        )
        if valid.scalar_one_or_none() is None:
            raise HTTPException(status_code=422, detail=f"Status '{body.status}' does not exist or is archived")
        resolved_names = await _get_resolved_status_names(session)
        csat_res = await session.execute(
            select(TicketStatusConfig.sends_csat).where(TicketStatusConfig.name == body.status)
        )
        sends_csat = bool(csat_res.scalar_one_or_none())
        # Same integrity guard as the single-ticket PATCH: technicians can't
        # bulk-close (terminal resolved state with no survey) to dodge CSAT.
        if (current_user.role == Role.technician
                and body.status in resolved_names and not sends_csat):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Technicians can't close tickets directly — use Resolved "
                    "(which sends the CSAT survey), or Close without survey."
                ),
            )

    updated = 0
    # (ticket, changes, entered_csat) for post-commit Slack/CSAT side effects
    changed: list[tuple[Ticket, dict, bool]] = []
    for ticket in tickets:
        changes: dict = {}
        entered_csat = False

        if body.assignee_id is not None and ticket.assignee_id != body.assignee_id:
            changes["assignee_id"] = (
                str(ticket.assignee_id) if ticket.assignee_id else None,
                str(body.assignee_id),
            )
            ticket.assignee_id = body.assignee_id

        if body.priority is not None and ticket.priority != body.priority:
            changes["priority"] = (ticket.priority.value, body.priority.value)
            ticket.priority = body.priority
            if sla_policy:
                ticket.sla_policy_id = sla_policy.id
                paused = timedelta(seconds=ticket.sla_paused_seconds or 0)
                ticket.sla_deadline = await compute_sla_deadline(
                    ticket.created_at, sla_policy.resolution_minutes, session
                ) + paused
                if ticket.first_responded_at is None:
                    ticket.first_response_deadline = await compute_sla_deadline(
                        ticket.created_at, sla_policy.first_response_minutes, session
                    ) + paused
            else:
                ticket.sla_policy_id = None
                ticket.sla_deadline = None

        if body.status is not None and ticket.status != body.status:
            old_status = ticket.status
            changes["status"] = (old_status, body.status)
            ticket.status = body.status
            await apply_sla_status_change(ticket, body.status, session)
            if body.status in resolved_names and old_status not in resolved_names:
                ticket.resolved_at = now
                entered_csat = sends_csat
            elif body.status not in resolved_names and old_status in resolved_names:
                ticket.resolved_at = None

        if changes:
            ticket.updated_at = now
            _record_history(session, ticket.id, current_user.id, changes)
            changed.append((ticket, changes, entered_csat))
            updated += 1

    await session.commit()

    # Fire the same Slack thread / assignee-DM / CSAT side effects the
    # single-ticket PATCH performs, once per changed ticket. All are
    # fire-and-forget — a Slack failure must not fail the bulk operation.
    # (expire_on_commit=False keeps ticket column attributes valid post-commit.)
    assignee_name = assignee.name if body.assignee_id is not None else None
    _SLACK_TRACKED = {"status", "priority", "assignee_id"}
    for ticket, changes, entered_csat in changed:
        if changes.keys() & _SLACK_TRACKED:
            try:
                from app.slack.service import post_ticket_update_to_slack
                await post_ticket_update_to_slack(
                    ticket, changes, current_user.name,
                    assignee_name=assignee_name,
                )
            except Exception:  # noqa: BLE001
                logger.exception("Failed to post bulk update to Slack for ticket %s", ticket.id)
        if "assignee_id" in changes and body.assignee_id is not None:
            try:
                from app.slack.service import notify_assignee_dm
                await notify_assignee_dm(ticket, body.assignee_id, current_user.name)
            except Exception:  # noqa: BLE001
                logger.exception("Failed to notify assignee for ticket %s", ticket.id)
        if entered_csat:
            try:
                from app.slack.service import send_csat_dm
                await send_csat_dm(ticket)
            except Exception:  # noqa: BLE001
                logger.exception("Failed to send CSAT DM for ticket %s", ticket.id)

    return {"updated": updated}


# ── PATCH /tickets/{id} ────────────────────────────────────────────────────────


@router.patch("/{ticket_id}", response_model=TicketRead)
async def update_ticket(
    ticket_id: int,
    body: TicketUpdate,
    current_user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> TicketRead:
    """Update a ticket. All fields are editable by technicians and admins."""
    ticket = await get_ticket_or_404(session, ticket_id)

    provided = body.model_fields_set  # fields explicitly included in request body
    if not provided:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No fields provided",
        )

    changes: dict[str, tuple[str | None, str | None]] = {}
    now = utcnow()
    _sends_csat = False

    # title
    if "title" in provided and body.title is not None:
        if ticket.title != body.title:
            changes["title"] = (ticket.title, body.title)
            ticket.title = body.title

    # description
    if "description" in provided and body.description is not None:
        if ticket.description != body.description:
            changes["description"] = (ticket.description[:120], body.description[:120])
            ticket.description = body.description

    # category_id
    if "category_id" in provided:
        new_cat = body.category_id
        if new_cat is not None:
            cat = await session.get(Category, new_cat)
            if cat is None or cat.is_archived:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Category not found or archived",
                )
        if ticket.category_id != new_cat:
            changes["category_id"] = (
                str(ticket.category_id) if ticket.category_id else None,
                str(new_cat) if new_cat else None,
            )
            ticket.category_id = new_cat

    # priority — recalculate SLA deadline when priority changes
    if "priority" in provided and body.priority is not None:
        if ticket.priority != body.priority:
            changes["priority"] = (ticket.priority.value, body.priority.value)
            ticket.priority = body.priority

            sla_result = await session.execute(
                select(SLAPolicy).where(SLAPolicy.priority == body.priority)
            )
            sla_policy = sla_result.scalar_one_or_none()
            if sla_policy:
                ticket.sla_policy_id = sla_policy.id
                # Recompute from created_at, then add back any accrued pause
                # extension so re-prioritising doesn't silently drop it.
                paused = timedelta(seconds=ticket.sla_paused_seconds or 0)
                ticket.sla_deadline = await compute_sla_deadline(
                    ticket.created_at, sla_policy.resolution_minutes, session
                ) + paused
                # The first-response target moves with priority too — but only
                # while the ticket is still awaiting its first response.
                if ticket.first_responded_at is None:
                    ticket.first_response_deadline = await compute_sla_deadline(
                        ticket.created_at, sla_policy.first_response_minutes, session
                    ) + paused
            else:
                ticket.sla_policy_id = None
                ticket.sla_deadline = None

    # status
    if "status" in provided and body.status is not None:
        if ticket.status != body.status:
            status_cfg = (await session.execute(
                select(TicketStatusConfig).where(
                    TicketStatusConfig.name == body.status,
                    TicketStatusConfig.is_archived == False,  # noqa: E712
                )
            )).scalar_one_or_none()
            if status_cfg is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Status '{body.status}' does not exist or is archived",
                )
            # Integrity guard: technicians may not move a ticket straight into a
            # terminal-close state (resolved but no survey) — that skips CSAT and
            # lets a tech dodge a bad score. They must use 'Resolved' (which sends
            # the survey); 'closed' is reserved for a 👍 response, auto-close, or an
            # admin. Legit no-survey closes go through POST /tickets/{id}/close.
            if (current_user.role == Role.technician
                    and status_cfg.is_resolved_state and not status_cfg.sends_csat):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        "Technicians can't close a ticket directly — set it to Resolved "
                        "(which sends the CSAT survey), or use Close without survey."
                    ),
                )
            resolved_names = await _get_resolved_status_names(session)
            changes["status"] = (ticket.status, body.status)
            old_status = ticket.status
            ticket.status = body.status

            # SLA pause/resume based on the new status's pauses_sla flag
            await apply_sla_status_change(ticket, body.status, session)

            # Track resolved_at transitions
            if body.status in resolved_names and old_status not in resolved_names:
                ticket.resolved_at = now
                # CSAT fires only on first entry into a sends_csat resolved state
                _sends_csat = bool(status_cfg.sends_csat)
            elif body.status not in resolved_names and old_status in resolved_names:
                ticket.resolved_at = None

    # assignee_id
    new_assignee_id: int | None = None
    if "assignee_id" in provided:
        new_assignee = body.assignee_id
        if new_assignee is not None:
            assignee = await session.get(User, new_assignee)
            if assignee is None or not assignee.is_active:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Assignee not found or inactive",
                )
            new_assignee_id = new_assignee
        if ticket.assignee_id != new_assignee:
            changes["assignee_id"] = (
                str(ticket.assignee_id) if ticket.assignee_id else None,
                str(new_assignee) if new_assignee else None,
            )
            ticket.assignee_id = new_assignee

    if not changes:
        # Nothing actually changed — return current state
        items, _ = await _fetch_enriched(session, [Ticket.id == ticket_id])
        return items[0]

    ticket.updated_at = now
    _record_history(session, ticket.id, current_user.id, changes)
    await session.commit()
    await session.refresh(ticket)

    items, _ = await _fetch_enriched(session, [Ticket.id == ticket_id])
    enriched = items[0]

    # Post a single Slack thread message covering all tracked field changes
    _SLACK_TRACKED = {"status", "priority", "assignee_id", "category_id"}
    if changes.keys() & _SLACK_TRACKED:
        try:
            from app.slack.service import post_ticket_update_to_slack
            await post_ticket_update_to_slack(
                ticket,
                changes,
                current_user.name,
                assignee_name=enriched.assignee_name,
                category_name=enriched.category_name,
            )
        except Exception:  # noqa: BLE001
            logger.exception("Failed to post field update to Slack for ticket %s", ticket_id)

    # DM the newly assigned technician if they have a Slack identity linked
    # in this ticket's workspace
    if "assignee_id" in changes and new_assignee_id is not None:
        try:
            from app.slack.service import notify_assignee_dm
            await notify_assignee_dm(ticket, new_assignee_id, current_user.name)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to notify assignee for ticket %s", ticket_id)

    # Send CSAT DM if the new status triggers it
    if _sends_csat:
        try:
            from app.slack.service import send_csat_dm
            await send_csat_dm(ticket)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to send CSAT DM for ticket %s", ticket_id)

    return enriched


# ── POST /tickets/{id}/close ───────────────────────────────────────────────────


@router.post("/{ticket_id}/close", response_model=TicketRead)
async def close_without_survey(
    ticket_id: int,
    body: CloseTicketRequest,
    request: Request,
    current_user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> TicketRead:
    """
    Close a ticket without sending a CSAT survey. This is the accountable escape
    hatch for cases where a survey doesn't apply (spam, a submitter with no Slack,
    an internal ticket). A reason is required and the action is written to the
    audit log so it can't be used silently to dodge a bad score.
    """
    ticket = await get_ticket_or_404(session, ticket_id)

    # The terminal-close status: resolved state that does not send a survey.
    close_cfg = (await session.execute(
        select(TicketStatusConfig).where(
            TicketStatusConfig.is_resolved_state == True,  # noqa: E712
            TicketStatusConfig.sends_csat == False,  # noqa: E712
            TicketStatusConfig.is_archived == False,  # noqa: E712
        ).order_by(TicketStatusConfig.sort_order).limit(1)
    )).scalar_one_or_none()
    if close_cfg is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No closed status is configured.",
        )
    if ticket.status == close_cfg.name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ticket is already closed.",
        )

    now = utcnow()
    resolved_names = await _get_resolved_status_names(session)
    old_status = ticket.status
    changes: dict[str, tuple[str | None, str | None]] = {"status": (old_status, close_cfg.name)}
    ticket.status = close_cfg.name
    if old_status not in resolved_names:
        ticket.resolved_at = now
    ticket.updated_at = now
    await apply_sla_status_change(ticket, close_cfg.name, session)
    _record_history(session, ticket.id, current_user.id, changes)

    await write_audit(
        session,
        actor_id=current_user.id,
        action="ticket.closed_no_survey",
        entity_type="ticket",
        entity_id=str(ticket_id),
        payload={"reason": body.reason, "from_status": old_status},
        ip_address=client_ip(request),
    )

    await session.commit()

    # Mirror the normal update: reflect the change in the Slack thread (no CSAT).
    items, _ = await _fetch_enriched(session, [Ticket.id == ticket_id])
    enriched = items[0]
    try:
        from app.slack.service import post_ticket_update_to_slack
        await post_ticket_update_to_slack(ticket, changes, current_user.name)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to post close update to Slack for ticket %s", ticket_id)

    return enriched


# ── GET /tickets/{id}/history ──────────────────────────────────────────────────


@router.get("/{ticket_id}/history")
async def get_ticket_history(
    ticket_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Return timeline events for a ticket (status/priority/assignee/category changes)."""
    await get_ticket_or_404(session, ticket_id)

    Actor = aliased(User, flat=True)

    rows = (
        await session.execute(
            select(TicketHistory, Actor.name.label("actor_name"))
            .outerjoin(Actor, TicketHistory.actor_id == Actor.id)
            .where(
                TicketHistory.ticket_id == ticket_id,
                TicketHistory.field_changed.in_(_HISTORY_DISPLAY_FIELDS),
            )
            .order_by(TicketHistory.created_at.asc())
            .limit(1000)  # safety cap
        )
    ).all()

    # Build lookup tables to resolve IDs → names for assignee and category fields
    user_ids = set()
    category_ids = set()
    for row in rows:
        h: TicketHistory = row[0]
        if h.field_changed == "assignee_id":
            for val in (h.old_value, h.new_value):
                if val and val.isdigit():
                    user_ids.add(int(val))
        elif h.field_changed == "category_id":
            for val in (h.old_value, h.new_value):
                if val and val.isdigit():
                    category_ids.add(int(val))

    user_names: dict[int, str] = {}
    if user_ids:
        user_rows = (await session.execute(
            select(User.id, User.name).where(User.id.in_(user_ids))
        )).all()
        user_names = {r.id: r.name for r in user_rows}

    cat_names: dict[int, str] = {}
    if category_ids:
        cat_rows = (await session.execute(
            select(Category.id, Category.name).where(Category.id.in_(category_ids))
        )).all()
        cat_names = {r.id: r.name for r in cat_rows}

    def _resolve(field: str, val: str | None) -> str | None:
        if val is None:
            return None
        if field == "assignee_id" and val.isdigit():
            return user_names.get(int(val), val)
        if field == "category_id" and val.isdigit():
            return cat_names.get(int(val), val)
        return val

    return [
        {
            "id": row[0].id,
            "field": row[0].field_changed,
            "old_value": _resolve(row[0].field_changed, row[0].old_value),
            "new_value": _resolve(row[0].field_changed, row[0].new_value),
            "actor_name": row[1],
            "created_at": row[0].created_at.isoformat(),
        }
        for row in rows
    ]


# ── POST /tickets/{id}/mark-duplicate ─────────────────────────────────────────


@router.post("/{ticket_id}/mark-duplicate", response_model=TicketRead)
async def mark_duplicate(
    ticket_id: int,
    body: MarkDuplicateRequest,
    request: Request,
    current_user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> TicketRead:
    """Mark a ticket as a duplicate of another. Closes the duplicate ticket."""
    ticket = await get_ticket_or_404(session, ticket_id)
    canonical = await get_ticket_or_404(session, body.duplicate_of_id)

    if ticket_id == body.duplicate_of_id:
        raise HTTPException(status_code=400, detail="A ticket cannot be a duplicate of itself")
    if canonical.duplicate_of_id is not None:
        raise HTTPException(status_code=400, detail="Cannot link to a ticket that is itself a duplicate")

    now = utcnow()
    changes: dict[str, tuple[str | None, str | None]] = {}

    old_dup = ticket.duplicate_of_id
    ticket.duplicate_of_id = body.duplicate_of_id
    changes["duplicate_of"] = (
        f"TKT-{old_dup:04d}" if old_dup else None,
        canonical.display_id,
    )

    # Close the duplicate
    resolved_names = await _get_resolved_status_names(session)
    closed_status = (
        "closed" if "closed" in resolved_names
        else "resolved" if "resolved" in resolved_names
        else next(iter(resolved_names), "closed")
    )
    if ticket.status not in resolved_names:
        changes["status"] = (ticket.status, closed_status)
        ticket.status = closed_status
        ticket.resolved_at = now
        await apply_sla_status_change(ticket, closed_status, session)

    ticket.updated_at = now
    _record_history(session, ticket.id, current_user.id, changes)

    # Closing-as-duplicate is a terminal path that never sends a CSAT survey, so
    # it gets the same audit trail as close_without_survey — otherwise linking a
    # ticket to any random one is a silent way to dodge a bad score.
    await write_audit(
        session,
        actor_id=current_user.id,
        action="ticket.marked_duplicate",
        entity_type="ticket",
        entity_id=str(ticket_id),
        payload={
            "duplicate_of_id": canonical.id,
            "duplicate_of": canonical.display_id,
            "closed": "status" in changes,
        },
        ip_address=client_ip(request),
    )

    await session.commit()
    await session.refresh(ticket)

    # DM the submitter
    try:
        from app.slack.service import notify_duplicate_dm
        await notify_duplicate_dm(ticket, canonical)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to send duplicate DM for ticket %s", ticket_id)

    items, _ = await _fetch_enriched(session, [Ticket.id == ticket_id])
    return items[0]


# ── DELETE /tickets/{id}/mark-duplicate ───────────────────────────────────────


@router.delete("/{ticket_id}/mark-duplicate", response_model=TicketRead)
async def unmark_duplicate(
    ticket_id: int,
    request: Request,
    current_user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> TicketRead:
    """Remove a duplicate link and re-open the ticket."""
    ticket = await get_ticket_or_404(session, ticket_id)

    if ticket.duplicate_of_id is None:
        raise HTTPException(status_code=400, detail="Ticket is not marked as a duplicate")

    now = utcnow()
    default_status = await _get_default_status(session)

    old_dup_id = ticket.duplicate_of_id
    changes: dict[str, tuple[str | None, str | None]] = {
        "duplicate_of": (f"TKT-{old_dup_id:04d}", None),
    }
    ticket.duplicate_of_id = None

    resolved_names = await _get_resolved_status_names(session)
    if ticket.status in resolved_names:
        changes["status"] = (ticket.status, default_status)
        ticket.status = default_status
        ticket.resolved_at = None
        await apply_sla_status_change(ticket, default_status, session)

    ticket.updated_at = now
    _record_history(session, ticket.id, current_user.id, changes)

    # Audited for the same reason as marking: mark-then-unlink must not be a
    # traceless close/reopen cycle.
    await write_audit(
        session,
        actor_id=current_user.id,
        action="ticket.unmarked_duplicate",
        entity_type="ticket",
        entity_id=str(ticket_id),
        payload={
            "was_duplicate_of_id": old_dup_id,
            "was_duplicate_of": f"TKT-{old_dup_id:04d}",
            "reopened": "status" in changes,
        },
        ip_address=client_ip(request),
    )

    await session.commit()

    items, _ = await _fetch_enriched(session, [Ticket.id == ticket_id])
    return items[0]
