"""A ticket made from a message in a channel shared between two connected
workspaces: the follow-up DM must come from the author's own workspace bot."""
import asyncio

from app.models import Ticket
from app.slack import handlers


class FakeClient:
    def __init__(self, team_id=None):
        self.team_id = team_id

    async def chat_getPermalink(self, **_):
        return {"permalink": "https://slack.example/p1"}

    async def users_info(self, user):
        return {"user": {"id": user, "team_id": self.team_id}}


def move(monkeypatch, *, author_team, own_team, connected):
    calls = {}

    async def fake_workspace_for_team(team):
        return connected.get(team)

    async def fake_anchor(ticket, slack_user_id, text, *, workspace_id=None):
        calls["workspace_id"] = workspace_id
        return True

    monkeypatch.setattr(handlers, "workspace_for_team", fake_workspace_for_team)
    monkeypatch.setattr(handlers, "anchor_ticket_in_dm", fake_anchor)
    ticket = Ticket(id=1, title="VPN down", status="open", source="slack", workspace_id=1)
    moved = asyncio.run(handlers._move_ticket_to_dm(
        FakeClient(), ticket, "U2", "C1", "1.0", author_team=author_team, own_team=own_team,
    ))
    return moved, calls["workspace_id"]


def test_author_from_another_connected_workspace_is_dmed_by_their_bot(monkeypatch):
    assert move(monkeypatch, author_team="T2", own_team="T1", connected={"T1": 1, "T2": 2}) == (True, 2)


def test_author_from_the_same_workspace_keeps_this_bot(monkeypatch):
    assert move(monkeypatch, author_team="T1", own_team="T1", connected={"T1": 1, "T2": 2}) == (True, None)


def test_author_from_a_workspace_that_isnt_connected_keeps_this_bot(monkeypatch):
    assert move(monkeypatch, author_team="T9", own_team="T1", connected={"T1": 1}) == (True, None)


def test_author_team_from_the_message_or_the_user():
    client = FakeClient(team_id="T3")
    assert asyncio.run(handlers._author_team(client, {"user_team": "T2", "team": "T1"}, "U2")) == "T2"
    assert asyncio.run(handlers._author_team(client, {"team": "T1"}, "U2")) == "T1"
    assert asyncio.run(handlers._author_team(client, {}, "U2")) == "T3", "falls back to users.info"
    assert asyncio.run(handlers._author_team(client, {}, "")) is None
