from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.auth.google import init_oauth
from app.config import settings
from app.routers import admin, auth, categories, health, sla_policies, tickets


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    init_oauth()
    # Scheduler and Slack bot are wired in later chunks
    yield
    # Shutdown — clean up resources added in later chunks


app = FastAPI(
    title="SimplyTickets API",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# SessionMiddleware must wrap the app before CORS so that
# Authlib can read/write the OIDC state cookie in route handlers.
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.app_secret_key,
    same_site="lax",
    https_only=False,  # set True behind HTTPS in production
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.app_base_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(categories.router, prefix="/api")
app.include_router(sla_policies.router, prefix="/api")
app.include_router(tickets.router, prefix="/api")
