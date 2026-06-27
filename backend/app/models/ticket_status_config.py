from typing import Optional

from sqlmodel import Field, SQLModel


class TicketStatusConfig(SQLModel, table=True):
    """Admin-configurable ticket statuses with SLA and lifecycle flags."""

    __tablename__ = "ticket_statuses"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)  # Slug stored in tickets.status
    label: str                                   # Display name
    color: str = Field(default="#737373")        # Hex colour for UI badges
    pauses_sla: bool = Field(default=False)      # SLA clock stops in this status
    is_default: bool = Field(default=False)      # Applied to newly created tickets
    is_resolved_state: bool = Field(default=False)  # Triggers resolved_at; re-opens on Slack reply
    sort_order: int = Field(default=0)
    is_archived: bool = Field(default=False)     # Hidden from pickers; existing tickets unaffected
    sends_csat: bool = Field(default=False)      # DM the submitter for CSAT on entering this status
