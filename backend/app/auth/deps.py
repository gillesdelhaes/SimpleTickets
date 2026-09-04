from datetime import datetime, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import decode_access_token
from app.database import get_session
from app.models import RevokedToken, Role, User

_bearer = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    session: AsyncSession = Depends(get_session),
) -> User:
    """Validate Bearer JWT and return the authenticated User row."""
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = int(payload["sub"])
        jti = payload.get("jti")
        iat = payload.get("iat")
    except (PyJWTError, KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if jti and await session.get(RevokedToken, jti) is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has been logged out",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer exists",
        )
    # Tokens issued before the user's last password change/reset are dead —
    # a stolen session must not survive the reset that was meant to kill it.
    # A token with no iat can't be placed relative to the cutoff: reject it.
    if user.tokens_valid_after is not None:
        issued_at = (
            datetime.fromtimestamp(iat, tz=timezone.utc).replace(tzinfo=None)
            if iat is not None else None
        )
        if issued_at is None or issued_at < user.tokens_valid_after:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired — please log in again",
                headers={"WWW-Authenticate": "Bearer"},
            )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled — contact your administrator",
        )

    return user


def require_roles(*roles: Role):
    """
    Dependency factory. Returns a dependency that checks the user's role.

    Usage:
        require_technician = require_roles(Role.technician, Role.admin)

        @router.get("/queue")
        async def queue(user: User = Depends(require_technician)):
            ...
    """

    async def _check(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action",
            )
        return user

    return _check


# Pre-built role dependencies imported by every router that needs them
require_technician = require_roles(Role.technician, Role.admin)
require_admin = require_roles(Role.admin)
