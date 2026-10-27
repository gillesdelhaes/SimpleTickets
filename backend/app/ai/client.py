"""
Run a model and get a checked, structured answer — on any provider.

    result = await run_structured(cfg, feature="triage", ticket_id=42,
                                  instructions=..., prompt=..., output_type=MyModel)

What every call gets, whatever the provider:
  • the daily token budget is checked first (AIBudgetExceeded)
  • the answer is validated against `output_type`; Pydantic AI asks the model
    to fix an invalid answer before giving up
  • structured output goes through tool calling, and falls back to a plain
    "answer with this JSON" prompt for models that can't call tools
  • a hard per-run cap on requests and tokens, and a timeout
  • one row in ai_usage (tokens, duration, error) — success or not
  • errors come back as AIError with a message an admin can act on
"""
import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Optional, TypeVar

from pydantic import BaseModel
from pydantic_ai import Agent, PromptedOutput
from pydantic_ai.exceptions import (
    AgentRunError,
    ModelAPIError,
    ModelHTTPError,
    UnexpectedModelBehavior,
    UsageLimitExceeded,
    UserError,
)
from pydantic_ai.models import Model
from pydantic_ai.usage import UsageLimits
from sqlalchemy import func, select

from app.ai.config import PROVIDERS, AIConfig
from app.database import AsyncSessionLocal
from app.models import AIUsage
from app.utils import utcnow

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

_TIMEOUT_SECONDS = 90
# Per run: the first answer plus up to two "please fix your answer" retries
_REQUEST_LIMIT = 3
_RUN_TOKEN_LIMIT = 40_000

# (provider, model) pairs that failed with tool-based output but worked with
# prompted output — remembered so later runs go straight to what works
_prompted_only: set[tuple[str, str]] = set()


class AIError(Exception):
    """A model run failed; the message is safe to show an admin."""


class AIBudgetExceeded(AIError):
    pass


@dataclass
class RunResult:
    output: Any
    input_tokens: int
    output_tokens: int
    duration_ms: int
    model: str


# ── Models ────────────────────────────────────────────────────────────────────


def build_model(cfg: AIConfig) -> Model:
    """The Pydantic AI model for the configured provider. Each provider is
    reached through its vendor's own SDK."""
    if cfg.provider == "google":
        from pydantic_ai.models.google import GoogleModel
        from pydantic_ai.providers.google import GoogleProvider
        return GoogleModel(cfg.model, provider=GoogleProvider(api_key=cfg.api_key))
    if cfg.provider == "anthropic":
        from pydantic_ai.models.anthropic import AnthropicModel
        from pydantic_ai.providers.anthropic import AnthropicProvider
        return AnthropicModel(cfg.model, provider=AnthropicProvider(api_key=cfg.api_key))
    if cfg.provider in ("openai", "openai_compatible"):
        from pydantic_ai.models.openai import OpenAIChatModel
        from pydantic_ai.providers.openai import OpenAIProvider
        base_url = cfg.base_url if cfg.provider == "openai_compatible" else None
        # Local servers (Ollama, LM Studio) take any key; the SDK insists on one
        api_key = cfg.api_key or ("not-needed" if base_url else "")
        return OpenAIChatModel(cfg.model, provider=OpenAIProvider(base_url=base_url, api_key=api_key))
    raise AIError("Choose an AI provider in Settings → AI assistant.")


