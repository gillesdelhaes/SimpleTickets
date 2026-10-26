"""
Linking an email requester to their Slack account, so "Other tickets from
this person", the From filter and search treat both as one person.

  • Automatic: when an email opens a ticket, Slack is asked who owns that
    address (users.lookupByEmail — needs the users:read.email scope). In a
    Google Workspace + Slack company that's the same address almost always.
  • Manual: a technician picks the Slack user on the ticket (personal
    addresses, vendors), or unlinks a wrong match.

A link belongs to the address: it's applied to every ticket from that
address, and new tickets from it inherit the latest decision — including
"unlinked", so a technician's correction isn't undone by the next email.
It's identity only; the conversation stays on email (see Ticket.linked_*).
"""
import logging
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Ticket
from app.models.slack_workspace import SlackWorkspace
from app.services.settings_service import get_setting, set_setting

logger = logging.getLogger(__name__)


@dataclass
class SlackMatch:
    workspace_id: int
    slack_user_id: str
    name: str


def _member_name(member: dict) -> str:
    profile = member.get("profile", {})
    return (profile.get("real_name") or profile.get("display_name") or member.get("name") or "").strip()


async def slack_member(workspace_id: int, slack_user_id: str) -> Optional[SlackMatch]:
    """The Slack user, if they exist and are a real, active person."""
    from app.slack.bot import get_slack_client
    client = get_slack_client(workspace_id)
    if client is None:
        return None
    try:
        member = (await client.users_info(user=slack_user_id)).get("user") or {}
    except Exception:  # noqa: BLE001 — user_not_found and friends
        return None
    if not member or member.get("deleted") or member.get("is_bot"):
        return None
    return SlackMatch(workspace_id, member["id"], _member_name(member) or slack_user_id)


async def lookup_by_email(session: AsyncSession, address: str) -> Optional[SlackMatch]:
    """Ask each connected workspace who owns this address."""
    from app.slack.bot import get_slack_client
    workspaces = (await session.execute(
        select(SlackWorkspace.id).where(SlackWorkspace.is_active == True).order_by(SlackWorkspace.id)  # noqa: E712
    )).scalars().all()
    for ws_id in workspaces:
        client = get_slack_client(ws_id)
        if client is None:
            continue
        try:
            resp = await client.users_lookupByEmail(email=address)
        except Exception as exc:  # noqa: BLE001
            response = getattr(exc, "response", None)  # SlackApiError carries the API reply
            error = response.get("error") if response is not None else None
            if error == "missing_scope":
                if await get_setting("email_slack_lookup", session) != "missing_scope":
                    logger.warning("Slack lookup by email needs the users:read.email scope (workspace %s)", ws_id)
                await set_setting("email_slack_lookup", "missing_scope", session)
            elif error != "users_not_found":
                logger.warning("Slack lookup by email failed in workspace %s: %s", ws_id, error or exc)
            continue
        await set_setting("email_slack_lookup", "ok", session)
        member = resp.get("user") or {}
        if member and not member.get("deleted") and not member.get("is_bot"):
            return SlackMatch(ws_id, member["id"], _member_name(member) or address)
    return None


async def apply_link(session: AsyncSession, address: str, match: Optional[SlackMatch], source: str) -> None:
    """Set (or clear, with match=None) the link on every ticket from this address."""
    await session.execute(
        update(Ticket)
        .where(Ticket.email_requester == address, Ticket.submitter_id.is_(None))
        .values(
            linked_slack_id=match.slack_user_id if match else None,
            linked_workspace_id=match.workspace_id if match else None,
            linked_slack_name=match.name if match else None,
            slack_link_source=source,
        )
        .execution_options(synchronize_session=False)
    )


async def auto_link(session: AsyncSession, ticket: Ticket) -> None:
    """For a new email ticket: inherit this address's earlier decision, or
    look the address up in Slack. Never raises; caller commits."""
    if ticket.submitter_id is not None or not ticket.email_requester:
        return
    try:
        earlier = (await session.execute(
            select(Ticket)
            .where(
                Ticket.email_requester == ticket.email_requester,
                Ticket.slack_link_source.is_not(None),
                Ticket.id != ticket.id,
            )
            .order_by(Ticket.id.desc())
            .limit(1)
        )).scalar_one_or_none()
        if earlier is not None:
            ticket.linked_slack_id = earlier.linked_slack_id
            ticket.linked_workspace_id = earlier.linked_workspace_id
            ticket.linked_slack_name = earlier.linked_slack_name
            ticket.slack_link_source = earlier.slack_link_source
            return
        match = await lookup_by_email(session, ticket.email_requester)
        if match is not None:
            ticket.linked_slack_id = match.slack_user_id
            ticket.linked_workspace_id = match.workspace_id
            ticket.linked_slack_name = match.name
            ticket.slack_link_source = "auto"
    except Exception:  # noqa: BLE001
        logger.exception("Email: Slack matching failed for %s", ticket.display_id)
