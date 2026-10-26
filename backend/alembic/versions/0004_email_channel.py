"""Email channel: Gmail mailbox intake and outgoing mail

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-26
"""
from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (key, default value, is_secret)
_SETTINGS = [
    ("gmail_client_secret", None, True),
    ("gmail_refresh_token", None, True),
    ("gmail_address", None, False),
    ("gmail_connected_at", None, False),
    ("gmail_enabled", "false", False),
    ("gmail_sender_name", "IT Support", False),
    ("gmail_last_poll_at", None, False),
    ("gmail_last_error", None, False),
    ("gmail_oauth_nonce", None, False),
    # 'ok' | 'missing_scope' — whether Slack lets us look people up by email
    ("email_slack_lookup", None, False),
]


def upgrade() -> None:
    op.add_column("tickets", sa.Column("email_thread_id", sqlmodel.AutoString(), nullable=True))
    op.add_column("tickets", sa.Column("email_requester", sqlmodel.AutoString(), nullable=True))
    op.add_column("tickets", sa.Column("email_subject", sqlmodel.AutoString(), nullable=True))
    op.add_column("tickets", sa.Column("email_message_id", sqlmodel.AutoString(), nullable=True))
    op.add_column("tickets", sa.Column("email_participants", sa.Text(), nullable=True))
    op.add_column("tickets", sa.Column("email_last_message_id", sqlmodel.AutoString(), nullable=True))
    op.add_column("tickets", sa.Column("email_references", sa.Text(), nullable=True))
    op.add_column("tickets", sa.Column("linked_slack_id", sqlmodel.AutoString(), nullable=True))
    op.add_column("tickets", sa.Column("linked_workspace_id", sa.Integer(), nullable=True))
    op.add_column("tickets", sa.Column("linked_slack_name", sqlmodel.AutoString(), nullable=True))
    op.add_column("tickets", sa.Column("slack_link_source", sqlmodel.AutoString(), nullable=True))
    op.create_foreign_key(
        "fk_tickets_linked_workspace_id", "tickets", "slack_workspaces",
        ["linked_workspace_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_tickets_linked_slack_id", "tickets", ["linked_slack_id"])
    op.create_index("ix_tickets_email_thread_id", "tickets", ["email_thread_id"])
    op.create_index("ix_tickets_email_requester", "tickets", ["email_requester"])
    op.create_index("ix_tickets_email_message_id", "tickets", ["email_message_id"])

    op.add_column("ticket_replies", sa.Column("email_message_id", sqlmodel.AutoString(), nullable=True))
    op.create_index("ix_ticket_replies_email_message_id", "ticket_replies", ["email_message_id"])

    op.create_table(
        "email_outbox",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("ticket_id", sa.Integer(), nullable=False),
        sa.Column("reply_id", sa.Integer(), nullable=True),
        sa.Column("kind", sqlmodel.AutoString(), nullable=False),
        sa.Column("author_name", sqlmodel.AutoString(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("send_after", sa.DateTime(), nullable=False),
        sa.Column("sent_at", sa.DateTime(), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reply_id"], ["ticket_replies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_email_outbox_ticket_id", "email_outbox", ["ticket_id"])
    op.create_index("ix_email_outbox_send_after", "email_outbox", ["send_after"])

    conn = op.get_bind()
    for key, value, is_secret in _SETTINGS:
        conn.execute(
            sa.text(
                "INSERT INTO app_settings (key, value, is_secret, group_name, updated_at) "
                "VALUES (:key, :value, :is_secret, 'email', now() at time zone 'utc') "
                "ON CONFLICT (key) DO NOTHING"
            ),
            {"key": key, "value": value, "is_secret": is_secret},
        )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text("DELETE FROM app_settings WHERE key = ANY(:keys)"),
        {"keys": [k for k, _, _ in _SETTINGS]},
    )
    op.drop_table("email_outbox")
    op.drop_index("ix_ticket_replies_email_message_id", table_name="ticket_replies")
    op.drop_column("ticket_replies", "email_message_id")
    op.drop_index("ix_tickets_linked_slack_id", table_name="tickets")
    op.drop_constraint("fk_tickets_linked_workspace_id", "tickets", type_="foreignkey")
    for col in ("slack_link_source", "linked_slack_name", "linked_workspace_id", "linked_slack_id"):
        op.drop_column("tickets", col)
    op.drop_index("ix_tickets_email_message_id", table_name="tickets")
    op.drop_index("ix_tickets_email_requester", table_name="tickets")
    op.drop_index("ix_tickets_email_thread_id", table_name="tickets")
    for col in ("email_references", "email_last_message_id", "email_participants",
                "email_message_id", "email_subject", "email_requester", "email_thread_id"):
        op.drop_column("tickets", col)
