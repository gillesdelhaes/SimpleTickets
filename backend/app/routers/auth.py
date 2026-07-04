from collections import defaultdict
from datetime import datetime, timezone
from time import monotonic

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from pydantic import BaseModel

from app.auth.deps import get_current_user
from app.auth.jwt import create_access_token
from app.database import get_session
from app.models import User
from app.schemas.auth import LoginRequest, TokenResponse
from app.services.passwords import hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

# Precomputed bcrypt hash used to equalize login timing when the email doesn't
# exist (or has no password), so response time doesn't reveal which emails are
# registered. The value never matches any real password.
_DUMMY_PASSWORD_HASH = hash_password("account-enumeration-timing-equalizer")

# ── Simple in-memory rate limiter ─────────────────────────────────────────────
# 10 attempts per IP per 60 seconds. Resets automatically as the window slides.

_attempts: dict[str, list[float]] = defaultdict(list)
_LIMIT = 10
_WINDOW = 60.0
_MAX_TRACKED_IPS = 10_000  # bound memory: rotating/spoofed IPs can't grow the map forever


def _client_ip(request: Request) -> str:
    # Behind nginx the TCP peer is always the proxy, so we need X-Real-IP (set from
    # $remote_addr) for per-client limiting. api:8000 is not published and only the
    # proxy is on its network, so a spoofed header requires already being inside the
    # internal network. Take a single trimmed token and fall back to the TCP peer.
    header = (request.headers.get("X-Real-IP") or "").split(",")[0].strip()
    if header:
        return header[:64]
    return request.client.host if request.client else "unknown"


def _check_rate_limit(ip: str) -> None:
    now = monotonic()
    recent = [t for t in _attempts.get(ip, ()) if now - t < _WINDOW]

    # Opportunistically evict stale buckets so the map can't grow without bound.
    if len(_attempts) > _MAX_TRACKED_IPS:
        for stale in [k for k, v in _attempts.items() if not v or now - v[-1] >= _WINDOW]:
            del _attempts[stale]

    if len(recent) >= _LIMIT:
        _attempts[ip] = recent
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts — please wait a minute and try again.",
        )
    recent.append(now)
    _attempts[ip] = recent


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    """Authenticate with email + password. Returns a Bearer JWT."""
    _check_rate_limit(_client_ip(request))

    result = await session.execute(
        select(User).where(User.email == body.email.lower())
    )
    user = result.scalar_one_or_none()

    _invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid email or password",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if user is None or not user.hashed_password:
        # Run a verify against a dummy hash so a missing account costs the same
        # ~bcrypt time as a wrong password for a real one (no timing oracle).
        verify_password(body.password, _DUMMY_PASSWORD_HASH)
        raise _invalid
    if not verify_password(body.password, user.hashed_password):
        raise _invalid
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled — contact your administrator",
        )

    user.last_login_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await session.commit()

    return TokenResponse(
        access_token=create_access_token(user.id, user.email, user.role.value, user.name or "")
    )



class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: ChangePasswordRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Change the authenticated user's own password."""
    _check_rate_limit(_client_ip(request))
    if not body.new_password or len(body.new_password) < 8:
        raise HTTPException(status_code=422, detail="New password must be at least 8 characters")
    if not current_user.hashed_password or not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    current_user.hashed_password = hash_password(body.new_password)
    await session.commit()
