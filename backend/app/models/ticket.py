from datetime import datetime
from app.dt import utcnow
from typing import Optional

from sqlalchemy import Column, Enum as SAEnum, String, Text
from sqlmodel import Field, SQLModel

from app.models.enums import Priority




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

    # Display name of a requester with no platform account (submitter_id is
    # null) — a Slack user, or an email sender's name
    slack_submitter_name: Optional[str] = Field(default=None)
    # Slack user ID of whoever submitted the ticket via Slack (all creation paths)
    slack_submitter_id: Optional[str] = Field(default=None, index=True)

    # SLA — policy snapshot at creation time; null = no SLA configured
    sla_policy_id: Optional[int] = Field(default=None, foreign_key="sla_policies.id")
    sla_deadline: Optional[datetime] = Field(default=None)
    sla_breached: bool = Field(default=False)
    # SLA clock. It is stopped while the ticket sits in a status that pauses
    # the SLA (e.g. Pending user) *or* in a resolved/closed status:
    # sla_paused_at = when it last stopped (null = running), and
    # sla_paused_seconds = SLA-clock seconds (business-hours aware) spent
    # stopped so far. Owned by services.sla.transition_status.
    sla_paused_at: Optional[datetime] = Field(default=None)
    sla_paused_seconds: int = Field(default=0)
    # Set when the 15-min breach warning DM has been sent — prevents re-sends
    sla_breach_warned_at: Optional[datetime] = Field(default=None)

    # Origin: 'web' = web portal, 'slack' = Slack, 'email' = the connected mailbox
    source: str = Field(default="slack")

    # Email channel (source == 'email'). The Gmail thread the conversation
    # lives in, and the requester's address (lowercase), which is also their
    # identity when they have no account.
    email_thread_id: Optional[str] = Field(default=None, index=True)
    email_requester: Optional[str] = Field(default=None, index=True)
    # Original subject, reused as "Re: …" on outgoing mail
    email_subject: Optional[str] = Field(default=None)
    # Message-ID of the email that opened the ticket
    email_message_id: Optional[str] = Field(default=None, index=True)
    # Who may reply publicly by email: JSON list of lowercase addresses (the
    # requester plus the To/Cc of the opening email). Anyone else's mail on
    # the thread lands as an internal note.
    email_participants: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    # Threading headers for the next outgoing message
    email_last_message_id: Optional[str] = Field(default=None)
    email_references: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    # Email requester ↔ Slack user, so their email and Slack tickets count as
    # one person. Identity only: it never moves the conversation to Slack
    # (deliberately not slack_submitter_id/workspace_id, which drive Slack
    # DMs, surveys and App Home). Kept the same on every ticket from the same
    # address. slack_link_source: 'auto' (matched by email in Slack),
    # 'manual' (set by a technician), 'none' (a technician unlinked it — don't
    # auto-match again), or null (never decided).
    linked_slack_id: Optional[str] = Field(default=None, index=True)
    linked_workspace_id: Optional[int] = Field(default=None, foreign_key="slack_workspaces.id")
    linked_slack_name: Optional[str] = Field(default=None)
    slack_link_source: Optional[str] = Field(default=None)

    # AI Assistant triage: when its note was written, and how many runs were
    # tried (a failing ticket is given up on after a few)
    ai_triaged_at: Optional[datetime] = Field(default=None)
    ai_triage_attempts: int = Field(default=0)

    # Which connected Slack workspace this ticket came from (null = no Slack
    # origin — a pure web-portal ticket with no Slack reporter). Determines
    # which workspace's bot handles replies/DMs/thread sync for this ticket.
    workspace_id: Optional[int] = Field(default=None, foreign_key="slack_workspaces.id", index=True)

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
