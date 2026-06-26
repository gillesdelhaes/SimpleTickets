"""Add unique constraint on ticket_read_markers(user_id, ticket_id)

Revision ID: a1b2c3d4e5f6
Revises: 0001
Create Date: 2026-06-26
"""
from typing import Sequence, Union

from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_read_marker_user_ticket",
        "ticket_read_markers",
        ["user_id", "ticket_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_read_marker_user_ticket",
        "ticket_read_markers",
    )
