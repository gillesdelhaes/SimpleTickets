import secrets
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from time import monotonic

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWTError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from pydantic import BaseModel

from app.auth.deps import get_current_user
from app.auth.google import GoogleTokenError, verify_google_id_token
from app.auth.jwt import create_access_token, decode_access_token
from app.database import get_session
from app.models import AuthProvider, PasswordResetToken, RevokedToken, User
from app.models.user_slack_identity import UserSlackIdentity
from app.schemas.auth import ForgotPasswordRequest, LoginRequest, ResetPasswordRequest, TokenResponse
from app.services.audit import write_audit
from app.services.passwords import hash_password, verify_password
from app.slack.service import send_password_reset_dm
from app.utils import client_ip

router = APIRouter(prefix="/auth", tags=["auth"])

_bearer = HTTPBearer()

# Precomputed bcrypt hash used to equalize login timing when the email doesn't
# exist (or has no password), so response time doesn't reveal which emails are
# registered. The value never matches any real password.
_DUMMY_PASSWORD_HASH = hash_password("account-enumeration-timing-equalizer")

# ── Simple in-memory rate limiter ─────────────────────────────────────────────
# 10 attempts per IP per 60 seconds. Resets automatically as the window slides.

_attempts: dict[str, list[float]] = defaultdict(list)
_LIMIT = 10
_WINDOW = 60.0
_MAX_TRACKED_IPS = 10_000  # bound memory: rotating/spoofed IPs can't grow the map forever


def _client_ip(request: Request) -> str:
    # Shared X-Real-IP-aware resolution (see app.utils.client_ip); the limiter
    # needs a non-null key, hence the "unknown" fallback.
    return client_ip(request) or "unknown"