async def list_models(cfg: AIConfig) -> list[str]:
    """Model ids the provider offers this key, newest naming first where the
    API says. Used by the settings page so model names are never hard-coded."""
    try:
        if cfg.provider == "google":
            from google import genai
            client = genai.Client(api_key=cfg.api_key)
            ids = []
            async for m in await client.aio.models.list():
                actions = getattr(m, "supported_actions", None) or []
                if "generateContent" in actions:
                    ids.append((m.name or "").removeprefix("models/"))
            return sorted(i for i in ids if i)
        if cfg.provider == "anthropic":
            from anthropic import AsyncAnthropic
            client = AsyncAnthropic(api_key=cfg.api_key)
            return [m.id async for m in client.models.list(limit=100)]
        if cfg.provider in ("openai", "openai_compatible"):
            from openai import AsyncOpenAI
            base_url = cfg.base_url if cfg.provider == "openai_compatible" else None
            client = AsyncOpenAI(api_key=cfg.api_key or ("not-needed" if base_url else ""), base_url=base_url)
            return sorted([m.id async for m in client.models.list()])
    except Exception as exc:  # noqa: BLE001 — every SDK has its own error types
        logger.info("AI: listing models failed for %s: %s", cfg.provider, exc)
        status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
        if status in (401, 403):
            raise AIError("The provider rejected the API key.")
        raise AIError("Couldn't list models. Check the key (and URL), or type the model name.")
    raise AIError("Choose an AI provider first.")


# ── Budget ────────────────────────────────────────────────────────────────────


async def tokens_used_today() -> int:
    start = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    async with AsyncSessionLocal() as session:
        used = (await session.execute(
            select(func.coalesce(func.sum(AIUsage.input_tokens + AIUsage.output_tokens), 0))
            .where(AIUsage.created_at >= start)
        )).scalar_one()
    return int(used)


# ── Running ───────────────────────────────────────────────────────────────────


def _friendly(exc: BaseException) -> str:
    if isinstance(exc, ModelHTTPError):
        code = exc.status_code
        if code in (401, 403):
            return "The provider rejected the API key (or the key can't use this model)."
        if code == 404:
            return "The provider doesn't know this model name. Use “Load models” to pick one."
        if code == 429:
            return "The provider is rate-limiting or the account is out of quota/credit."
        if code >= 500:
            return f"The provider had an error ({code}). It will be retried."
        return f"The provider refused the request ({code})."
    if isinstance(exc, UsageLimitExceeded):
        return "The answer was too long or took too many attempts."
    if isinstance(exc, UnexpectedModelBehavior):
        return "The model didn't return a usable answer. A stronger model may do better."
    if isinstance(exc, ModelAPIError):
        return "Couldn't reach the provider. Check the URL and the server's internet access."
    if isinstance(exc, TimeoutError):
        return "The provider took too long to answer."
    if isinstance(exc, UserError):
        return "The AI settings are incomplete or invalid."
    return "The AI run failed. See the server logs."


async def _record(cfg: AIConfig, feature: str, ticket_id: Optional[int], *, input_tokens: int = 0,
                  output_tokens: int = 0, requests: int = 0, duration_ms: int = 0, error: Optional[str] = None) -> None:
    async with AsyncSessionLocal() as session:
        session.add(AIUsage(
            feature=feature, ticket_id=ticket_id, provider=cfg.provider or "", model=cfg.model or "",
            input_tokens=input_tokens, output_tokens=output_tokens, requests=requests,
            duration_ms=duration_ms, ok=error is None, error=error,
        ))
        await session.commit()


