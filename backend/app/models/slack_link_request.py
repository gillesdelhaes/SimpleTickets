from datetime import datetime
from app.dt import utcnow
from typing import Optional

from sqlmodel import Field, SQLModel


class SlackLinkRequest(SQLModel, table=True):
    """
    A staff member's pending request to link a Slack ID to their own account
    (My account page). Nothing is linked until the owner of that Slack
    account clicks 👍 in the confirmation DM the bot sends them — so nobody
    can claim someone else's Slack identity. One pending request per
    (user, workspace); a new request replaces the old one. `token` is the
    button value, so stale or forged buttons can't confirm a different
    request. Admin linking from the Users page bypasses this.
    """
    __tablename__ = "slack_link_requests"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    workspace_id: int = Field(foreign_key="slack_workspaces.id", index=True)
    slack_user_id: str
    token: str = Field(index=True, unique=True)
    # Where the confirmation DM landed, so it can be edited when the request
    # is superseded or cancelled from the web.
    slack_channel_id: Optional[str] = Field(default=None)
    slack_message_ts: Optional[str] = Field(default=None)
    expires_at: datetime
    created_at: datetime = Field(default_factory=utcnow)
