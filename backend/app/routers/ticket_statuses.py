"""
Admin CRUD for configurable ticket statuses.
GET    /api/admin/ticket-statuses        list all (including archived)
POST   /api/admin/ticket-statuses        create
PATCH  /api/admin/ticket-statuses/{id}   update
DELETE /api/admin/ticket-statuses/{id}   archive (soft delete)
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require_admin
from app.database import get_session
from app.models.ticket_status_config import TicketStatusConfig
from app.models.user import User

router = APIRouter(prefix="/admin/ticket-statuses", tags=["ticket-statuses"])


class StatusRead(BaseModel):
    id: int
    name: str
    label: str
    color: str
    pauses_sla: bool
    is_default: bool
    is_resolved_state: bool
    sort_order: int
    is_archived: bool

    model_config = {"from_attributes": True}


class StatusCreate(BaseModel):
    name: str
    label: str
    color: str = "#737373"
    pauses_sla: bool = False
    is_default: bool = False
    is_resolved_state: bool = False
    sort_order: int = 0


class StatusUpdate(BaseModel):
    label: Optional[str] = None
    color: Optional[str] = None
    pauses_sla: Optional[bool] = None
    is_default: Optional[bool] = None
    is_resolved_state: Optional[bool] = None
    sort_order: Optional[int] = None
    is_archived: Optional[bool] = None


@router.get("", response_model=list[StatusRead])
async def list_statuses(
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> list[StatusRead]:
    rows = (
        await session.execute(
            select(TicketStatusConfig).order_by(TicketStatusConfig.sort_order)
        )
    ).scalars().all()
    return [StatusRead.model_validate(r) for r in rows]


@router.post("", response_model=StatusRead, status_code=status.HTTP_201_CREATED)
async def create_status(
    body: StatusCreate,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> StatusRead:
    existing = (
        await session.execute(
            select(TicketStatusConfig).where(TicketStatusConfig.name == body.name)
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"A status with name '{body.name}' already exists",
        )

    # If this will be the default, clear any existing default
    if body.is_default:
        await _clear_default(session)

    row = TicketStatusConfig(**body.model_dump())
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return StatusRead.model_validate(row)


@router.patch("/{status_id}", response_model=StatusRead)
async def update_status(
    status_id: int,
    body: StatusUpdate,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> StatusRead:
    row = await session.get(TicketStatusConfig, status_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Status not found")

    provided = body.model_fields_set

    # If setting this as default, clear the old one first
    if "is_default" in provided and body.is_default:
        await _clear_default(session, exclude_id=status_id)

    for field in provided:
        value = getattr(body, field)
        if value is not None or field in ("is_default", "is_resolved_state", "pauses_sla", "is_archived"):
            setattr(row, field, value)

    await session.commit()
    await session.refresh(row)
    return StatusRead.model_validate(row)


@router.delete("/{status_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_status(
    status_id: int,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> None:
    row = await session.get(TicketStatusConfig, status_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Status not found")
    if row.is_default:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Cannot archive the default status. Assign another status as default first.",
        )
    row.is_archived = True
    await session.commit()


async def _clear_default(session: AsyncSession, exclude_id: Optional[int] = None) -> None:
    stmt = select(TicketStatusConfig).where(TicketStatusConfig.is_default == True)  # noqa: E712
    if exclude_id is not None:
        stmt = stmt.where(TicketStatusConfig.id != exclude_id)
    rows = (await session.execute(stmt)).scalars().all()
    for r in rows:
        r.is_default = False
