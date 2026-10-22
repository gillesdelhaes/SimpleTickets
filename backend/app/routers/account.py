"""
My account — self-service endpoints for the signed-in staff member.

  GET    /account                                  my profile, linked + pending Slack IDs
  PUT    /account/slack-identity/{workspace_id}    request a link (confirmed in Slack) or unlink
  DELETE /account/slack-link-request/{workspace_id} cancel a pending link request

Linking your own Slack ID never takes effect directly: the bot DMs that Slack
account with 👍/👎 buttons and only a 👍 from it creates the link (see
services/slack_identity.py and the slack_link_* actions in slack/handlers.py).
Admins can still link anyone directly via /admin/users/{id}/slack-identity.
Password changes live at POST /auth/change-password.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from slack_sdk.errors import SlackApiError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.database import get_session
from app.models import User
from app.models.slack_workspace import SlackWorkspace
from app.schemas.user import AccountRead, PendingSlackLinkRead, SlackIdentityUpdate, UserRead
from app.services.slack_identity import (
    create_link_request,
    get_pending_requests,
    get_request,
    load_identities,
    set_identity,
)
from app.slack.bot import get_slack_client
from app.slack.service import close_link_dm, send_link_confirmation_dm
from app.utils import client_ip

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/account", tags=["account"])


async def _account_read(session: AsyncSession, user: User) -> AccountRead:
    identities = (await load_identities(session, [user.id])).get(user.id, [])
    pending = await get_pending_requests(session, user.id)
    base = UserRead.model_validate(user).model_dump(exclude={"slack_identities"})
    return AccountRead(
        **base,
        slack_identities=identities,
        pending_slack_links=[
            PendingSlackLinkRead(workspace_id=r.workspace_id, slack_user_id=r.slack_user_id, expires_at=r.expires_at)
            for r in pending
        ],
    )


async def _active_workspace(session: AsyncSession, workspace_id: int) -> SlackWorkspace:
    workspace = await session.get(SlackWorkspace, workspace_id)
    if workspace is None or not workspace.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    return workspace


async def _drop_request(session: AsyncSession, user: User, workspace_id: int, dm_text: str) -> None:
    """Delete the user's pending request for a workspace (if any) and retire
    its DM's buttons. Caller commits."""
    req = await get_request(session, user.id, workspace_id)
    if req is None:
        return
    await close_link_dm(get_slack_client(workspace_id), req.slack_channel_id, req.slack_message_ts, dm_text)
    await session.delete(req)


@router.get("", response_model=AccountRead)
async def get_my_account(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AccountRead:
    return await _account_read(session, current_user)


@router.put("/slack-identity/{workspace_id}", response_model=AccountRead)
async def set_my_slack_identity(
    workspace_id: int,
    body: SlackIdentityUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AccountRead:
    """
    Blank/null slack_user_id unlinks immediately (and cancels any pending
    request). Any other value starts a link request: the bot DMs that Slack
    account and nothing is linked until it clicks 👍. Needs the workspace's
    bot to be connected — without a DM there's no way to confirm.
    """
    workspace = await _active_workspace(session, workspace_id)
    new_sid = (body.slack_user_id or "").strip()

    if not new_sid:
        await _drop_request(session, current_user, workspace_id, "🚫 Link request cancelled.")
        await set_identity(
            session, user=current_user, workspace=workspace, slack_user_id=None,
            actor=current_user, ip_address=client_ip(request),
        )
        await session.commit()
        return await _account_read(session, current_user)

    current = (await load_identities(session, [current_user.id])).get(current_user.id, [])
    if any(i.workspace_id == workspace_id and i.slack_user_id == new_sid for i in current):
        return await _account_read(session, current_user)  # already linked to exactly this

    client = get_slack_client(workspace_id)
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f'Slack is offline for "{workspace.name}", so the link can\'t be confirmed. Try later or ask an admin.',
        )

    try:
        member = (await client.users_info(user=new_sid)).get("user") or {}
    except SlackApiError as exc:
        if exc.response.get("error") not in ("user_not_found", "invalid_user"):
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Couldn't verify the Slack ID — try again")
        member = None
    if member is None or member.get("deleted") or member.get("is_bot"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f'No active Slack member with ID "{new_sid}" in "{workspace.name}"',
        )

    old = await get_request(session, current_user.id, workspace_id)
    old_dm = (old.slack_channel_id, old.slack_message_ts) if old else (None, None)

    req = await create_link_request(
        session, user=current_user, workspace=workspace, slack_user_id=new_sid,
        ip_address=client_ip(request),
    )
    try:
        req.slack_channel_id, req.slack_message_ts = await send_link_confirmation_dm(
            client, slack_user_id=new_sid, token=req.token, user=current_user,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Link confirmation DM to %s failed", new_sid)
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Couldn't send the confirmation message in Slack — try again",
        )
    await session.commit()
    await close_link_dm(client, *old_dm, "🚫 This link request was replaced by a newer one.")
    return await _account_read(session, current_user)


@router.delete("/slack-link-request/{workspace_id}", response_model=AccountRead)
async def cancel_my_slack_link_request(
    workspace_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AccountRead:
    await _drop_request(session, current_user, workspace_id, "🚫 Link request cancelled.")
    await session.commit()
    return await _account_read(session, current_user)