async def run_structured(
    cfg: AIConfig,
    *,
    feature: str,
    ticket_id: Optional[int],
    instructions: str,
    prompt: str,
    output_type: type[T],
    model: Optional[Model] = None,
) -> RunResult:
    """Run one structured-output request. `model` overrides the configured one (tests)."""
    if model is None and not cfg.configured:
        raise AIError("The AI provider isn't fully configured.")
    used = await tokens_used_today()
    if cfg.daily_token_budget and used >= cfg.daily_token_budget:
        raise AIBudgetExceeded(
            f"Today's AI token budget ({cfg.daily_token_budget:,}) is used up. It resets at midnight UTC."
        )

    model = model or build_model(cfg)
    key = (cfg.provider or "", cfg.model or "")
    modes = ["prompted"] if key in _prompted_only else ["tool", "prompted"]
    limits = UsageLimits(request_limit=_REQUEST_LIMIT, total_tokens_limit=_RUN_TOKEN_LIMIT)
    started = time.monotonic()
    last_exc: Optional[BaseException] = None
    in_tok = out_tok = reqs = 0

    for mode in modes:
        output_spec = output_type if mode == "tool" else PromptedOutput(output_type)
        agent = Agent(model, output_type=output_spec, instructions=instructions, retries=2)
        try:
            result = await asyncio.wait_for(agent.run(prompt, usage_limits=limits), timeout=_TIMEOUT_SECONDS)
        except (UnexpectedModelBehavior, ModelHTTPError) as exc:
            last_exc = exc
            # A 400 or a garbled tool answer often means "this model can't do
            # tool calls" — try the plain-JSON prompt before giving up. Auth,
            # quota and server errors won't be fixed by that.
            if isinstance(exc, ModelHTTPError) and exc.status_code != 400:
                break
            logger.info("AI: %s output failed on %s/%s (%s); trying the next mode", mode, *key, exc)
            continue
        except (AgentRunError, UserError, TimeoutError) as exc:
            last_exc = exc
            break
        except Exception as exc:  # noqa: BLE001 — SDK-specific network errors
            last_exc = exc
            logger.exception("AI: unexpected error from %s/%s", *key)
            break

        usage = result.usage  # a property in pydantic-ai 2.x
        in_tok += usage.input_tokens or 0
        out_tok += usage.output_tokens or 0
        reqs += usage.requests or 0
        if mode == "prompted" and "tool" in modes:
            _prompted_only.add(key)
            logger.info("AI: %s/%s works with prompted output only; remembering that", *key)
        duration = int((time.monotonic() - started) * 1000)
        await _record(cfg, feature, ticket_id, input_tokens=in_tok, output_tokens=out_tok,
                      requests=reqs, duration_ms=duration)
        return RunResult(result.output, in_tok, out_tok, duration, cfg.model or getattr(model, "model_name", ""))

    message = _friendly(last_exc) if last_exc else "The AI run failed."
    logger.warning("AI: %s run failed on %s/%s: %r", feature, *key, last_exc)
    await _record(cfg, feature, ticket_id, requests=reqs or 1,
                  duration_ms=int((time.monotonic() - started) * 1000), error=message)
    raise AIError(message) from last_exc


async def usage_summary(days: int = 14) -> dict:
    """Tokens, runs and failures per day for the settings page."""
    since = (utcnow() - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    day = func.date_trunc("day", AIUsage.created_at)
    async with AsyncSessionLocal() as session:
        rows = (await session.execute(
            select(
                day.label("day"),
                func.sum(AIUsage.input_tokens).label("input_tokens"),
                func.sum(AIUsage.output_tokens).label("output_tokens"),
                func.count(AIUsage.id).label("runs"),
                func.count(AIUsage.id).filter(AIUsage.ok == False).label("failures"),  # noqa: E712
            )
            .where(AIUsage.created_at >= since)
            .group_by(day)
            .order_by(day)
        )).all()
        recent = (await session.execute(
            select(AIUsage).order_by(AIUsage.id.desc()).limit(10)
        )).scalars().all()
    return {
        "days": [
            {"day": r.day.date().isoformat(), "input_tokens": int(r.input_tokens or 0),
             "output_tokens": int(r.output_tokens or 0), "runs": r.runs, "failures": r.failures}
            for r in rows
        ],
        "recent": [
            {"at": u.created_at.isoformat(), "feature": u.feature, "ticket_id": u.ticket_id, "model": u.model,
             "tokens": u.input_tokens + u.output_tokens, "duration_ms": u.duration_ms, "ok": u.ok, "error": u.error}
            for u in recent
        ],
    }


def provider_choices() -> list[dict]:
    return [{"id": k, **v} for k, v in PROVIDERS.items()]
