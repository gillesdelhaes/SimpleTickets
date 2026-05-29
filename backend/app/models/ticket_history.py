from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TicketHistory(SQLModel, table=True):
    """Immutable append-only log of every field change on a ticket."""

    __tablename__ = "ticket_history"

    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(foreign_key="tickets.id", index=True)
    # Null actor = system action (e.g. SLA breach flag, auto-close)
    actor_id: Optional[int] = Field(default=None, foreign_key="users.id")
    field_changed: str  # e.g. "status", "priority", "assignee_id"
    old_value: Optional[str] = Field(default=None)  # JSON-serialised string
    new_value: Optional[str] = Field(default=None)  # JSON-serialised string
    created_at: datetime = Field(default_factory=utcnow, index=True)
