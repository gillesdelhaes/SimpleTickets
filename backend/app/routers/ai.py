"""
AI Assistant settings (admin only).

  GET   /admin/ai          settings (key masked), providers, today's usage
  PATCH /admin/ai          change settings; switching on records when, so only
                           tickets created afterwards are triaged
  POST  /admin/ai/models   list the provider's models for the given settings
  POST  /admin/ai/test     triage a sample ticket with the given settings
  GET   /admin/ai/usage    tokens, runs and failures for the last 14 days

/models and /test take the form's current values, so an admin can try a
provider before saving it; a blank key means "use the saved one".
"""
import logging
from typing import Optional
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.client import AIError, list_models, provider_choices, tokens_used_today, usage_summary
from app.ai.config import PROVIDERS, AIConfig, load_config
from app.ai.triage import assess
from app.auth.deps import require_admin
from app.database import get_session
from app.models import Ticket
from app.models.enums import Priority
from app.models.user import User
from app.services.audit import write_audit
from app.services.rate_limit import RateLimiter
from app.services.settings_service import get_setting, set_setting
from app.utils import client_ip, utcnow

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin/ai", tags=["admin"])

_try_limiter = RateLimiter(limit=10, window_seconds=60)

SAMPLE_TICKET = (
    "laptop not working",
    "hi, my laptop is acting weird since this morning and i can't do my work. can someone help asap",
)


class AISettingsRead(BaseModel):
    enabled: bool
    provider: Optional[str]
    model: Optional[str]
    base_url: Optional[str]
    api_key_set: bool
    daily_token_budget: int
    company_context: str
    triage_note: bool
    configured: bool
    providers: list[dict]
    tokens_today: int
    last_error: Optional[str]


class AISettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    provider: Optional[str] = Field(default=None, max_length=40)
    model: Optional[str] = Field(default=None, max_length=200)
    base_url: Optional[str] = Field(default=None, max_length=500)
    api_key: Optional[str] = Field(default=None, max_length=1000)
    clear_api_key: bool = False
    daily_token_budget: Optional[int] = Field(default=None, ge=0, le=100_000_000)
    company_context: Optional[str] = Field(default=None, max_length=4000)
    triage_note: Optional[bool] = None


class AITryRequest(BaseModel):
    """The form's current, possibly unsaved, connection values."""
    provider: Optional[str] = Field(default=None, max_length=40)
    model: Optional[str] = Field(default=None, max_length=200)
    base_url: Optional[str] = Field(default=None, max_length=500)
    api_key: Optional[str] = Field(default=None, max_length=1000)
    company_context: Optional[str] = Field(default=None, max_length=4000)
    title: Optional[str] = Field(default=None, max_length=255)
    description: Optional[str] = Field(default=None, max_length=8000)


def _check_base_url(url: str) -> None:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.netloc or parts.username or parts.password:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The base URL must be an http(s) URL without credentials.")


async def _read(session: AsyncSession) -> AISettingsRead:
    cfg = await load_config(session)
    return AISettingsRead(
        enabled=cfg.enabled,
        provider=cfg.provider,
        model=cfg.model,
        base_url=cfg.base_url,
        api_key_set=bool(cfg.api_key),
        daily_token_budget=cfg.daily_token_budget,
        company_context=cfg.company_context,
        triage_note=cfg.triage_note,
        configured=cfg.configured,
        providers=provider_choices(),
        tokens_today=await tokens_used_today(),
        last_error=await get_setting("ai_last_error", session) or None,
    )


