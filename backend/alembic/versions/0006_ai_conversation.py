"""AI Assistant: a living assessment per ticket, updated as replies come in

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-04
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tickets", sa.Column("ai_assessment", sa.Text(), nullable=True))
    op.add_column("tickets", sa.Column("ai_runs", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("tickets", sa.Column("ai_question_rounds", sa.Integer(), nullable=False, server_default="0"))
    op.get_bind().execute(sa.text(
        "INSERT INTO app_settings (key, value, is_secret, group_name, updated_at) "
        "VALUES ('ai_retitle', 'false', false, 'ai', now() at time zone 'utc'), "
        "('ai_auto_priority', 'false', false, 'ai', now() at time zone 'utc') ON CONFLICT (key) DO NOTHING"
    ))


def downgrade() -> None:
    op.get_bind().execute(sa.text("DELETE FROM app_settings WHERE key IN ('ai_retitle', 'ai_auto_priority')"))
    op.drop_column("tickets", "ai_question_rounds")
    op.drop_column("tickets", "ai_runs")
    op.drop_column("tickets", "ai_assessment")
