from sqlalchemy import Column, Enum as SAEnum
from sqlmodel import Field, SQLModel

from app.models.enums import NotificationEvent


class NotificationPreference(SQLModel, table=True):
    """Per-user opt-out preferences. A missing row means 'enabled' (opt-out model)."""

    __tablename__ = "notification_preferences"

    user_id: int = Field(foreign_key="users.id", primary_key=True)
    event_type: NotificationEvent = Field(
        sa_column=Column(
            SAEnum(NotificationEvent, native_enum=False, name="notification_event"),
            nullable=False,
            primary_key=True,
        )
    )
    enabled: bool = Field(default=True)
