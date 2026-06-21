"""
File Attachments — Chunk 09.

Storage layout:
  {STORAGE_LOCAL_PATH}/
    {ticket_id}/
      {uuid}_{sanitized_filename}

Access rules (mirrors ticket access):
  POST   /tickets/{id}/attachments    any authenticated user on accessible ticket
  GET    /tickets/{id}/attachments    any authenticated user on accessible ticket
  GET    /attachments/{id}/download   any authenticated user on accessible ticket
  DELETE /attachments/{id}            uploader OR technician/admin
"""
import logging
import mimetypes
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

import aiofiles
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.config import settings
from app.database import get_session
from app.models import Ticket, TicketAttachment, User
from app.schemas.attachment import AttachmentRead

router = APIRouter(tags=["attachments"])

# Allowed MIME types — images, PDFs, common office docs, plain text
_ALLOWED_MIME_PREFIXES = ("image/",)
_ALLOWED_MIME_EXACT = {
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/zip",
    "application/x-zip-compressed",
}

_UNSAFE_CHARS = re.compile(r"[^\w.\-]")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _sanitize_filename(name: str) -> str:
    """Strip path components and replace unsafe characters."""
    name = Path(name).name  # strip any directory traversal
    name = _UNSAFE_CHARS.sub("_", name)
    return name[:200] or "file"


def _is_allowed_mime(mime: str) -> bool:
    if any(mime.startswith(p) for p in _ALLOWED_MIME_PREFIXES):
        return True
    return mime in _ALLOWED_MIME_EXACT


def _storage_dir(ticket_id: int) -> Path:
    return Path(settings.storage_local_path) / str(ticket_id)


async def _get_ticket_or_404(session: AsyncSession, ticket_id: int) -> Ticket:
    ticket = await session.get(Ticket, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    return ticket


# ── POST /tickets/{id}/attachments ────────────────────────────────────────────


@router.post(
    "/tickets/{ticket_id}/attachments",
    response_model=AttachmentRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_attachment(
    ticket_id: int,
    file: UploadFile,
    reply_id: int | None = Query(default=None, description="Associate with a specific reply"),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AttachmentRead:
    """
    Upload a file attachment to a ticket (or to a specific reply).
    Max size: {max_mb} MB. Allowed types: images, PDF, office docs, plain text.
    """
    await _get_ticket_or_404(session, ticket_id)

    max_bytes = 10 * 1024 * 1024  # 10 MB hard limit

    contents = await file.read(max_bytes + 1)
    if len(contents) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File exceeds the 10 MB limit",
        )

    if len(contents) == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Uploaded file is empty",
        )

    # Determine MIME type — prefer the sniffed type over what the client claims
    original_name = file.filename or "upload"
    mime_type = file.content_type or ""
    if not mime_type or mime_type == "application/octet-stream":
        guessed, _ = mimetypes.guess_type(original_name)
        mime_type = guessed or "application/octet-stream"

    if not _is_allowed_mime(mime_type):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"File type '{mime_type}' is not allowed",
        )

    # Validate reply_id belongs to this ticket
    if reply_id is not None:
        from app.models import TicketReply  # local import to avoid circular
        reply = await session.get(TicketReply, reply_id)
        if reply is None or reply.ticket_id != ticket_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Reply not found on this ticket",
            )

    # Build storage path
    safe_name = _sanitize_filename(original_name)
    unique_name = f"{uuid.uuid4().hex}_{safe_name}"
    storage_dir = _storage_dir(ticket_id)
    storage_dir.mkdir(parents=True, exist_ok=True)
    abs_path = storage_dir / unique_name
    relative_path = str(Path(str(ticket_id)) / unique_name)

    # Write to disk
    async with aiofiles.open(abs_path, "wb") as f:
        await f.write(contents)

    attachment = TicketAttachment(
        ticket_id=ticket_id,
        reply_id=reply_id,
        filename=original_name,
        storage_path=relative_path,
        mime_type=mime_type,
        size_bytes=len(contents),
        created_at=_utcnow(),
    )
    session.add(attachment)
    await session.commit()
    await session.refresh(attachment)

    # Push attachment to the Slack thread — works for both reply-level (reply_id set)
    # and ticket-level (reply_id=None) attachments as long as the ticket has a thread anchor.
    try:
        from app.slack.service import upload_attachments_to_slack
        ticket_obj = await _get_ticket_or_404(session, ticket_id)
        if ticket_obj.slack_channel_id and ticket_obj.slack_message_ts:
            await upload_attachments_to_slack(ticket_obj, reply_id)
    except Exception:  # noqa: BLE001
        logger.warning("Failed to upload attachment %d to Slack", attachment.id)

    return AttachmentRead.model_validate(attachment)


# ── GET /tickets/{id}/attachments ─────────────────────────────────────────────


@router.get("/tickets/{ticket_id}/attachments", response_model=list[AttachmentRead])
async def list_attachments(
    ticket_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[AttachmentRead]:
    """List all attachments for a ticket."""
    await _get_ticket_or_404(session, ticket_id)

    result = await session.execute(
        select(TicketAttachment)
        .where(TicketAttachment.ticket_id == ticket_id)
        .order_by(TicketAttachment.created_at.asc())
    )
    return [AttachmentRead.model_validate(a) for a in result.scalars().all()]


# ── GET /attachments/{id}/download ────────────────────────────────────────────


@router.get("/attachments/{attachment_id}/download")
async def download_attachment(
    attachment_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FileResponse:
    """Stream an attachment file to the client."""
    attachment = await session.get(TicketAttachment, attachment_id)
    if attachment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")

    await _get_ticket_or_404(session, attachment.ticket_id)

    abs_path = Path(settings.storage_local_path) / attachment.storage_path
    if not abs_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attachment file missing from storage",
        )

    return FileResponse(
        path=str(abs_path),
        media_type=attachment.mime_type,
        filename=attachment.filename,
    )

