"""
DB-backed settings service.

Global app configuration (except DATABASE_URL) is stored in the app_settings
table — Slack workspace credentials live per-row in slack_workspaces instead
(see models.SlackWorkspace), but reuse encrypt_value/decrypt_value from here.
Sensitive values are encrypted with Fernet using a key derived from
APP_SECRET_KEY. That master key itself is never stored in the database —
it's the key that decrypts everything else here, so keeping it in the same
place would defeat the point. See app/bootstrap.py for where it lives.

Usage:
    from app.services.settings_service import get_setting, set_setting

    tz = await get_setting("timezone", session, default="UTC")
    await set_setting("timezone", "America/New_York", session)
"""
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


# ── Which settings are secret ──────────────────────────────────────────────────
#
# Known here, not only on the row: a row can go missing (a restore truncates
# app_settings and backups never carry these), and set_setting used to
# re-create it as plaintext. Key → settings group, for a re-created row.
SECRET_SETTINGS: dict[str, str] = {
    "jwt_secret": "app",
    "gmail_client_secret": "email",
    "gmail_refresh_token": "email",
    "ai_api_key": "ai",
}


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
        row = AppSetting(key=key, is_secret=key in SECRET_SETTINGS, group_name=SECRET_SETTINGS.get(key, "app"))
        session.add(row)
    elif key in SECRET_SETTINGS and not row.is_secret:
        row.is_secret = True  # a row left plaintext by an older restore

    stored = encrypt_value(value) if row.is_secret else value
    row.value = stored
    row.updated_at = utcnow()
    # No commit here — caller owns the transaction


async def encrypt_plaintext_secrets(session: AsyncSession) -> list[str]:
    """Encrypt secret settings stored as plaintext — left that way by a
    restore before set_setting knew which keys are secret. Run at startup;
    values are kept, so nothing needs re-entering. Returns the keys fixed."""
    rows = (await session.execute(
        select(AppSetting).where(AppSetting.key.in_(SECRET_SETTINGS), AppSetting.is_secret == False)  # noqa: E712
    )).scalars().all()
    for row in rows:
        if row.value is not None:
            row.value = encrypt_value(row.value)
        row.is_secret = True
        row.updated_at = utcnow()
    if rows:
        await session.commit()
        logger.warning("Encrypted secret settings stored as plaintext: %s", ", ".join(r.key for r in rows))
    return [r.key for r in rows]


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
    from sqlalchemy import func
    from sqlmodel import select as sel
    from app.models.user import User
    from app.models.enums import Role
    result = await session.execute(
        sel(func.count()).select_from(User).where(
            User.role == Role.admin, User.is_active == True  # noqa: E712
        )
    )
    return (result.scalar_one() or 0) > 0
