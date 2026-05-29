from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session

router = APIRouter(tags=["health"])


@router.get("/health", include_in_schema=False)
async def health_check() -> JSONResponse:
    """
    Liveness + readiness probe.
    Checks DB connectivity and returns 200 OK or 503 Service Unavailable.
    Excluded from the OpenAPI schema to avoid noise in API docs.
    """
    db_ok = False
    try:
        # Use a fresh session so this never interferes with request sessions
        async for session in get_session():
            await session.execute(text("SELECT 1"))
            db_ok = True
            break
    except Exception:
        db_ok = False

    payload = {
        "status": "ok" if db_ok else "degraded",
        "db": "ok" if db_ok else "unreachable",
        "service": "simplytickets-api",
    }
    return JSONResponse(
        content=payload,
        status_code=200 if db_ok else 503,
    )
