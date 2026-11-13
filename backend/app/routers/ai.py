"""
AI Assistant settings (admin only).

  GET   /admin/ai          settings (key masked), providers, today's usage
  PATCH /admin/ai          change settings; switching on records when, so only
                           tickets created afterwards are triaged
  POST  /admin/ai/models   list the provider's models for the given settings
  POST  /admin/ai/test     triage a sample ticket with the given settings
  GET   /admin/ai/usage    tokens, runs and failures for the last 14 days

Technicians:
  GET   /tickets/{id}/assistant          the Assistant's current assessment
  POST  /tickets/{id}/assistant/refresh  re-assess now (never messages the requester)

/models and /test take the form's current values, so an admin can try a
provider before saving it; a blank key means "use the saved one".
"""
import logging
from typing import Optional
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.client import AIError, list_models, provider_choices, tokens_used_today, usage_summary
from app.ai.config import PROVIDERS, AIConfig, load_config
from app.ai.triage import (
    DEFAULT_INSTRUCTIONS, FIXED_RULES, MAX_INSTRUCTIONS_CHARS, _MAX_QUESTION_ROUNDS, _requester_reply_filter,
    _is_resolved, assess, stored_assessment, triage_ticket,
)
from app.auth.deps import require_admin, require_technician
from app.database import get_session
from app.models import Ticket, TicketReply
from app.models.enums import Priority
from app.models.user import User
from app.services.audit import write_audit
from app.services.rate_limit import RateLimiter
from app.services.settings_service import get_setting, set_setting
from app.utils import client_ip, utcnow

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin/ai", tags=["admin"])
ticket_router = APIRouter(prefix="/tickets", tags=["ai"])

_try_limiter = RateLimiter(limit=10, window_seconds=60)
_refresh_limiter = RateLimiter(limit=10, window_seconds=60)

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
    # The base prompt in use: the admin's, or the built-in one
    instructions: str
    instructions_custom: bool
    default_instructions: str
    # Always sent after the base prompt; shown read-only
    fixed_rules: str
    fill_details: bool
    ask_requester: bool
    configured: bool
    providers: list[dict]
    tokens_today: int
    last_error: Optional[str]
    # USD per 1M tokens, for the cost estimate in Reports; null = not set
    price_input_per_m: Optional[float]
    price_output_per_m: Optional[float]


class AISettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    provider: Optional[str] = Field(default=None, max_length=40)
    model: Optional[str] = Field(default=None, max_length=200)
    base_url: Optional[str] = Field(default=None, max_length=500)
    api_key: Optional[str] = Field(default=None, max_length=1000)
    clear_api_key: bool = False
    daily_token_budget: Optional[int] = Field(default=None, ge=0, le=100_000_000)
    company_context: Optional[str] = Field(default=None, max_length=4000)
    # Blank, or the built-in text unchanged, goes back to the built-in prompt
    instructions: Optional[str] = Field(default=None, max_length=MAX_INSTRUCTIONS_CHARS)
    fill_details: Optional[bool] = None
    ask_requester: Optional[bool] = None
    # -1 clears a price
    price_input_per_m: Optional[float] = Field(default=None, ge=-1, le=1000)
    price_output_per_m: Optional[float] = Field(default=None, ge=-1, le=1000)


async def read_price(key: str, session: AsyncSession) -> Optional[float]:
    try:
        value = float(await get_setting(key, session))
    except ValueError:
        return None
    return value if value >= 0 else None


class AITryRequest(BaseModel):
    """The form's current, possibly unsaved, connection values."""
    provider: Optional[str] = Field(default=None, max_length=40)
    model: Optional[str] = Field(default=None, max_length=200)
    base_url: Optional[str] = Field(default=None, max_length=500)
    api_key: Optional[str] = Field(default=None, max_length=1000)
    company_context: Optional[str] = Field(default=None, max_length=4000)
    instructions: Optional[str] = Field(default=None, max_length=MAX_INSTRUCTIONS_CHARS)
    title: Optional[str] = Field(default=None, max_length=255)
    description: Optional[str] = Field(default=None, max_length=8000)


