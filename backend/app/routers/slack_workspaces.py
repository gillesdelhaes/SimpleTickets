"""
Slack workspace connections — admin CRUD, plus a lightweight listing for
any authenticated user.

Admin (secrets masked in responses, never round-tripped):
  GET    /admin/slack-workspaces            list all connections
  POST   /admin/slack-workspaces            create a new connection
  PATCH  /admin/slack-workspaces/{id}       partial update (only fields sent)
  POST   /admin/slack-workspaces/test       test unsaved credentials
  POST   /admin/slack-workspaces/{id}/test  test a saved connection's credentials

Any authenticated user (technicians included — powers the reporter-workspace
picker and the per-workspace Slack ID linker):
  GET    /slack/workspaces                  [{id, name}] for active workspaces
"""
import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, require_admin
from app.database import get_session
from app.dt import utcnow
from app.models.slack_workspace import SlackWorkspace
from app.models.user import User
from app.services.audit import write_audit
from app.services.settings_service import decrypt_value, encrypt_value
from app.slack.service import slack_test_error_message
from app.utils import client_ip

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/slack-workspaces", tags=["admin"])
public_router = APIRouter(prefix="/slack", tags=["slack"])


# ── Schemas ──────────────────────────────────────────────────────────────────


class WorkspaceRead(BaseModel):
    id: int
    name: str
    team_id: Optional[str]
    team_name: Optional[str]
    bot_token: Optional[str]        # masked
    app_token: Optional[str]        # masked
    signing_secret: Optional[str]   # masked
    trigger_emoji: str
    two_way_sync: bool
    sla_escalation_target: Optional[str]
    ticket_created_target: Optional[str]
    is_active: bool
    online: bool


class WorkspaceCreate(BaseModel):
    name: str
    bot_token: str
    app_token: str
    signing_secret: str = ""
    trigger_emoji: str = "clipboard"
    two_way_sync: bool = True
    sla_escalation_target: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name cannot be blank")
        return v

    @field_validator("bot_token", "app_token")
    @classmethod
    def token_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Required")
        return v


class WorkspaceUpdate(BaseModel):
    """All fields optional — only fields present in the request body are applied."""
    name: Optional[str] = None
    bot_token: Optional[str] = None
    app_token: Optional[str] = None
    signing_secret: Optional[str] = None
    trigger_emoji: Optional[str] = None
    two_way_sync: Optional[bool] = None
    sla_escalation_target: Optional[str] = None
    ticket_created_target: Optional[str] = None
    is_active: Optional[bool] = None


class TestNewRequest(BaseModel):
    bot_token: str


class TestTargetRequest(BaseModel):
    target: str


class WorkspaceOption(BaseModel):
    id: int
    name: str


def _mask(value: str) -> Optional[str]:
    return "••••••••" if value else None


async def _to_read(workspace: SlackWorkspace) -> WorkspaceRead:
    from app.slack.bot import is_slack_online
    return WorkspaceRead(
        id=workspace.id,
        name=workspace.name,
        team_id=workspace.team_id,
        team_name=workspace.team_name,
        bot_token=_mask(workspace.bot_token),
        app_token=_mask(workspace.app_token),
        signing_secret=_mask(workspace.signing_secret),
        trigger_emoji=workspace.trigger_emoji,
        two_way_sync=workspace.two_way_sync,
        sla_escalation_target=workspace.sla_escalation_target,
        ticket_created_target=workspace.ticket_created_target,
        is_active=workspace.is_active,
        online=await is_slack_online(workspace.id),
    )


# ── GET /admin/slack-workspaces ────────────────────────────────────────────────


