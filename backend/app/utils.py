from app.dt import utcnow

from fastapi import HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Ticket


def client_ip(request: Request) -> str | None:
    """Real client IP for audit/rate-limit use. Behind nginx the TCP peer is
    always the proxy, so prefer X-Real-IP (set from $remote_addr in
    locations.conf). api:8000 is not published and only the proxy is on its
    network, so spoofing the header requires already being inside the internal
    network. Take a single trimmed token and fall back to the TCP peer."""
    header = (request.headers.get("X-Real-IP") or "").split(",")[0].strip()
    if header:
        return header[:64]
    return request.client.host if request.client else None


async def get_ticket_or_404(session: AsyncSession, ticket_id: int) -> Ticket:
    ticket = await session.get(Ticket, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    return ticket
