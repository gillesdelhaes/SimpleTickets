"""AI Assistant: one "Fill in ticket details" switch; the summary is always on

Replaces ai_auto_category, ai_retitle and ai_auto_priority with
ai_fill_details (on if any of them was on), and drops ai_triage_note: with
the Assistant on, technicians always get its summary.

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-13
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD = ("ai_auto_category", "ai_retitle", "ai_auto_priority")


def upgrade() -> None:
    conn = op.get_bind()
    any_on = conn.execute(
        sa.text("SELECT count(*) FROM app_settings WHERE key = ANY(:keys) AND value = 'true'"), {"keys": list(_OLD)},
    ).scalar_one() > 0
    conn.execute(sa.text(
        "INSERT INTO app_settings (key, value, is_secret, group_name, updated_at) "
        "VALUES ('ai_fill_details', :v, false, 'ai', now() at time zone 'utc') ON CONFLICT (key) DO NOTHING"
    ), {"v": "true" if any_on else "false"})
    conn.execute(sa.text("DELETE FROM app_settings WHERE key = ANY(:keys)"), {"keys": [*_OLD, "ai_triage_note"]})


def downgrade() -> None:
    conn = op.get_bind()
    on = conn.execute(sa.text("SELECT value FROM app_settings WHERE key = 'ai_fill_details'")).scalar_one_or_none()
    for key, value in [*((k, on or "false") for k in _OLD), ("ai_triage_note", "true")]:
        conn.execute(sa.text(
            "INSERT INTO app_settings (key, value, is_secret, group_name, updated_at) "
            "VALUES (:k, :v, false, 'ai', now() at time zone 'utc') ON CONFLICT (key) DO NOTHING"
        ), {"k": key, "v": value})
    conn.execute(sa.text("DELETE FROM app_settings WHERE key = 'ai_fill_details'"))
