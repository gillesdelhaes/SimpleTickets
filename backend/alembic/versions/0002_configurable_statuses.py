"""Configurable ticket statuses

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-01
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DEFAULTS = [
    {"name": "open",         "label": "Open",         "color": "#3B82F6", "pauses_sla": False, "is_default": True,  "is_resolved_state": False, "sort_order": 0},
    {"name": "in_progress",  "label": "In Progress",  "color": "#FF4713", "pauses_sla": False, "is_default": False, "is_resolved_state": False, "sort_order": 1},
    {"name": "pending_user", "label": "Pending User", "color": "#F59E0B", "pauses_sla": True,  "is_default": False, "is_resolved_state": False, "sort_order": 2},
    {"name": "resolved",     "label": "Resolved",     "color": "#10B981", "pauses_sla": False, "is_default": False, "is_resolved_state": True,  "sort_order": 3},
    {"name": "closed",       "label": "Closed",       "color": "#737373", "pauses_sla": False, "is_default": False, "is_resolved_state": True,  "sort_order": 4},
]


def upgrade() -> None:
    op.create_table(
        "ticket_statuses",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("color", sa.String(), nullable=False),
        sa.Column("pauses_sla", sa.Boolean(), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        sa.Column("is_resolved_state", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_archived", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ticket_statuses_name", "ticket_statuses", ["name"], unique=True)

    op.bulk_insert(
        sa.table(
            "ticket_statuses",
            sa.column("name", sa.String),
            sa.column("label", sa.String),
            sa.column("color", sa.String),
            sa.column("pauses_sla", sa.Boolean),
            sa.column("is_default", sa.Boolean),
            sa.column("is_resolved_state", sa.Boolean),
            sa.column("sort_order", sa.Integer),
            sa.column("is_archived", sa.Boolean),
        ),
        [{**row, "is_archived": False} for row in _DEFAULTS],
    )


def downgrade() -> None:
    op.drop_index("ix_ticket_statuses_name", table_name="ticket_statuses")
    op.drop_table("ticket_statuses")