def _check_rate_limit(ip: str) -> None:
    now = monotonic()
    recent = [t for t in _attempts.get(ip, ()) if now - t < _WINDOW]

    # Opportunistically evict stale buckets so the map can't grow without bound.
    if len(_attempts) > _MAX_TRACKED_IPS:
        for stale in [k for k, v in _attempts.items() if not v or now - v[-1] >= _WINDOW]:
            del _attempts[stale]

    if len(recent) >= _LIMIT:
        _attempts[ip] = recent
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts — please wait a minute and try again.",
        )
    recent.append(now)
    _attempts[ip] = recent


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    """Authenticate with email + password. Returns a Bearer JWT."""
    _check_rate_limit(_client_ip(request))
    ip = _client_ip(request)

    result = await session.execute(
        select(User).where(User.email == body.email.lower())
    )
    user = result.scalar_one_or_none()

    _invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid email or password",
        headers={"WWW-Authenticate": "Bearer"},
    )

    async def _log_failure(reason: str) -> None:
        await write_audit(
            session,
            actor_id=user.id if user else None,
            action="user.login_failed",
            entity_type="user",
            entity_id=user.id if user else None,
            payload={"email": body.email.lower(), "reason": reason},
            ip_address=ip,
        )
        await session.commit()

    if user is None or not user.hashed_password:
        # Run a verify against a dummy hash so a missing account costs the same
        # ~bcrypt time as a wrong password for a real one (no timing oracle).
        verify_password(body.password, _DUMMY_PASSWORD_HASH)
        await _log_failure("unknown_account")
        raise _invalid
    if not verify_password(body.password, user.hashed_password):
        await _log_failure("bad_password")
        raise _invalid
    if not user.is_active:
        await _log_failure("account_disabled")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled — contact your administrator",
        )

    user.last_login_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await write_audit(
        session,
        actor_id=user.id,
        action="user.login",
        entity_type="user",
        entity_id=user.id,
        ip_address=ip,
    )
    await session.commit()

    return TokenResponse(
        access_token=create_access_token(user.id, user.email, user.role.value, user.name or "")
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Revoke the presented token's jti so it can't be reused before it
    would otherwise expire — closes the window a client-side-only logout
    leaves open (stolen/cached token, shared device)."""
    try:
        payload = decode_access_token(credentials.credentials)
        jti = payload.get("jti")
        exp = payload.get("exp")
        user_id = int(payload["sub"]) if "sub" in payload else None
    except (PyJWTError, KeyError, ValueError):
        return  # already invalid/expired — nothing to revoke

    if jti and exp:
        expires_at = datetime.fromtimestamp(exp, tz=timezone.utc).replace(tzinfo=None)
        session.add(RevokedToken(jti=jti, expires_at=expires_at))
        await write_audit(
            session,
            actor_id=user_id,
            action="user.logout",
            entity_type="user",
            entity_id=user_id,
            ip_address=_client_ip(request),
        )
        await session.commit()



# ── Sign in with Google (GIS) ─────────────────────────────────────────────────
# Gated model: only accounts an admin pre-provisioned with
# auth_provider=google can sign in this way — unknown Google identities are
# rejected, local (break-glass) accounts keep using passwords. The client ID
# is public by design (it's embedded in the login page), so exposing it
# unauthenticated leaks nothing.


class GoogleLoginRequest(BaseModel):
    credential: str  # Google ID token from the GIS button


@router.get("/google/config")
async def google_config(session: AsyncSession = Depends(get_session)) -> dict:
    """Unauthenticated. Tells the login page whether to render the Google
    button, and with which client ID."""
    from app.services.settings_service import get_setting
    client_id = (await get_setting("google_client_id", session)).strip()
    return {"client_id": client_id or None}


@router.post("/google", response_model=TokenResponse)
async def google_login(
    body: GoogleLoginRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    """Authenticate with a Google ID token. Only pre-provisioned
    auth_provider=google accounts are accepted."""
    ip = _client_ip(request)
    _check_rate_limit(ip)

    from app.services.settings_service import get_setting
    client_id = (await get_setting("google_client_id", session)).strip()
    if not client_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Google sign-in is not enabled",
        )

    try:
        claims = await verify_google_id_token(body.credential, client_id)
    except GoogleTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google sign-in failed — please try again",
        )

    email = str(claims["email"]).lower()
    user = (await session.execute(
        select(User).where(User.email == email)
    )).scalar_one_or_none()

    async def _log_failure(reason: str) -> None:
        await write_audit(
            session,
            actor_id=user.id if user else None,
            action="user.login_failed",
            entity_type="user",
            entity_id=user.id if user else None,
            payload={"email": email, "reason": reason, "provider": "google"},
            ip_address=ip,
        )
        await session.commit()

    # The caller proved they own this Google account (valid signed token), so
    # a specific message doesn't enable enumeration the way login errors would.
    if user is None or user.auth_provider != AuthProvider.google:
        await _log_failure("no_google_account" if user is None else "not_google_provider")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No SimpleTickets account is linked to this Google identity — ask an administrator",
        )
    if not user.is_active:
        await _log_failure("account_disabled")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled — contact your administrator",
        )

    user.last_login_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await write_audit(
        session,
        actor_id=user.id,
        action="user.login",
        entity_type="user",
        entity_id=user.id,
        payload={"provider": "google"},
        ip_address=ip,
    )
    await session.commit()

    return TokenResponse(
        access_token=create_access_token(user.id, user.email, user.role.value, user.name or "")
    )


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password", response_model=TokenResponse)
async def change_password(
    body: ChangePasswordRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    """Change the authenticated user's own password. Revokes every existing
    session (tokens issued before this instant) and returns a fresh token so
    the caller's own session carries on — any other/stolen token dies here."""
    _check_rate_limit(_client_ip(request))
    if not body.new_password or len(body.new_password) < 8:
        raise HTTPException(status_code=422, detail="New password must be at least 8 characters")
    if not current_user.hashed_password or not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    current_user.hashed_password = hash_password(body.new_password)
    # Truncate to the second: JWT iat is whole-second, so a sub-second cutoff
    # would reject the very token issued below.
    current_user.tokens_valid_after = datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)
    await session.commit()
    return TokenResponse(
        access_token=create_access_token(
            current_user.id, current_user.email, current_user.role.value, current_user.name or ""
        )
    )


# ── Password reset via Slack DM ────────────────────────────────────────────────
# Self-service recovery for the "lone admin forgot their password" lockout.
# Only works for accounts with at least one linked Slack identity (in any
# workspace) — everyone else still needs another admin's help, same as today.

_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O/1/I/L — read aloud safely
_CODE_LENGTH = 8
_CODE_TTL_MINUTES = 15
_CODE_COOLDOWN_SECONDS = 60.0  # don't re-DM the same user faster than this

_RESET_LIMIT = 5
_RESET_WINDOW = 900.0  # 15 minutes
_reset_attempts: dict[str, list[float]] = defaultdict(list)
_last_code_sent: dict[int, float] = {}

_GENERIC_FORGOT_MESSAGE = "If that account exists and is linked to Slack, a reset code has been sent."


