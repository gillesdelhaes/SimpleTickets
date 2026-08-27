#!/bin/sh
set -e

echo "[entrypoint] Resolving database password..."
DB_PASSWORD_FILE="${DB_PASSWORD_FILE:-/data/db-secret/password}"
DB_PASSWORD=$(cat "$DB_PASSWORD_FILE")
export DATABASE_URL="postgresql+asyncpg://postgres:${DB_PASSWORD}@db:5432/simpletickets"

echo "[entrypoint] Running database migrations..."
alembic upgrade head

echo "[entrypoint] Bootstrapping machine secret..."
APP_SECRET_KEY=$(python -m app.bootstrap)
export APP_SECRET_KEY

echo "[entrypoint] Starting API server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
