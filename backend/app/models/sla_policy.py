from typing import Optional

from sqlalchemy import Column, Enum as SAEnum
from sqlmodel import Field, SQLModel

from app.models.enums import Priority


class SLAPolicy(SQLModel, table=True):
    __tablename__ = "sla_policies"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    # One policy per priority — enforced at application layer
    priority: Priority = Field(
        sa_column=Column(
            SAEnum(Priority, native_enum=False, name="sla_priority"),
            nullable=False,
            index=True,
        )
    )
    first_response_minutes: int
    resolution_minutes: int
