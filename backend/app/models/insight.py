"""What each ticket is about, in a form SQL can group on.

The labelling job (app/ai/labels.py) reads a ticket once and stores a short
topic, the affected system, the kind of request, the category that fits
best, and, once resolved, how it was fixed. Ask's tools group and count
these; nothing at question time re-reads ticket text in bulk.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, ForeignKey, Integer, Text
from sqlmodel import Field, SQLModel

from app.dt import utcnow


class Topic(SQLModel, table=True):
    """A canonical topic, e.g. "SSO login loop". Near-duplicates are merged
    into one by the nightly merge job (merged_into_id points at the survivor)."""
    __tablename__ = "topics"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    merged_into_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("topics.id", ondelete="SET NULL"), nullable=True),
    )
    created_at: datetime = Field(default_factory=utcnow)


class TicketInsight(SQLModel, table=True):
    __tablename__ = "ticket_insights"

    ticket_id: int = Field(
        sa_column=Column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"), primary_key=True),
    )
    topic_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("topics.id", ondelete="SET NULL"), nullable=True, index=True),
    )
    # The affected app or device, e.g. "CRM", "VPN", "Laptop"
    system: Optional[str] = Field(default=None, index=True)
    # incident | request | question | access
    kind: str = Field(default="incident", index=True)
    # The category the ticket fits best (null: none fits) and how well its
    # current category fits: high | medium | low
    best_category_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True),
    )
    fit: str = Field(default="high")
    # How it was fixed, once resolved (short phrase), e.g. "cleared stale session"
    resolution: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    # The category the ticket had when labelled, so a later change re-checks the fit
    labelled_category_id: Optional[int] = Field(default=None)
    labelled_resolved: bool = Field(default=False)
    version: int = Field(default=1)
    labelled_at: datetime = Field(default_factory=utcnow)
