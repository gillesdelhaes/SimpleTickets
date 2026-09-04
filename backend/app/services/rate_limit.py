"""
Lightweight in-process sliding-window rate limiter, generalized from the
one already used for login/password-reset in routers/auth.py.

In-memory only — resets on container restart, and only effective with a
single uvicorn worker (see backend/entrypoint.sh, which runs exactly one).
That's an accepted, documented trade-off for this deployment shape (see
TODO.md L1) — the goal here is bounding abuse from a single account, not
perfect fairness or distributed correctness.
"""
from time import monotonic

from fastapi import HTTPException, status

_MAX_TRACKED_KEYS = 10_000


class RateLimiter:
    def __init__(self, limit: int, window_seconds: float):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, list[float]] = {}

    def check(self, key: str) -> None:
        """Raise 429 if `key` has exceeded the limit within the window,
        otherwise record this hit."""
        now = monotonic()
        # Plain .get(), never __getitem__: this used to be a defaultdict whose
        # read access inserted the key, which made the is-new eviction check
        # below unreachable and let the map grow without bound.
        is_new = key not in self._hits
        recent = [t for t in self._hits.get(key, ()) if now - t < self.window]
        if len(recent) >= self.limit:
            self._hits[key] = recent
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests — please slow down.",
            )
        if is_new and len(self._hits) >= _MAX_TRACKED_KEYS:
            # Bound memory under a rotating-identity flood — evict whoever's
            # least recently active rather than growing unbounded.
            oldest_key = min(self._hits, key=lambda k: self._hits[k][-1] if self._hits[k] else 0.0)
            del self._hits[oldest_key]
        recent.append(now)
        self._hits[key] = recent

    def allow(self, key: str) -> bool:
        """Same check, but returns False instead of raising — for non-HTTP
        callers (e.g. Slack event handlers) that need to silently drop
        rather than return a 429."""
        try:
            self.check(key)
            return True
        except HTTPException:
            return False
