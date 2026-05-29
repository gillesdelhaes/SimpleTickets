from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Column, Enum as SAEnum, String
from sqlmodel import Field, SQLModel

from app.models.enums import AuthProvider, Role


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(unique=True, index=True)
    name: str
    avatar_url: Optional[str] = Field(default=None)
    role: Role = Field(
        sa_column=Column(
            SAEnum(Role, native_enum=False, name="role"),
            nullable=False,
            default=Role.end_user,
        )
    )
    auth_provider: AuthProvider = Field(
        sa_column=Column(
            SAEnum(AuthProvider, native_enum=False, name="auth_provider"),
            nullable=False,
            default=AuthProvider.google,
        )
    )
    # Nullable unique — a user has either google_sub OR hashed_password, not both
    google_sub: Optional[str] = Field(
        default=None,
        sa_column=Column(String(255), unique=True, nullable=True),
    )
    slack_user_id: Optional[str] = Field(default=None, index=True)
    hashed_password: Optional[str] = Field(default=None)
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=utcnow)
    last_login_at: Optional[datetime] = Field(default=None)
