"""app_settings table for DB-backed configuration

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-30
"""
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("key",        sa.String(100), nullable=False),
        sa.Column("value",      sa.Text(),       nullable=True),
        sa.Column("is_secret",  sa.Boolean(),    nullable=False, server_default="false"),
        sa.Column("group_name", sa.String(50),   nullable=False, server_default="app"),
        sa.Column("updated_at", sa.DateTime(),   nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    op.bulk_insert(
        sa.table(
            "app_settings",
            sa.column("key",        sa.String),
            sa.column("value",      sa.Text),
            sa.column("is_secret",  sa.Boolean),
            sa.column("group_name", sa.String),
            sa.column("updated_at", sa.DateTime),
        ),
        [
            # app group
            {"key": "setup_complete",           "value": None,      "is_secret": False, "group_name": "app",     "updated_at": now},
            {"key": "app_base_url",             "value": None,      "is_secret": False, "group_name": "app",     "updated_at": now},
            # app_secret_key is stored plaintext — it IS the encryption key
            {"key": "app_secret_key",           "value": None,      "is_secret": False, "group_name": "app",     "updated_at": now},
            # slack group
            {"key": "slack_bot_token",          "value": None,      "is_secret": True,  "group_name": "slack",   "updated_at": now},
            {"key": "slack_app_token",          "value": None,      "is_secret": True,  "group_name": "slack",   "updated_at": now},
            {"key": "slack_signing_secret",     "value": None,      "is_secret": True,  "group_name": "slack",   "updated_at": now},
            {"key": "slack_trigger_emoji",      "value": "ticket",  "is_secret": False, "group_name": "slack",   "updated_at": now},
            {"key": "slack_monitored_channels", "value": "",        "is_secret": False, "group_name": "slack",   "updated_at": now},
            {"key": "slack_two_way_sync",       "value": "true",    "is_secret": False, "group_name": "slack",   "updated_at": now},
            # storage group
            {"key": "attachment_max_size_mb",   "value": "10",      "is_secret": False, "group_name": "storage", "updated_at": now},
        ],
    )


def downgrade() -> None:
    op.drop_table("app_settings")