@router.get("", response_model=AISettingsRead)
async def get_ai_settings(
    current_user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> AISettingsRead:
    return await _read(session)


@router.patch("", response_model=AISettingsRead)
async def update_ai_settings(
    body: AISettingsUpdate,
    request: Request,
    current_user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> AISettingsRead:
    changed: list[str] = []
    if body.provider is not None:
        if body.provider and body.provider not in PROVIDERS:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown provider.")
        await set_setting("ai_provider", body.provider, session)
        changed.append("provider")
    if body.model is not None:
        await set_setting("ai_model", body.model.strip(), session)
        changed.append("model")
    if body.base_url is not None:
        if body.base_url.strip():
            _check_base_url(body.base_url.strip())
        await set_setting("ai_base_url", body.base_url.strip(), session)
        changed.append("base_url")
    if body.clear_api_key:
        await set_setting("ai_api_key", "", session)
        changed.append("api_key")
    elif body.api_key and body.api_key.strip():
        await set_setting("ai_api_key", body.api_key.strip(), session)
        changed.append("api_key")
    if body.daily_token_budget is not None:
        await set_setting("ai_daily_token_budget", str(body.daily_token_budget), session)
        changed.append("daily_token_budget")
    if body.company_context is not None:
        await set_setting("ai_company_context", body.company_context.strip(), session)
        changed.append("company_context")
    if body.triage_note is not None:
        await set_setting("ai_triage_note", "true" if body.triage_note else "false", session)
        changed.append("triage_note")

    if body.enabled is not None:
        cfg = await load_config(session)  # sees the values set above (same session)
        if body.enabled and not cfg.configured:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Choose a provider and model (and key or URL where needed) before switching the Assistant on.",
            )
        was_on = await get_setting("ai_enabled", session) == "true"
        await set_setting("ai_enabled", "true" if body.enabled else "false", session)
        if body.enabled and not was_on:
            # Only tickets created from now on are triaged — never the backlog
            await set_setting("ai_enabled_at", utcnow().isoformat(), session)
            await set_setting("ai_last_error", "", session)
        changed.append("enabled")

    if changed:
        # Field names only; never values (the key is secret, context may be sensitive)
        await write_audit(
            session, actor_id=current_user.id, action="ai_settings.updated", entity_type="settings",
            payload={"fields": changed, "enabled": body.enabled, "provider": body.provider},
            ip_address=client_ip(request),
        )
        await session.commit()
    return await _read(session)


async def _try_config(body: AITryRequest, session: AsyncSession) -> AIConfig:
    saved = await load_config(session)
    provider = body.provider if body.provider is not None else saved.provider
    if provider not in PROVIDERS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a provider first.")
    base_url = (body.base_url if body.base_url is not None else saved.base_url) or None
    if base_url:
        _check_base_url(base_url)
    # A blank key means "the saved one" — but only for the provider it was saved for
    api_key = (body.api_key or "").strip() or (saved.api_key if provider == saved.provider else "")
    return AIConfig(
        enabled=saved.enabled,
        provider=provider,
        model=(body.model if body.model is not None else saved.model or "").strip() or None,
        api_key=api_key,
        base_url=base_url,
        daily_token_budget=saved.daily_token_budget,
        company_context=(body.company_context if body.company_context is not None else saved.company_context).strip(),
        triage_note=saved.triage_note,
    )


@router.post("/models")
async def list_ai_models(
    body: AITryRequest,
    current_user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    _try_limiter.check(str(current_user.id))
    cfg = await _try_config(body, session)
    try:
        return {"models": await list_models(cfg)}
    except AIError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


@router.post("/test")
async def test_ai(
    body: AITryRequest,
    current_user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Triage a sample (or the given) ticket with the form's settings. Nothing is saved
    except the usage row, which counts toward today's budget."""
    _try_limiter.check(str(current_user.id))
    cfg = await _try_config(body, session)
    if not cfg.configured:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Fill in the provider, model and key (or URL) first.")
    title, description = SAMPLE_TICKET
    sample = Ticket(
        id=None,
        title=(body.title or title).strip() or title,
        description=(body.description or description).strip() or description,
        status="open",
        priority=Priority.medium,
        source="slack",
        slack_submitter_name="Sample requester",
    )
    try:
        assessment, note, run = await assess(cfg, sample, feature="test")
    except AIError as exc:
        return {"ok": False, "error": str(exc)}
    return {
        "ok": True, "note": note, "assessment": assessment.model_dump(), "model": run.model,
        "input_tokens": run.input_tokens, "output_tokens": run.output_tokens, "duration_ms": run.duration_ms,
    }


@router.get("/usage")
async def get_ai_usage(current_user: User = Depends(require_admin)) -> dict:
    return await usage_summary()
