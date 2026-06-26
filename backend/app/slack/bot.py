"""
Slack Bolt integration.

Uses Socket Mode (SLACK_APP_TOKEN = xapp-…) — no public inbound webhook needed.

Lifecycle:
  start_slack()  — called in FastAPI lifespan startup (no-op if tokens missing).
  stop_slack()   — called in FastAPI lifespan shutdown.
  reload_slack() — called after Slack settings change; stops and restarts the bot.
"""
from __future__ import annotations

import asyncio
import logging

from app.config import settings_manager

logger = logging.getLogger(__name__)

_slack_app = None
_socket_handler = None
_socket_task: asyncio.Task | None = None


def create_app():
    """Create and return a configured AsyncApp, or None if tokens are missing."""
    if not settings_manager.is_slack_configured():
        logger.info("Slack integration disabled — configure tokens in Settings to enable.")
        return None

    try:
        from slack_bolt.async_app import AsyncApp
        from app.slack.handlers import register_handlers

        app = AsyncApp(
            token=settings_manager.slack_bot_token,
            signing_secret=settings_manager.slack_signing_secret or None,
            process_before_response=True,
        )
        register_handlers(app)
        logger.info("Slack AsyncApp created (trigger_emoji=%r)", settings_manager.slack_trigger_emoji)
        return app

    except ImportError:
        logger.error("slack-bolt is not installed — Slack integration unavailable.")
        return None
    except Exception:  # noqa: BLE001
        logger.exception("Failed to create Slack app.")
        return None


async def start_slack() -> None:
    """Start the Slack Socket Mode handler as a background task."""
    global _slack_app, _socket_handler, _socket_task

    app = create_app()
    if app is None:
        return

    try:
        from slack_bolt.adapter.socket_mode.async_handler import AsyncSocketModeHandler

        _slack_app = app
        _socket_handler = AsyncSocketModeHandler(app, settings_manager.slack_app_token)
        # start_async() blocks until disconnected — run it as a background task
        _socket_task = asyncio.create_task(_socket_handler.start_async())
        logger.info("Slack Socket Mode handler started in background.")
    except Exception:  # noqa: BLE001
        logger.exception("Slack Socket Mode handler failed to start.")
        _slack_app = None
        _socket_handler = None
        _socket_task = None


async def stop_slack() -> None:
    """Cleanly disconnect the Slack Socket Mode handler."""
    global _slack_app, _socket_handler, _socket_task
    if _socket_handler is not None:
        try:
            await _socket_handler.close_async()
            logger.info("Slack Socket Mode handler disconnected.")
        except Exception:  # noqa: BLE001
            logger.exception("Error closing Slack Socket Mode handler.")
        finally:
            _socket_handler = None
            _slack_app = None
    if _socket_task is not None:
        _socket_task.cancel()
        _socket_task = None


async def reload_slack() -> None:
    """Stop the current bot and restart with freshly cached credentials."""
    logger.info("Reloading Slack integration with updated credentials...")
    await stop_slack()
    await start_slack()


def is_slack_online() -> bool:
    """True if the Socket Mode handler is running and its task is alive."""
    return (
        _socket_handler is not None
        and _socket_task is not None
        and not _socket_task.done()
    )


def get_slack_client():
    """Return the Slack AsyncWebClient if the bot is running, else None."""
    if _slack_app is not None:
        return _slack_app.client
    return None
