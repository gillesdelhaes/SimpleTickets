# Simple**Tickets**

A self-hosted, Slack-first helpdesk for small IT teams. End users submit and track
tickets entirely through Slack — no portal account required. Technicians work the
queue through a web UI.

Part of a suite of simple, self-hosted ops tools: each app does one thing well,
runs from a single `docker compose up`, and needs zero configuration to start.

![Dashboard](docs/screenshots/dashboard-dark.png)

## What it does

- **Slack-first intake** — four creation paths: DM the bot, react with an emoji,
  `/ticket`, or the App Home tab; images and files flow in both directions
- **Two-way thread sync** — web replies post to the Slack thread automatically,
  and vice versa; submitters are DM'd on every reply and field update
- **SLA tracking** — per-priority policies for first response and resolution,
  pause/resume on configurable statuses, breach warnings DM'd to the team
  15 minutes before a deadline
- **Queue** — filterable by status, priority, assignee, and category; sortable
  columns; live SLA countdown meters; bulk assign, prioritize, and resolve
- **Ticket detail** — public replies, internal notes, attachments, and a full
  conversation timeline with field-change events interleaved by timestamp
- **CSAT surveys** — thumbs up/down sent on resolution; negative feedback
  reopens the ticket and surfaces on the dashboard
- **Reports** — volume, priority, status, category, and channel breakdowns,
  technician performance with SLA compliance, CSV export
- **Full-text search** — across titles, descriptions, and reply bodies
- **Sign in with Google** — optionally gate technician accounts behind your
  Google org (inheriting its MFA), no self-signup, with a password-based
  break-glass admin always kept
- **Admin without config files** — users, statuses, categories, SLA policies,
  Slack credentials, and backup/restore all managed from a tabbed settings page

![Queue](docs/screenshots/queue-dark.png)

![Ticket detail](docs/screenshots/ticket-detail-dark.png)

Dark and light themes, toggled from the top bar — the choice persists per user.

![Dashboard light](docs/screenshots/dashboard-light.png)

![Login](docs/screenshots/login-dark.png)

## Quick start

```bash
git clone https://github.com/gillesdelhaes/SimpleTickets.git
cd SimpleTickets
docker compose up -d
```

Open **http://localhost:3000** — the setup wizard runs on first launch, creates
your admin account, and optionally connects Slack. No config files, no env vars.

## Deploying to production

Plain HTTP on `:3000` is for `localhost` only — **don't expose it on a real
network as-is**. [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) is the operator
guide: TLS with your own certificates (behind an existing reverse proxy, or
terminated by the container itself), running behind a VPN with no inbound
connectivity (Slack works over outbound Socket Mode), the exact egress
allowlist, Google sign-in setup in GCP, and backups.

## Sign in with Google (optional)

Staff accounts can be gated behind Google sign-in instead of passwords.
Only pre-provisioned accounts whose email matches their Google account can
sign in this way — there is no self-signup. Create accounts with sign-in
method **Google** (Settings → Users) or use **Convert to Google** on
existing ones; Slack identity links are independent and keep working either
way.

Google-provider accounts have no password at all, and inherit whatever MFA
your Google organization enforces. Keep at least one password-based admin as
a **break-glass account** (the app refuses to convert the last one) so a
Google outage can't lock you out. An admin can always convert an account back
by setting a password on it.

Enabling it takes a public OAuth client ID and one settings field — see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#google-sign-in--operator-setup).

## Slack setup

SimpleTickets uses a **private Slack app** in your workspace running over Socket
Mode — no public webhook URL or port forwarding needed. Both the setup wizard and
**Settings → Slack** include a copy-paste app manifest that configures every
scope, event, and command automatically; you only paste back three tokens.

## Backups

Two separate things to back up, deliberately non-overlapping: **data**
(in-app backup zip, cron-able via `scripts/backup.sh`) and **secrets** (the
`app_secret`/`db_secret` volumes, excluded from data backups so a leaked zip
alone can't decrypt anything). Commands and cron examples:
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#backups).

## Stack

- **Backend:** Python 3.12 + FastAPI, PostgreSQL 16, SQLModel + Alembic,
  Slack Bolt (Socket Mode)
- **Frontend:** React 18 + TypeScript, Vite, Tailwind CSS, TanStack Query, Recharts
- **Deploy:** 3 containers via Docker Compose (db + api + frontend); only the
  frontend port is exposed

## License

AGPL-3.0
