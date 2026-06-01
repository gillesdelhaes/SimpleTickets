"""Add first_response_warned_at to tickets

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-01
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tickets",
        sa.Column("first_response_warned_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tickets", "first_response_warned_at")
