from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Column, Text
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TicketReply(SQLModel, table=True):
    __tablename__ = "ticket_replies"

    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(foreign_key="tickets.id", index=True)
    # Null author = system-generated message (e.g. duplicate notice, SLA breach)
    author_id: Optional[int] = Field(default=None, foreign_key="users.id")
    body: str = Field(sa_column=Column(Text, nullable=False))
    # True = internal note (technicians only), False = public reply
    is_internal: bool = Field(default=False)
    # Slack thread message timestamp — set when this reply was synced from/to Slack
    slack_ts: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=utcnow)
