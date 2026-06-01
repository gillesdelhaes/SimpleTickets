from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Column, Enum as SAEnum, String, Text
from sqlmodel import Field, SQLModel

from app.models.enums import Priority


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Ticket(SQLModel, table=True):
    __tablename__ = "tickets"

    id: Optional[int] = Field(default=None, primary_key=True)

    # Core fields
    title: str
    description: str = Field(sa_column=Column(Text, nullable=False))
    status: str = Field(
        sa_column=Column(String, nullable=False, default="open", index=True)
    )
    priority: Priority = Field(
        sa_column=Column(
            SAEnum(Priority, native_enum=False, name="ticket_priority"),
            nullable=False,
            default=Priority.medium,
            index=True,
        )
    )

    # Relationships (FK only — no ORM lazy-load needed at this scale)
    category_id: Optional[int] = Field(default=None, foreign_key="categories.id")
    submitter_id: Optional[int] = Field(default=None, foreign_key="users.id", index=True)
    assignee_id: Optional[int] = Field(default=None, foreign_key="users.id", index=True)

    # Unmatched Slack submitter — set when submitter_id is null
    slack_submitter_name: Optional[str] = Field(default=None)
    # Slack user ID of whoever submitted the ticket via Slack (all creation paths)
    slack_submitter_id: Optional[str] = Field(default=None, index=True)

    # SLA — policy snapshot at creation time; null = no SLA configured
    sla_policy_id: Optional[int] = Field(default=None, foreign_key="sla_policies.id")
    sla_deadline: Optional[datetime] = Field(default=None)
    sla_breached: bool = Field(default=False)
    # Tracks cumulative paused time (seconds) for accurate remaining calculation
    sla_paused_at: Optional[datetime] = Field(default=None)
    sla_paused_seconds: int = Field(default=0)
    # Set when the 15-min breach warning DM has been sent — prevents re-sends
    sla_breach_warned_at: Optional[datetime] = Field(default=None)

    # Origin: 'web' = created via web portal, 'slack' = created via Slack
    source: str = Field(default="slack")

    # Slack integration
    slack_channel_id: Optional[str] = Field(default=None)
    slack_message_ts: Optional[str] = Field(default=None)

    # Duplicate link
    duplicate_of_id: Optional[int] = Field(default=None, foreign_key="tickets.id")

    # Timestamps
    created_at: datetime = Field(default_factory=utcnow, index=True)
    updated_at: datetime = Field(default_factory=utcnow)
    resolved_at: Optional[datetime] = Field(default=None)
    # First-response SLA — deadline set at creation, timestamp set on first public tech reply
    first_response_deadline: Optional[datetime] = Field(default=None)
    first_responded_at: Optional[datetime] = Field(default=None)
    # Set when the 15-min first-response warning DM has been sent
    first_response_warned_at: Optional[datetime] = Field(default=None)

    @property
    def display_id(self) -> str:
        """Human-readable ticket ID, e.g. TKT-0042."""
        if self.id is None:
            return "TKT-????"
        return f"TKT-{self.id:04d}"
