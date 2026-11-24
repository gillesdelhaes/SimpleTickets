"""
Name the people and channels a Slack message points at.

Slack delivers mentions as bare IDs — `<@U0123ABC>`, `<#C0CD157MNP9>` (or
`<#C…|>` with an empty label). Stored as-is, the web portal can only show the
ID. At ingest we look the names up once and keep them in the token
(`<@U0123ABC|Jane Doe>`, `<#C0CD157MNP9|it-help>`), which both Slack and the
portal's RichText render by name.

Lookups that fail (missing channels:read / groups:read scope, a private
channel the bot isn't in, a user from another workspace) leave the token
untouched, so the worst case is today's behaviour.
"""
import logging
import re
import time
from typing import Any

logger = logging.getLogger(__name__)

# <@U123>, <@W123>, <#C123>, <#G123> with no label or an empty one.
_UNLABELLED = re.compile(r"<([@#])([UWCG][A-Z0-9]+)\|?>")
# Any mention token, labelled or not — for the plain-text form.
_TOKEN = re.compile(r"<([@#])([UWCG][A-Z0-9]+)(?:\|([^<>]*))?>|<!(here|channel|everyone)(?:\|[^<>]*)?>")

_TTL = 600.0
_cache: dict[tuple[str, str], tuple[float, str | None]] = {}


async def _lookup(client: Any, kind: str, ident: str) -> str | None:
    key = (kind, ident)
    hit = _cache.get(key)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    name: str | None = None
    try:
        if kind == "@":
            user = (await client.users_info(user=ident)).get("user") or {}
            profile = user.get("profile") or {}
            name = profile.get("display_name") or profile.get("real_name") or user.get("name") or None
        else:
            channel = (await client.conversations_info(channel=ident)).get("channel") or {}
            name = channel.get("name") or None
    except Exception as exc:  # noqa: BLE001 — scope/permission errors fall back to the ID
        logger.debug("Could not resolve Slack %s%s: %s", kind, ident, exc)
    _cache[key] = (time.monotonic() + _TTL, name)
    return name


def _clean(name: str) -> str:
    # The label sits inside <…|label>; keep it from closing the token early.
    return name.replace("<", "").replace(">", "").replace("|", "")


async def label_mentions(client: Any, text: str) -> str:
    """Return `text` with every unlabelled user/channel mention given its name."""
    if not text or "<" not in text:
        return text
    found = {(m.group(1), m.group(2)) for m in _UNLABELLED.finditer(text)}
    if not found:
        return text
    names = {key: await _lookup(client, *key) for key in found}

    def sub(m: re.Match) -> str:
        name = names.get((m.group(1), m.group(2)))
        return f"<{m.group(1)}{m.group(2)}|{_clean(name)}>" if name else m.group(0)

    return _UNLABELLED.sub(sub, text)


def plain_mentions(text: str) -> str:
    """Mention tokens as readable text (`@Jane Doe`, `#it-help`, `@here`) —
    for places that show text verbatim, like ticket titles and modal inputs."""
    if not text or "<" not in text:
        return text

    def sub(m: re.Match) -> str:
        if m.group(4):
            return f"@{m.group(4)}"
        return f"{m.group(1)}{m.group(3) or m.group(2)}"

    return _TOKEN.sub(sub, text)
