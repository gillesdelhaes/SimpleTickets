#!/bin/sh
# Cron-friendly SimpleTickets backup — logs in as an admin, downloads the
# in-app backup zip (all data + attachments; secrets are deliberately
# excluded, see README), and prunes old backups past a retention count.
#
# This does NOT cover the app_secret / db_secret volumes — those hold the
# master encryption key and DB password and need their own, separate,
# infrequent backup. See the "Backups" section in the README.
#
# Configure via environment (e.g. a root-owned, chmod 600 env file sourced
# from cron — see the README for a crontab example):
#   ST_URL              Base URL, e.g. http://localhost:3000/api (default)
#   ST_ADMIN_EMAIL       Admin login email (required)
#   ST_ADMIN_PASSWORD    Admin login password (required)
#   ST_BACKUP_DIR        Where to write backup zips (default: ./backups)
#   ST_BACKUP_KEEP       How many recent backups to retain (default: 14)
set -eu

ST_URL="${ST_URL:-http://localhost:3000/api}"
ST_BACKUP_DIR="${ST_BACKUP_DIR:-./backups}"
ST_BACKUP_KEEP="${ST_BACKUP_KEEP:-14}"

if [ -z "${ST_ADMIN_EMAIL:-}" ] || [ -z "${ST_ADMIN_PASSWORD:-}" ]; then
    echo "ST_ADMIN_EMAIL and ST_ADMIN_PASSWORD must be set" >&2
    exit 1
fi

mkdir -p "$ST_BACKUP_DIR"

TOKEN=$(curl -sf -X POST "$ST_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${ST_ADMIN_EMAIL}\",\"password\":\"${ST_ADMIN_PASSWORD}\"}" \
    | python3 -c "import sys, json; print(json.load(sys.stdin)['access_token'])")

if [ -z "$TOKEN" ]; then
    echo "Login failed — check ST_URL/ST_ADMIN_EMAIL/ST_ADMIN_PASSWORD" >&2
    exit 1
fi

OUT_FILE="$ST_BACKUP_DIR/simpletickets-$(date -u +%Y%m%dT%H%M%SZ).zip"

curl -sf "$ST_URL/admin/backup" \
    -H "Authorization: Bearer $TOKEN" \
    -o "$OUT_FILE"

echo "Backup written to $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"

# Prune — keep the $ST_BACKUP_KEEP most recent backups
ls -1t "$ST_BACKUP_DIR"/simpletickets-*.zip 2>/dev/null | tail -n +$((ST_BACKUP_KEEP + 1)) | while IFS= read -r old; do
    rm -f "$old"
    echo "Pruned old backup: $old"
done
