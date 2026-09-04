"""
Google ID-token verification for the "Sign in with Google" (GIS) flow.

The login page renders Google's GIS button, which hands the browser a signed
ID token (JWT). The frontend posts it to POST /auth/google, and this module
verifies it against Google's published JWKS: RS256 signature, audience
(our client ID), issuer, expiry, and a verified email claim.

Only a public OAuth client ID is involved — no client secret — so the ID can
live as a plain (non-secret) row in app_settings, consistent with the
no-env-files configuration model.

PyJWKClient does blocking HTTP to fetch Google's keys; it caches them
(lifespan below), and callers go through asyncio.to_thread so the event loop
never blocks on the occasional refresh.
"""
import asyncio
import logging
from typing import Optional

import jwt
from jwt import PyJWKClient, PyJWTError

logger = logging.getLogger(__name__)

_GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
_GOOGLE_ISSUERS = {"https://accounts.google.com", "accounts.google.com"}
_JWKS_CACHE_SECONDS = 3600

_jwks_client: Optional[PyJWKClient] = None


class GoogleTokenError(Exception):
    """The presented Google credential could not be verified."""


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(
            _GOOGLE_JWKS_URL, cache_keys=True, lifespan=_JWKS_CACHE_SECONDS
        )
    return _jwks_client


async def verify_google_id_token(credential: str, client_id: str) -> dict:
    """
    Verify a Google ID token and return its claims.

    Checks: RS256 signature against Google's JWKS, aud == our client ID,
    exp/iat (30s leeway for clock skew), issuer, and email_verified.
    Raises GoogleTokenError on any failure — callers must treat the token
    as worthless in that case.
    """

    def _verify() -> dict:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(credential)
        return jwt.decode(
            credential,
            signing_key.key,
            algorithms=["RS256"],
            audience=client_id,
            leeway=30,
        )

    try:
        claims = await asyncio.to_thread(_verify)
    except PyJWTError as exc:
        raise GoogleTokenError(f"Invalid Google credential: {exc}") from exc
    except Exception as exc:  # JWKS fetch failure, malformed token header, …
        logger.warning("Google ID-token verification failed: %s", exc)
        raise GoogleTokenError("Could not verify the Google credential") from exc

    if claims.get("iss") not in _GOOGLE_ISSUERS:
        raise GoogleTokenError("Wrong token issuer")
    if not claims.get("email") or not claims.get("email_verified"):
        raise GoogleTokenError("Google account email is missing or unverified")
    return claims
