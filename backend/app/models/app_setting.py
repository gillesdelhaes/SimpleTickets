from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class AppSetting(SQLModel, table=True):
    __tablename__ = "app_settings"

    key:        str           = Field(primary_key=True, max_length=100)
    value:      Optional[str] = Field(default=None)
    is_secret:  bool          = Field(default=False)
    group_name: str           = Field(default="app", max_length=50)
    updated_at: datetime      = Field(default_factory=utcnow)
