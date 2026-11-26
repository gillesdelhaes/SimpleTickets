"""Ask: conversations with the AI about the ticket data, and pinned answers."""
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, ForeignKey, Integer, Text
from sqlmodel import Field, SQLModel

from app.dt import utcnow


class AskThread(SQLModel, table=True):
    """One conversation. Private to the person who started it."""
    __tablename__ = "ask_threads"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
    )
    title: str = Field(default="")
    # The date window the conversation looks at, in days
    days: int = Field(default=90)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow, index=True)


class AskMessage(SQLModel, table=True):
    __tablename__ = "ask_messages"

    id: Optional[int] = Field(default=None, primary_key=True)
    thread_id: int = Field(
        sa_column=Column(Integer, ForeignKey("ask_threads.id", ondelete="CASCADE"), nullable=False, index=True),
    )
    # user | assistant
    role: str
    text: str = Field(default="", sa_column=Column(Text, nullable=False, server_default=""))
    # Assistant only, as JSON: the tool results the answer shows (blocks),
    # the tool calls that made them (calls, for pinning), follow-up questions
    results: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    calls: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    blocks: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    follow_ups: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    # Numbers in the text that weren't found in any tool result
    unverified: bool = Field(default=False)
    error: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    # Thumbs up/down from the asker; null = no rating
    helpful: Optional[bool] = Field(default=None)
    input_tokens: int = Field(default=0)
    output_tokens: int = Field(default=0)
    created_at: datetime = Field(default_factory=utcnow)


class AskPin(SQLModel, table=True):
    """A saved answer: its tool calls are re-run (no AI) to refresh it."""
    __tablename__ = "ask_pins"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
    )
    title: str
    question: str = Field(default="")
    # JSON list of {"tool": name, "args": {...}}
    calls: str = Field(sa_column=Column(Text, nullable=False))
    days: int = Field(default=90)
    created_at: datetime = Field(default_factory=utcnow)
