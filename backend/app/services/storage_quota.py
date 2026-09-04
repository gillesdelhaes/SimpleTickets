"""
Aggregate attachment-storage quota, shared by every intake path.

Per-file caps (10 MB) bound a single upload, but only an aggregate cap stops
the disk filling over time. This must be enforced on BOTH intake paths — the
web upload endpoint (routers/attachments.py) and Slack file downloads
(slack/service._download_slack_files); the Slack path previously skipped it,
so any workspace member DMing files could exhaust the volume.
"""
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ticket_attachment import TicketAttachment

MAX_TOTAL_ATTACHMENT_BYTES = 5 * 1024 * 1024 * 1024  # 5 GB


async def total_attachment_bytes(session: AsyncSession) -> int:
    """Sum of stored attachment sizes across the whole instance."""
    result = await session.execute(
        select(func.coalesce(func.sum(TicketAttachment.size_bytes), 0))
    )
    return int(result.scalar_one())


async def storage_quota_reached(session: AsyncSession) -> bool:
    return await total_attachment_bytes(session) >= MAX_TOTAL_ATTACHMENT_BYTES
