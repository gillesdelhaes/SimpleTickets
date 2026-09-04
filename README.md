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

By default this serves plain HTTP on :3000 — fine for `localhost`, **not safe
to expose on a real network as-is**: login credentials and session tokens
would travel in cleartext. Pick one of the two TLS modes.

**Mode A — behind a TLS-terminating reverse proxy / load balancer you already
run** (the usual corporate setup):

1. `docker compose up -d` on the host.
2. Point your proxy at this host's `:3000` (plain HTTP upstream) and
   terminate TLS with your own certificates at the proxy.
3. Don't expose `:3000`/`:443` beyond the proxy. Use `GET /api/health` as
   the health check.

**Mode B — let the container terminate TLS itself:**

1. Drop your certificate as `certs/fullchain.pem` and `certs/privkey.pem`
   next to `docker-compose.yml` (internal-CA certs are fine).
2. `docker compose up -d` (or restart the `frontend` service). It's detected
   automatically — HTTP on :80 redirects to HTTPS on :443, no config to edit.
3. To renew: replace the two files, restart `frontend`. Remove both and
   restart to go back to plain HTTP. `certs/` is gitignored; never commit a
   real private key.

Either way, complete the **setup wizard immediately after first boot** — the
setup endpoints are open until the first admin account exists.

### Behind a VPN / private network

SimpleTickets needs **no inbound connectivity from the internet** — Slack
runs over Socket Mode (outbound WebSocket, no webhook URL) and Google
sign-in only ever talks outward, so a VPN-only deployment works unchanged.
The docker host just needs **direct outbound HTTPS (443)** to:

| Destination | Why |
|---|---|
| `slack.com`, `wss-*.slack.com`, `files.slack.com` | Slack API, Socket Mode, file sync |
| `www.googleapis.com` | Google signing keys (only if Google sign-in is used) |

(Users' browsers also load `accounts.google.com` for the sign-in button. A
mandatory corporate HTTP proxy or TLS-intercepting firewall on that egress
path is not supported out of the box.)

For Google sign-in on an internal host, use a VPN-only subdomain of a real
domain you own (e.g. `tickets.internal.example.com`) — Google's console
rejects non-public TLDs like `.corp`/`.local` as origins, but a private
split-horizon DNS name under a public domain works: Google never needs to
reach the server, only your browsers do.

Data lives in four Docker volumes (`pgdata`, `attachments`, `app_secret`,
`db_secret`) — see **Backups** below before going live.

## Sign in with Google (optional)

Staff accounts can be gated behind Google sign-in instead of passwords:

1. In [Google Cloud console](https://console.cloud.google.com/apis/credentials),
   create an **OAuth client ID** (type *Web application*) and add your
   SimpleTickets URL as an **authorized JavaScript origin**. No client secret
   is needed — only the public client ID.
2. Paste the client ID in **Settings → General → Sign in with Google**. The
   login page now shows a Google button.
3. Create staff accounts with sign-in method **Google** (Settings → Users),
   or use **Convert to Google** on existing ones. Only pre-provisioned
   accounts whose email matches their Google account can sign in this way —
   there is no self-signup. Slack identity links are independent and keep
   working either way.

Google-provider accounts have no password at all, and inherit whatever MFA
your Google organization enforces. Keep at least one password-based admin as
a **break-glass account** (the app refuses to convert the last one) so a
Google outage can't lock you out. An admin can always convert an account back
by setting a password on it. Note: Google's sign-in button requires HTTPS on
any non-`localhost` origin, so set up TLS first.

## Slack setup

SimpleTickets uses a **private Slack app** in your workspace running over Socket
Mode — no public webhook URL or port forwarding needed. Both the setup wizard and
**Settings → Slack** include a copy-paste app manifest that configures every
scope, event, and command automatically; you only paste back three tokens.

## Backups

There are two separate things to back up, and they don't overlap on purpose.

**Data** — tickets, users, settings, attachments — via `Settings → Backup` in
the admin UI, or the same endpoint from a script: `GET /api/admin/backup`
(admin-only, streams a zip). `scripts/backup.sh` wraps that for cron:

```bash
ST_ADMIN_EMAIL=admin@example.com \
ST_ADMIN_PASSWORD=your-password \
ST_BACKUP_DIR=/var/backups/simpletickets \
ST_BACKUP_KEEP=30 \
sh scripts/backup.sh
```

Crontab example — nightly at 2am, credentials kept out of the crontab line
itself via a root-owned, `chmod 600` env file:

```cron
0 2 * * * . /etc/simpletickets/backup.env && /path/to/simpletickets/scripts/backup.sh >> /var/log/simpletickets-backup.log 2>&1
```

```bash
# /etc/simpletickets/backup.env — chmod 600, owned by root
ST_URL=http://localhost:3000/api
ST_ADMIN_EMAIL=admin@example.com
ST_ADMIN_PASSWORD=your-password
ST_BACKUP_DIR=/var/backups/simpletickets
ST_BACKUP_KEEP=30
```

**Secrets** — the master encryption key and the Postgres password — are
deliberately **excluded** from that backup, so a leaked backup zip alone
can't decrypt anything. They live in two Docker volumes, `app_secret` and
`db_secret`, and need their own, separate backup. They rarely change, but
losing them without a copy permanently orphans every encrypted Slack token
and the JWT signing key, even with the database fully intact:

```bash
docker run --rm \
  -v simpletickets_app_secret:/from/app_secret:ro \
  -v simpletickets_db_secret:/from/db_secret:ro \
  -v "$(pwd)":/backup \
  alpine sh -c "tar czf /backup/simpletickets-secrets-$(date -u +%Y%m%dT%H%M%SZ).tar.gz -C /from ."
```

Store that somewhere separate from the data backups — keeping both in the
same place recreates the single-failure-domain problem this split exists to
avoid. Run it whenever you rotate credentials, and once after first setup.

## Stack

- **Backend:** Python 3.12 + FastAPI, PostgreSQL 16, SQLModel + Alembic,
  Slack Bolt (Socket Mode)
- **Frontend:** React 18 + TypeScript, Vite, Tailwind CSS, TanStack Query, Recharts
- **Deploy:** 3 containers via Docker Compose (db + api + frontend); only the
  frontend port is exposed

## License

AGPL-3.0
