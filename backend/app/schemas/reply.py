from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator


_MAX_REPLY_CHARS = 20_000


class ReplyCreate(BaseModel):
    body: str
    is_internal: bool = False

    @field_validator("body")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Reply body cannot be blank")
        if len(v) > _MAX_REPLY_CHARS:
            raise ValueError(f"Reply body cannot exceed {_MAX_REPLY_CHARS:,} characters")
        return v


class ReplyRead(BaseModel):
    id: int
    ticket_id: int
    author_id: Optional[int]
    author_name: Optional[str]   # denormalized
    author_avatar: Optional[str] # denormalized
    body: str
    is_internal: bool
    slack_ts: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}
