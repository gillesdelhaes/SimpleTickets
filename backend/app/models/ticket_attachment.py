from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class TicketAttachment(SQLModel, table=True):
    __tablename__ = "ticket_attachments"

    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(foreign_key="tickets.id", index=True)
    # Null = attachment on the ticket itself (not on a specific reply)
    reply_id: Optional[int] = Field(default=None, foreign_key="ticket_replies.id")
    filename: str  # Original filename shown to users
    storage_path: str  # Relative path under STORAGE_LOCAL_PATH
    mime_type: str
    size_bytes: int
    slack_file_id: Optional[str] = Field(default=None)  # Slack file ID for dedup
    created_at: datetime = Field(default_factory=utcnow)
