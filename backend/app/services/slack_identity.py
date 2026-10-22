"""
Staff Slack identity linking — shared by the admin Users page
(PUT /admin/users/{id}/slack-identity/{workspace_id}) and the self-service
My account page (PUT /account/slack-identity/{workspace_id}).

Admins link directly (set_identity). Self-service links go through a
SlackLinkRequest: the bot DMs the Slack account with 👍/👎 buttons, and only
a 👍 from that account creates the link (resolve_link_request).
"""
import secrets
from datetime import timedelta
from typing import Literal, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dt import utcnow
from app.models import User
from app.models.slack_link_request import SlackLinkRequest
from app.models.slack_workspace import SlackWorkspace
from app.models.user_slack_identity import UserSlackIdentity
from app.schemas.user import SlackIdentityRead
from app.services.audit import write_audit


async def load_identities(session: AsyncSession, user_ids: list[int]) -> dict[int, list[SlackIdentityRead]]:
    """Linked Slack identities for each of user_ids, workspace-name ordered."""
    if not user_ids:
        return {}
    rows = (await session.execute(
        select(
            UserSlackIdentity.user_id,
            UserSlackIdentity.workspace_id,
            SlackWorkspace.name,
            UserSlackIdentity.slack_user_id,
        )
        .join(SlackWorkspace, SlackWorkspace.id == UserSlackIdentity.workspace_id)
        .where(UserSlackIdentity.user_id.in_(user_ids))
        .order_by(SlackWorkspace.name)
    )).all()
    by_user: dict[int, list[SlackIdentityRead]] = {}
    for user_id, workspace_id, workspace_name, slack_user_id in rows:
        by_user.setdefault(user_id, []).append(
            SlackIdentityRead(workspace_id=workspace_id, workspace_name=workspace_name, slack_user_id=slack_user_id)
        )
    return by_user


LINK_REQUEST_TTL = timedelta(hours=24)


async def _conflicting_owner(
    session: AsyncSession, workspace_id: int, slack_user_id: str, user_id: int,
) -> Optional[UserSlackIdentity]:
    """Another user's identity already holding this Slack ID in the workspace."""
    return (await session.execute(
        select(UserSlackIdentity).where(
            UserSlackIdentity.workspace_id == workspace_id,
            UserSlackIdentity.slack_user_id == slack_user_id,
            UserSlackIdentity.user_id != user_id,
        )
    )).scalar_one_or_none()


def _conflict_error(workspace: SlackWorkspace) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f'That Slack ID is already linked to another user in "{workspace.name}"',
    )


async def set_identity(
    session: AsyncSession,
    *,
    user: User,
    workspace: SlackWorkspace,
    slack_user_id: Optional[str],
    actor: User,
    ip_address: Optional[str],
    audit_extra: Optional[dict] = None,
) -> None:
    """
    Link, change or unlink (slack_user_id None/blank) the user's Slack identity
    in one workspace, writing an audit entry and committing. No-op when the
    value is unchanged. 409 if another user already holds that Slack ID in
    the workspace — a Slack ID must resolve to exactly one staff member.
    """
    new_sid = slack_user_id.strip() if slack_user_id else None
    new_sid = new_sid or None

    existing = (await session.execute(
        select(UserSlackIdentity).where(
            UserSlackIdentity.user_id == user.id,
            UserSlackIdentity.workspace_id == workspace.id,
        )
    )).scalar_one_or_none()
    old_sid = existing.slack_user_id if existing else None

    if old_sid == new_sid:
        return

    if new_sid is None:
        await session.delete(existing)
    else:
        if await _conflicting_owner(session, workspace.id, new_sid, user.id) is not None:
            raise _conflict_error(workspace)
        if existing is not None:
            existing.slack_user_id = new_sid
        else:
            session.add(UserSlackIdentity(user_id=user.id, workspace_id=workspace.id, slack_user_id=new_sid))

    payload: dict = {"email": user.email, "workspace": workspace.name, "slack_user_id": new_sid or old_sid}
    if new_sid and old_sid:
        payload["previous_slack_user_id"] = old_sid
    await write_audit(
        session,
        actor_id=actor.id,
        action="user.slack_linked" if new_sid else "user.slack_unlinked",
        entity_type="user",
        entity_id=user.id,
        payload={**payload, **(audit_extra or {})},
        ip_address=ip_address,
    )
    await session.commit()


