from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class TicketCSAT(SQLModel, table=True):
    __tablename__ = "ticket_csat"

    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(foreign_key="tickets.id", index=True)
    score: bool  # True = positive (👍), False = negative (👎)
    responded_at: datetime
    dm_ts: Optional[str] = Field(default=None)  # Slack message ts; DB-unique per ticket, guards concurrent double-clicks
