"""
Backup & Restore
GET  /api/admin/backup   — stream a zip archive with backup.json + attachments/
POST /api/admin/restore  — accept a zip upload, truncate all tables, restore data
"""
import io
import json
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import insert as sa_insert, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require_admin
from app.config import settings, settings_manager
from app.database import get_session
from app.models.app_setting import AppSetting
from app.models.audit_log import AuditLog
from app.models.category import Category
from app.models.sla_policy import SLAPolicy
from app.models.ticket import Ticket
from app.models.ticket_attachment import TicketAttachment
from app.models.ticket_history import TicketHistory
from app.models.ticket_read_marker import TicketReadMarker
from app.models.ticket_reply import TicketReply
from app.models.ticket_status_config import TicketStatusConfig
from app.models.user import User

router = APIRouter(prefix="/admin", tags=["backup"])

BACKUP_VERSION = 1

# Slack credentials and the JWT secret are excluded — re-enter after restore
_SECRET_KEYS = frozenset({
    "slack_bot_token", "slack_app_token", "slack_signing_secret", "jwt_secret",
})

# Export in dependency order (referenced tables before referencing tables)
_EXPORT_MODELS: list[tuple[str, Any]] = [
    ("ticket_statuses", TicketStatusConfig),
    ("users", User),
    ("categories", Category),
    ("sla_policies", SLAPolicy),
    ("tickets", Ticket),
    ("ticket_replies", TicketReply),
    ("ticket_history", TicketHistory),
    ("ticket_attachments", TicketAttachment),
    ("audit_log", AuditLog),
    ("ticket_read_markers", TicketReadMarker),
]

# Datetime column names per table (used during restore deserialization)
_DT_COLS: dict[str, set[str]] = {
    "ticket_statuses":     set(),
    "users":               {"created_at", "last_login_at"},
    "categories":          {"created_at"},
    "sla_policies":        set(),
    "tickets":             {
        "created_at", "updated_at", "resolved_at",
        "sla_deadline", "sla_paused_at",
        "first_response_deadline", "first_responded_at",
    },
    "ticket_replies":      {"created_at"},
    "ticket_history":      {"created_at"},
    "ticket_attachments":  {"created_at"},
    "audit_log":           {"created_at"},
    "ticket_read_markers": {"last_read_at"},
    "app_settings":        {"updated_at"},
}


def _serialize_row(row: Any) -> dict:
    """Convert a SQLModel ORM row to a JSON-serializable dict."""
    result: dict = {}
    for col in row.__class__.__table__.columns:
        v = getattr(row, col.key)
        if isinstance(v, datetime):
            result[col.key] = v.isoformat()
        elif hasattr(v, "value"):  # Enum
            result[col.key] = v.value
        else:
            result[col.key] = v
    return result


def _deserialize_row(row: dict, table_name: str) -> dict:
    """Parse ISO datetime strings back to naive UTC datetime objects."""
    dt_cols = _DT_COLS.get(table_name, set())
    out: dict = {}
    for k, v in row.items():
        if k in dt_cols and v is not None:
            dt = datetime.fromisoformat(v)
            out[k] = dt.replace(tzinfo=None)
        else:
            out[k] = v
    return out


# ── GET /api/admin/backup ─────────────────────────────────────────────────────


@router.get("/backup")
async def download_backup(
    _admin=Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    """Stream a zip archive containing all data and attachment files."""
    tables: dict[str, list[dict]] = {}

    for table_name, model in _EXPORT_MODELS:
        rows = (await session.execute(select(model))).scalars().all()
        tables[table_name] = [_serialize_row(r) for r in rows]

    # App settings — exclude secrets
    settings_rows = (await session.execute(
        select(AppSetting).where(AppSetting.key.notin_(_SECRET_KEYS))
    )).scalars().all()
    tables["app_settings"] = [_serialize_row(r) for r in settings_rows]

    att_list = tables.get("ticket_attachments", [])
    payload = {
        "version": BACKUP_VERSION,
        "exported_at": datetime.utcnow().isoformat(),
        "attachment_count": len(att_list),
        "attachment_total_bytes": sum(a.get("size_bytes", 0) for a in att_list),
        "tables": tables,
    }

    buf = io.BytesIO()
    storage_root = Path(settings.storage_local_path)

    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("backup.json", json.dumps(payload, default=str))
        for att in att_list:
            disk_path = storage_root / att["storage_path"]
            if disk_path.exists():
                zf.write(disk_path, f"attachments/{att['storage_path']}")

    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    zip_bytes = buf.getvalue()

    return StreamingResponse(
        iter([zip_bytes]),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="simpletickets_backup_{ts}.zip"',
            "Content-Length": str(len(zip_bytes)),
        },
    )


