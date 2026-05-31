"""
Ticket CRUD.

Access: all endpoints require technician or admin role.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.auth.deps import get_current_user
from app.database import get_session
from app.models import Category, SLAPolicy, Ticket, TicketHistory, User
from app.models.enums import Priority, TicketStatus
from app.schemas.ticket import TicketCreate, TicketListResponse, TicketRead, TicketUpdate
from app.services.sla import apply_sla_status_change

router = APIRouter(prefix="/tickets", tags=["tickets"])

# ── helpers ────────────────────────────────────────────────────────────────────

_RESOLVED_STATUSES = {TicketStatus.resolved, TicketStatus.closed}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


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

    base = (
        select(
            Ticket,
            Submitter.name.label("submitter_name"),
            Assignee.name.label("assignee_name"),
            Category.name.label("category_name"),
        )
        .outerjoin(Submitter, Ticket.submitter_id == Submitter.id)
        .outerjoin(Assignee, Ticket.assignee_id == Assignee.id)
        .outerjoin(Category, Ticket.category_id == Category.id)
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
                slack_channel_id=ticket.slack_channel_id,
                slack_message_ts=ticket.slack_message_ts,
                created_at=ticket.created_at,
                updated_at=ticket.updated_at,
                resolved_at=ticket.resolved_at,
            )
        )

    return items, total


async def _get_ticket_or_404(session: AsyncSession, ticket_id: int) -> Ticket:
    ticket = await session.get(Ticket, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    return ticket


def _record_history(
    session: AsyncSession,
    ticket_id: int,
    actor_id: int | None,
    changes: dict[str, tuple[str | None, str | None]],
) -> None:
    """Queue TicketHistory rows (one per changed field) without flushing."""
    now = _utcnow()
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
    - The authenticated user is automatically set as submitter.
    - SLA deadline is calculated from the matching SLA policy (if any).
    """
    now = _utcnow()

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
    if sla_policy:
        sla_policy_id = sla_policy.id
        sla_deadline = now + timedelta(minutes=sla_policy.resolution_minutes)

    ticket = Ticket(
        title=body.title,
        description=body.description,
        status=TicketStatus.open,
        priority=body.priority,
        category_id=body.category_id,
        submitter_id=current_user.id,
        sla_policy_id=sla_policy_id,
        sla_deadline=sla_deadline,
        created_at=now,
        updated_at=now,
    )
    session.add(ticket)
    await session.flush()  # get ticket.id before history insert

    # Seed history entry for creation
    _record_history(session, ticket.id, current_user.id, {"status": (None, TicketStatus.open.value)})

    await session.commit()
    await session.refresh(ticket)

    # Return enriched response
    items, _ = await _fetch_enriched(session, [Ticket.id == ticket.id])
    return items[0]


# ── GET /tickets ───────────────────────────────────────────────────────────────


@router.get("", response_model=TicketListResponse)
async def list_tickets(
    status_filter: list[TicketStatus] = Query(default=[], alias="status"),
    priority_filter: list[Priority] = Query(default=[], alias="priority"),
    category_id: int | None = Query(default=None),
    assignee_id: int | None = Query(default=None),
    unassigned: bool = Query(default=False),
    q: str | None = Query(default=None, description="Search in title"),
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
    if assignee_id is not None:
        where.append(Ticket.assignee_id == assignee_id)
    if unassigned:
        where.append(Ticket.assignee_id.is_(None))
    if q:
        where.append(Ticket.title.ilike(f"%{q}%"))

    items, total = await _fetch_enriched(
        session,
        where,
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
    await _get_ticket_or_404(session, ticket_id)
    items, _ = await _fetch_enriched(session, [Ticket.id == ticket_id])
    return items[0]


# ── PATCH /tickets/{id} ────────────────────────────────────────────────────────


@router.patch("/{ticket_id}", response_model=TicketRead)
async def update_ticket(
    ticket_id: int,
    body: TicketUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TicketRead:
    """Update a ticket. All fields are editable by technicians and admins."""
    ticket = await _get_ticket_or_404(session, ticket_id)

    provided = body.model_fields_set  # fields explicitly included in request body
    if not provided:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No fields provided",
        )

    changes: dict[str, tuple[str | None, str | None]] = {}
    now = _utcnow()

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
                ticket.sla_deadline = ticket.created_at + timedelta(
                    minutes=sla_policy.resolution_minutes
                )
            else:
                ticket.sla_policy_id = None
                ticket.sla_deadline = None

    # status
    if "status" in provided and body.status is not None:
        if ticket.status != body.status:
            changes["status"] = (ticket.status.value, body.status.value)
            old_status = ticket.status
            ticket.status = body.status

            # SLA pause/resume on pending_user transitions
            apply_sla_status_change(ticket, body.status)

            # Track resolved_at transitions
            if body.status in _RESOLVED_STATUSES and old_status not in _RESOLVED_STATUSES:
                ticket.resolved_at = now
            elif body.status not in _RESOLVED_STATUSES and old_status in _RESOLVED_STATUSES:
                ticket.resolved_at = None

    # assignee_id
    if "assignee_id" in provided:
        new_assignee = body.assignee_id
        if new_assignee is not None:
            assignee = await session.get(User, new_assignee)
            if assignee is None or not assignee.is_active:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Assignee not found or inactive",
                )
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
            pass

    return enriched
