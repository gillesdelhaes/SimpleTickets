from datetime import datetime
from app.dt import utcnow
from typing import Optional

from sqlalchemy import Column, ForeignKey, Integer, Text
from sqlmodel import Field, SQLModel


class EmailOutbox(SQLModel, table=True):
    """Mail waiting to go out through the connected mailbox. Sent by a
    scheduler job (app/email/outbox.py) so a slow or failing Gmail never
    blocks a request, and retried with backoff."""
    __tablename__ = "email_outbox"

    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(
        sa_column=Column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    # Set for a technician reply — its attachments go out with it
    reply_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("ticket_replies.id", ondelete="CASCADE"), nullable=True),
    )
    # 'reply' | 'ack' | 'update' (status and/or assignee change; body is JSON)
    kind: str
    # Who the requester sees as the sender, e.g. the technician's name
    author_name: Optional[str] = Field(default=None)
    body: str = Field(sa_column=Column(Text, nullable=False))
    send_after: datetime = Field(default_factory=utcnow, index=True)
    sent_at: Optional[datetime] = Field(default=None)
    attempts: int = Field(default=0)
    last_error: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: datetime = Field(default_factory=utcnow)
