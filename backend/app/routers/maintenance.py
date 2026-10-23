"""
Data health — admin-only database checks and cleanup, usable without direct
database access (e.g. a client-hosted instance).

  GET  /admin/maintenance/health    version, row counts, leftover rows/files,
                                    and a per-ticket breakdown of the Reports
                                    overview (same window and rules)
  POST /admin/maintenance/cleanup   remove leftover rows and unused files (audited)

"Leftover" = a row pointing at a ticket that no longer exists, or a file in
attachment storage no attachment row uses. The foreign keys normally make
leftover rows impossible; the check is there to prove it on a live instance.
"""
import shutil
from datetime import date
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require_admin
from app.config import settings
from app.database import get_session
from app.models import Notification, Ticket, TicketCSAT, TicketHistory, TicketReadMarker, User
from app.models.ticket_attachment import TicketAttachment
from app.models.ticket_reply import TicketReply
from app.models.ticket_status_config import TicketStatusConfig
from app.routers.reports import _date_range
from app.services.audit import write_audit
from app.utils import client_ip

router = APIRouter(prefix="/admin/maintenance", tags=["admin"])

# Tables whose rows belong to a ticket: (label, model)
_TICKET_CHILDREN = [
    ("csat_answers", TicketCSAT),
    ("history", TicketHistory),
    ("replies", TicketReply),
    ("attachments", TicketAttachment),
    ("notifications", Notification),
    ("read_markers", TicketReadMarker),
]


def _orphan_filter(model):
    return ~select(Ticket.id).where(Ticket.id == model.ticket_id).exists()


def _scan_files(referenced: set[str]) -> tuple[list[Path], int]:
    """Files under attachment storage no attachment row references, and the
    number of referenced files missing on disk."""
    root = Path(settings.storage_local_path)
    unused: list[Path] = []
    on_disk: set[str] = set()
    if root.is_dir():
        for p in root.rglob("*"):
            if p.is_file():
                rel = str(p.relative_to(root))
                on_disk.add(rel)
                if rel not in referenced:
                    unused.append(p)
    missing = len(referenced - on_disk)
    return unused, missing


async def _referenced_paths(session: AsyncSession) -> set[str]:
    return set((await session.execute(select(TicketAttachment.storage_path))).scalars().all())


@router.get("/health")
async def data_health(
    from_date: Optional[date] = Query(default=None),
    to_date: Optional[date] = Query(default=None),
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    version = (await session.execute(text("SELECT version_num FROM alembic_version"))).scalar_one_or_none()

    counts = {"tickets": (await session.execute(select(func.count()).select_from(Ticket))).scalar_one()}
    leftovers: dict[str, int] = {}
    for label, model in _TICKET_CHILDREN:
        counts[label] = (await session.execute(select(func.count()).select_from(model))).scalar_one()
        leftovers[label] = (await session.execute(
            select(func.count()).select_from(model).where(_orphan_filter(model))
        )).scalar_one()

    unused_files, missing_files = _scan_files(await _referenced_paths(session))
    leftovers["unused_files"] = len(unused_files)

    # ── Reports overview, ticket by ticket (same window + rules as /reports/overview)
    start, end = await _date_range(from_date, to_date, session)
    resolved_names = set((await session.execute(
        select(TicketStatusConfig.name).where(TicketStatusConfig.is_resolved_state == True)  # noqa: E712
    )).scalars().all())
    csat = {
        tid: (n, pos) for tid, n, pos in (await session.execute(
            select(
                TicketCSAT.ticket_id,
                func.count(TicketCSAT.id),
                func.count().filter(TicketCSAT.score == True),  # noqa: E712
            ).group_by(TicketCSAT.ticket_id)
        )).all()
    }
    tickets = (await session.execute(
        select(Ticket).where(Ticket.created_at >= start, Ticket.created_at <= end).order_by(Ticket.id)
    )).scalars().all()

    rows = []
    for t in tickets:
        if t.sla_deadline is None:
            sla, why = "excluded", "no SLA policy"
        elif t.resolved_at is not None:
            if t.resolved_at <= t.sla_deadline:
                sla, why = "met", "resolved before the deadline"
            else:
                sla, why = "missed", "resolved after the deadline"
        elif t.sla_breached:
            sla, why = "missed", "still open, deadline passed"
        else:
            sla, why = "excluded", "still open, deadline not reached"
        n, pos = csat.get(t.id, (0, 0))
        rows.append({
            "id": t.id,
            "display_id": t.display_id,
            "title": t.title,
            "status": t.status,
            "resolved": t.status in resolved_names,
            "created_at": t.created_at,
            "resolved_at": t.resolved_at,
            "sla_deadline": t.sla_deadline,
            "sla": sla,
            "sla_reason": why,
            "csat_answers": n,
            "csat_positive": pos,
        })

    sla_counted = [r for r in rows if r["sla"] != "excluded"]
    sla_met = sum(1 for r in rows if r["sla"] == "met")
    csat_total = sum(r["csat_answers"] for r in rows)
    csat_pos = sum(r["csat_positive"] for r in rows)
    return {
        "db_version": version,
        "counts": counts,
        "leftovers": leftovers,
        "missing_files": missing_files,
        "report": {
            "from": start,
            "to": end,
            "tickets": rows,
            "totals": {
                "tickets": len(rows),
                "sla_counted": len(sla_counted),
                "sla_met": sla_met,
                "sla_compliance_pct": round(sla_met * 100 / len(sla_counted), 1) if sla_counted else None,
                "csat_total": csat_total,
                "csat_positive": csat_pos,
            },
        },
    }


@router.post("/cleanup")
async def cleanup(
    request: Request,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Delete leftover rows (children of tickets that no longer exist) and
    files no attachment uses. Audited with what was removed."""
    removed: dict[str, int] = {}
    # Attachments before replies: an attachment can point at a reply.
    order = ["attachments", "csat_answers", "history", "replies", "notifications", "read_markers"]
    models = dict(_TICKET_CHILDREN)
    for label in order:
        model = models[label]
        result = await session.execute(delete(model).where(_orphan_filter(model)))
        removed[label] = result.rowcount or 0

    # Scanned inside the transaction (sees the deleted attachment rows), removed
    # from disk only after the commit — a failed commit must not lose files.
    unused_files, _ = _scan_files(await _referenced_paths(session))
    removed["unused_files"] = len(unused_files)

    await write_audit(
        session,
        actor_id=admin.id,
        action="maintenance.cleanup",
        entity_type="instance",
        payload={"removed": removed},
        ip_address=client_ip(request),
    )
    await session.commit()

    for f in unused_files:
        f.unlink(missing_ok=True)
    root = Path(settings.storage_local_path)
    if root.is_dir():
        for d in sorted((p for p in root.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
            if not any(d.iterdir()):
                shutil.rmtree(d, ignore_errors=True)
    return {"removed": removed}
