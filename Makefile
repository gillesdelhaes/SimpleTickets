.PHONY: build migrate migrate-new migrate-down migrate-fresh \
        shell-api shell-db logs logs-api

DC = docker compose -f docker-compose.yml

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
	$(DC) exec db psql -U postgres simpletickets

logs:
	$(DC) logs -f

logs-api:
	$(DC) logs -f api
