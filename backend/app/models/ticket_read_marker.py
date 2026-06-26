from datetime import datetime
from app.dt import utcnow
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class TicketReadMarker(SQLModel, table=True):
    """
    Records the last time a user read a ticket's replies.
    One row per (user_id, ticket_id) pair — upserted when user opens a ticket.
    """
    __tablename__ = "ticket_read_markers"
    __table_args__ = (
        UniqueConstraint("user_id", "ticket_id", name="uq_read_marker_user_ticket"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    ticket_id: int = Field(foreign_key="tickets.id", index=True)
    last_read_at: datetime = Field(default_factory=utcnow)
