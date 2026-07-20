"""
Slack Users — list one workspace's members for the reporter picker.

GET /slack/workspaces/{workspace_id}/users returns a name-sorted list of
non-bot workspace members. Returns an empty list when that workspace's bot
isn't currently connected. Results are cached in-memory per workspace for 5
minutes to avoid repeated workspace pagination.
"""
import time
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.deps import get_current_user
from app.models import User
from app.slack.bot import get_slack_client

router = APIRouter(prefix="/slack/workspaces", tags=["slack"])

_CACHE_TTL = 300  # 5 minutes
_cache: dict[int, list["SlackUser"]] = {}
_cache_at: dict[int, float] = {}


class SlackUser(BaseModel):
    id: str
    name: str


@router.get("/{workspace_id}/users", response_model=list[SlackUser])
async def list_slack_users(
    workspace_id: int,
    _user: User = Depends(get_current_user),
) -> list[SlackUser]:
    """
    List a Slack workspace's members for the ticket reporter picker.
    Filters out bots and deleted accounts. Requires that workspace's bot to
    be connected. Results are cached for 5 minutes per workspace.
    """
    now = time.monotonic()
    if workspace_id in _cache and now - _cache_at.get(workspace_id, 0.0) < _CACHE_TTL:
        return _cache[workspace_id]

    client = get_slack_client(workspace_id)
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
    _cache[workspace_id] = users
    _cache_at[workspace_id] = now
    return users
