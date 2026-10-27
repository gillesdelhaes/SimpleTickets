"""AI Assistant: provider settings, usage log, triage notes

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-27
"""
from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (key, default value, is_secret)
_SETTINGS = [
    ("ai_enabled", "false", False),
    ("ai_enabled_at", None, False),
    ("ai_provider", None, False),
    ("ai_model", None, False),
    ("ai_base_url", None, False),
    ("ai_api_key", None, True),
    ("ai_daily_token_budget", "200000", False),
    ("ai_company_context", None, False),
    ("ai_triage_note", "true", False),
    ("ai_last_error", None, False),
]


def upgrade() -> None:
    op.add_column("ticket_replies", sa.Column("ai_generated", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("tickets", sa.Column("ai_triaged_at", sa.DateTime(), nullable=True))
    op.add_column("tickets", sa.Column("ai_triage_attempts", sa.Integer(), nullable=False, server_default="0"))

    op.create_table(
        "ai_usage",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("feature", sqlmodel.AutoString(), nullable=False),
        sa.Column("ticket_id", sa.Integer(), nullable=True),
        sa.Column("provider", sqlmodel.AutoString(), nullable=False),
        sa.Column("model", sqlmodel.AutoString(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("requests", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("duration_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ok", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_usage_created_at", "ai_usage", ["created_at"])

    conn = op.get_bind()
    for key, value, is_secret in _SETTINGS:
        conn.execute(
            sa.text(
                "INSERT INTO app_settings (key, value, is_secret, group_name, updated_at) "
                "VALUES (:key, :value, :is_secret, 'ai', now() at time zone 'utc') "
                "ON CONFLICT (key) DO NOTHING"
            ),
            {"key": key, "value": value, "is_secret": is_secret},
        )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text("DELETE FROM app_settings WHERE key = ANY(:keys)"),
        {"keys": [k for k, _, _ in _SETTINGS]},
    )
    op.drop_table("ai_usage")
    op.drop_column("tickets", "ai_triage_attempts")
    op.drop_column("tickets", "ai_triaged_at")
    op.drop_column("ticket_replies", "ai_generated")
