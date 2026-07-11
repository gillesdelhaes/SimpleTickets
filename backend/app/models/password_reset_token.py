from datetime import datetime
from app.dt import utcnow
from typing import Optional

from sqlmodel import Field, SQLModel


class PasswordResetToken(SQLModel, table=True):
    """
    A short-lived, single-use code DMed to a user via Slack to let them set a
    new password without admin help. code_hash is bcrypt — never store the
    raw code.
    """
    __tablename__ = "password_reset_tokens"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    code_hash: str
    expires_at: datetime
    used_at: Optional[datetime] = Field(default=None)
    created_at: datetime = Field(default_factory=utcnow)
