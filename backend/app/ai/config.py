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

DEFAULT_DAILY_TOKEN_BUDGET = 10_000_000


@dataclass
class AIConfig:
    enabled: bool
    provider: Optional[str]
    model: Optional[str]
    api_key: str
    base_url: Optional[str]
    daily_token_budget: int
    company_context: str
    # Both off by default: with the Assistant on, it keeps its summary on each
    # ticket and only suggests until an admin opts in to these
    fill_details: bool = False    # fill in blanks and defaults: category, vague title, medium priority
    ask_requester: bool = False   # send the requester its questions on unclear tickets
    # The admin's base prompt; empty = the built-in one (triage.DEFAULT_INSTRUCTIONS)
    instructions: str = ""

    # The three things "Fill in ticket details" covers, one switch in Settings
    @property
    def auto_category(self) -> bool:   # set the category when the ticket has none
        return self.fill_details

    @property
    def retitle(self) -> bool:         # replace a vague title, until a technician edits it
        return self.fill_details

    @property
    def auto_priority(self) -> bool:   # move a default (medium) priority, never to critical
        return self.fill_details

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
        fill_details=await get_setting("ai_fill_details", session, default="false") == "true",
        ask_requester=await get_setting("ai_ask_requester", session, default="false") == "true",
        instructions=(await get_setting("ai_instructions", session)).strip(),
    )
