"""Public app configuration endpoint — accessible to any authenticated user."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.database import get_session
from app.models.ticket_status_config import TicketStatusConfig
from app.models.user import User
from app.services.settings_service import get_setting

router = APIRouter(tags=["config"])


class StatusConfigRead(BaseModel):
    name: str
    label: str
    color: str
    pauses_sla: bool
    is_default: bool
    is_resolved_state: bool
    sort_order: int


class AppConfig(BaseModel):
    timezone: str
    statuses: list[StatusConfigRead]


@router.get("/app-config", response_model=AppConfig)
async def get_app_config(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AppConfig:
    tz = await get_setting("timezone", session, default="UTC")
    rows = (
        await session.execute(
            select(TicketStatusConfig)
            .where(TicketStatusConfig.is_archived == False)  # noqa: E712
            .order_by(TicketStatusConfig.sort_order)
        )
    ).scalars().all()
    statuses = [
        StatusConfigRead(
            name=r.name,
            label=r.label,
            color=r.color,
            pauses_sla=r.pauses_sla,
            is_default=r.is_default,
            is_resolved_state=r.is_resolved_state,
            sort_order=r.sort_order,
        )
        for r in rows
    ]
    return AppConfig(timezone=tz, statuses=statuses)
