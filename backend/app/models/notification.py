from datetime import datetime
from app.dt import utcnow
from typing import Optional

from sqlmodel import Field, SQLModel


class Notification(SQLModel, table=True):
    """
    One in-app (bell) notification for one staff member about one ticket:
    assigned to you, SLA about to breach / breached, or a 👎 survey answer.
    Unread replies are not stored here — they're computed from read markers.
    Opening the ticket marks its notifications read.
    """
    __tablename__ = "notifications"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    ticket_id: int = Field(foreign_key="tickets.id", index=True)
    # assigned | sla_warning | first_response_warning | sla_breached | csat_negative
    kind: str
    actor_name: Optional[str] = Field(default=None)  # who assigned it, for "assigned"
    created_at: datetime = Field(default_factory=utcnow)
    read_at: Optional[datetime] = Field(default=None)
