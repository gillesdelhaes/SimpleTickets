import logging
import secrets
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from app.config import settings_manager

logger = logging.getLogger(__name__)

_ALGORITHM = "HS256"
_EXPIRE_HOURS = 8


def create_access_token(user_id: int, email: str, role: str, name: str = "") -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "email": email,
        "role": role,
        "name": name,
        "iat": now,
        "exp": now + timedelta(hours=_EXPIRE_HOURS),
        "jti": secrets.token_hex(16),
    }
    return jwt.encode(payload, settings_manager.jwt_secret, algorithm=_ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Decode and verify a JWT. Raises jose.JWTError on failure."""
    return jwt.decode(token, settings_manager.jwt_secret, algorithms=[_ALGORITHM])


async def prune_revoked_tokens() -> None:
    """Delete revoked-token rows past their own expiry — safe to drop since
    an expired JWT is already rejected on signature/exp grounds alone."""
    from sqlalchemy import delete

    from app.database import AsyncSessionLocal
    from app.models import RevokedToken
    from app.utils import utcnow

    async with AsyncSessionLocal() as session:
        try:
            result = await session.execute(
                delete(RevokedToken).where(RevokedToken.expires_at < utcnow())
            )
            await session.commit()
            if result.rowcount:
                logger.debug("Pruned %d expired revoked-token row(s)", result.rowcount)
        except Exception:
            logger.exception("Failed to prune revoked tokens")
            await session.rollback()
