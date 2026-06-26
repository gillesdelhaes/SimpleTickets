from datetime import datetime
from app.dt import utcnow
from typing import Optional

from sqlalchemy import Column, Enum as SAEnum
from sqlmodel import Field, SQLModel

from app.models.enums import AuthProvider, Role




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
            default=Role.technician,
        )
    )
    auth_provider: AuthProvider = Field(
        sa_column=Column(
            SAEnum(AuthProvider, native_enum=False, name="auth_provider"),
            nullable=False,
            default=AuthProvider.local,
        )
    )
    slack_user_id: Optional[str] = Field(default=None, index=True)
    hashed_password: Optional[str] = Field(default=None)
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=utcnow)
    last_login_at: Optional[datetime] = Field(default=None)
