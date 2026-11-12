"""Backup → restore row conversion (no database needed)."""
import json
from datetime import datetime

from sqlalchemy import DateTime

from app.models import Ticket
from app.routers.backup import _DT_COLS, _EXPORT_MODELS, _deserialize_row, _serialize_row


def test_every_datetime_column_is_restored_as_a_datetime():
    for name, model in _EXPORT_MODELS:
        dates = {c.key for c in model.__table__.columns if isinstance(c.type, DateTime)}
        assert _DT_COLS[name] == dates, name
    assert "ai_triaged_at" in _DT_COLS["tickets"]
    assert "updated_at" in _DT_COLS["app_settings"]


def test_assessed_ticket_survives_the_round_trip():
    at = datetime(2026, 11, 12, 9, 30)
    ticket = Ticket(id=1, title="x", status="open", source="email", ai_triaged_at=at, created_at=at, updated_at=at)
    # Through JSON, as in the backup file
    row = _deserialize_row(json.loads(json.dumps(_serialize_row(ticket))), "tickets")
    assert row["ai_triaged_at"] == at and row["created_at"] == at
    assert row["resolved_at"] is None
    assert not [k for k, v in row.items() if k.endswith("_at") and isinstance(v, str)]


def test_restore_lists_what_to_set_up_again():
    from app.routers.backup import to_reconnect
    tables = {
        "slack_workspaces": [{"id": 1}, {"id": 2}],
        "app_settings": [
            {"key": "gmail_address", "value": "help@example.com"},
            {"key": "ai_provider", "value": "anthropic"},
        ],
    }
    items = {i["tab"]: i for i in to_reconnect(tables)}
    assert set(items) == {"slack", "google", "ai"}
    assert "2 workspaces are switched off" in items["slack"]["detail"]
    assert "help@example.com" in items["google"]["detail"]
    # Nothing set up, nothing to do; a local model needs no key
    assert to_reconnect({}) == []
    assert to_reconnect({"app_settings": [{"key": "ai_provider", "value": "openai_compatible"}, {"key": "gmail_address", "value": ""}]}) == []
