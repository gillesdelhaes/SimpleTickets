"""
Admin settings endpoints — read/write app_settings from the UI.

GET  /admin/settings         — list all settings (secrets masked)
PATCH /admin/settings        — bulk update settings

Slack connections are managed separately — see routers/slack_workspaces.py.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require_admin
from app.database import get_session
from app.models.app_setting import AppSetting
from app.models.user import User
from app.services.audit import write_audit
from app.services.settings_service import set_setting

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin/settings", tags=["admin"])

# Keys the UI is allowed to write (prevent arbitrary key injection)
_WRITABLE_KEYS = {
    "timezone",
    "business_hours_enabled",
    "business_hours_start",
    "business_hours_end",
    "business_days",
    "csat_auto_close_days",
}

# Keys the GET endpoint may return. Deliberately excludes internal secrets
# (app_secret_key, jwt_secret) and the setup flag — the UI never reads them,
# and shipping the JWT signing key to a browser would allow token forgery.
_READABLE_KEYS = _WRITABLE_KEYS




# ── Response types ─────────────────────────────────────────────────────────────

class SettingRead(BaseModel):
    key: str
    value: Optional[str]   # None / masked for secrets
    is_secret: bool
    group_name: str


class SettingsResponse(BaseModel):
    settings: list[SettingRead]


class SettingUpdate(BaseModel):
    key: str
    value: str


class SettingsPatchRequest(BaseModel):
    settings: list[SettingUpdate]


# ── GET /admin/settings ────────────────────────────────────────────────────────

@router.get("", response_model=SettingsResponse)
async def list_settings(
    current_user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> SettingsResponse:
    result = await session.execute(
        select(AppSetting)
        .where(AppSetting.key.in_(_READABLE_KEYS))
        .order_by(AppSetting.group_name, AppSetting.key)
    )
    rows = result.scalars().all()
    items = []
    for row in rows:
        if row.is_secret:
            display = "••••••••" if row.value else None
        else:
            display = row.value
        items.append(SettingRead(
            key=row.key,
            value=display,
            is_secret=row.is_secret,
            group_name=row.group_name,
        ))
    return SettingsResponse(settings=items)


# ── PATCH /admin/settings ──────────────────────────────────────────────────────

@router.patch("")
async def update_settings(
    body: SettingsPatchRequest,
    request: Request,
    current_user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    invalid = [s.key for s in body.settings if s.key not in _WRITABLE_KEYS]
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown or read-only settings keys: {invalid}",
        )

    try:
        for item in body.settings:
            await set_setting(item.key, item.value, session)

        # Audit which keys changed — never the values (some are secrets).
        await write_audit(
            session,
            actor_id=current_user.id,
            action="settings.updated",
            entity_type="settings",
            payload={"keys": sorted({s.key for s in body.settings})},
            ip_address=request.client.host if request.client else None,
        )
        await session.commit()
    except Exception:
        await session.rollback()
        raise

    # Re-warm the cache so subsequent requests see the new values
    from app.config import settings_manager
    await settings_manager.warm(session)

    return {"updated": len(body.settings)}