def _check_reset_rate_limit(ip: str) -> None:
    now = monotonic()
    recent = [t for t in _reset_attempts.get(ip, ()) if now - t < _RESET_WINDOW]

    # Same bounded-memory eviction as the login limiter — rotating/spoofed IPs
    # must not grow the map forever.
    if len(_reset_attempts) > _MAX_TRACKED_IPS:
        for stale in [k for k, v in _reset_attempts.items() if not v or now - v[-1] >= _RESET_WINDOW]:
            del _reset_attempts[stale]

    if len(recent) >= _RESET_LIMIT:
        _reset_attempts[ip] = recent
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many attempts — please wait a while and try again.",
        )
    recent.append(now)
    _reset_attempts[ip] = recent


@router.post("/forgot-password")
async def forgot_password(
    body: ForgotPasswordRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """
    Request a one-time password-reset code via Slack DM. Always returns the
    same generic message regardless of whether the account exists, is active,
    or has Slack linked — a prober learns nothing from the response.
    """
    _check_reset_rate_limit(_client_ip(request))

    result = await session.execute(select(User).where(User.email == body.email.lower()))
    user = result.scalar_one_or_none()

    # Google-provider accounts have no password by design — a reset code
    # would mint one and quietly re-enable password login for an account
    # meant to be SSO-only. Same generic response either way.
    is_local = user is not None and user.auth_provider == AuthProvider.local

    has_identity = False
    if user and user.is_active and is_local:
        identity_row = (await session.execute(
            select(UserSlackIdentity.id).where(UserSlackIdentity.user_id == user.id).limit(1)
        )).scalar_one_or_none()
        has_identity = identity_row is not None

    if user and user.is_active and is_local and has_identity:
        now_mono = monotonic()
        if now_mono - _last_code_sent.get(user.id, 0.0) >= _CODE_COOLDOWN_SECONDS:
            code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LENGTH))
            # Send before touching the DB — a failed DM means the user never saw
            # the code, so it must not invalidate a still-valid earlier one.
            sent = await send_password_reset_dm(user, code, session)
            if sent:
                now = datetime.now(timezone.utc).replace(tzinfo=None)

                # Invalidate any still-outstanding codes so only the newest one works.
                stale = (await session.execute(
                    select(PasswordResetToken).where(
                        PasswordResetToken.user_id == user.id,
                        PasswordResetToken.used_at.is_(None),
                    )
                )).scalars().all()
                for tok in stale:
                    tok.used_at = now

                session.add(PasswordResetToken(
                    user_id=user.id,
                    code_hash=hash_password(code),
                    expires_at=now + timedelta(minutes=_CODE_TTL_MINUTES),
                ))
                await write_audit(
                    session,
                    actor_id=user.id,
                    action="user.password_reset_requested",
                    entity_type="user",
                    entity_id=str(user.id),
                    ip_address=_client_ip(request),
                )
                await session.commit()
                _last_code_sent[user.id] = now_mono

    return {"message": _GENERIC_FORGOT_MESSAGE}


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(
    body: ResetPasswordRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Complete a password reset using the code DMed via /forgot-password."""
    _check_reset_rate_limit(_client_ip(request))

    _invalid = HTTPException(status_code=400, detail="Invalid or expired reset code")

    result = await session.execute(select(User).where(User.email == body.email.lower()))
    user = result.scalar_one_or_none()
    if user is None or user.auth_provider != AuthProvider.local:
        # Burn the same bcrypt cost as a real check so timing doesn't reveal
        # whether the account exists. Non-local accounts never have valid
        # codes (forgot-password refuses to mint them) — reject uniformly.
        verify_password(body.code, _DUMMY_PASSWORD_HASH)
        raise _invalid

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    candidates = (await session.execute(
        select(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.expires_at > now,
        )
        .order_by(PasswordResetToken.created_at.desc())
    )).scalars().all()

    matched = next((c for c in candidates if verify_password(body.code, c.code_hash)), None)
    if matched is None:
        if not candidates:
            verify_password(body.code, _DUMMY_PASSWORD_HASH)
        raise _invalid

    matched.used_at = now
    user.hashed_password = hash_password(body.new_password)
    # Kill every outstanding session — the reset exists precisely because the
    # old credential (and possibly a session using it) can't be trusted.
    user.tokens_valid_after = now.replace(microsecond=0)

    await write_audit(
        session,
        actor_id=user.id,
        action="user.password_reset_completed",
        entity_type="user",
        entity_id=str(user.id),
        ip_address=_client_ip(request),
    )
    await session.commit()
