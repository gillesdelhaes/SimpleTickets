"""Slack mentions arrive as bare IDs; they're stored with names attached."""
import asyncio

from app.slack import mentions
from app.slack.mentions import label_mentions, plain_mentions


class FakeClient:
    def __init__(self):
        self.calls = 0

    async def users_info(self, user):
        self.calls += 1
        if user == "U404":
            raise RuntimeError("user_not_found")
        return {"user": {"name": "jdoe", "profile": {"display_name": "", "real_name": "Jane Doe"}}}

    async def conversations_info(self, channel):
        self.calls += 1
        if channel == "CPRIVATE":
            raise RuntimeError("missing_scope")
        return {"channel": {"name": "it-help"}}


def label(text, client=None):
    mentions._cache.clear()
    return asyncio.run(label_mentions(client or FakeClient(), text))


def test_users_and_channels_get_names():
    assert label("ping <@U1> in <#C0CD157MNP9>") == "ping <@U1|Jane Doe> in <#C0CD157MNP9|it-help>"


def test_empty_channel_label_is_filled():
    assert label("see <#C0CD157MNP9|>") == "see <#C0CD157MNP9|it-help>"


def test_existing_labels_and_links_are_left_alone():
    text = "<#C1|general> <https://x.io|site> <!here>"
    client = FakeClient()
    assert label(text, client) == text
    assert client.calls == 0


def test_failed_lookups_keep_the_id():
    assert label("<@U404> <#CPRIVATE>") == "<@U404> <#CPRIVATE>"


def test_repeat_ids_are_looked_up_once():
    client = FakeClient()
    label("<@U1> and <@U1> and <@U1>", client)
    assert client.calls == 1


def test_plain_form_for_titles():
    assert plain_mentions("<@U1|Jane Doe> <#C1|it-help> <#C2> <!here>") == "@Jane Doe #it-help #C2 @here"


# ── Test connection reports missing bot scopes ────────────────────────────────

from app.slack.service import REQUIRED_BOT_SCOPES, missing_bot_scopes, slack_test_success  # noqa: E402


class FakeAuth(dict):
    def __init__(self, scopes):
        super().__init__(team="Acme", user="simpletickets")
        self.headers = {} if scopes is None else {"X-OAuth-Scopes": scopes}


def test_missing_channel_scopes_are_reported():
    granted = ",".join(s for s in REQUIRED_BOT_SCOPES if s not in ("channels:read", "groups:read"))
    assert slack_test_success(FakeAuth(granted))["missing_scopes"] == ["channels:read", "groups:read"]


def test_full_grant_reports_nothing_missing():
    assert missing_bot_scopes(FakeAuth(", ".join(REQUIRED_BOT_SCOPES) + ",users:read.email")) == []


def test_no_scope_header_means_no_warning():
    assert missing_bot_scopes(FakeAuth(None)) == []
