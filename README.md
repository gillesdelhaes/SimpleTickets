# Simple**Tickets**

A self-hosted, Slack-first helpdesk for small IT teams. People ask for help in
Slack or by email, with no portal account to create; technicians work the queue
in a web UI. One `docker compose up`, no config files.

![Dashboard](docs/screenshots/dashboard-dark.png)

## Features

- **Slack intake** — DM the bot, react with an emoji, `/ticket`, or a message
  shortcut; replies and files sync both ways in the thread
- **Email channel** — connect a Google Workspace mailbox (e.g. `help@`): new mail
  becomes a ticket and replies go out in the same thread
- **SLAs** — first-response and resolution targets per priority, business hours,
  pausable statuses, breach warnings
- **Queue** — filters, saved views, live SLA meters, bulk actions
- **CSAT, reports and search** — surveys on resolution, team and technician
  reports with CSV export, full-text search
- **Ask** — chat with your ticket data: trends, recurring problems, whether the
  categories still fit, workload, SLAs. Numbers come from SQL (the same queries
  as Reports), the AI only picks what to look up and writes the summary;
  suggested changes (move tickets, add or merge categories) need a click to
  confirm. Uses the AI assistant's provider; works with small models like
  Gemini Flash
- **Sign in with Google** for staff, with a password break-glass admin
- **Everything in the UI** — users, statuses, categories, SLAs, integrations,
  backup and restore

| | |
|---|---|
| ![Queue](docs/screenshots/queue-dark.png) | ![Ticket detail](docs/screenshots/ticket-detail-dark.png) |

## Quick start

```bash
git clone https://github.com/gillesdelhaes/SimpleTickets.git
cd SimpleTickets
docker compose up -d
```

Open **http://localhost:3000**. The setup wizard creates your admin account and
can connect Slack (a copy-paste app manifest; Socket Mode, so no public URL).

To try Ask on realistic data, add four months of demo tickets (and remove
them again with `--purge`). Nothing is sent to Slack or email:

```bash
docker compose exec api sh -c 'DATABASE_URL="postgresql+asyncpg://postgres:$(cat /data/db-secret/password)@db:5432/simpletickets" APP_SECRET_KEY=$(python -m app.bootstrap) python -m app.demo_seed'
```

For production (TLS, VPN-only hosting, egress allowlist, Google sign-in, the
email mailbox, backups), see **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.
Plain HTTP on `:3000` is for localhost only.

## Stack

FastAPI · PostgreSQL 16 · SQLModel/Alembic · Slack Bolt · React 18 + TypeScript ·
Vite · Tailwind · TanStack Query. Three containers (db, api, frontend); only the
frontend port is exposed.

## License

MIT — see [LICENSE](LICENSE).
