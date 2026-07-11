from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.models.enums import AuthProvider, Role


class UserRead(BaseModel):
    id: int
    email: str
    name: str
    role: Role
    auth_provider: AuthProvider
    slack_user_id: Optional[str]
    is_active: bool
    created_at: datetime
    last_login_at: Optional[datetime]

    model_config = {"from_attributes": True}


class UserAdminUpdate(BaseModel):
    """Fields an admin may update on any user account."""
    name: Optional[str] = None
    role: Optional[Role] = None
    is_active: Optional[bool] = None
    slack_user_id: Optional[str] = None

    from pydantic import field_validator

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip()
            if not v:
                raise ValueError("Name cannot be blank")
        return v


class UserListResponse(BaseModel):
    items: list[UserRead]
    total: int
