from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class AttachmentRead(BaseModel):
    id: int
    ticket_id: int
    reply_id: Optional[int]
    filename: str
    mime_type: str
    size_bytes: int
    created_at: datetime

    model_config = {"from_attributes": True}
