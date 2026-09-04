# Deploying SimpleTickets

Operator guide: TLS, private-network/VPN deployments, Google sign-in setup,
and backups. For what the product does and a local quick start, see the
[README](../README.md).

## TLS — pick one mode

Out of the box the stack serves plain HTTP on `:3000` — fine for `localhost`,
**not safe to expose on a real network**: login credentials and session
tokens would travel in cleartext.

### Mode A — behind a TLS-terminating reverse proxy / load balancer you already run

The usual corporate setup:

1. `docker compose up -d` on the host.
2. Point your proxy at this host's `:3000` (plain HTTP upstream) and
   terminate TLS with your own certificates at the proxy.
3. Don't expose `:3000`/`:443` beyond the proxy. Use `GET /api/health` as
   the health check.

### Mode B — let the container terminate TLS itself

1. Drop your certificate as `certs/fullchain.pem` and `certs/privkey.pem`
   next to `docker-compose.yml` (internal-CA certs are fine).
2. `docker compose up -d` (or restart the `frontend` service). It's detected
   automatically — HTTP on :80 redirects to HTTPS on :443, no config to edit.
3. To renew: replace the two files, restart `frontend`. Remove both and
   restart to go back to plain HTTP. `certs/` is gitignored; never commit a
   real private key.

Either way, complete the **setup wizard immediately after first boot** — the
setup endpoints are open until the first admin account exists.

## Behind a VPN / private network

SimpleTickets needs **no inbound connectivity from the internet** — Slack
runs over Socket Mode (outbound WebSocket, no webhook URL) and Google
sign-in only ever talks outward, so a VPN-only deployment works unchanged.
The docker host just needs **direct outbound HTTPS (443)** to:

| Destination | Why |
|---|---|
| `slack.com`, `wss-*.slack.com`, `files.slack.com` | Slack API, Socket Mode, file sync |
| `www.googleapis.com` | Google signing keys (only if Google sign-in is used) |

Users' browsers also load `accounts.google.com` for the sign-in button. A
mandatory corporate HTTP proxy or TLS-intercepting firewall on the egress
path is not supported out of the box.

## Google sign-in — operator setup

The product side (gating model, break-glass account, converting users) is in
the [README](../README.md#sign-in-with-google-optional). To enable it:

1. In [Google Cloud console → Credentials](https://console.cloud.google.com/apis/credentials),
   create an **OAuth client ID**, application type **Web application**. If
   the project has no OAuth consent screen yet, configure it once — choose
   **Internal** for a Google Workspace org.
2. Add your SimpleTickets URL as an **authorized JavaScript origin** (exact
   scheme+host+port). No client secret and no redirect URIs are needed —
   only the public client ID. You can list several origins on one client
   (e.g. `http://localhost:3000` for testing plus the production URL).
3. Paste the client ID in **Settings → General → Sign in with Google**. The
   login page shows the Google button from then on.

Origin rules to know:

- Google requires **HTTPS on any non-`localhost` origin** — set up TLS first.
  Plain `http://localhost:<port>` is allowed for local testing.
- Google's console **rejects non-public TLDs** like `.corp`/`.local`. For a
  VPN-only host, use a subdomain of a real domain you own
  (e.g. `tickets.internal.example.com`) with split-horizon DNS: Google never
  needs to reach the server, only your users' browsers do.

## Backups

Data lives in four Docker volumes: `pgdata`, `attachments`, `app_secret`,
`db_secret`. There are two separate things to back up, and they don't
overlap on purpose.

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

Restores happen from **Settings → Backup** in the admin UI. By design a
restore does not carry secrets: Slack workspace tokens are re-entered and
workspaces re-activated afterward from **Settings → Workspaces**.
