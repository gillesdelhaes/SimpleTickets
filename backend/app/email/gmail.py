"""
Gmail connection for the email channel.

The mailbox is connected once by an admin through Google's OAuth consent
screen, using the same OAuth client as "Sign in with Google" (its client ID
is the google_client_id setting; the secret is stored encrypted as
gmail_client_secret). The consent screen should be set to Internal so only
the company's own accounts can be connected and Google's app review doesn't
apply. We keep the refresh token (encrypted) and mint short-lived access
tokens from it as needed.

Scope: gmail.modify, which allows reading, labelling and sending, but not
permanently deleting mail.
"""
import json
import logging
import secrets
import time
from datetime import timedelta
from typing import Any, Optional
from urllib.parse import urlencode

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.settings_service import get_setting, set_setting
from app.utils import utcnow

logger = logging.getLogger(__name__)

SCOPE = "https://www.googleapis.com/auth/gmail.modify"
_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_TOKEN_URL = "https://oauth2.googleapis.com/token"
_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
_API = "https://gmail.googleapis.com/gmail/v1/users/me"

CALLBACK_PATH = "/api/email/oauth/callback"
_NONCE_TTL = timedelta(minutes=10)

# Labels we put on mail we've handled. Nothing is ever deleted.
LABEL_DONE = "SimpleTickets"
LABEL_IGNORED = "SimpleTickets/Ignored"
LABEL_NOTE = "SimpleTickets/Unverified"


class GmailError(Exception):
    """A Gmail or OAuth call failed; the message is safe to show an admin."""


class GmailAuthError(GmailError):
    """The stored grant no longer works (revoked, password change, …)."""


# ── OAuth ─────────────────────────────────────────────────────────────────────


async def start_oauth(session: AsyncSession, *, user_id: int, redirect_uri: str) -> str:
    """Return the Google consent URL. The state is a single-use nonce kept
    in the DB with who started the flow and where Google must send them back."""
    client_id = (await get_setting("google_client_id", session)).strip()
    if not client_id:
        raise GmailError("Set the Google client ID in Settings → General first.")
    if not await get_setting("gmail_client_secret", session):
        raise GmailError("Add the client secret first.")

    nonce = secrets.token_urlsafe(32)
    await set_setting("gmail_oauth_nonce", json.dumps({
        "nonce": nonce,
        "user_id": user_id,
        "redirect_uri": redirect_uri,
        "expires": (utcnow() + _NONCE_TTL).isoformat(),
    }), session)

    return _AUTH_URL + "?" + urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        # Always show consent so Google always returns a refresh token
        "prompt": "consent",
        "include_granted_scopes": "false",
        "state": nonce,
    })


async def consume_oauth_state(session: AsyncSession, state: str) -> dict:
    """Check and burn the nonce. Returns {user_id, redirect_uri}."""
    raw = await get_setting("gmail_oauth_nonce", session)
    await set_setting("gmail_oauth_nonce", "", session)
    try:
        data = json.loads(raw) if raw else None
    except ValueError:
        data = None
    if (
        not data
        or not state
        or not secrets.compare_digest(str(data.get("nonce", "")), state)
        or utcnow().isoformat() > str(data.get("expires", ""))
    ):
        raise GmailError("This connection link expired or was already used. Start again from Settings.")
    return data


async def finish_oauth(session: AsyncSession, *, code: str, redirect_uri: str) -> str:
    """Exchange the code, check the grant, store it. Returns the mailbox address."""
    client_id = (await get_setting("google_client_id", session)).strip()
    client_secret = await get_setting("gmail_client_secret", session)
    async with httpx.AsyncClient(timeout=20) as http:
        resp = await http.post(_TOKEN_URL, data={
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        })
    if resp.status_code != 200:
        logger.warning("Gmail token exchange failed: %s %s", resp.status_code, resp.text[:300])
        raise GmailError(_oauth_error_text(resp))
    tokens = resp.json()

    granted = set(str(tokens.get("scope", "")).split())
    if SCOPE not in granted:
        raise GmailError("Gmail access wasn't granted. Connect again and tick the Gmail permission.")
    refresh = tokens.get("refresh_token")
    if not refresh:
        raise GmailError("Google didn't return a long-lived grant. Remove the app from the account's "
                         "third-party access page and connect again.")

    access = tokens["access_token"]
    async with httpx.AsyncClient(timeout=20) as http:
        prof = await http.get(f"{_API}/profile", headers={"Authorization": f"Bearer {access}"})
    if prof.status_code != 200:
        raise GmailError("Connected, but the Gmail API refused access. Is the Gmail API enabled "
                         "in your Google Cloud project?")
    address = str(prof.json().get("emailAddress", "")).lower()

    await set_setting("gmail_refresh_token", refresh, session)
    await set_setting("gmail_address", address, session)
    # Only mail arriving from now on is ticketed — never the existing inbox
    await set_setting("gmail_connected_at", str(int(time.time())), session)
    await set_setting("gmail_enabled", "true", session)
    await set_setting("gmail_last_error", "", session)
    _token_cache.clear()
    return address


