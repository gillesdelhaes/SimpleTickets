#!/bin/sh
set -e

# Auto-generate the Postgres password on first boot and persist it to its own
# volume — mirrors backend/app/bootstrap.py's handling of APP_SECRET_KEY.
# POSTGRES_PASSWORD_FILE only affects initdb on an empty data directory; on
# every later boot the already-initialized cluster just keeps its stored
# password, and the api container reads the same file to build DATABASE_URL.
SECRET_DIR="${DB_PASSWORD_DIR:-/data/db-secret}"
SECRET_FILE="$SECRET_DIR/password"

mkdir -p "$SECRET_DIR"

if [ ! -s "$SECRET_FILE" ]; then
    echo "[db-entrypoint] Generating new database password" >&2
    openssl rand -hex 32 > "$SECRET_FILE"
    # World-readable, not writable: db and api run as different container
    # UIDs and both need to read this file; the volume itself (internal-
    # network-only, no host bind mount) is the actual security boundary.
    chmod 644 "$SECRET_FILE"
else
    echo "[db-entrypoint] Using persisted database password" >&2
fi

export POSTGRES_PASSWORD_FILE="$SECRET_FILE"

exec docker-entrypoint.sh "$@"
