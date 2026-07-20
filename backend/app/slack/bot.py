"""
Slack Bolt integration — multi-workspace.

Each connected Slack workspace (a SlackWorkspace DB row) gets its own Bolt
AsyncApp and its own Socket Mode connection — Socket Mode is inherently one
connection per app installation, and each workspace is a separately-created
Slack app. `_bots` tracks the currently-running ones, keyed by workspace id.

Lifecycle:
  start_slack()                   — FastAPI lifespan startup; starts a bot
                                     for every active, configured workspace.
  stop_slack()                    — FastAPI lifespan shutdown; stops all.
  reload_slack(workspace_id=None) — restart one workspace (after its
                                     credentials/active flag changed), or
                                     every active workspace when omitted.
"""
import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Optional

from app.models.slack_workspace import SlackWorkspace

logger = logging.getLogger(__name__)


@dataclass
class _RunningBot:
    app: Any
    socket_handler: Any
    task: asyncio.Task


_bots: dict[int, _RunningBot] = {}


async def _active_workspaces() -> list[SlackWorkspace]:
    from sqlalchemy import select
    from app.database import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(SlackWorkspace).where(SlackWorkspace.is_active == True)  # noqa: E712
        )
        return list(result.scalars().all())


def _create_app(workspace: SlackWorkspace, bot_token: str, signing_secret: str):
    """Create and return a configured AsyncApp for one workspace, or None on failure."""
    try:
        from slack_bolt.async_app import AsyncApp
        from app.slack.handlers import register_handlers

        app = AsyncApp(
            token=bot_token,
            signing_secret=signing_secret or None,
            process_before_response=True,
        )
        register_handlers(app, workspace)
        logger.info("Slack AsyncApp created for workspace %r (id=%s)", workspace.name, workspace.id)
        return app
    except ImportError:
        logger.error("slack-bolt is not installed — Slack integration unavailable.")
        return None
    except Exception:  # noqa: BLE001
        logger.exception("Failed to create Slack app for workspace %r (id=%s)", workspace.name, workspace.id)
        return None


async def _start_one(workspace: SlackWorkspace) -> None:
    """Start (no-op if already running) the Socket Mode connection for one workspace."""
    if workspace.id in _bots:
        return

    from app.services.settings_service import decrypt_value

    bot_token = decrypt_value(workspace.bot_token) if workspace.bot_token else ""
    app_token = decrypt_value(workspace.app_token) if workspace.app_token else ""
    signing_secret = decrypt_value(workspace.signing_secret) if workspace.signing_secret else ""

    if not (bot_token and app_token):
        logger.info("Workspace %r (id=%s) missing tokens — not starting.", workspace.name, workspace.id)
        return

    app = _create_app(workspace, bot_token, signing_secret)
    if app is None:
        return

    try:
        from slack_bolt.adapter.socket_mode.async_handler import AsyncSocketModeHandler

        socket_handler = AsyncSocketModeHandler(app, app_token)
        # start_async() blocks until disconnected — run it as a background task
        task = asyncio.create_task(socket_handler.start_async())
        _bots[workspace.id] = _RunningBot(app=app, socket_handler=socket_handler, task=task)
        logger.info("Slack Socket Mode handler started for workspace %r (id=%s)", workspace.name, workspace.id)
    except Exception:  # noqa: BLE001
        logger.exception(
            "Slack Socket Mode handler failed to start for workspace %r (id=%s)", workspace.name, workspace.id
        )


async def _stop_one(workspace_id: int) -> None:
    bot = _bots.pop(workspace_id, None)
    if bot is None:
        return
    try:
        await bot.socket_handler.close_async()
        logger.info("Slack Socket Mode handler disconnected for workspace id=%s", workspace_id)
    except Exception:  # noqa: BLE001
        logger.exception("Error closing Slack Socket Mode handler for workspace id=%s", workspace_id)
    bot.task.cancel()


async def start_slack() -> None:
    """Start a Socket Mode connection for every active, configured workspace."""
    for workspace in await _active_workspaces():
        await _start_one(workspace)


async def stop_slack() -> None:
    """Cleanly disconnect every running Socket Mode handler."""
    for workspace_id in list(_bots.keys()):
        await _stop_one(workspace_id)


async def reload_slack(workspace_id: Optional[int] = None) -> None:
    """
    Restart one workspace's bot with freshly-loaded credentials (after its row
    changes), or every active workspace's bot when workspace_id is None.
    """
    if workspace_id is not None:
        await _stop_one(workspace_id)
        from app.database import AsyncSessionLocal

        async with AsyncSessionLocal() as session:
            workspace = await session.get(SlackWorkspace, workspace_id)
        if workspace is not None and workspace.is_active:
            await _start_one(workspace)
        return

    logger.info("Reloading all Slack workspace connections...")
    await stop_slack()
    await start_slack()


async def is_slack_online(workspace_id: Optional[int] = None) -> bool:
    """
    True if the given workspace's Socket Mode handler is running and alive.
    With no workspace_id: True only if every active workspace currently has a
    live connection (used for the app-wide "Slack disconnected" banner).
    """
    if workspace_id is not None:
        bot = _bots.get(workspace_id)
        return bot is not None and not bot.task.done()

    workspaces = await _active_workspaces()
    if not workspaces:
        return False
    for workspace in workspaces:
        bot = _bots.get(workspace.id)
        if bot is None or bot.task.done():
            return False
    return True


def get_slack_client(workspace_id: int):
    """Return the Slack AsyncWebClient for a workspace if its bot is running, else None."""
    bot = _bots.get(workspace_id)
    return bot.app.client if bot is not None else None
