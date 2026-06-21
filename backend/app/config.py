"""
Two-phase configuration:

Phase 1 — `settings` (pydantic-settings, reads from env/.env at import time).
  Used only for: DATABASE_URL, and fallback defaults for everything else.
  Never fails — all fields have defaults.

Phase 2 — `settings_manager` (SettingsManager, reads from app_settings DB table).
  DB values override env defaults at runtime.
  Cache TTL: 30 seconds. Invalidated immediately after any PATCH /admin/settings.
  Must be warmed in FastAPI lifespan before serving requests.
"""
import logging
import secrets
import time
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # These two are never overridden from the DB
    app_secret_key: str = "dev-secret-change-in-production"
    database_url: str = "postgresql+asyncpg://postgres:postgres@db:5432/simpletickets"

    # All other fields serve as defaults when the DB has no value
    slack_bot_token: str = ""
    slack_signing_secret: str = ""
    slack_app_token: str = ""
    slack_trigger_emoji: str = "clipboard"
    slack_two_way_sync: bool = True
    storage_local_path: str = "/data/attachments"


settings = Settings()


# ── Runtime settings manager ───────────────────────────────────────────────────

class SettingsManager:
    """
    Wraps the static Settings with a DB-backed override layer.
    Call warm() once at startup to pre-load all values into the in-process cache.
    """

    def __init__(self) -> None:
        self._cache: dict[str, str] = {}
        self._cache_at: float = 0.0
        self._TTL: float = 30.0

    def invalidate(self) -> None:
        """Force a full cache reload on next access."""
        self._cache_at = 0.0

    async def warm(self, session) -> None:
        """Pre-load all settings into cache. Call from lifespan startup."""
        await self._refresh(session)

    async def _refresh(self, session) -> None:
        from app.services.settings_service import get_all_settings
        self._cache = await get_all_settings(session)
        self._cache_at = time.monotonic()
        logger.debug("Settings cache refreshed (%d keys)", len(self._cache))

    async def _ensure_fresh(self, session) -> None:
        if time.monotonic() - self._cache_at > self._TTL:
            await self._refresh(session)

    async def get(self, key: str, session, default: str = "") -> str:
        await self._ensure_fresh(session)
        return self._cache.get(key) or default

    # ── Synchronous properties (read from cache only, no DB) ──────────────────
    # Used by JWT signing and other places where we cannot inject a session.
    # Safe after warm() has been called.

    @property
    def secret_key(self) -> str:
        # Always prefer the live env value (set by bootstrap) over the cache
        return settings.app_secret_key

    @property
    def slack_bot_token(self) -> str:
        return self._cache.get("slack_bot_token") or settings.slack_bot_token

    @property
    def slack_app_token(self) -> str:
        return self._cache.get("slack_app_token") or settings.slack_app_token

    @property
    def slack_signing_secret(self) -> str:
        return self._cache.get("slack_signing_secret") or settings.slack_signing_secret

    @property
    def slack_trigger_emoji(self) -> str:
        return self._cache.get("slack_trigger_emoji") or settings.slack_trigger_emoji

    @property
    def slack_two_way_sync(self) -> bool:
        v = self._cache.get("slack_two_way_sync")
        if v is not None:
            return v.lower() not in ("false", "0", "no")
        return settings.slack_two_way_sync

    @property
    def jwt_secret(self) -> str:
        return self._cache.get("jwt_secret") or settings.app_secret_key

    async def ensure_jwt_secret(self, session) -> None:
        """Generate and persist a strong JWT secret on first boot if not already set."""
        if self._cache.get("jwt_secret"):
            return
        from app.services.settings_service import set_setting
        new_secret = secrets.token_hex(32)
        try:
            await set_setting("jwt_secret", new_secret, session)
            await session.commit()
        except Exception as exc:
            raise RuntimeError(
                f"Failed to persist JWT secret to the database: {exc}. "
                "The application cannot start safely without a persistent JWT secret."
            ) from exc
        self._cache["jwt_secret"] = new_secret
        logger.info("Generated new JWT secret and persisted to DB")

    def is_slack_configured(self) -> bool:
        return bool(self.slack_bot_token and self.slack_app_token)


settings_manager = SettingsManager()
