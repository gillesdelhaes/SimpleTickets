"""
Slack Users — list workspace members for the reporter picker.

GET /slack/users  returns a name-sorted list of non-bot workspace members.
Returns an empty list when Slack is not configured.
Results are cached in-memory for 5 minutes to avoid repeated workspace pagination.
"""
import time
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.deps import get_current_user
from app.models import User
from app.slack.bot import get_slack_client

router = APIRouter(prefix="/slack", tags=["slack"])

_CACHE_TTL = 300  # 5 minutes
_cache: list["SlackUser"] = []
_cache_at: float = 0.0


class SlackUser(BaseModel):
    id: str
    name: str


@router.get("/users", response_model=list[SlackUser])
async def list_slack_users(
    _user: User = Depends(get_current_user),
) -> list[SlackUser]:
    """
    List Slack workspace users for the ticket reporter picker.
    Filters out bots and deleted accounts. Requires Slack to be configured.
    Results are cached for 5 minutes.
    """
    global _cache, _cache_at

    if _cache and time.monotonic() - _cache_at < _CACHE_TTL:
        return _cache

    client = get_slack_client()
    if client is None:
        return []

    users: list[SlackUser] = []
    cursor: str | None = None

    while True:
        kwargs: dict = {"limit": 200}
        if cursor:
            kwargs["cursor"] = cursor

        result = await client.users_list(**kwargs)

        for member in result.get("members", []):
            if member.get("deleted") or member.get("is_bot"):
                continue
            if member.get("id") == "USLACKBOT":
                continue
            profile = member.get("profile", {})
            name = (
                profile.get("real_name")
                or profile.get("display_name")
                or member.get("name", "")
            ).strip()
            if name:
                users.append(SlackUser(id=member["id"], name=name))

        meta = result.get("response_metadata") or {}
        cursor = meta.get("next_cursor") or None
        if not cursor:
            break

    users.sort(key=lambda u: u.name.lower())
    _cache = users
    _cache_at = time.monotonic()
    return users
