"""
Email channel settings — connect the Google Workspace mailbox (e.g. help@)
that SimpleTickets reads and sends from. See app/email/.

Admin:
  GET   /admin/email              connection status and settings
  PATCH /admin/email              client secret, sender name, pause/resume
  POST  /admin/email/connect      start Google's consent flow → {url}
  POST  /admin/email/disconnect   revoke and forget the grant
  POST  /admin/email/check        check the mailbox now

Public (Google redirects the admin's browser here; authorised by the
single-use state nonce, not a session):
  GET   /email/oauth/callback
"""
import logging
from typing import Optional
from urllib.parse import quote, urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require_admin
from app.database import get_session
from app.email import gmail as gmail_mod
from app.email.gmail import CALLBACK_PATH, GmailError
from app.models.user import User
from app.services.audit import write_audit
from app.services.rate_limit import RateLimiter
from app.services.settings_service import get_setting, set_setting
from app.utils import client_ip

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/email", tags=["admin"])
public_router = APIRouter(prefix="/email", tags=["email"])

_callback_limiter = RateLimiter(limit=20, window_seconds=60)
_check_limiter = RateLimiter(limit=6, window_seconds=60)


class EmailChannelRead(BaseModel):
    google_client_id_set: bool
    client_secret_set: bool
    connected: bool
    address: Optional[str]
    enabled: bool
    sender_name: str
    last_poll_at: Optional[str]
    last_error: Optional[str]
    # Whether Slack lets us match senders to Slack users: 'ok', 'missing_scope', or null (not tried yet)
    slack_lookup: Optional[str]


class EmailChannelUpdate(BaseModel):
    client_secret: Optional[str] = Field(default=None, max_length=500)
    sender_name: Optional[str] = Field(default=None, max_length=100)
    enabled: Optional[bool] = None


class ConnectRequest(BaseModel):
    redirect_uri: str = Field(max_length=500)


async def _read(session: AsyncSession) -> EmailChannelRead:
    address = await get_setting("gmail_address", session)
    connected = bool(address and await get_setting("gmail_refresh_token", session))
    return EmailChannelRead(
        google_client_id_set=bool((await get_setting("google_client_id", session)).strip()),
        client_secret_set=bool(await get_setting("gmail_client_secret", session)),
        connected=connected,
        address=address or None,
        enabled=connected and await get_setting("gmail_enabled", session) == "true",
        sender_name=await get_setting("gmail_sender_name", session, default="IT Support") or "IT Support",
        last_poll_at=await get_setting("gmail_last_poll_at", session) or None,
        last_error=await get_setting("gmail_last_error", session) or None,
        slack_lookup=await get_setting("email_slack_lookup", session) or None,
    )


@router.get("", response_model=EmailChannelRead)
async def get_email_channel(
    current_user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> EmailChannelRead:
    return await _read(session)


@router.patch("", response_model=EmailChannelRead)
async def update_email_channel(
    body: EmailChannelUpdate,
    request: Request,
    current_user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> EmailChannelRead:
    changed: list[str] = []
    if body.client_secret is not None and body.client_secret.strip():
        await set_setting("gmail_client_secret", body.client_secret.strip(), session)
        changed.append("client_secret")
    if body.sender_name is not None:
        await set_setting("gmail_sender_name", body.sender_name.strip() or "IT Support", session)
        changed.append("sender_name")
    if body.enabled is not None:
        if body.enabled and not await get_setting("gmail_refresh_token", session):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Connect the mailbox first.")
        await set_setting("gmail_enabled", "true" if body.enabled else "false", session)
        changed.append("enabled")
    if changed:
        await write_audit(
            session, actor_id=current_user.id, action="email_channel.updated",
            entity_type="settings", payload={"fields": changed, "enabled": body.enabled},
            ip_address=client_ip(request),
        )
        await session.commit()
    return await _read(session)


def _valid_redirect(uri: str) -> bool:
    parts = urlsplit(uri)
    local = parts.hostname in ("localhost", "127.0.0.1")
    return (
        (parts.scheme == "https" or (parts.scheme == "http" and local))
        and bool(parts.netloc)
        and parts.path == CALLBACK_PATH
        and not parts.query
        and not parts.fragment
        and parts.username is None
    )


@router.post("/connect")
async def connect_email_channel(
    body: ConnectRequest,
    current_user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if not _valid_redirect(body.redirect_uri):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid redirect URI.")
    try:
        url = await gmail_mod.start_oauth(session, user_id=current_user.id, redirect_uri=body.redirect_uri)
    except GmailError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.commit()
    return {"url": url}


@router.post("/disconnect", response_model=EmailChannelRead)
async def disconnect_email_channel(
    request: Request,
    current_user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> EmailChannelRead:
    address = await get_setting("gmail_address", session)
    await gmail_mod.disconnect(session)
    await write_audit(
        session, actor_id=current_user.id, action="email_channel.disconnected",
        entity_type="settings", payload={"address": address}, ip_address=client_ip(request),
    )
    await session.commit()
    return await _read(session)


@router.post("/check", response_model=EmailChannelRead)
async def check_email_channel(
    current_user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> EmailChannelRead:
    _check_limiter.check(str(current_user.id))
    from app.email.inbound import check_now
    await check_now()
    session.expire_all()
    return await _read(session)


def _back(**params: str) -> RedirectResponse:
    query = "&".join(f"{k}={quote(v)}" for k, v in params.items())
    return RedirectResponse(f"/admin/settings?tab=email&{query}", status_code=status.HTTP_303_SEE_OTHER)


@public_router.get("/oauth/callback", include_in_schema=False)
async def email_oauth_callback(
    request: Request,
    code: str = Query(default="", max_length=2000),
    state: str = Query(default="", max_length=200),
    error: str = Query(default="", max_length=200),
    session: AsyncSession = Depends(get_session),
) -> RedirectResponse:
    _callback_limiter.check(client_ip(request) or "unknown")
    try:
        data = await gmail_mod.consume_oauth_state(session, state)
        await session.commit()  # burn the nonce even if the rest fails
        if error:
            return _back(gmail_error="Google sign-in was cancelled.")
        if not code:
            raise GmailError("Google didn't return an authorisation code.")
        address = await gmail_mod.finish_oauth(session, code=code, redirect_uri=data["redirect_uri"])
        await write_audit(
            session, actor_id=data.get("user_id"), action="email_channel.connected",
            entity_type="settings", payload={"address": address}, ip_address=client_ip(request),
        )
        await session.commit()
    except GmailError as exc:
        await session.commit()
        return _back(gmail_error=str(exc))
    except Exception:  # noqa: BLE001
        logger.exception("Gmail OAuth callback failed")
        await session.rollback()
        return _back(gmail_error="Connecting the mailbox failed. See the server logs.")
    return _back(gmail="connected")
