from datetime import datetime
from app.dt import utcnow
from typing import Optional

from sqlmodel import Field, SQLModel


class SlackWorkspace(SQLModel, table=True):
    """
    One connected Slack workspace (a separately-created Slack app + its own
    Socket Mode connection). A single SimpleTickets deployment can have many
    of these — every ticket that originates from Slack is tagged with the
    workspace it came from (see Ticket.workspace_id), so replies/DMs route
    back through the correct bot automatically.

    bot_token / app_token / signing_secret are stored encrypted at rest
    (see services/settings_service.encrypt_value / decrypt_value).
    """
    __tablename__ = "slack_workspaces"

    id: Optional[int] = Field(default=None, primary_key=True)

    # Admin-supplied display name, e.g. "Acme Corp"
    name: str

    # Populated from Slack's auth.test response on first successful connect —
    # used to show the real workspace name and to reject connecting the same
    # Slack workspace twice under two different rows.
    team_id: Optional[str] = Field(default=None, index=True)
    team_name: Optional[str] = Field(default=None)

    # Encrypted at rest (Fernet, via settings_service.encrypt_value)
    bot_token: str = Field(default="")
    app_token: str = Field(default="")
    signing_secret: str = Field(default="")

    trigger_emoji: str = Field(default="clipboard")
    two_way_sync: bool = Field(default=True)
    # Person (Slack user ID) or channel (Slack channel ID) DMed on SLA
    # breach warnings for tickets in this workspace. Empty = all active
    # technicians linked to this workspace.
    sla_escalation_target: Optional[str] = Field(default=None)

    # Slack channel ID posted to whenever a new ticket is created in this
    # workspace (any source: DM, /ticket, reaction, message shortcut, web).
    # None = no announcement. Deliberately channel-only (no requester name or
    # description in the message) — visibility, not a second intake surface.
    ticket_created_target: Optional[str] = Field(default=None)

    # Soft on/off switch — disconnects the bot without losing history or
    # credentials. Historical tickets keep pointing at this row either way.
    is_active: bool = Field(default=True)

    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
