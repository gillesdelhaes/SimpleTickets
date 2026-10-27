"""AI Assistant — provider-agnostic.

  config.py  which provider/model/key the admin chose (no default provider)
  client.py  one way to run a model with a checked, structured answer, on
             any provider, within the daily token budget, logged in ai_usage
  triage.py  the triage note written on every new ticket

Every feature must work on every supported provider: answers are validated
by our own Pydantic models (with a retry, and a fallback to plain-JSON
"prompted" output for models without tool calling), and nothing relies on
vendor-only extras. The model proposes; our code decides what is written.
"""
