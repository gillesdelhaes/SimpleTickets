.PHONY: dev dev-frontend build migrate migrate-new migrate-down migrate-fresh \
        shell-api shell-db logs logs-api lint test \
        prod-build prod-up prod-down prod-logs prod-migrate

# ── Development ───────────────────────────────────────────────────────────────

dev:
	@echo "Starting API + DB with hot reload..."
	@echo "Run 'make dev-frontend' in another terminal for the React dev server."
	docker compose up api db

dev-frontend:
	cd frontend && npm run dev

build:
	docker compose build

# ── Database migrations ───────────────────────────────────────────────────────

migrate:
	docker compose run --rm api alembic upgrade head

migrate-down:
	docker compose run --rm api alembic downgrade -1

migrate-new:
	@read -p "Migration name: " name; \
	docker compose run --rm api alembic revision --autogenerate -m "$$name"

migrate-fresh:
	@echo "WARNING: This will DROP and recreate the entire database."
	@read -p "Are you sure? [y/N] " confirm; \
	[ "$$confirm" = "y" ] || exit 0; \
	docker compose run --rm api alembic downgrade base; \
	docker compose run --rm api alembic upgrade head
	@echo "Database reset complete."

# ── Shells ────────────────────────────────────────────────────────────────────

shell-api:
	docker compose run --rm api bash

shell-db:
	docker compose exec db psql -U postgres simplytickets

# ── Logs ──────────────────────────────────────────────────────────────────────

logs:
	docker compose logs -f

logs-api:
	docker compose logs -f api

# ── Lint / Test ───────────────────────────────────────────────────────────────

lint:
	docker compose run --rm api sh -c "pip install --quiet ruff && ruff check app"

test:
	docker compose run --rm api sh -c "pip install --quiet pytest pytest-asyncio httpx && pytest tests/ -v"

# ── Production ────────────────────────────────────────────────────────────────

prod-build:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml build

prod-up:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

prod-down:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml down

prod-logs:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f

prod-migrate:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm api alembic upgrade head
