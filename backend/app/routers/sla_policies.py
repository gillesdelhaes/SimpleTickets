from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.deps import require_admin, require_technician
from app.database import get_session
from app.models import SLAPolicy, User
from app.models.enums import Priority
from app.schemas.sla_policy import SLAPolicyCreate, SLAPolicyRead, SLAPolicyUpdate
from app.services.audit import write_audit
from app.utils import client_ip

router = APIRouter(prefix="/sla-policies", tags=["sla-policies"])


@router.get("", response_model=list[SLAPolicyRead])
async def list_sla_policies(
    _user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> list[SLAPolicy]:
    """List all SLA policies. Technician and admin only."""
    # Return in logical priority order
    _order = [Priority.critical, Priority.high, Priority.medium, Priority.low]
    result = await session.execute(select(SLAPolicy))
    policies = list(result.scalars().all())
    policies.sort(key=lambda p: _order.index(p.priority) if p.priority in _order else 99)
    return policies


@router.post("", response_model=SLAPolicyRead, status_code=status.HTTP_201_CREATED)
async def create_sla_policy(
    body: SLAPolicyCreate,
    request: Request,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> SLAPolicy:
    """
    Create a new SLA policy. Admin only.
    One policy per priority is enforced — creating a duplicate priority replaces the existing one.
    """
    # Check if a policy for this priority already exists
    result = await session.execute(
        select(SLAPolicy).where(SLAPolicy.priority == body.priority)
    )
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"A policy for priority '{body.priority.value}' already exists (id={existing.id}). "
                "Use PATCH to update it."
            ),
        )

    policy = SLAPolicy(
        name=body.name,
        priority=body.priority,
        first_response_minutes=body.first_response_minutes,
        resolution_minutes=body.resolution_minutes,
    )
    session.add(policy)
    await session.flush()
    await write_audit(
        session,
        actor_id=admin.id,
        action="sla_policy.created",
        entity_type="sla_policy",
        entity_id=policy.id,
        payload={
            "name": policy.name,
            "priority": policy.priority.value,
            "first_response_minutes": policy.first_response_minutes,
            "resolution_minutes": policy.resolution_minutes,
        },
        ip_address=client_ip(request),
    )
    await session.commit()
    await session.refresh(policy)
    return policy


@router.patch("/{policy_id}", response_model=SLAPolicyRead)
async def update_sla_policy(
    policy_id: int,
    body: SLAPolicyUpdate,
    request: Request,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> SLAPolicy:
    """Update an SLA policy's name or time targets. Admin only."""
    result = await session.execute(select(SLAPolicy).where(SLAPolicy.id == policy_id))
    policy = result.scalar_one_or_none()
    if not policy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SLA policy not found")

    changes: dict = {}
    for field in ("name", "first_response_minutes", "resolution_minutes"):
        new = getattr(body, field)
        if new is not None and new != getattr(policy, field):
            changes[field] = {"from": getattr(policy, field), "to": new}
            setattr(policy, field, new)

    if changes:
        await write_audit(
            session,
            actor_id=admin.id,
            action="sla_policy.updated",
            entity_type="sla_policy",
            entity_id=policy.id,
            payload={"name": policy.name, "priority": policy.priority.value, "changes": changes},
            ip_address=client_ip(request),
        )

    await session.commit()
    await session.refresh(policy)
    return policy


@router.delete("/{policy_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sla_policy(
    policy_id: int,
    request: Request,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> None:
    """
    Delete an SLA policy. Admin only.
    Raises 409 if any tickets currently reference this policy.
    """
    from app.models import Ticket  # local import to avoid circular dependency

    result = await session.execute(select(SLAPolicy).where(SLAPolicy.id == policy_id))
    policy = result.scalar_one_or_none()
    if not policy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SLA policy not found")

    # Guard against orphaning active tickets
    ticket_result = await session.execute(
        select(Ticket).where(Ticket.sla_policy_id == policy_id).limit(1)
    )
    if ticket_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete — tickets are currently using this SLA policy",
        )

    await write_audit(
        session,
        actor_id=admin.id,
        action="sla_policy.deleted",
        entity_type="sla_policy",
        entity_id=policy.id,
        payload={"name": policy.name, "priority": policy.priority.value},
        ip_address=client_ip(request),
    )
    await session.delete(policy)
    await session.commit()
