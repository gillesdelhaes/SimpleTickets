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

# ── Simple in-memory rate limiter ─────────────────────────────────────────────
# 10 attempts per IP per 60 seconds. Resets automatically as the window slides.

_attempts: dict[str, list[float]] = defaultdict(list)
_LIMIT = 10
_WINDOW = 60.0


def _check_rate_limit(ip: str) -> None:
    now = monotonic()
    _attempts[ip] = [t for t in _attempts[ip] if now - t < _WINDOW]
    if len(_attempts[ip]) >= _LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts — please wait a minute and try again.",
        )
    _attempts[ip].append(now)


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    """Authenticate with email + password. Returns a Bearer JWT."""
    _check_rate_limit(request.client.host if request.client else "unknown")

    result = await session.execute(
        select(User).where(User.email == body.email.lower())
    )
    user = result.scalar_one_or_none()

    _invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid email or password",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if user is None:
        raise _invalid
    if not user.hashed_password or not verify_password(body.password, user.hashed_password):
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
    _check_rate_limit(request.client.host if request.client else "unknown")
    if not body.new_password or len(body.new_password) < 8:
        raise HTTPException(status_code=422, detail="New password must be at least 8 characters")
    if not current_user.hashed_password or not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    current_user.hashed_password = hash_password(body.new_password)
    await session.commit()
