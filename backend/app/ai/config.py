"""AI Assistant settings, read from app_settings (the key is encrypted)."""
from dataclasses import dataclass
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.settings_service import get_setting

# Provider id → what the admin form needs. No provider is a default: the
# Assistant stays off until an admin picks one.
PROVIDERS: dict[str, dict] = {
    "google": {"label": "Google Gemini", "needs_key": True, "needs_base_url": False},
    "openai": {"label": "OpenAI", "needs_key": True, "needs_base_url": False},
    "anthropic": {"label": "Anthropic Claude", "needs_key": True, "needs_base_url": False},
    "openai_compatible": {
        "label": "OpenAI-compatible (Mistral, Groq, OpenRouter, Azure, Ollama…)",
        "needs_key": False,
        "needs_base_url": True,
    },
}

DEFAULT_DAILY_TOKEN_BUDGET = 200_000


@dataclass
class AIConfig:
    enabled: bool
    provider: Optional[str]
    model: Optional[str]
    api_key: str
    base_url: Optional[str]
    daily_token_budget: int
    company_context: str
    triage_note: bool

    @property
    def configured(self) -> bool:
        """Enough to call a model (whether or not the Assistant is switched on)."""
        spec = PROVIDERS.get(self.provider or "")
        if spec is None or not self.model:
            return False
        if spec["needs_key"] and not self.api_key:
            return False
        if spec["needs_base_url"] and not self.base_url:
            return False
        return True


async def load_config(session: AsyncSession) -> AIConfig:
    try:
        budget = int(await get_setting("ai_daily_token_budget", session, default=str(DEFAULT_DAILY_TOKEN_BUDGET)))
    except ValueError:
        budget = DEFAULT_DAILY_TOKEN_BUDGET
    return AIConfig(
        enabled=await get_setting("ai_enabled", session) == "true",
        provider=await get_setting("ai_provider", session) or None,
        model=(await get_setting("ai_model", session)).strip() or None,
        api_key=await get_setting("ai_api_key", session),
        base_url=(await get_setting("ai_base_url", session)).strip() or None,
        daily_token_budget=max(0, budget),
        company_context=(await get_setting("ai_company_context", session)).strip(),
        triage_note=await get_setting("ai_triage_note", session, default="true") == "true",
    )
