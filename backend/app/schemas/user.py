from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.models.enums import AuthProvider, Role


class SlackIdentityRead(BaseModel):
    """A staff member's linked Slack identity within one workspace. Slack
    user IDs are workspace-specific, so a staff member can have one of these
    per connected workspace."""
    workspace_id: int
    workspace_name: str
    slack_user_id: str


class UserRead(BaseModel):
    id: int
    email: str
    name: str
    role: Role
    auth_provider: AuthProvider
    slack_identities: list[SlackIdentityRead] = []
    is_active: bool
    created_at: datetime
    last_login_at: Optional[datetime]

    model_config = {"from_attributes": True}


class UserAdminUpdate(BaseModel):
    """Fields an admin may update on any user account. Slack identities are
    managed separately (per workspace) via PUT /admin/users/{id}/slack-identity/{workspace_id}."""
    name: Optional[str] = None
    role: Optional[Role] = None
    is_active: Optional[bool] = None

    from pydantic import field_validator

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip()
            if not v:
                raise ValueError("Name cannot be blank")
        return v


class SlackIdentityUpdate(BaseModel):
    """Body for PUT /admin/users/{id}/slack-identity/{workspace_id}. A null
    slack_user_id unlinks the identity for that workspace."""
    slack_user_id: Optional[str] = None


class UserListResponse(BaseModel):
    items: list[UserRead]
    total: int
