from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator

from app.models.enums import Channel, Priority, TicketStatus


class TicketCreate(BaseModel):
    title: str
    description: str
    priority: Priority = Priority.medium
    category_id: Optional[int] = None

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Title cannot be blank")
        if len(v) > 255:
            raise ValueError("Title cannot exceed 255 characters")
        return v

    @field_validator("description")
    @classmethod
    def description_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Description cannot be blank")
        return v


class TicketUpdate(BaseModel):
    """
    All fields optional. Only fields present in the request body are applied.
    Set assignee_id or category_id to null explicitly to unset them.
    """

    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[Priority] = None
    status: Optional[TicketStatus] = None
    category_id: Optional[int] = None
    assignee_id: Optional[int] = None

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip()
            if not v:
                raise ValueError("Title cannot be blank")
            if len(v) > 255:
                raise ValueError("Title cannot exceed 255 characters")
        return v

    @field_validator("description")
    @classmethod
    def description_not_blank(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip()
            if not v:
                raise ValueError("Description cannot be blank")
        return v


class TicketRead(BaseModel):
    id: int
    display_id: str
    title: str
    description: str
    status: TicketStatus
    priority: Priority
    channel: Channel

    category_id: Optional[int]
    category_name: Optional[str]

    submitter_id: Optional[int]
    submitter_name: Optional[str]

    assignee_id: Optional[int]
    assignee_name: Optional[str]

    sla_policy_id: Optional[int]
    sla_deadline: Optional[datetime]
    sla_breached: bool

    duplicate_of_id: Optional[int]

    # Slack integration — present when ticket was created from Slack
    slack_channel_id: Optional[str]
    slack_message_ts: Optional[str]

    created_at: datetime
    updated_at: datetime
    resolved_at: Optional[datetime]

    model_config = {"from_attributes": True}


class TicketListResponse(BaseModel):
    items: list[TicketRead]
    total: int
