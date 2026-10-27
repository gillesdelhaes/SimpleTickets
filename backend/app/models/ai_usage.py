from datetime import datetime
from app.dt import utcnow
from typing import Optional

from sqlalchemy import Column, ForeignKey, Integer, Text
from sqlmodel import Field, SQLModel


class AIUsage(SQLModel, table=True):
    """One AI model run: what it was for, which model, tokens used and
    whether it worked. Feeds the daily token budget and the usage panel."""
    __tablename__ = "ai_usage"

    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=utcnow, index=True)
    # 'triage' | 'test'
    feature: str
    ticket_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("tickets.id", ondelete="SET NULL"), nullable=True),
    )
    provider: str
    model: str
    input_tokens: int = Field(default=0)
    output_tokens: int = Field(default=0)
    requests: int = Field(default=0)
    duration_ms: int = Field(default=0)
    ok: bool = Field(default=True)
    error: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
