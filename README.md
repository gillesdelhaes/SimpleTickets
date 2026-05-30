# SimplyTickets

A self-hosted support ticketing system with a React frontend, FastAPI backend, PostgreSQL database, Google SSO, Slack integration, and SLA tracking.

## Stack

- **Backend**: Python 3.12, FastAPI, SQLModel, Alembic, asyncpg
- **Frontend**: React 18, Vite 6, TypeScript, Tailwind CSS, TanStack Query
- **Database**: PostgreSQL 16
- **Auth**: Google OIDC (Authlib) + local email/password accounts, JWT (HS256)
- **Integrations**: Slack (Socket Mode), SMTP notifications
- **Deployment**: Docker Compose, nginx

## Prerequisites

- Docker 24+ and Docker Compose v2
- A domain name (for production)
- Google Cloud project with OAuth 2.0 credentials (optional — for Google SSO)
- A Slack app with Bot and App-Level tokens (optional — for Slack integration)

## Quick Start (Development)

```bash
# 1. Clone and enter the repo
git clone https://github.com/gillesdelhaes/simplytickets.git
cd simplytickets

# 2. Create your environment file
cp .env.example .env
# Edit .env — at minimum set APP_SECRET_KEY

# 3. Start the stack
docker compose up -d

# 4. Run database migrations
make migrate
# or: docker compose exec api alembic upgrade head

# 5. Open the app
open http://localhost:3000
```

The first user to sign in via Google SSO (or a local account created via the API) becomes an admin if `DEFAULT_ROLE` is set to `admin`.

## Production Deployment

```bash
# Build and start in production mode (nginx serves the frontend, no Vite dev server)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# Run migrations against the production database
make prod-migrate

# View logs
make prod-logs

# Stop
make prod-down
```

### HTTPS / SSL

SimplyTickets does not terminate TLS itself. Place it behind a reverse proxy (Caddy, Traefik, nginx, or a cloud load balancer) that handles SSL and forwards requests to port 80 of the frontend container.

Once behind HTTPS, set `APP_BASE_URL` to your `https://` URL. The nginx configuration already sends `Strict-Transport-Security` headers.

## Environment Variables

Copy `.env.example` to `.env` and fill in the values. Never commit `.env`.

### Application

| Variable | Required | Description |
|---|---|---|
| `APP_SECRET_KEY` | ✅ | JWT signing secret — generate with `python -c "import secrets; print(secrets.token_hex(32))"` |
| `APP_BASE_URL` | ✅ | Public URL of the frontend, e.g. `https://tickets.example.com` |
| `DEFAULT_ROLE` | | Role assigned to new SSO users (`end_user`, `technician`, `admin`). Default: `end_user` |
| `ATTACHMENT_MAX_SIZE_MB` | | Max file upload size in MB. Default: `10` |

### Database

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | asyncpg connection string, e.g. `postgresql+asyncpg://user:pass@db:5432/simplytickets` |
| `DB_PASSWORD` | ✅ | PostgreSQL superuser password (used by the `db` container) |

### Google OAuth / SSO

Leave all blank to disable Google SSO — local accounts only.

| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth 2.0 Client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 Client Secret |
| `GOOGLE_WORKSPACE_DOMAIN` | Restrict login to this G Suite domain (e.g. `example.com`). Leave blank to allow any Google account. |

**Google Cloud setup:**
1. Create a project at console.cloud.google.com
2. Enable the "Google+ API" or "Google Identity"
3. Create OAuth 2.0 credentials (Web application)
4. Add `https://your-domain/api/auth/google/callback` as an authorised redirect URI

### Slack Integration

Leave all blank to disable Slack features.

| Variable | Description |
|---|---|
| `SLACK_BOT_TOKEN` | Bot User OAuth Token (`xoxb-…`) |
| `SLACK_APP_TOKEN` | App-Level Token for Socket Mode (`xapp-…`) |
| `SLACK_SIGNING_SECRET` | Used to verify request signatures from Slack |
| `SLACK_TRIGGER_EMOJI` | Emoji reaction that creates a ticket (without colons). Default: `ticket` |
| `SLACK_MONITORED_CHANNELS` | Comma-separated channel IDs to watch. Leave blank to monitor all channels. |
| `SLACK_TWO_WAY_SYNC` | Sync web replies to Slack threads and vice versa. Default: `true` |

**Slack app setup:**
1. Create an app at api.slack.com/apps
2. Enable Socket Mode (requires an App-Level Token with `connections:write` scope)
3. Add Bot Token Scopes: `channels:history`, `reactions:read`, `users:read`, `users:read.email`, `chat:write`, `im:write`
4. Enable Events: `reaction_added`, `message.channels`
5. Add a Slash Command: `/ticket`
6. Install the app to your workspace

### SMTP (Email Notifications)

Leave `SMTP_HOST` blank to print emails to stdout (useful in development).

| Variable | Description |
|---|---|
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_PORT` | Port — `587` for STARTTLS, `465` for SSL. Default: `587` |
| `SMTP_TLS` | Enable STARTTLS. Default: `true` |
| `SMTP_USER` | SMTP username |
| `SMTP_PASSWORD` | SMTP password |
| `SMTP_FROM` | From address for outgoing notifications |

## Makefile Reference

```
make up           # Start dev stack (docker compose up -d)
make down         # Stop dev stack
make logs         # Tail dev logs
make migrate      # Run Alembic migrations (dev)
make shell        # Open a shell in the api container

make prod-build   # Build production images
make prod-up      # Start production stack
make prod-down    # Stop production stack
make prod-logs    # Tail production logs
make prod-migrate # Run migrations (production)
```

## Creating the First Admin Account

Option A — Google SSO: Set `DEFAULT_ROLE=admin` in `.env`, restart, then sign in with Google. Revert `DEFAULT_ROLE` to `end_user` after.

Option B — Local account via API:
```bash
curl -X POST http://localhost:3000/api/admin/users \
  -H "Authorization: Bearer <your-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Admin","email":"admin@example.com","password":"changeme","role":"admin"}'
```

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│   Browser   │────▶│  nginx (80)  │────▶│  FastAPI     │
│             │     │  React SPA   │     │  (port 8000) │
└─────────────┘     └──────────────┘     └──────┬───────┘
                                                │
                                         ┌──────▼───────┐
                                         │  PostgreSQL  │
                                         │  (port 5432) │
                                         └──────────────┘
```

All three services run in an internal Docker bridge network. Only the nginx container exposes a port to the host.

## License

MIT
