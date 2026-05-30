from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class TicketReadMarker(SQLModel, table=True):
    """
    Records the last time a user read a ticket's replies.
    One row per (user_id, ticket_id) pair — upserted when user opens a ticket.
    """
    __tablename__ = "ticket_read_markers"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    ticket_id: int = Field(foreign_key="tickets.id", index=True)
    last_read_at: datetime = Field(default_factory=utcnow)
