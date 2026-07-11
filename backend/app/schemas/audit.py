from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class AuditLogRead(BaseModel):
    id: int
    actor_id: Optional[int]
    actor_name: Optional[str]   # denormalized from users join
    actor_email: Optional[str]  # denormalized
    action: str
    entity_type: str
    entity_id: Optional[str]
    payload: Optional[Any]
    ip_address: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class AuditLogResponse(BaseModel):
    items: list[AuditLogRead]
    total: int
