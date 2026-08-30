import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import settings, settings_manager
from app.database import AsyncSessionLocal
from app.slack.bot import start_slack, stop_slack
from app.routers import (
    activity,
    admin,
    app_config,
    attachments,
    auth,
    backup,
    categories,
    health,
    notifications,
    replies,
    reports,
    search,
    sla_policies,
    ticket_statuses,
    tickets,
)
from app.routers import setup, settings as settings_router, slack_users, slack_workspaces
from app.services.sla import start_scheduler, stop_scheduler

# No logging was configured anywhere — every logger.info()/logger.warning() call
# across the app (including "Slack bot connected for workspace X") was silently
# dropped by Python's default root-logger level (WARNING, no handler). Configure
# it here, once, before the app starts logging anything.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
# Quiet third-party HTTP client chatter — otherwise every outbound Slack API
# call logs a request/response line at INFO.
for _noisy in ("httpx", "httpcore", "aiohttp.client", "apscheduler"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm the settings cache from DB before serving any request
    async with AsyncSessionLocal() as session:
        await settings_manager.warm(session)
        await settings_manager.ensure_jwt_secret(session)

    start_scheduler()

    # Start Slack only if already configured (will be a no-op on first boot)
    await start_slack()

    yield

    await stop_slack()
    stop_scheduler()


app = FastAPI(
    title="SimpleTickets API",
    version="0.1.0",
    docs_url="/api/docs" if settings.enable_api_docs else None,
    redoc_url="/api/redoc" if settings.enable_api_docs else None,
    openapi_url="/api/openapi.json" if settings.enable_api_docs else None,
    lifespan=lifespan,
)

app.include_router(health.router,          prefix="/api")
app.include_router(setup.router,           prefix="/api")
app.include_router(auth.router,            prefix="/api")
app.include_router(admin.router,           prefix="/api")
app.include_router(settings_router.router, prefix="/api")
app.include_router(categories.router,      prefix="/api")
app.include_router(sla_policies.router,    prefix="/api")
app.include_router(tickets.router,         prefix="/api")
app.include_router(replies.router,         prefix="/api")
app.include_router(attachments.router,     prefix="/api")
app.include_router(search.router,          prefix="/api")
app.include_router(notifications.router,   prefix="/api")
app.include_router(app_config.router,      prefix="/api")
app.include_router(reports.router,         prefix="/api")
app.include_router(slack_users.router,     prefix="/api")
app.include_router(slack_workspaces.router,        prefix="/api")
app.include_router(slack_workspaces.public_router, prefix="/api")
app.include_router(activity.router,        prefix="/api")
app.include_router(backup.router,          prefix="/api")
app.include_router(ticket_statuses.router, prefix="/api")
