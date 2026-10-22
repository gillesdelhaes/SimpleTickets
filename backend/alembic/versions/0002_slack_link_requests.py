"""Pending self-service Slack ID links, confirmed by the Slack account owner

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-22
"""
from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "slack_link_requests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("slack_user_id", sqlmodel.AutoString(), nullable=False),
        sa.Column("token", sqlmodel.AutoString(), nullable=False),
        sa.Column("slack_channel_id", sqlmodel.AutoString(), nullable=True),
        sa.Column("slack_message_ts", sqlmodel.AutoString(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["slack_workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "workspace_id", name="uq_link_request_user_workspace"),
    )
    op.create_index("ix_slack_link_requests_user_id", "slack_link_requests", ["user_id"])
    op.create_index("ix_slack_link_requests_workspace_id", "slack_link_requests", ["workspace_id"])
    op.create_index("ix_slack_link_requests_token", "slack_link_requests", ["token"], unique=True)


def downgrade() -> None:
    op.drop_table("slack_link_requests")
