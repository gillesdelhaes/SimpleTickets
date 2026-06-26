"""
Admin settings endpoints — read/write app_settings from the UI.

GET  /api/admin/settings         — list all settings (secrets masked)
PATCH /api/admin/settings        — bulk update settings
POST /api/admin/settings/test-slack — test Slack connection (post-setup)
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require_admin
from app.database import get_session
from app.models.app_setting import AppSetting
from app.models.user import User
from app.services.settings_service import get_setting, set_setting

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin/settings", tags=["admin"])

# Keys the UI is allowed to write (prevent arbitrary key injection)
_WRITABLE_KEYS = {
    "slack_bot_token",
    "slack_app_token",
    "slack_signing_secret",
    "slack_trigger_emoji",
    "slack_two_way_sync",
    "timezone",
}

_SLACK_KEYS = {
    "slack_bot_token", "slack_app_token", "slack_signing_secret",
    "slack_trigger_emoji", "slack_two_way_sync",
}




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
        select(AppSetting).order_by(AppSetting.group_name, AppSetting.key)
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
    current_user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    invalid = [s.key for s in body.settings if s.key not in _WRITABLE_KEYS]
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown or read-only settings keys: {invalid}",
        )

    for item in body.settings:
        if item.key == "slack_trigger_emoji" and not (item.value or "").strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="slack_trigger_emoji cannot be empty",
            )

    slack_changed = False
    for item in body.settings:
        await set_setting(item.key, item.value, session)
        if item.key in _SLACK_KEYS:
            slack_changed = True

    await session.commit()

    # Invalidate cache so next request picks up new values
    from app.config import settings_manager
    settings_manager.invalidate()
    await settings_manager.warm(session)

    # Reload Slack bot if any Slack credential changed
    if slack_changed and settings_manager.is_slack_configured():
        from app.slack.bot import reload_slack
        import asyncio
        asyncio.create_task(reload_slack())

    return {"updated": len(body.settings), "slack_reloaded": slack_changed}


# ── GET /admin/settings/slack-status ─────────────────────────────────────────


@router.get("/slack-status")
async def slack_status(
    current_user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Live Slack connectivity check using stored credentials."""
    import asyncio
    from app.config import settings_manager
    if not settings_manager.is_slack_configured():
        return {"ok": False, "error": "Slack is not configured"}
    try:
        from slack_sdk import WebClient
        token = await get_setting("slack_bot_token", session)
        client = WebClient(token=token)
        response = await asyncio.to_thread(client.auth_test)
        return {"ok": True, "team_name": response.get("team"), "bot_name": response.get("user")}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


# ── POST /admin/settings/test-slack ───────────────────────────────────────────

class TestSlackRequest(BaseModel):
    bot_token: str
    app_token: str


@router.post("/test-slack")
async def test_slack(
    body: TestSlackRequest,
    current_user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Test Slack credentials. If token looks masked/unchanged, use stored DB value."""
    import asyncio
    from slack_sdk import WebClient

    def _is_masked(val: str) -> bool:
        return not val or not val.startswith("xo")

    bot = body.bot_token if not _is_masked(body.bot_token) else await get_setting("slack_bot_token", session)
    if not bot:
        return {"ok": False, "error": "No bot token configured"}
    try:
        client = WebClient(token=bot)
        response = await asyncio.to_thread(client.auth_test)
        return {"ok": True, "team_name": response.get("team"), "bot_name": response.get("user")}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
