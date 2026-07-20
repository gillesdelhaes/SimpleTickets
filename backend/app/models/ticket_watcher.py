from datetime import datetime
from app.dt import utcnow
from typing import Optional

from sqlmodel import Field, SQLModel


class TicketWatcher(SQLModel, table=True):
    """
    A staff member (technician/admin) following a ticket they aren't the
    submitter or assignee of. Watchers get a Slack DM on status changes and
    public replies. DB-unique per (ticket, user).
    """
    __tablename__ = "ticket_watchers"

    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(foreign_key="tickets.id", index=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    created_at: datetime = Field(default_factory=utcnow)
