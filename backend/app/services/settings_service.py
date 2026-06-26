"""
DB-backed settings service.

All app configuration (except DATABASE_URL) is stored in the app_settings
table. Sensitive values are encrypted with Fernet using a key derived from
APP_SECRET_KEY. The app_secret_key row itself is stored plaintext — it IS
the encryption key, so encrypting it with itself is circular.

Usage:
    from app.services.settings_service import get_setting, set_setting

    bot_token = await get_setting("slack_bot_token", session)
    await set_setting("slack_bot_token", "xoxb-...", session)
"""
from __future__ import annotations

import base64
import hashlib
import logging
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.app_setting import AppSetting
from app.utils import utcnow

logger = logging.getLogger(__name__)

# ── Encryption helpers ─────────────────────────────────────────────────────────

_fernet_instance: Optional[Fernet] = None


def _fernet() -> Fernet:
    global _fernet_instance
    if _fernet_instance is None:
        raw = settings.app_secret_key.encode()
        key = base64.urlsafe_b64encode(hashlib.sha256(raw).digest())
        _fernet_instance = Fernet(key)
    return _fernet_instance




def encrypt_value(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_value(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except (InvalidToken, Exception):
        logger.warning("Failed to decrypt settings value — returning empty string")
        return ""


# ── CRUD ───────────────────────────────────────────────────────────────────────


async def get_setting(key: str, session: AsyncSession, default: str = "") -> str:
    """
    Return the decrypted value for a settings key.
    Falls back to `default` if the row is missing or value is NULL.
    """
    row = await session.get(AppSetting, key)
    if row is None or row.value is None:
        return default
    if row.is_secret:
        return decrypt_value(row.value)
    return row.value


async def set_setting(key: str, value: str, session: AsyncSession) -> None:
    """
    Persist a setting value, encrypting if the row is marked is_secret.
    Creates the row if it does not exist (upsert).
    """
    row = await session.get(AppSetting, key)
    if row is None:
        # Create with sensible defaults — caller must ensure key is known
        row = AppSetting(key=key, is_secret=False, group_name="app")
        session.add(row)

    stored = encrypt_value(value) if row.is_secret else value
    row.value = stored
    row.updated_at = utcnow()
    # No commit here — caller owns the transaction


async def get_all_settings(session: AsyncSession) -> dict[str, str]:
    """Return all settings as a key→plaintext dict (secrets decrypted)."""
    result = await session.execute(select(AppSetting))
    rows = result.scalars().all()
    out: dict[str, str] = {}
    for row in rows:
        if row.value is None:
            out[row.key] = ""
        elif row.is_secret:
            out[row.key] = decrypt_value(row.value)
        else:
            out[row.key] = row.value
    return out


async def is_setup_complete(session: AsyncSession) -> bool:
    row = await session.get(AppSetting, "setup_complete")
    return row is not None and row.value == "true"


async def has_any_admin(session: AsyncSession) -> bool:
    from sqlmodel import select as sel
    from app.models.user import User
    from app.models.enums import Role
    result = await session.execute(
        sel(User).where(User.role == Role.admin, User.is_active == True)  # noqa: E712
    )
    return result.scalar_one_or_none() is not None
