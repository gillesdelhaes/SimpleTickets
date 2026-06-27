"""CSAT survey — ticket_csat table, sends_csat flag on statuses, auto-close setting

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-27
"""
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_now = datetime.now(timezone.utc).replace(tzinfo=None)


def upgrade() -> None:
    # Add sends_csat column to ticket_statuses
    op.add_column(
        "ticket_statuses",
        sa.Column("sends_csat", sa.Boolean(), nullable=False, server_default="false"),
    )
    # The "resolved" status triggers the CSAT survey
    op.execute("UPDATE ticket_statuses SET sends_csat = TRUE WHERE name = 'resolved'")

    # Create ticket_csat table
    op.create_table(
        "ticket_csat",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("ticket_id", sa.Integer(), nullable=False),
        sa.Column("score", sa.Boolean(), nullable=False),
        sa.Column("responded_at", sa.DateTime(), nullable=False),
        sa.Column("slack_user_id", sqlmodel.AutoString(), nullable=False),
        sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ticket_csat_ticket_id", "ticket_csat", ["ticket_id"], unique=False)

    # Seed csat_auto_close_days setting (default: 7 days)
    op.execute(
        sa.text(
            "INSERT INTO app_settings (key, value, is_secret, group_name, updated_at) "
            "VALUES ('csat_auto_close_days', '7', FALSE, 'app', :now) "
            "ON CONFLICT (key) DO NOTHING"
        ).bindparams(now=_now)
    )


def downgrade() -> None:
    op.execute("DELETE FROM app_settings WHERE key = 'csat_auto_close_days'")
    op.drop_index("ix_ticket_csat_ticket_id", table_name="ticket_csat")
    op.drop_table("ticket_csat")
    op.drop_column("ticket_statuses", "sends_csat")
