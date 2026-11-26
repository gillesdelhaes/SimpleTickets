"""Ask: per-ticket labels (topics), conversations and pinned answers

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-20
"""
from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel
from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "topics",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sqlmodel.AutoString(), nullable=False),
        sa.Column("merged_into_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["merged_into_id"], ["topics.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_topics_name", "topics", ["name"])
    # One topic per name, whatever the case
    op.create_index("ux_topics_name_lower", "topics", [sa.text("lower(name)")], unique=True)

    op.create_table(
        "ticket_insights",
        sa.Column("ticket_id", sa.Integer(), nullable=False),
        sa.Column("topic_id", sa.Integer(), nullable=True),
        sa.Column("system", sqlmodel.AutoString(), nullable=True),
        sa.Column("kind", sqlmodel.AutoString(), nullable=False, server_default="incident"),
        sa.Column("best_category_id", sa.Integer(), nullable=True),
        sa.Column("fit", sqlmodel.AutoString(), nullable=False, server_default="high"),
        sa.Column("resolution", sa.Text(), nullable=True),
        sa.Column("labelled_category_id", sa.Integer(), nullable=True),
        sa.Column("labelled_resolved", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("labelled_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["topic_id"], ["topics.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["best_category_id"], ["categories.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("ticket_id"),
    )
    op.create_index("ix_ticket_insights_topic_id", "ticket_insights", ["topic_id"])
    op.create_index("ix_ticket_insights_system", "ticket_insights", ["system"])
    op.create_index("ix_ticket_insights_kind", "ticket_insights", ["kind"])

    op.create_table(
        "ask_threads",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("title", sqlmodel.AutoString(), nullable=False, server_default=""),
        sa.Column("days", sa.Integer(), nullable=False, server_default="90"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ask_threads_user_id", "ask_threads", ["user_id"])
    op.create_index("ix_ask_threads_updated_at", "ask_threads", ["updated_at"])

    op.create_table(
        "ask_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("thread_id", sa.Integer(), nullable=False),
        sa.Column("role", sqlmodel.AutoString(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False, server_default=""),
        sa.Column("results", sa.Text(), nullable=True),
        sa.Column("calls", sa.Text(), nullable=True),
        sa.Column("blocks", sa.Text(), nullable=True),
        sa.Column("follow_ups", sa.Text(), nullable=True),
        sa.Column("unverified", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("helpful", sa.Boolean(), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["thread_id"], ["ask_threads.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ask_messages_thread_id", "ask_messages", ["thread_id"])

    op.create_table(
        "ask_pins",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("title", sqlmodel.AutoString(), nullable=False),
        sa.Column("question", sqlmodel.AutoString(), nullable=False, server_default=""),
        sa.Column("calls", sa.Text(), nullable=False),
        sa.Column("days", sa.Integer(), nullable=False, server_default="90"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ask_pins_user_id", "ask_pins", ["user_id"])


def downgrade() -> None:
    op.drop_table("ask_pins")
    op.drop_table("ask_messages")
    op.drop_table("ask_threads")
    op.drop_table("ticket_insights")
    op.drop_table("topics")
