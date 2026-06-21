# SimpleTickets

A self-hosted, Slack-first helpdesk for small IT teams. End users submit and track tickets entirely through Slack — no portal account required. Technicians work the queue through a web UI.

---

## Features

### Slack integration
- **Four creation paths** — DM the bot, react with an emoji, use `/ticket`, or the App Home tab
- **Two-way thread sync** — web replies post to the Slack thread automatically, and vice versa
- **DM notifications** — submitter is notified on every tech reply and field update; assignee is DM'd when assigned a ticket
- **SLA breach warnings** — all technicians and admins with a Slack account are DM'd 15 minutes before a resolution or first-response deadline
- **File attachments** — images and files flow in both directions between Slack and the web UI
- **App Home tab** — tabbed view (Active / Pending / Resolved) with rich ticket cards, inline Reply modal, and one-click Resolve; auto-refreshes after actions

### Web UI (technicians and admins only)
- **Dashboard** — unassigned queue count, "needs your attention" panel (SLA breaches + unread replies on your tickets), live activity feed
- **Queue** — filterable by status, priority, assignee; sortable columns; channel icons; SLA bars
- **Ticket detail** — public replies, internal notes, file attachments, full conversation timeline with field-change events interleaved by timestamp
- **Reports** — ticket volume, by priority, by status, by category, by channel (Slack vs web), technician performance with SLA compliance
- **Full-text search** — across titles, descriptions, and reply bodies (PostgreSQL FTS)

### Core engine
- **SLA policies** — configurable per priority; resolution and first-response deadlines; breach detection; pause/resume on configurable statuses; auto-reopen on reply
- **Configurable statuses** — create custom statuses with colour, SLA-pause flag, and resolved-state flag; no code changes needed
- **Conversation timeline** — status changes, reassignments, priority changes, and category changes appear inline between replies with actor and timestamp
- **Audit log** — every field change recorded with actor, old value, and new value
- **Notifications** — unread reply badges on queue rows, bell dropdown with per-ticket navigation; queue and ticket views auto-refresh every 15–30 s

### Admin
- **Users** — local accounts only (admin-created); Slack user ID linking for cross-platform identity
- **Unified settings** — single tabbed page covers general settings, Slack credentials, categories, SLA policies, statuses, and backup/restore; no config files or restarts needed
- **Setup wizard** — first-run flow creates the admin account and optionally configures Slack credentials
- **Slack setup guide** — step-by-step guide built into the Slack settings tab covering all required scopes, events, and app configuration

---

## Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, FastAPI, SQLModel, Alembic, asyncpg |
| Frontend | React 18, Vite, TypeScript, TanStack Query v5, Recharts |
| Database | PostgreSQL 16 |
| Auth | Local email/password, JWT (HS256), auto-generated secret on first boot |
| Slack | Slack Bolt (Python), Socket Mode — no public inbound URL required |
| Deployment | Docker Compose |

---

## Quick start

```bash
git clone https://github.com/gillesdelhaes/SimpleTickets.git
cd SimpleTickets
docker compose up -d
```

Open **http://localhost:3000** — the setup wizard runs automatically on first launch.

The wizard creates the admin account and optionally configures Slack. Everything else is managed through the admin panel.

---

## Configuration

The stack is self-configuring. The only required variable with no default is the database password.

| Variable | Default | Description |
|---|---|---|
| `DB_PASSWORD` | — | PostgreSQL password (required) |
| `DATABASE_URL` | set in compose | asyncpg connection string |
| `STORAGE_LOCAL_PATH` | `/data/attachments` | Attachment storage path inside the container |

All Slack credentials (bot token, app token, signing secret, trigger emoji) are set through the web UI after first login — not environment variables. The JWT secret is generated and persisted automatically on first boot.

---

## Slack setup

SimpleTickets uses a **private Slack app** in your workspace running over Socket Mode — no public webhook URL or port forwarding needed.

A full step-by-step guide is available inside the app at **Admin → Settings → Slack** after completing the wizard. Short version:

1. Create an app at [api.slack.com/apps](https://api.slack.com/apps) → From scratch
2. Enable **Socket Mode** → generate an App-Level Token (`xapp-…`) with `connections:write`
3. Add **Bot Token Scopes**: `chat:write`, `files:read`, `files:write`, `reactions:read`, `users:read`, `channels:history`, `groups:history`, `im:history`, `im:write`
4. Subscribe to **bot events**: `message.im`, `message.channels`, `message.groups`, `reaction_added`, `app_home_opened`
5. Add a **Slash Command**: command `/ticket`, description `Create a support ticket`
6. Enable **Interactivity** and the **App Home** tab
7. Install to workspace → copy the Bot Token (`xoxb-…`)
8. Enter both tokens and the signing secret in **Admin → Settings**

---

## Architecture

```
Browser ──▶ nginx (port 3000) ──▶ FastAPI (port 8000) ──▶ PostgreSQL (port 5432)
                                         │
                                   Slack API
                                 (Socket Mode WebSocket,
                                  no inbound port required)
```

All services run on an internal Docker bridge network. Only the frontend port (`3000`) is exposed to the host.

---

## License

AGPL-3.0
