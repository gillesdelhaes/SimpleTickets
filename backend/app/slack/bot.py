"""
Slack Bolt integration — Chunk 19.

Architecture:
  Uses Socket Mode (SLACK_APP_TOKEN = xapp-…) so no public inbound webhook
  is required. The handler connects to Slack's WebSocket relay and processes
  events in the running asyncio event loop.

Lifecycle:
  start_slack() — called in FastAPI lifespan startup.
                  No-op if SLACK_BOT_TOKEN is not set.
  stop_slack()  — called in FastAPI lifespan shutdown.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

from app.config import settings

logger = logging.getLogger(__name__)

# Module-level references so we can stop them on shutdown
_slack_app = None
_socket_handler = None


def _is_configured() -> bool:
    return bool(settings.slack_bot_token and settings.slack_app_token)


def create_app():
    """Create and return a configured AsyncApp, or None if tokens are missing."""
    if not _is_configured():
        logger.info(
            "Slack integration disabled — "
            "set SLACK_BOT_TOKEN and SLACK_APP_TOKEN to enable."
        )
        return None

    try:
        from slack_bolt.async_app import AsyncApp

        app = AsyncApp(
            token=settings.slack_bot_token,
            signing_secret=settings.slack_signing_secret or None,
            # Disable request verification for Socket Mode (Slack signs internally)
            process_before_response=True,
        )

        # Register all event/command handlers
        from app.slack.handlers import register_handlers
        register_handlers(app)

        logger.info("Slack AsyncApp created (trigger_emoji=%r)", settings.slack_trigger_emoji)
        return app

    except ImportError:
        logger.error("slack-bolt is not installed — Slack integration unavailable.")
        return None
    except Exception:  # noqa: BLE001
        logger.exception("Failed to create Slack app — integration disabled.")
        return None


async def start_slack() -> None:
    """Start the Slack Socket Mode handler in the background."""
    global _slack_app, _socket_handler

    app = create_app()
    if app is None:
        return

    try:
        from slack_bolt.adapter.socket_mode.async_handler import AsyncSocketModeHandler

        _slack_app = app
        _socket_handler = AsyncSocketModeHandler(app, settings.slack_app_token)
        # start_async() launches the WebSocket loop as a background asyncio task
        await _socket_handler.start_async()
        logger.info("Slack Socket Mode handler connected.")
    except Exception:  # noqa: BLE001
        logger.exception(
            "Slack Socket Mode handler failed to start — "
            "check SLACK_APP_TOKEN and network access."
        )
        _slack_app = None
        _socket_handler = None


async def stop_slack() -> None:
    """Cleanly disconnect the Slack Socket Mode handler."""
    global _socket_handler
    if _socket_handler is not None:
        try:
            await _socket_handler.close_async()
            logger.info("Slack Socket Mode handler disconnected.")
        except Exception:  # noqa: BLE001
            logger.exception("Error closing Slack Socket Mode handler.")
        finally:
            _socket_handler = None
