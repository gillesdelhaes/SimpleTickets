"""
Bootstrap script — run by entrypoint.sh before uvicorn starts.

Responsibilities:
  1. Ensure a stable APP_SECRET_KEY exists as a local file on its own
     Docker volume — deliberately NOT in Postgres. This is the master key
     that decrypts every other stored secret (Slack tokens, JWT signing
     key), so it must never live in the same failure domain as the
     database it protects: a leaked DB backup, snapshot, or replica must
     not also hand over the key. The volume is still fully automatic —
     nothing to configure, no .env file, no human in the loop.
  2. Print the resolved key to stdout (captured by entrypoint.sh and
     exported as APP_SECRET_KEY so the API process inherits it).

All diagnostic output goes to stderr so stdout carries only the key.

Usage (from entrypoint.sh):
    export APP_SECRET_KEY=$(python -m app.bootstrap)
"""
import os
import secrets
import sys
from pathlib import Path

_KEY_PATH = Path(os.environ.get("APP_SECRET_KEY_PATH", "/data/secret/app_secret_key"))

# ── Caller supplied a key explicitly (e.g. injected from an external
# secrets manager) — use it as-is, nothing to persist locally. ────────────────

env_key = os.environ.get("APP_SECRET_KEY", "").strip()
if env_key and env_key != "dev-secret-change-in-production":
    print("[bootstrap] Using externally-supplied APP_SECRET_KEY", file=sys.stderr)
    print(env_key)
    sys.exit(0)

# ── Load from the local key file, or generate a fresh one ────────────────────

try:
    if _KEY_PATH.exists():
        existing_key = _KEY_PATH.read_text().strip()
        if existing_key:
            print("[bootstrap] Using persisted APP_SECRET_KEY from local key file", file=sys.stderr)
            print(existing_key)
            sys.exit(0)
except Exception as exc:
    print(f"[bootstrap] Warning: could not read key file: {exc}", file=sys.stderr)

key = secrets.token_hex(32)

try:
    _KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    _KEY_PATH.write_text(key)
    _KEY_PATH.chmod(0o600)
    print("[bootstrap] Generated and persisted new APP_SECRET_KEY to local key file", file=sys.stderr)
except Exception as exc:
    # Can't persist — the next restart would generate a different key and
    # break every stored secret, but a running instance is still better than
    # none. Surface this loudly since it needs an operator's attention.
    print(f"[bootstrap] ERROR: could not persist key file, secrets will not survive a restart: {exc}", file=sys.stderr)

print(key)