# ── Self-service link requests (confirmed in Slack) ──────────────────────────


async def get_pending_requests(session: AsyncSession, user_id: int) -> list[SlackLinkRequest]:
    """The user's unexpired pending link requests."""
    return list((await session.execute(
        select(SlackLinkRequest).where(
            SlackLinkRequest.user_id == user_id,
            SlackLinkRequest.expires_at > utcnow(),
        )
    )).scalars().all())


async def get_request(session: AsyncSession, user_id: int, workspace_id: int) -> Optional[SlackLinkRequest]:
    """The user's request for one workspace, expired or not."""
    return (await session.execute(
        select(SlackLinkRequest).where(
            SlackLinkRequest.user_id == user_id,
            SlackLinkRequest.workspace_id == workspace_id,
        )
    )).scalar_one_or_none()


async def create_link_request(
    session: AsyncSession,
    *,
    user: User,
    workspace: SlackWorkspace,
    slack_user_id: str,
    ip_address: Optional[str],
) -> SlackLinkRequest:
    """
    Start a pending link (replacing any earlier one for this workspace — the
    caller edits that one's DM). 409 if the Slack ID already belongs to
    someone else. Flushed, not committed: the caller sends the DM, records
    where it landed, then commits — or rolls back if the DM fails.
    """
    if await _conflicting_owner(session, workspace.id, slack_user_id, user.id) is not None:
        raise _conflict_error(workspace)

    old = await get_request(session, user.id, workspace.id)
    if old is not None:
        await session.delete(old)
        await session.flush()

    req = SlackLinkRequest(
        user_id=user.id,
        workspace_id=workspace.id,
        slack_user_id=slack_user_id,
        token=secrets.token_urlsafe(24),
        expires_at=utcnow() + LINK_REQUEST_TTL,
    )
    session.add(req)
    await write_audit(
        session,
        actor_id=user.id,
        action="user.slack_link_requested",
        entity_type="user",
        entity_id=user.id,
        payload={"email": user.email, "workspace": workspace.name, "slack_user_id": slack_user_id},
        ip_address=ip_address,
    )
    await session.flush()
    return req


LinkOutcome = Literal["linked", "declined", "invalid", "expired", "conflict"]


async def resolve_link_request(
    session: AsyncSession,
    *,
    token: str,
    workspace_id: int,
    responder_slack_id: str,
    approve: bool,
) -> tuple[LinkOutcome, Optional[User]]:
    """
    Apply a 👍/👎 click from the confirmation DM. Only the Slack account the
    request names may answer it, in the workspace it was sent from — any
    other click is treated as invalid. The request is consumed either way.
    Commits.
    """
    req = (await session.execute(
        select(SlackLinkRequest).where(SlackLinkRequest.token == token)
    )).scalar_one_or_none()
    if req is None or req.workspace_id != workspace_id or req.slack_user_id != responder_slack_id:
        return "invalid", None

    user = await session.get(User, req.user_id)
    workspace = await session.get(SlackWorkspace, req.workspace_id)
    await session.delete(req)

    if user is None or workspace is None or not user.is_active:
        await session.commit()
        return "invalid", None
    if req.expires_at <= utcnow():
        await session.commit()
        return "expired", user

    if not approve:
        await write_audit(
            session,
            actor_id=None,
            action="user.slack_link_declined",
            entity_type="user",
            entity_id=user.id,
            payload={"email": user.email, "workspace": workspace.name, "slack_user_id": req.slack_user_id},
        )
        await session.commit()
        return "declined", user

    try:
        await set_identity(
            session, user=user, workspace=workspace, slack_user_id=req.slack_user_id,
            actor=user, ip_address=None, audit_extra={"confirmed_in_slack": True},
        )
    except HTTPException:
        # Someone else linked this Slack ID while the request was pending.
        await session.commit()
        return "conflict", user
    await session.commit()  # no-op commit if set_identity found nothing to change
    return "linked", user