def _oauth_error_text(resp: httpx.Response) -> str:
    try:
        err = resp.json().get("error", "")
    except ValueError:
        err = ""
    if err == "invalid_client":
        return "Google rejected the client ID or secret. Check both match the same OAuth client."
    if err == "redirect_uri_mismatch":
        return "The redirect URI isn't registered on the OAuth client. Add the one shown in Settings."
    return "Google refused the connection. Try again."


async def disconnect(session: AsyncSession) -> None:
    token = await get_setting("gmail_refresh_token", session)
    if token:
        try:
            async with httpx.AsyncClient(timeout=10) as http:
                await http.post(_REVOKE_URL, data={"token": token})
        except httpx.HTTPError:
            logger.warning("Gmail token revoke failed; clearing it locally anyway")
    for key in ("gmail_refresh_token", "gmail_address", "gmail_connected_at", "gmail_last_error"):
        await set_setting(key, "", session)
    await set_setting("gmail_enabled", "false", session)
    _token_cache.clear()
    _label_cache.clear()


# ── API client ────────────────────────────────────────────────────────────────

# refresh token → (access token, expiry epoch)
_token_cache: dict[str, tuple[str, float]] = {}
# label name → id
_label_cache: dict[str, str] = {}


class Gmail:
    """Thin async client. Build one per job run with Gmail.from_settings()."""

    def __init__(self, *, client_id: str, client_secret: str, refresh_token: str, address: str):
        self._client_id = client_id
        self._client_secret = client_secret
        self._refresh = refresh_token
        self.address = address

    @classmethod
    async def from_settings(cls, session: AsyncSession) -> Optional["Gmail"]:
        """None when the channel is off or not connected."""
        if await get_setting("gmail_enabled", session) != "true":
            return None
        refresh = await get_setting("gmail_refresh_token", session)
        address = await get_setting("gmail_address", session)
        if not refresh or not address:
            return None
        return cls(
            client_id=(await get_setting("google_client_id", session)).strip(),
            client_secret=await get_setting("gmail_client_secret", session),
            refresh_token=refresh,
            address=address,
        )

    async def _access_token(self) -> str:
        cached = _token_cache.get(self._refresh)
        if cached and cached[1] > time.time() + 60:
            return cached[0]
        async with httpx.AsyncClient(timeout=20) as http:
            resp = await http.post(_TOKEN_URL, data={
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "refresh_token": self._refresh,
                "grant_type": "refresh_token",
            })
        if resp.status_code != 200:
            if resp.status_code in (400, 401):
                raise GmailAuthError("Gmail access was revoked or expired. Reconnect the mailbox in Settings → Email.")
            raise GmailError(f"Google token endpoint returned {resp.status_code}")
        data = resp.json()
        _token_cache[self._refresh] = (data["access_token"], time.time() + int(data.get("expires_in", 3600)))
        return data["access_token"]

    async def _call(self, method: str, path: str, **kwargs: Any) -> dict:
        token = await self._access_token()
        async with httpx.AsyncClient(timeout=30) as http:
            resp = await http.request(method, f"{_API}{path}", headers={"Authorization": f"Bearer {token}"}, **kwargs)
        if resp.status_code == 401:
            _token_cache.pop(self._refresh, None)
            raise GmailAuthError("Gmail access was revoked or expired. Reconnect the mailbox in Settings → Email.")
        if resp.status_code >= 400:
            raise GmailError(f"Gmail API {method} {path.split('?')[0]} returned {resp.status_code}")
        return resp.json() if resp.content else {}

    async def list_message_ids(self, query: str, max_results: int = 25) -> list[str]:
        data = await self._call("GET", "/messages", params={"q": query, "maxResults": max_results})
        return [m["id"] for m in data.get("messages", [])]

    async def get_raw(self, message_id: str) -> dict:
        """{'id', 'threadId', 'raw' (base64url), 'labelIds', 'internalDate'}"""
        return await self._call("GET", f"/messages/{message_id}", params={"format": "raw"})

    async def label_id(self, name: str) -> str:
        if name in _label_cache:
            return _label_cache[name]
        data = await self._call("GET", "/labels")
        for lab in data.get("labels", []):
            _label_cache[lab["name"]] = lab["id"]
        if name not in _label_cache:
            created = await self._call("POST", "/labels", json={
                "name": name, "labelListVisibility": "labelShow", "messageListVisibility": "show",
            })
            _label_cache[name] = created["id"]
        return _label_cache[name]

    async def mark_handled(self, message_id: str, *extra_labels: str) -> None:
        """Label as handled (plus any extra labels) and mark read."""
        ids = [await self.label_id(LABEL_DONE)] + [await self.label_id(n) for n in extra_labels]
        await self._call("POST", f"/messages/{message_id}/modify", json={
            "addLabelIds": ids, "removeLabelIds": ["UNREAD"],
        })

    async def send_raw(self, raw_b64url: str, thread_id: Optional[str]) -> dict:
        body: dict[str, Any] = {"raw": raw_b64url}
        if thread_id:
            body["threadId"] = thread_id
        return await self._call("POST", "/messages/send", json=body)
