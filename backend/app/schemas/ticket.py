from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, computed_field, field_validator

from app.models.enums import Priority


class TicketCreate(BaseModel):
    title: str
    description: str
    priority: Priority = Priority.medium
    category_id: Optional[int] = None
    # When set, the ticket is created on behalf of a Slack user (no DB submitter)
    slack_reporter_id: Optional[str] = None
    slack_reporter_name: Optional[str] = None

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
        if len(v) > 10_000:
            raise ValueError("Description cannot exceed 10,000 characters")
        return v


class MarkDuplicateRequest(BaseModel):
    duplicate_of_id: int


class BulkTicketUpdate(BaseModel):
    ids: list[int]
    assignee_id: Optional[int] = None
    priority: Optional[Priority] = None
    status: Optional[str] = None


class TicketUpdate(BaseModel):
    """
    All fields optional. Only fields present in the request body are applied.
    Set assignee_id or category_id to null explicitly to unset them.
    """

    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[Priority] = None
    status: Optional[str] = None
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
            if len(v) > 10_000:
                raise ValueError("Description cannot exceed 10,000 characters")
        return v


class TicketRead(BaseModel):
    id: int
    display_id: str
    title: str
    description: str
    status: str
    priority: Priority

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
    duplicate_of_title: Optional[str] = None

    source: str  # 'web' | 'slack'

    # Slack integration — present when ticket was created from Slack
    slack_channel_id: Optional[str]
    slack_message_ts: Optional[str]

    first_response_deadline: Optional[datetime]
    first_responded_at: Optional[datetime]

    created_at: datetime
    updated_at: datetime
    resolved_at: Optional[datetime]

    @computed_field  # type: ignore[misc]
    @property
    def channel(self) -> Literal['slack', 'web']:
        return 'slack' if self.source == 'slack' else 'web'

    model_config = {"from_attributes": True}


class TicketListResponse(BaseModel):
    items: list[TicketRead]
    total: int
