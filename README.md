# SimplyTickets

A self-hosted, Slack-first support ticketing system for small IT teams. End users submit and track tickets entirely through Slack — no portal account required. Technicians and admins work through a web UI.

## Features

- **Slack-native** — tickets created via DM, emoji reaction, `/ticket` modal, or Slack App Home
- **Two-way thread sync** — web replies appear in Slack threads and vice versa
- **File attachments** — images and files flow in both directions between Slack and the web UI
- **Queue & dashboard** — filtered ticket list, SLA badges, priority/status/assignee management
- **Full-text search** — across titles, descriptions, and reply bodies (PostgreSQL FTS)
- **Internal notes** — team-only replies invisible to the submitter
- **SLA engine** — configurable policies per priority, deadline tracking, breach detection
- **Notifications** — unread reply indicators and bell dropdown for assigned tickets
- **Audit log** — full history of every field change
- **Admin panel** — users, categories, SLA policies, settings, Slack setup guide
- **Setup wizard** — first-run flow to create the admin account and configure Slack

## Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, FastAPI, SQLModel, Alembic, asyncpg |
| Frontend | React 18, Vite, TypeScript, TanStack Query |
| Database | PostgreSQL 16 |
| Auth | Local email/password accounts, JWT (HS256) |
| Slack | Slack Bolt, Socket Mode (no public webhook URL needed) |
| Deployment | Docker Compose |

## Quick Start

```bash
git clone https://github.com/gillesdelhaes/simplytickets.git
cd simplytickets
docker compose up -d
```

Open **http://localhost:3000** — the setup wizard runs automatically on first launch.

The wizard creates the admin account and optionally configures Slack. Everything else is configured through the admin panel.

## Environment Variables

The stack is configured via `docker-compose.yml`. The only variable with no default is the database password.

| Variable | Default | Description |
|---|---|---|
| `DB_PASSWORD` | — | PostgreSQL password (required) |
| `DATABASE_URL` | set in compose | asyncpg connection string |
| `STORAGE_LOCAL_PATH` | `/data/attachments` | Where uploaded files are stored inside the container |

All Slack credentials (bot token, app token, signing secret, trigger emoji) are configured through the web UI after first login — not via environment variables.

## Slack Setup

SimplyTickets uses a **private Slack app** installed in your workspace. A step-by-step guide covering all required scopes, events, and settings is available inside the app at **Admin → Slack Setup** once you've completed the setup wizard.

Short version:
1. Create an app at [api.slack.com/apps](https://api.slack.com/apps) — From scratch
2. Enable Socket Mode → generate an App-Level Token (`xapp-…`) with `connections:write`
3. Add Bot Token Scopes: `chat:write`, `files:read`, `files:write`, `reactions:read`, `users:read`, `channels:history`, `groups:history`, `im:history`
4. Subscribe to bot events: `message.im`, `message.channels`, `message.groups`, `reaction_added`, `app_home_opened`
5. Enable Interactivity and the App Home tab
6. Install to workspace → copy the Bot Token (`xoxb-…`)
7. Enter both tokens + the signing secret in **Admin → Settings**

## Architecture

```
Browser ──▶ Vite / nginx (3000) ──▶ FastAPI (8000) ──▶ PostgreSQL (5432)
                                          │
                                    Slack (Socket Mode)
                                    WebSocket, no inbound port
```

All services run on an internal Docker bridge network (`simplytickets_internal`). Only the frontend port is exposed to the host.

## License

AGPL-3.0
