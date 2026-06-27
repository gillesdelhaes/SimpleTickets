"""Initial schema with all tables and seed data

Revision ID: 0001
Revises:
Create Date: 2026-05-30
"""
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel
from alembic import op

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_now = datetime.now(timezone.utc).replace(tzinfo=None)


def upgrade() -> None:
    # ── users ──────────────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sqlmodel.AutoString(), nullable=False),
        sa.Column("name", sqlmodel.AutoString(), nullable=False),
        sa.Column("avatar_url", sqlmodel.AutoString(), nullable=True),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("auth_provider", sa.String(), nullable=False),
        sa.Column("slack_user_id", sqlmodel.AutoString(), nullable=True),
        sa.Column("hashed_password", sqlmodel.AutoString(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_login_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_slack_user_id", "users", ["slack_user_id"], unique=False)

    # ── categories ─────────────────────────────────────────────────────────────
    op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sqlmodel.AutoString(), nullable=False),
        sa.Column("is_archived", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index("ix_categories_name", "categories", ["name"], unique=True)

    # ── sla_policies ───────────────────────────────────────────────────────────
    op.create_table(
        "sla_policies",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sqlmodel.AutoString(), nullable=False),
        sa.Column("priority", sa.String(), nullable=False),
        sa.Column("first_response_minutes", sa.Integer(), nullable=False),
        sa.Column("resolution_minutes", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sla_policies_priority", "sla_policies", ["priority"], unique=False)

    # ── ticket_statuses ────────────────────────────────────────────────────────
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
        sa.Column("sends_csat", sa.Boolean(), nullable=False, server_default="false"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ticket_statuses_name", "ticket_statuses", ["name"], unique=True)

    # ── tickets ────────────────────────────────────────────────────────────────
    op.create_table(
        "tickets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sqlmodel.AutoString(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("priority", sa.String(), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("submitter_id", sa.Integer(), nullable=True),
        sa.Column("assignee_id", sa.Integer(), nullable=True),
        sa.Column("slack_submitter_name", sqlmodel.AutoString(), nullable=True),
        sa.Column("slack_submitter_id", sqlmodel.AutoString(), nullable=True),
        sa.Column("sla_policy_id", sa.Integer(), nullable=True),
        sa.Column("sla_deadline", sa.DateTime(), nullable=True),
        sa.Column("sla_breached", sa.Boolean(), nullable=False),
        sa.Column("sla_paused_at", sa.DateTime(), nullable=True),
        sa.Column("sla_paused_seconds", sa.Integer(), nullable=False),
        sa.Column("sla_breach_warned_at", sa.DateTime(), nullable=True),
        sa.Column("source", sa.String(10), nullable=False, server_default="slack"),
        sa.Column("slack_channel_id", sqlmodel.AutoString(), nullable=True),
        sa.Column("slack_message_ts", sqlmodel.AutoString(), nullable=True),
        sa.Column("duplicate_of_id", sa.Integer(), nullable=True),
        sa.Column("first_response_deadline", sa.DateTime(), nullable=True),
        sa.Column("first_responded_at", sa.DateTime(), nullable=True),
        sa.Column("first_response_warned_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["assignee_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"]),
        sa.ForeignKeyConstraint(["duplicate_of_id"], ["tickets.id"]),
        sa.ForeignKeyConstraint(["sla_policy_id"], ["sla_policies.id"]),
        sa.ForeignKeyConstraint(["submitter_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tickets_assignee_id", "tickets", ["assignee_id"], unique=False)
    op.create_index("ix_tickets_created_at", "tickets", ["created_at"], unique=False)
    op.create_index("ix_tickets_priority", "tickets", ["priority"], unique=False)
    op.create_index("ix_tickets_status", "tickets", ["status"], unique=False)
    op.create_index("ix_tickets_submitter_id", "tickets", ["submitter_id"], unique=False)
    op.create_index("ix_tickets_slack_submitter_id", "tickets", ["slack_submitter_id"], unique=False)

    # ── ticket_replies ─────────────────────────────────────────────────────────
    op.create_table(
        "ticket_replies",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("ticket_id", sa.Integer(), nullable=False),
        sa.Column("author_id", sa.Integer(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("is_internal", sa.Boolean(), nullable=False),
        sa.Column("slack_ts", sqlmodel.AutoString(), nullable=True),
        sa.Column("slack_author_name", sqlmodel.AutoString(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ticket_replies_ticket_id", "ticket_replies", ["ticket_id"], unique=False)

    # ── ticket_history ─────────────────────────────────────────────────────────
    op.create_table(
        "ticket_history",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("ticket_id", sa.Integer(), nullable=False),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column("field_changed", sqlmodel.AutoString(), nullable=False),
        sa.Column("old_value", sqlmodel.AutoString(), nullable=True),
        sa.Column("new_value", sqlmodel.AutoString(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ticket_history_ticket_id", "ticket_history", ["ticket_id"], unique=False)
    op.create_index("ix_ticket_history_created_at", "ticket_history", ["created_at"], unique=False)

    # ── ticket_attachments ─────────────────────────────────────────────────────
    op.create_table(
        "ticket_attachments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("ticket_id", sa.Integer(), nullable=False),
        sa.Column("reply_id", sa.Integer(), nullable=True),
        sa.Column("filename", sqlmodel.AutoString(), nullable=False),
        sa.Column("storage_path", sqlmodel.AutoString(), nullable=False),
        sa.Column("mime_type", sqlmodel.AutoString(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("slack_file_id", sqlmodel.AutoString(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["reply_id"], ["ticket_replies.id"]),
        sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ticket_attachments_ticket_id", "ticket_attachments", ["ticket_id"], unique=False)

    # ── audit_log ──────────────────────────────────────────────────────────────
    op.create_table(
        "audit_log",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column("action", sqlmodel.AutoString(), nullable=False),
        sa.Column("entity_type", sqlmodel.AutoString(), nullable=False),
        sa.Column("entity_id", sqlmodel.AutoString(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("ip_address", sqlmodel.AutoString(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_log_action", "audit_log", ["action"], unique=False)
    op.create_index("ix_audit_log_actor_id", "audit_log", ["actor_id"], unique=False)
    op.create_index("ix_audit_log_created_at", "audit_log", ["created_at"], unique=False)

    # ── app_settings ───────────────────────────────────────────────────────────
    op.create_table(
        "app_settings",
        sa.Column("key",        sa.String(100),  nullable=False),
        sa.Column("value",      sa.Text(),        nullable=True),
        sa.Column("is_secret",  sa.Boolean(),     nullable=False, server_default="false"),
        sa.Column("group_name", sa.String(50),    nullable=False, server_default="app"),
        sa.Column("updated_at", sa.DateTime(),    nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )

    # ── ticket_read_markers ────────────────────────────────────────────────────
    op.create_table(
        "ticket_read_markers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("ticket_id", sa.Integer(), nullable=False),
        sa.Column("last_read_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "ticket_id", name="uq_read_marker_user_ticket"),
    )
    op.create_index("ix_ticket_read_markers_user_id", "ticket_read_markers", ["user_id"])
    op.create_index("ix_ticket_read_markers_ticket_id", "ticket_read_markers", ["ticket_id"])

    # ── ticket_csat ────────────────────────────────────────────────────────────
    op.create_table(
        "ticket_csat",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("ticket_id", sa.Integer(), nullable=False),
        sa.Column("score", sa.Boolean(), nullable=False),
        sa.Column("responded_at", sa.DateTime(), nullable=False),
        sa.Column("slack_user_id", sqlmodel.AutoString(), nullable=False),
        sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ticket_csat_ticket_id", "ticket_csat", ["ticket_id"], unique=False)

    # ── seed: categories ───────────────────────────────────────────────────────
    op.bulk_insert(
        sa.table(
            "categories",
            sa.column("name", sa.String),
            sa.column("is_archived", sa.Boolean),
            sa.column("created_at", sa.DateTime),
        ),
        [
            {"name": "Hardware",               "is_archived": False, "created_at": _now},
            {"name": "Software / Applications","is_archived": False, "created_at": _now},
            {"name": "Access & Permissions",   "is_archived": False, "created_at": _now},
        ],
    )

    # ── seed: SLA policies ─────────────────────────────────────────────────────
    op.bulk_insert(
        sa.table(
            "sla_policies",
            sa.column("name", sa.String),
            sa.column("priority", sa.String),
            sa.column("first_response_minutes", sa.Integer),
            sa.column("resolution_minutes", sa.Integer),
        ),
        [
            {"name": "Critical SLA", "priority": "critical", "first_response_minutes": 30,  "resolution_minutes": 240},
            {"name": "High SLA",     "priority": "high",     "first_response_minutes": 60,  "resolution_minutes": 480},
            {"name": "Medium SLA",   "priority": "medium",   "first_response_minutes": 240, "resolution_minutes": 1440},
            {"name": "Low SLA",      "priority": "low",      "first_response_minutes": 480, "resolution_minutes": 4320},
        ],
    )

    # ── seed: ticket_statuses ──────────────────────────────────────────────────
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
            sa.column("sends_csat", sa.Boolean),
        ),
        [
            {"name": "open",         "label": "Open",         "color": "#3B82F6", "pauses_sla": False, "is_default": True,  "is_resolved_state": False, "sort_order": 0, "is_archived": False, "sends_csat": False},
            {"name": "in_progress",  "label": "In Progress",  "color": "#FF4713", "pauses_sla": False, "is_default": False, "is_resolved_state": False, "sort_order": 1, "is_archived": False, "sends_csat": False},
            {"name": "pending_user", "label": "Pending User", "color": "#F59E0B", "pauses_sla": True,  "is_default": False, "is_resolved_state": False, "sort_order": 2, "is_archived": False, "sends_csat": False},
            {"name": "resolved",     "label": "Resolved",     "color": "#10B981", "pauses_sla": False, "is_default": False, "is_resolved_state": True,  "sort_order": 3, "is_archived": False, "sends_csat": True},
            {"name": "closed",       "label": "Closed",       "color": "#737373", "pauses_sla": False, "is_default": False, "is_resolved_state": True,  "sort_order": 4, "is_archived": False, "sends_csat": False},
        ],
    )

    # ── seed: app_settings ─────────────────────────────────────────────────────
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
            {"key": "setup_complete",       "value": None,        "is_secret": False, "group_name": "app",   "updated_at": _now},
            {"key": "app_secret_key",       "value": None,        "is_secret": False, "group_name": "app",   "updated_at": _now},
            {"key": "slack_bot_token",      "value": None,        "is_secret": True,  "group_name": "slack", "updated_at": _now},
            {"key": "slack_app_token",      "value": None,        "is_secret": True,  "group_name": "slack", "updated_at": _now},
            {"key": "slack_signing_secret", "value": None,        "is_secret": True,  "group_name": "slack", "updated_at": _now},
            {"key": "slack_trigger_emoji",  "value": "clipboard", "is_secret": False, "group_name": "slack", "updated_at": _now},
            {"key": "slack_two_way_sync",   "value": "true",      "is_secret": False, "group_name": "slack", "updated_at": _now},
            {"key": "timezone",             "value": "UTC",       "is_secret": False, "group_name": "app",   "updated_at": _now},
            {"key": "csat_auto_close_days", "value": "7",         "is_secret": False, "group_name": "app",   "updated_at": _now},
        ],
    )


def downgrade() -> None:
    op.drop_table("ticket_csat")
    op.drop_table("ticket_read_markers")
    op.drop_table("app_settings")
    op.drop_table("audit_log")
    op.drop_table("ticket_attachments")
    op.drop_table("ticket_history")
    op.drop_table("ticket_replies")
    op.drop_table("tickets")
    op.drop_table("ticket_statuses")
    op.drop_table("sla_policies")
    op.drop_table("categories")
    op.drop_table("users")
