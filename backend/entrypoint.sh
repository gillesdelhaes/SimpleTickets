#!/bin/sh
set -e

echo "[entrypoint] Running database migrations..."
alembic upgrade head

echo "[entrypoint] Bootstrapping machine secret..."
APP_SECRET_KEY=$(python -m app.bootstrap)
export APP_SECRET_KEY

echo "[entrypoint] Starting API server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