@router.get("", response_model=list[WorkspaceRead])
async def list_workspaces(
    current_user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> list[WorkspaceRead]:
    rows = (await session.execute(
        select(SlackWorkspace).order_by(SlackWorkspace.created_at)
    )).scalars().all()
    return [await _to_read(w) for w in rows]


# ── POST /admin/slack-workspaces ───────────────────────────────────────────────


@router.post("", response_model=WorkspaceRead, status_code=status.HTTP_201_CREATED)
async def create_workspace(
    body: WorkspaceCreate,
    request: Request,
    current_user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> WorkspaceRead:
    try:
        from slack_sdk import WebClient
        client = WebClient(token=body.bot_token)
        auth = await asyncio.to_thread(client.auth_test)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Could not connect to Slack with that bot token: {exc}",
        )

    team_id = auth.get("team_id")
    team_name = auth.get("team")

    if team_id:
        existing = (await session.execute(
            select(SlackWorkspace).where(
                SlackWorkspace.team_id == team_id,
                SlackWorkspace.is_active == True,  # noqa: E712
            )
        )).scalar_one_or_none()
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f'This Slack workspace is already connected as "{existing.name}"',
            )

    now = utcnow()
    workspace = SlackWorkspace(
        name=body.name,
        team_id=team_id,
        team_name=team_name,
        bot_token=encrypt_value(body.bot_token),
        app_token=encrypt_value(body.app_token),
        signing_secret=encrypt_value(body.signing_secret) if body.signing_secret else "",
        trigger_emoji=(body.trigger_emoji or "clipboard").strip() or "clipboard",
        two_way_sync=body.two_way_sync,
        sla_escalation_target=body.sla_escalation_target or None,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    session.add(workspace)
    await session.flush()

    await write_audit(
        session,
        actor_id=current_user.id,
        action="slack_workspace.created",
        entity_type="slack_workspace",
        entity_id=str(workspace.id),
        payload={"name": workspace.name, "team_name": team_name},
        ip_address=client_ip(request),
    )
    await session.commit()
    await session.refresh(workspace)

    from app.slack.bot import reload_slack
    asyncio.create_task(reload_slack(workspace.id))

    return await _to_read(workspace)


# ── PATCH /admin/slack-workspaces/{id} ─────────────────────────────────────────


@router.patch("/{workspace_id}", response_model=WorkspaceRead)
async def update_workspace(
    workspace_id: int,
    body: WorkspaceUpdate,
    request: Request,
    current_user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> WorkspaceRead:
    workspace = await session.get(SlackWorkspace, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")

    provided = body.model_fields_set
    if not provided:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No fields provided")

    changes: dict = {}
    # A stale in-process bot only picks up trigger_emoji/token changes on
    # restart (two_way_sync / sla_escalation_target are re-read from the DB
    # on every use, so they don't need one).
    needs_reload = False

    if "name" in provided and body.name is not None:
        new_name = body.name.strip()
        if not new_name:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Name cannot be blank")
        if new_name != workspace.name:
            changes["name"] = {"from": workspace.name, "to": new_name}
            workspace.name = new_name

    if "bot_token" in provided and body.bot_token:
        workspace.bot_token = encrypt_value(body.bot_token)
        changes["bot_token"] = "updated"
        needs_reload = True

    if "app_token" in provided and body.app_token:
        workspace.app_token = encrypt_value(body.app_token)
        changes["app_token"] = "updated"
        needs_reload = True

    if "signing_secret" in provided:
        workspace.signing_secret = encrypt_value(body.signing_secret) if body.signing_secret else ""
        changes["signing_secret"] = "updated"
        needs_reload = True

    if "trigger_emoji" in provided:
        new_emoji = (body.trigger_emoji or "").strip()
        if not new_emoji:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Trigger emoji cannot be empty")
        if new_emoji != workspace.trigger_emoji:
            changes["trigger_emoji"] = {"from": workspace.trigger_emoji, "to": new_emoji}
            workspace.trigger_emoji = new_emoji
            needs_reload = True

    if "two_way_sync" in provided and body.two_way_sync is not None:
        if body.two_way_sync != workspace.two_way_sync:
            changes["two_way_sync"] = {"from": workspace.two_way_sync, "to": body.two_way_sync}
            workspace.two_way_sync = body.two_way_sync

    if "sla_escalation_target" in provided:
        new_target = body.sla_escalation_target or None
        if new_target != workspace.sla_escalation_target:
            changes["sla_escalation_target"] = {"from": workspace.sla_escalation_target, "to": new_target}
            workspace.sla_escalation_target = new_target

    if "ticket_created_target" in provided:
        new_notify_target = body.ticket_created_target or None
        if new_notify_target != workspace.ticket_created_target:
            changes["ticket_created_target"] = {"from": workspace.ticket_created_target, "to": new_notify_target}
            workspace.ticket_created_target = new_notify_target

    if "is_active" in provided and body.is_active is not None:
        if body.is_active != workspace.is_active:
            changes["is_active"] = {"from": workspace.is_active, "to": body.is_active}
            workspace.is_active = body.is_active
            needs_reload = True

    if not changes:
        return await _to_read(workspace)

    workspace.updated_at = utcnow()
    await write_audit(
        session,
        actor_id=current_user.id,
        action="slack_workspace.updated",
        entity_type="slack_workspace",
        entity_id=str(workspace_id),
        payload={"keys": sorted(changes.keys())},
        ip_address=client_ip(request),
    )
    await session.commit()
    await session.refresh(workspace)

    if needs_reload:
        from app.slack.bot import reload_slack
        asyncio.create_task(reload_slack(workspace_id))

    return await _to_read(workspace)


# ── Test connection ─────────────────────────────────────────────────────────────


@router.post("/test")
async def test_new_workspace(
    body: TestNewRequest,
    current_user: User = Depends(require_admin),
) -> dict:
    """Test unsaved credentials, e.g. while filling in the 'add workspace' form."""
    try:
        from slack_sdk import WebClient
        client = WebClient(token=body.bot_token)
        response = await asyncio.to_thread(client.auth_test)
        return {"ok": True, "team_name": response.get("team"), "bot_name": response.get("user")}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": slack_test_error_message(exc)}


@router.post("/{workspace_id}/test")
async def test_existing_workspace(
    workspace_id: int,
    current_user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Live connectivity check using a saved workspace's stored credentials."""
    workspace = await session.get(SlackWorkspace, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    if not workspace.bot_token:
        return {"ok": False, "error": "No bot token configured"}
    try:
        from slack_sdk import WebClient
        client = WebClient(token=decrypt_value(workspace.bot_token))
        response = await asyncio.to_thread(client.auth_test)
        return {"ok": True, "team_name": response.get("team"), "bot_name": response.get("user")}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": slack_test_error_message(exc)}


@router.post("/{workspace_id}/test-target")
async def test_notification_target(
    workspace_id: int,
    body: TestTargetRequest,
    current_user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """
    Send a real test message to a channel/user ID before it's relied on for
    SLA escalations or new-ticket announcements — this is the fix for the
    known gap where a wrong or private channel ID only ever failed silently
    in the logs, 15 minutes before a real SLA breach. Tests the raw string
    passed in, not necessarily what's saved yet, so an admin can validate
    before hitting Save.
    """
    workspace = await session.get(SlackWorkspace, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    if not workspace.bot_token:
        return {"ok": False, "error": "No bot token configured"}
    target = body.target.strip()
    if not target:
        return {"ok": False, "error": "No target given"}
    try:
        from slack_sdk import WebClient
        client = WebClient(token=decrypt_value(workspace.bot_token))
        await asyncio.to_thread(
            client.chat_postMessage,
            channel=target,
            text="✅ SimpleTickets test message — this target is configured correctly.",
        )
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": slack_test_error_message(exc)}


# ── GET /slack/workspaces — lightweight, any authenticated user ────────────────


@public_router.get("/workspaces", response_model=list[WorkspaceOption])
async def list_workspace_options(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[WorkspaceOption]:
    rows = (await session.execute(
        select(SlackWorkspace.id, SlackWorkspace.name)
        .where(SlackWorkspace.is_active == True)  # noqa: E712
        .order_by(SlackWorkspace.name)
    )).all()
    return [WorkspaceOption(id=r[0], name=r[1]) for r in rows]
