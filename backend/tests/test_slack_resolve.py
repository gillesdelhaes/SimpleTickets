"""Resolve from the Slack App Home: the parts that need no database."""
from datetime import datetime

from app.models import Ticket
from app.slack.handlers import _resolve_category_modal, wants_csat


def ticket(**kw) -> Ticket:
    return Ticket(title="x", status="open", source="slack", **kw)


def test_no_survey_when_nobody_else_touched_the_ticket():
    assert not wants_csat(ticket(), None), "requester closed an untouched ticket"
    assert not wants_csat(ticket(assignee_id=7), 7), "a technician resolving their own ticket, assigned to themselves"


def test_survey_when_someone_worked_on_it():
    assert wants_csat(ticket(assignee_id=7), None), "assigned to a technician"
    assert wants_csat(ticket(assignee_id=7), 8), "assigned to another technician"
    assert wants_csat(ticket(first_responded_at=datetime(2026, 11, 12)), None), "a technician replied"


def test_category_modal_requires_a_choice():
    options = [{"text": {"type": "plain_text", "text": f"c{i}"}, "value": str(i)} for i in range(150)]
    view = _resolve_category_modal(12, "active", options)
    block = view["blocks"][0]
    assert view["callback_id"] == "home_resolve_modal" and '"tid": 12' in view["private_metadata"]
    assert not block.get("optional"), "a technician can't skip it"
    assert len(block["element"]["options"]) == 100, "Slack's limit"
