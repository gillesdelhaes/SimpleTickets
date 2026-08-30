"""
Two-phase configuration:

Phase 1 — `settings` (pydantic-settings, reads from env/.env at import time).
  Used only for: DATABASE_URL, and fallback defaults for everything else.
  Never fails — all fields have defaults.

Phase 2 — `settings_manager` (SettingsManager, reads from app_settings DB table).
  DB values override env defaults at runtime.
  Cached in-process; re-warmed after any settings write (PATCH /admin/settings,
  setup, restore). Must be warmed in FastAPI lifespan before serving requests.
"""
import logging
import secrets

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # These two are never overridden from the DB
    app_secret_key: str = "dev-secret-change-in-production"
    database_url: str = "postgresql+asyncpg://postgres:postgres@db:5432/simpletickets"

    # Slack credentials live per-workspace in the slack_workspaces table (see
    # models.SlackWorkspace) — not here.
    storage_local_path: str = "/data/attachments"

    # Off by default — the interactive API docs enumerate every endpoint,
    # field name, and enum value unauthenticated. Set ENABLE_API_DOCS=true
    # to turn them back on for local development.
    enable_api_docs: bool = False


settings = Settings()


# ── Runtime settings manager ───────────────────────────────────────────────────

class SettingsManager:
    """
    Wraps the static Settings with a DB-backed override layer.
    Call warm() once at startup to pre-load all values into the in-process
    cache, and again after any settings write (PATCH /admin/settings, setup,
    restore) to pick up the new values.
    """

    def __init__(self) -> None:
        self._cache: dict[str, str] = {}

    async def warm(self, session) -> None:
        """(Re)load all settings into the cache. Replaces it atomically, so
        readers never observe a partially-loaded cache."""
        from app.services.settings_service import get_all_settings
        self._cache = await get_all_settings(session)
        logger.debug("Settings cache refreshed (%d keys)", len(self._cache))

    # ── Synchronous properties (read from cache only, no DB) ──────────────────
    # Used by JWT signing and other places where we cannot inject a session.
    # Safe after warm() has been called.

    @property
    def jwt_secret(self) -> str:
        return self._cache.get("jwt_secret") or settings.app_secret_key

    async def ensure_jwt_secret(self, session) -> None:
        """
        Ensure a strong JWT secret exists and is stored encrypted at rest.

        - Fresh install: generate one and persist it with is_secret=True.
        - Legacy install (row exists as plaintext, is_secret=False): re-encrypt
          the *same* value in place and flip is_secret, so the signing key is
          never stored or served in plaintext. Preserving the value keeps
          existing sessions valid across the upgrade.

        The signing key must never be readable as plaintext by callers other
        than the token codec — see the _READABLE_KEYS allowlist in
        routers/settings.py, which keeps it out of GET /admin/settings.
        """
        from app.dt import utcnow
        from app.models.app_setting import AppSetting
        from app.services.settings_service import encrypt_value

        row = await session.get(AppSetting, "jwt_secret")
        if row is not None and row.value:
            if not row.is_secret:
                plaintext = row.value
                row.is_secret = True
                row.value = encrypt_value(plaintext)
                row.updated_at = utcnow()
                try:
                    await session.commit()
                except Exception as exc:
                    await session.rollback()
                    raise RuntimeError(
                        f"Failed to migrate JWT secret to encrypted storage: {exc}."
                    ) from exc
                self._cache["jwt_secret"] = plaintext
                logger.info("Migrated JWT secret to encrypted-at-rest storage")
            return

        new_secret = secrets.token_hex(32)
        row = AppSetting(
            key="jwt_secret",
            value=encrypt_value(new_secret),
            is_secret=True,
            group_name="app",
            updated_at=utcnow(),
        )
        session.add(row)
        try:
            await session.commit()
        except Exception as exc:
            await session.rollback()
            raise RuntimeError(
                f"Failed to persist JWT secret to the database: {exc}. "
                "The application cannot start safely without a persistent JWT secret."
            ) from exc
        self._cache["jwt_secret"] = new_secret
        logger.info("Generated new JWT secret and persisted to DB (encrypted)")


settings_manager = SettingsManager()
