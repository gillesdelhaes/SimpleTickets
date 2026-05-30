from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.deps import get_current_user
from app.auth.jwt import create_access_token
from app.database import get_session
from app.models import User
from app.schemas.auth import LoginRequest, TokenResponse
from app.services.passwords import verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    """Authenticate with email + password. Returns a Bearer JWT."""
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


@router.get("/me")
async def get_me(current_user: User = Depends(get_current_user)) -> dict:
    """Return the profile of the currently authenticated user."""
    return {
        "id": current_user.id,
        "email": current_user.email,
        "name": current_user.name,
        "avatar_url": current_user.avatar_url,
        "role": current_user.role,
        "auth_provider": current_user.auth_provider,
        "created_at": current_user.created_at,
        "last_login_at": current_user.last_login_at,
    }


@router.post("/logout")
async def logout() -> dict:
    """JWT is stateless — token removal is handled client-side."""
    return {"message": "Logged out"}
