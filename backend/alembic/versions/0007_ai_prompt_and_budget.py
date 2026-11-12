"""AI Assistant: base prompt editable in Settings; default daily budget 10M tokens

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-12
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    # Null = the built-in prompt (app.ai.triage.DEFAULT_INSTRUCTIONS)
    conn.execute(sa.text(
        "INSERT INTO app_settings (key, value, is_secret, group_name, updated_at) "
        "VALUES ('ai_instructions', NULL, false, 'ai', now() at time zone 'utc') ON CONFLICT (key) DO NOTHING"
    ))
    # Only installs still on the old default; a budget an admin chose is kept
    conn.execute(sa.text(
        "UPDATE app_settings SET value = '10000000' WHERE key = 'ai_daily_token_budget' AND value = '200000'"
    ))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text(
        "UPDATE app_settings SET value = '200000' WHERE key = 'ai_daily_token_budget' AND value = '10000000'"
    ))
    conn.execute(sa.text("DELETE FROM app_settings WHERE key = 'ai_instructions'"))
