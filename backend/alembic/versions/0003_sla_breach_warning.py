"""Add sla_breach_warned_at to tickets

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-01
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tickets",
        sa.Column("sla_breach_warned_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tickets", "sla_breach_warned_at")
