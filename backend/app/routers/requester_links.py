"""
Link an email ticket's requester to their Slack account, or unlink it.
See app/email/identity.py. Technicians and admins.

  PUT    /tickets/{id}/slack-link   {workspace_id, slack_user_id}
  DELETE /tickets/{id}/slack-link

Applies to every ticket from the same address. Recorded in the ticket's
history and the audit log.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require_technician
from app.database import get_session
from app.email.identity import apply_link, slack_member
from app.models import Ticket, User
from app.routers.tickets import _fetch_enriched, _record_history
from app.schemas.ticket import TicketRead
from app.services.audit import write_audit
from app.utils import client_ip, get_ticket_or_404

router = APIRouter(prefix="/tickets", tags=["tickets"])


class SlackLinkRequest(BaseModel):
    workspace_id: int
    slack_user_id: str = Field(min_length=1, max_length=32, pattern=r"^[A-Z0-9]+$")


def _linkable(ticket: Ticket) -> str:
    if ticket.source != "email" or not ticket.email_requester or ticket.submitter_id is not None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Only email tickets from someone without a SimpleTickets account can be linked to Slack.",
        )
    return ticket.email_requester


@router.put("/{ticket_id}/slack-link", response_model=TicketRead)
async def link_requester_to_slack(
    ticket_id: int,
    body: SlackLinkRequest,
    request: Request,
    current_user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> TicketRead:
    ticket = await get_ticket_or_404(session, ticket_id)
    address = _linkable(ticket)
    match = await slack_member(body.workspace_id, body.slack_user_id)
    if match is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That Slack user wasn't found in this workspace.")

    old_name, old_source = ticket.linked_slack_name, ticket.slack_link_source
    await apply_link(session, address, match, "manual")
    if old_name != match.name or old_source != "manual":
        _record_history(session, ticket.id, current_user.id, {"slack_link": (old_name, match.name)})
    await write_audit(
        session, actor_id=current_user.id, action="ticket.requester_linked", entity_type="ticket",
        entity_id=str(ticket.id),
        payload={"address": address, "workspace_id": match.workspace_id, "slack_user_id": match.slack_user_id},
        ip_address=client_ip(request),
    )
    await session.commit()
    session.expire_all()  # apply_link is a bulk UPDATE; reload the ticket
    items, _ = await _fetch_enriched(session, [Ticket.id == ticket_id])
    return items[0]


@router.delete("/{ticket_id}/slack-link", response_model=TicketRead)
async def unlink_requester_from_slack(
    ticket_id: int,
    request: Request,
    current_user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> TicketRead:
    ticket = await get_ticket_or_404(session, ticket_id)
    address = _linkable(ticket)
    old_name = ticket.linked_slack_name
    # 'none' (not null) so the next email from this address isn't re-matched
    await apply_link(session, address, None, "none")
    if old_name:
        _record_history(session, ticket.id, current_user.id, {"slack_link": (old_name, None)})
    await write_audit(
        session, actor_id=current_user.id, action="ticket.requester_unlinked", entity_type="ticket",
        entity_id=str(ticket.id), payload={"address": address, "was": old_name},
        ip_address=client_ip(request),
    )
    await session.commit()
    session.expire_all()  # apply_link is a bulk UPDATE; reload the ticket
    items, _ = await _fetch_enriched(session, [Ticket.id == ticket_id])
    return items[0]
