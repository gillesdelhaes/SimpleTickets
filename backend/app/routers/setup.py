"""
First-run setup endpoints — no authentication required.
All endpoints return 403 once setup_complete=true.

POST /api/setup/admin        — create the first admin account
POST /api/setup/slack        — persist Slack credentials
POST /api/setup/test-slack   — verify Slack tokens without persisting
POST /api/setup/complete     — mark setup done, start Slack bot
GET  /api/setup/status       — unauthenticated; used by frontend to gate the wizard
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.enums import AuthProvider, Role
from app.models.user import User
from app.services.passwords import hash_password
from app.services.settings_service import (
    has_any_admin,
    is_setup_complete,
    set_setting,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/setup", tags=["setup"])


# ── Guard ──────────────────────────────────────────────────────────────────────

async def _require_setup_incomplete(session: AsyncSession = Depends(get_session)):
    if await is_setup_complete(session):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Setup has already been completed",
        )
    return session


# ── GET /setup/status ──────────────────────────────────────────────────────────

@router.get("/status")
async def setup_status(session: AsyncSession = Depends(get_session)) -> dict:
    """Unauthenticated. Returns setup state so the frontend knows what to render."""
    return {
        "setup_complete": await is_setup_complete(session),
        "has_admin": await has_any_admin(session),
    }


# ── POST /setup/admin ──────────────────────────────────────────────────────────

class AdminSetupRequest(BaseModel):
    name: str
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v

    @field_validator("name")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name cannot be blank")
        return v.strip()


@router.post("/admin", status_code=status.HTTP_201_CREATED)
async def setup_admin(
    body: AdminSetupRequest,
    session: AsyncSession = Depends(_require_setup_incomplete),
) -> dict:
    """Create the first admin account."""
    from sqlmodel import select
    existing = (await session.execute(
        select(User).where(User.email == body.email.lower())
    )).scalar_one_or_none()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with that email already exists",
        )

    from datetime import datetime, timezone
    user = User(
        email=body.email.lower(),
        name=body.name.strip(),
        role=Role.admin,
        auth_provider=AuthProvider.local,
        hashed_password=hash_password(body.password),
        is_active=True,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    session.add(user)
    await session.commit()
    logger.info("Setup: first admin account created (%s)", user.email)
    return {"success": True, "email": user.email}


# ── POST /setup/test-slack ─────────────────────────────────────────────────────

class TestSlackRequest(BaseModel):
    bot_token: str
    app_token: str


@router.post("/test-slack")
async def test_slack(
    body: TestSlackRequest,
    session: AsyncSession = Depends(_require_setup_incomplete),
) -> dict:
    """Verify Slack tokens during the setup wizard. Blocked once setup is complete."""
    import asyncio
    try:
        from slack_sdk import WebClient
        client = WebClient(token=body.bot_token)
        response = await asyncio.to_thread(client.auth_test)
        return {
            "ok": True,
            "team_name": response.get("team"),
            "bot_name": response.get("user"),
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


# ── POST /setup/slack ──────────────────────────────────────────────────────────

class SlackSetupRequest(BaseModel):
    bot_token: str
    app_token: str
    signing_secret: str = ""
    trigger_emoji: str = "clipboard"
    two_way_sync: bool = True


@router.post("/slack")
async def setup_slack(
    body: SlackSetupRequest,
    session: AsyncSession = Depends(_require_setup_incomplete),
) -> dict:
    """Persist Slack credentials to app_settings."""
    await set_setting("slack_bot_token",      body.bot_token,                                session)
    await set_setting("slack_app_token",      body.app_token,                                session)
    await set_setting("slack_signing_secret", body.signing_secret,                           session)
    await set_setting("slack_trigger_emoji",  body.trigger_emoji,                            session)
    await set_setting("slack_two_way_sync",   "true" if body.two_way_sync else "false",      session)
    await session.commit()
    logger.info("Setup: Slack settings saved")
    return {"success": True}


# ── POST /setup/complete ───────────────────────────────────────────────────────

@router.post("/complete")
async def setup_complete(
    session: AsyncSession = Depends(_require_setup_incomplete),
) -> dict:
    """
    Mark setup as done. Starts the Slack bot with the saved credentials.
    Redirects to /login on the frontend.
    """
    if not await has_any_admin(session):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot complete setup without at least one admin account",
        )

    await set_setting("setup_complete", "true", session)
    await session.commit()

    # Warm the settings cache then start Slack (fire-and-forget; don't block the response)
    from app.config import settings_manager
    from app.slack.bot import reload_slack
    import asyncio

    settings_manager.invalidate()
    # Refresh cache synchronously with this session before reloading Slack
    await settings_manager.warm(session)
    asyncio.create_task(reload_slack())

    logger.info("Setup complete — Slack bot starting")
    return {"success": True}
