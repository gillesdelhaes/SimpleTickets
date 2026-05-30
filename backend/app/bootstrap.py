"""
Bootstrap script — run by entrypoint.sh before uvicorn starts.

Responsibilities:
  1. Ensure a stable APP_SECRET_KEY exists in app_settings.
  2. Print the resolved key to stdout (captured by entrypoint.sh and
     exported as APP_SECRET_KEY so the API process inherits it).

All diagnostic output goes to stderr so stdout carries only the key.

Usage (from entrypoint.sh):
    export APP_SECRET_KEY=$(python -m app.bootstrap)
"""
import os
import secrets
import sys

# ── Resolve DATABASE_URL ───────────────────────────────────────────────────────

db_url = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://postgres:postgres@db:5432/simplytickets",
)
# psycopg2 needs the sync driver URL
sync_url = db_url.replace("+asyncpg", "").replace("postgresql+psycopg2", "postgresql")

# ── Check env first ────────────────────────────────────────────────────────────

env_key = os.environ.get("APP_SECRET_KEY", "").strip()
if env_key and env_key != "dev-secret-change-in-production":
    # Caller already set a real key — sync it to the DB and use it
    try:
        import psycopg2
        conn = psycopg2.connect(sync_url)
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO app_settings (key, value, is_secret, group_name, updated_at)
            VALUES ('app_secret_key', %s, false, 'app', NOW())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            WHERE app_settings.value IS DISTINCT FROM EXCLUDED.value
            """,
            (env_key,),
        )
        cur.close()
        conn.close()
    except Exception as exc:
        print(f"[bootstrap] Warning: could not sync APP_SECRET_KEY to DB: {exc}", file=sys.stderr)
    print(env_key)
    sys.exit(0)

# ── Try to load from DB ────────────────────────────────────────────────────────

try:
    import psycopg2
    conn = psycopg2.connect(sync_url)
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute("SELECT value FROM app_settings WHERE key = 'app_secret_key'")
    row = cur.fetchone()

    if row and row[0]:
        print(f"[bootstrap] Using persisted APP_SECRET_KEY from DB", file=sys.stderr)
        print(row[0])
        cur.close()
        conn.close()
        sys.exit(0)

    # Generate a new key and persist it
    new_key = secrets.token_hex(32)
    cur.execute(
        """
        INSERT INTO app_settings (key, value, is_secret, group_name, updated_at)
        VALUES ('app_secret_key', %s, false, 'app', NOW())
        ON CONFLICT (key) DO UPDATE SET value = %s, updated_at = NOW()
        """,
        (new_key, new_key),
    )
    print("[bootstrap] Generated and persisted new APP_SECRET_KEY", file=sys.stderr)
    print(new_key)
    cur.close()
    conn.close()

except Exception as exc:
    # DB not ready or table missing — fall through to dev default
    print(f"[bootstrap] Warning: {exc}", file=sys.stderr)
    fallback = env_key or "dev-secret-change-in-production"
    print(fallback)
