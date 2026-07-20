from datetime import datetime
from app.dt import utcnow
from typing import Optional

from sqlmodel import Field, SQLModel


class UserSlackIdentity(SQLModel, table=True):
    """
    A staff member's Slack user ID within one specific workspace. Slack user
    IDs are workspace-scoped — the same technician has a different ID in
    each connected workspace — so this is a join table rather than a single
    column on User. Unique per (user, workspace) and per (workspace, slack
    user id): one identity per person per workspace, and one person per
    Slack ID within a workspace.
    """
    __tablename__ = "user_slack_identities"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    workspace_id: int = Field(foreign_key="slack_workspaces.id", index=True)
    slack_user_id: str
    created_at: datetime = Field(default_factory=utcnow)
