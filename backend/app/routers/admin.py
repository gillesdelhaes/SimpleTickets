"""
Admin Panel API.

Endpoints:
  POST  /admin/users                      create local account
  POST  /admin/users/{id}/set-password    set a user's password directly
  GET   /admin/users                      list all users with filters + pagination
  PATCH /admin/users/{id}                 update role, is_active, name, slack_user_id (writes audit entry)
  GET   /admin/audit                      paginated, filterable audit log
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.auth.deps import require_admin
from app.database import get_session
from app.models import AuditLog, AuthProvider, Role, Ticket, User
from app.schemas.audit import AuditLogRead, AuditLogResponse
from app.schemas.auth import CreateLocalUserRequest
from app.schemas.user import UserAdminUpdate, UserListResponse, UserRead
from app.services.audit import write_audit
from app.services.passwords import hash_password

router = APIRouter(prefix="/admin", tags=["admin"])


# ── POST /admin/users ──────────────────────────────────────────────────────────


@router.post("/users", status_code=status.HTTP_201_CREATED, response_model=UserRead)
async def create_local_user(
    body: CreateLocalUserRequest,
    request: Request,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> UserRead:
    """Create a local (email + password) account. Admin only."""
    try:
        role = Role(body.role)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid role '{body.role}'. Valid values: {[r.value for r in Role]}",
        )

    result = await session.execute(
        select(User).where(User.email == body.email.lower())
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with that email already exists",
        )

    user = User(
        email=body.email.lower(),
        name=body.name,
        hashed_password=hash_password(body.password),
        role=role,
        auth_provider=AuthProvider.local,
        is_active=True,
    )
    session.add(user)
    await session.flush()  # get user.id before audit entry

    await write_audit(
        session,
        actor_id=admin.id,
        action="user.created",
        entity_type="user",
        entity_id=user.id,
        payload={"email": user.email, "role": role.value, "auth_provider": "local"},
        ip_address=request.client.host if request.client else None,
    )

    await session.commit()
    await session.refresh(user)
    return UserRead.model_validate(user)


# ── POST /admin/users/{id}/set-password ───────────────────────────────────────


class SetPasswordRequest(BaseModel):
    new_password: str


@router.post("/users/{user_id}/set-password", status_code=status.HTTP_204_NO_CONTENT)
async def set_user_password(
    user_id: int,
    body: SetPasswordRequest,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Set a user's password directly. Admin only."""
    if not body.new_password or len(body.new_password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    user.hashed_password = hash_password(body.new_password)
    await session.commit()


# ── GET /admin/users ───────────────────────────────────────────────────────────


@router.get("/users", response_model=UserListResponse)
async def list_users(
    q: Optional[str] = Query(default=None, description="Search name or email"),
    role: Optional[Role] = Query(default=None),
    is_active: Optional[bool] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> UserListResponse:
    """List all users with optional filters. Admin only."""
    where = []
    if q:
        pattern = f"%{q}%"
        where.append(User.name.ilike(pattern) | User.email.ilike(pattern))
    if role is not None:
        where.append(User.role == role)
    if is_active is not None:
        where.append(User.is_active == is_active)

    count_stmt = select(func.count()).select_from(select(User).where(*where).subquery())
    total: int = (await session.execute(count_stmt)).scalar_one()

    stmt = select(User).where(*where).order_by(User.created_at.desc()).limit(limit).offset(offset)
    users = list((await session.execute(stmt)).scalars().all())

    return UserListResponse(
        items=[UserRead.model_validate(u) for u in users],
        total=total,
    )


# ── PATCH /admin/users/{id} ────────────────────────────────────────────────────


@router.patch("/users/{user_id}", response_model=UserRead)
async def update_user(
    user_id: int,
    body: UserAdminUpdate,
    request: Request,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> UserRead:
    """
    Update a user's name, role, or active status. Admin only.
    All changes are written to the audit log.
    Admins cannot deactivate themselves.
    """
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    provided = body.model_fields_set
    if not provided:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No fields provided",
        )

    changes: dict = {}
    ip = request.client.host if request.client else None

    if "name" in provided and body.name is not None:
        if user.name != body.name:
            changes["name"] = {"from": user.name, "to": body.name}
            user.name = body.name

    if "slack_user_id" in provided:
        new_sid = body.slack_user_id.strip() if body.slack_user_id else None
        if user.slack_user_id != new_sid:
            changes["slack_user_id"] = {"from": user.slack_user_id, "to": new_sid}
            user.slack_user_id = new_sid

    if "role" in provided and body.role is not None:
        if user.role != body.role:
            changes["role"] = {"from": user.role.value, "to": body.role.value}
            user.role = body.role

    if "is_active" in provided and body.is_active is not None:
        if body.is_active is False and user.id == admin.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot deactivate your own account",
            )
        if user.is_active != body.is_active:
            action = "user.activated" if body.is_active else "user.deactivated"
            changes["is_active"] = {"from": user.is_active, "to": body.is_active}
            user.is_active = body.is_active

            await write_audit(
                session,
                actor_id=admin.id,
                action=action,
                entity_type="user",
                entity_id=user_id,
                payload={"email": user.email},
                ip_address=ip,
            )

    if "role" in changes:
        await write_audit(
            session,
            actor_id=admin.id,
            action="user.role_changed",
            entity_type="user",
            entity_id=user_id,
            payload={"email": user.email, **changes.get("role", {})},
            ip_address=ip,
        )

    if not changes:
        return UserRead.model_validate(user)

    await session.commit()
    await session.refresh(user)
    return UserRead.model_validate(user)


# ── GET /admin/audit ───────────────────────────────────────────────────────────


@router.get("/audit", response_model=AuditLogResponse)
async def list_audit_log(
    action: Optional[str] = Query(default=None, description="Filter by action prefix, e.g. 'user.'"),
    entity_type: Optional[str] = Query(default=None),
    entity_id: Optional[str] = Query(default=None),
    actor_id: Optional[int] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> AuditLogResponse:
    """
    Paginated, filterable audit log. Admin only.
    Returns entries newest-first with actor name and email denormalized.
    """
    Actor = aliased(User, flat=True)

    where = []
    if action:
        where.append(AuditLog.action.ilike(f"{action}%"))
    if entity_type:
        where.append(AuditLog.entity_type == entity_type)
    if entity_id:
        where.append(AuditLog.entity_id == entity_id)
    if actor_id is not None:
        where.append(AuditLog.actor_id == actor_id)

    count_stmt = select(func.count()).select_from(
        select(AuditLog).where(*where).subquery()
    )
    total: int = (await session.execute(count_stmt)).scalar_one()

    stmt = (
        select(
            AuditLog,
            Actor.name.label("actor_name"),
            Actor.email.label("actor_email"),
        )
        .outerjoin(Actor, AuditLog.actor_id == Actor.id)
        .where(*where)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .offset(offset)
    )

    rows = (await session.execute(stmt)).all()

    items = [
        AuditLogRead(
            id=row[0].id,
            actor_id=row[0].actor_id,
            actor_name=row[1],
            actor_email=row[2],
            action=row[0].action,
            entity_type=row[0].entity_type,
            entity_id=row[0].entity_id,
            payload=row[0].payload,
            ip_address=row[0].ip_address,
            created_at=row[0].created_at,
        )
        for row in rows
    ]

    return AuditLogResponse(items=items, total=total)


