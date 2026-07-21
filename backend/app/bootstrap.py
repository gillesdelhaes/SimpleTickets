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
  2. Migrate a legacy DB-stored key (pre-dating this file-based scheme)
     out to the file on first run, then blank the DB row.
  3. Print the resolved key to stdout (captured by entrypoint.sh and
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


def _migrate_legacy_db_key() -> str | None:
    """
    One-time migration: older versions stored the key in the app_settings
    table. If no key file exists yet, check for one there and pull it out —
    preserving it means existing encrypted Slack tokens/JWT sessions stay
    valid across the upgrade — then blank the DB row so the plaintext key
    stops living there. Returns None (not an error) if there's nothing to
    migrate, e.g. a genuinely fresh install.
    """
    db_url = os.environ.get(
        "DATABASE_URL",
        "postgresql+asyncpg://postgres:postgres@db:5432/simpletickets",
    )
    sync_url = db_url.replace("+asyncpg", "").replace("postgresql+psycopg2", "postgresql")
    try:
        import psycopg2
        conn = psycopg2.connect(sync_url)
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute("SELECT value FROM app_settings WHERE key = 'app_secret_key'")
        row = cur.fetchone()
        if row and row[0]:
            legacy_key = row[0]
            cur.execute(
                "UPDATE app_settings SET value = NULL, updated_at = NOW() WHERE key = 'app_secret_key'"
            )
            cur.close()
            conn.close()
            print("[bootstrap] Migrated APP_SECRET_KEY out of the database to the local key file", file=sys.stderr)
            return legacy_key
        cur.close()
        conn.close()
    except Exception as exc:
        print(f"[bootstrap] Note: could not check for a legacy DB-stored key: {exc}", file=sys.stderr)
    return None


# ── Caller supplied a key explicitly (e.g. injected from an external
# secrets manager) — use it as-is, nothing to persist locally. ────────────────

env_key = os.environ.get("APP_SECRET_KEY", "").strip()
if env_key and env_key != "dev-secret-change-in-production":
    print("[bootstrap] Using externally-supplied APP_SECRET_KEY", file=sys.stderr)
    print(env_key)
    sys.exit(0)

# ── Load from the local key file ──────────────────────────────────────────────

try:
    if _KEY_PATH.exists():
        existing_key = _KEY_PATH.read_text().strip()
        if existing_key:
            print("[bootstrap] Using persisted APP_SECRET_KEY from local key file", file=sys.stderr)
            print(existing_key)
            sys.exit(0)
except Exception as exc:
    print(f"[bootstrap] Warning: could not read key file: {exc}", file=sys.stderr)

# ── Nothing on disk — migrate a legacy DB key, or generate a fresh one ────────

key = _migrate_legacy_db_key() or secrets.token_hex(32)

try:
    _KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    _KEY_PATH.write_text(key)
    _KEY_PATH.chmod(0o600)
    print("[bootstrap] Persisted APP_SECRET_KEY to local key file", file=sys.stderr)
except Exception as exc:
    # Can't persist — the next restart would generate a different key and
    # break every stored secret, but a running instance is still better than
    # none. Surface this loudly since it needs an operator's attention.
    print(f"[bootstrap] ERROR: could not persist key file, secrets will not survive a restart: {exc}", file=sys.stderr)

print(key)