def _custom_instructions(text: str) -> str:
    """What to store: empty when it's blank or just the built-in prompt, so
    installs that never changed it keep following the built-in one."""
    text = text.replace("\r\n", "\n").strip()
    return "" if text == DEFAULT_INSTRUCTIONS.strip() else text


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
        instructions=cfg.instructions or DEFAULT_INSTRUCTIONS,
        instructions_custom=bool(cfg.instructions),
        default_instructions=DEFAULT_INSTRUCTIONS,
        fixed_rules=FIXED_RULES,
        fill_details=cfg.fill_details,
        ask_requester=cfg.ask_requester,
        configured=cfg.configured,
        providers=provider_choices(),
        tokens_today=await tokens_used_today(),
        last_error=await get_setting("ai_last_error", session) or None,
        price_input_per_m=await read_price("ai_price_input_per_m", session),
        price_output_per_m=await read_price("ai_price_output_per_m", session),
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
    if body.instructions is not None:
        await set_setting("ai_instructions", _custom_instructions(body.instructions), session)
        changed.append("instructions")
    for field in ("price_input_per_m", "price_output_per_m"):
        value = getattr(body, field)
        if value is not None:
            await set_setting(f"ai_{field}", "" if value < 0 else str(value), session)
            changed.append(field)
    for field in ("fill_details", "ask_requester"):
        value = getattr(body, field)
        if value is not None:
            await set_setting(f"ai_{field}", "true" if value else "false", session)
            changed.append(field)

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
        instructions=_custom_instructions(body.instructions) if body.instructions is not None else saved.instructions,
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


# ── Ticket panel ──────────────────────────────────────────────────────────────


class TicketAssistantRead(BaseModel):
    # The Assistant is on and keeps a summary on tickets
    active: bool
    assessment: Optional[dict]
    # Questions sent to the requester in the latest round (empty if none)
    asked: list[str]
    category_set: Optional[str]
    # {'from': the requester's original title, 'to': the Assistant's}
    title_set: Optional[dict]
    # The priority the Assistant set, if it did
    priority_set: Optional[str]
    question_rounds: int
    max_question_rounds: int
    assessed_at: Optional[str]
    # The requester replied since; an update is on its way
    updating: bool
    # Resolved: frozen, so no Refresh
    resolved: bool


async def _ticket_assistant(session: AsyncSession, ticket: Ticket) -> TicketAssistantRead:
    cfg = await load_config(session)
    data = stored_assessment(ticket)
    updating = False
    if ticket.ai_triaged_at is not None:
        last = (await session.execute(
            select(func.max(TicketReply.created_at)).where(TicketReply.ticket_id == ticket.id, *_requester_reply_filter())
        )).scalar_one_or_none()
        updating = bool(last and last > ticket.ai_triaged_at and cfg.enabled)
    return TicketAssistantRead(
        active=cfg.enabled,
        assessment=data["assessment"] if data else None,
        asked=(data or {}).get("asked") or [],
        category_set=(data or {}).get("category_set"),
        title_set=(data or {}).get("title_set"),
        priority_set=(data or {}).get("priority_set"),
        question_rounds=ticket.ai_question_rounds,
        max_question_rounds=_MAX_QUESTION_ROUNDS,
        assessed_at=ticket.ai_triaged_at.isoformat() if ticket.ai_triaged_at else None,
        updating=updating,
        resolved=await _is_resolved(session, ticket),
    )


@ticket_router.get("/{ticket_id}/assistant", response_model=TicketAssistantRead)
async def get_ticket_assistant(
    ticket_id: int,
    current_user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> TicketAssistantRead:
    ticket = await session.get(Ticket, ticket_id)
    if ticket is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found")
    return await _ticket_assistant(session, ticket)


@ticket_router.post("/{ticket_id}/assistant/refresh", response_model=TicketAssistantRead)
async def refresh_ticket_assistant(
    ticket_id: int,
    current_user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> TicketAssistantRead:
    """Re-assess now, e.g. after a technician added details. Updates the panel
    and may set the category, but never sends the requester questions."""
    _refresh_limiter.check(str(current_user.id))
    cfg = await load_config(session)
    if not (cfg.enabled and cfg.configured):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The Assistant is off.")
    ticket = await session.get(Ticket, ticket_id)
    if ticket is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found")
    if await _is_resolved(session, ticket):
        # Resolved tickets are frozen, as everywhere else
        raise HTTPException(status.HTTP_409_CONFLICT, "This ticket is resolved — reopen it to refresh the Assistant.")
    if not await triage_ticket(cfg, ticket_id, allow_questions=False):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            await get_setting("ai_last_error", session) or "The Assistant couldn't run.",
        )
    session.expire_all()
    return await _ticket_assistant(session, await session.get(Ticket, ticket_id))
