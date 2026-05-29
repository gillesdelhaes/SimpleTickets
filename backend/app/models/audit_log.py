from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AuditLog(SQLModel, table=True):
    """Append-only audit trail. No UPDATE or DELETE API is provided for this table."""

    __tablename__ = "audit_log"

    id: Optional[int] = Field(default=None, primary_key=True)
    # Null = system action
    actor_id: Optional[int] = Field(default=None, foreign_key="users.id", index=True)
    action: str = Field(index=True)  # e.g. "user.role_changed", "ticket.closed"
    entity_type: str  # e.g. "user", "ticket", "category"
    entity_id: Optional[str] = Field(default=None)  # String to handle both int and str IDs
    # Arbitrary JSON payload (before/after values, metadata)
    payload: Optional[Any] = Field(default=None, sa_column=Column(JSON, nullable=True))
    ip_address: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=utcnow, index=True)
