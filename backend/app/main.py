from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings, settings_manager
from app.database import AsyncSessionLocal
from app.slack.bot import start_slack, stop_slack
from app.routers import (
    admin,
    app_config,
    attachments,
    auth,
    categories,
    health,
    notifications,
    replies,
    reports,
    search,
    sla_policies,
    tickets,
)
from app.routers import setup, settings as settings_router
from app.services.sla import start_scheduler, stop_scheduler


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
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