# ── POST /api/admin/restore ───────────────────────────────────────────────────


@router.post("/restore", status_code=status.HTTP_200_OK)
async def restore_backup(
    file: UploadFile,
    _admin=Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    """
    Restore all data from a backup zip.
    Truncates every table, re-inserts from the archive, resets sequences.
    Rolls back fully on any error.
    """
    fname = file.filename or ""
    if not fname.endswith(".zip"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Upload must be a .zip file")

    _MAX_RESTORE_BYTES = 500 * 1024 * 1024  # 500 MB
    raw = await file.read(_MAX_RESTORE_BYTES + 1)
    if len(raw) > _MAX_RESTORE_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Backup file exceeds 500 MB limit")

    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid zip file")

    if "backup.json" not in zf.namelist():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "zip does not contain backup.json")

    try:
        payload = json.loads(zf.read("backup.json"))
    except json.JSONDecodeError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "backup.json is not valid JSON")

    if payload.get("version") != BACKUP_VERSION:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unsupported backup version {payload.get('version')} (expected {BACKUP_VERSION})",
        )

    tables: dict[str, list[dict]] = payload.get("tables", {})

    # ── Database restore (single transaction) ────────────────────────────────
    try:
        # Truncate all tables in reverse dependency order; CASCADE handles any remaining FKs
        truncate_names = [t[0] for t in reversed(_EXPORT_MODELS)] + ["app_settings"]
        for tname in truncate_names:
            await session.execute(text(f"TRUNCATE TABLE {tname} RESTART IDENTITY CASCADE"))

        # Re-insert in dependency order
        for table_name, model in _EXPORT_MODELS:
            rows = tables.get(table_name, [])
            if rows:
                deserialized = [_deserialize_row(r, table_name) for r in rows]
                await session.execute(sa_insert(model.__table__), deserialized)

        # App settings
        app_settings_rows = tables.get("app_settings", [])
        if app_settings_rows:
            deserialized = [_deserialize_row(r, "app_settings") for r in app_settings_rows]
            await session.execute(sa_insert(AppSetting.__table__), deserialized)

        # Verify the restored data includes at least one admin — a corrupt backup must
        # not lock out the current user with no recovery path.
        restored_users = tables.get("users", [])
        if not any(u.get("role") == "admin" for u in restored_users):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Backup contains no admin users — restore aborted to prevent lockout",
            )

        # Advance each sequence past the largest inserted ID so new rows get correct IDs.
        # When the table is empty MAX(id) is NULL: set sequence to 1 with is_called=false
        # so the next nextval() returns 1. When rows exist: set to max(id) with is_called=true
        # so the next nextval() returns max(id)+1.
        for table_name, _ in _EXPORT_MODELS:
            await session.execute(text(
                f"SELECT setval(pg_get_serial_sequence('{table_name}', 'id'), "
                f"COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM {table_name}"
            ))

        await session.commit()
        settings_manager.invalidate()
    except Exception as exc:
        await session.rollback()
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            f"Restore failed: {exc}",
        ) from exc

    # ── Restore attachment files ──────────────────────────────────────────────
    storage_root = Path(settings.storage_local_path).resolve()
    restored_files = 0
    for name in zf.namelist():
        if name.startswith("attachments/") and not name.endswith("/"):
            rel = name[len("attachments/"):]
            dest = (storage_root / rel).resolve()
            if not dest.is_relative_to(storage_root):
                continue  # skip path-traversal attempts
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(zf.read(name))
            restored_files += 1

    return {"ok": True, "restored_files": restored_files}
