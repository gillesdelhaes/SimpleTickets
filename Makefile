.PHONY: build migrate migrate-new migrate-down migrate-fresh \
        shell-api shell-db logs logs-api \
        prod-build prod-up prod-down prod-logs prod-migrate

DC      = docker compose -f docker-compose.yml
DC_PROD = docker compose -f docker-compose.yml -f docker-compose.prod.yml

# ── Build ─────────────────────────────────────────────────────────────────────

build:
	$(DC) build

# ── Database migrations ───────────────────────────────────────────────────────

migrate:
	$(DC) run --rm api alembic upgrade head

migrate-down:
	$(DC) run --rm api alembic downgrade -1

migrate-new:
	@read -p "Migration name: " name; \
	$(DC) run --rm api alembic revision --autogenerate -m "$$name"

migrate-fresh:
	@echo "WARNING: This will DROP and recreate the entire database."
	@read -p "Are you sure? [y/N] " confirm; \
	[ "$$confirm" = "y" ] || exit 0; \
	$(DC) run --rm api alembic downgrade base; \
	$(DC) run --rm api alembic upgrade head
	@echo "Database reset complete."

# ── Shells / Logs ─────────────────────────────────────────────────────────────

shell-api:
	$(DC) run --rm api bash

shell-db:
	$(DC) exec db psql -U postgres simplytickets

logs:
	$(DC) logs -f

logs-api:
	$(DC) logs -f api

# ── Production ────────────────────────────────────────────────────────────────

prod-build:
	$(DC_PROD) build

prod-up:
	$(DC_PROD) up -d

prod-down:
	$(DC_PROD) down

prod-logs:
	$(DC_PROD) logs -f

prod-migrate:
	$(DC_PROD) run --rm api alembic upgrade head
