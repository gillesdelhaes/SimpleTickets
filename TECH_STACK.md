# Tech Stack — Rationale

Every technology choice in SimpleTickets is deliberate. This document explains what each component is, why it was chosen over the alternatives, and how it fits into the overall architecture.

---

## Backend

### Python 3.12

Python is the lingua franca of modern backend development and has by far the richest ecosystem for the libraries this project depends on — particularly Slack's official SDK (`slack-bolt`), which is Python-first and async-capable. The 3.12 release brought meaningful performance improvements (faster interpreter, lower memory overhead) and better error messages that genuinely improve the developer experience.

**Alternatives considered:**
- **Node.js / TypeScript** — sharing a language with the frontend has appeal, but the Slack Bolt Python library is more mature than the JS equivalent and aligns better with the rest of the ecosystem (APScheduler, SQLModel).
- **Go** — excellent performance and a single binary, but the ORM and migration story is far less ergonomic for a data-heavy app, and the Slack SDK requires wrapping.

---

### FastAPI

FastAPI is the obvious choice for a modern Python async API. Its key strengths for this project:

- **Async-native** — the entire stack (database access via asyncpg, Slack I/O via aiohttp) is non-blocking. FastAPI runs on Uvicorn with an asyncio event loop, so everything composes cleanly without threads or executor hacks.
- **Pydantic schemas** — request validation, response serialisation, and OpenAPI docs are derived from the same Python type annotations. No separate schema layer, no boilerplate.
- **Dependency injection** — `get_current_user`, `get_session`, and similar dependencies are declared once and composed automatically. Authentication, session management, and permission checks are not scattered across routes.
- **Auto-generated OpenAPI** — the `/docs` endpoint gives a live, accurate API explorer at zero cost, which is useful during development.

**Alternatives considered:**
- **Django REST Framework** — mature and feature-rich, but Django's ORM is synchronous and bolting async onto it is awkward. Django also brings a lot of machinery (admin, templates, middleware) that this project doesn't need.
- **Flask** — minimal and flexible, but requires assembling async support, validation, and dependency injection from separate libraries, adding complexity without adding capability.

---

### SQLModel

SQLModel is a thin bridge between SQLAlchemy (the industry-standard Python ORM) and Pydantic (FastAPI's validation layer). The key benefit: **a single class definition serves as both the ORM model and the API schema**. Instead of maintaining parallel `models/ticket.py` and `schemas/ticket.py` files that mirror each other, one `Ticket` class handles persistence, validation, and serialisation.

The async session support (`AsyncSession`) works seamlessly with FastAPI's dependency injection, and SQLAlchemy's expression language (`select`, `where`, `join`) is used directly for queries — there is no magic query builder that obscures what SQL is actually being run.

**Alternatives considered:**
- **Raw SQLAlchemy** — more explicit but significantly more verbose. SQLModel sits on top of SQLAlchemy, so all of its power is still accessible when needed.
- **Tortoise ORM** — async-native and clean, but less mature, a smaller ecosystem, and no Pydantic integration.
- **Prisma (Python client)** — the Python client is a community effort and lags behind the JS version; not production-ready at the time of writing.

---

### Alembic

Alembic is the standard migration tool for SQLAlchemy projects. It stores the current schema version in the database itself (`alembic_version` table) and applies migrations in order on startup. The `entrypoint.sh` runs `alembic upgrade head` before the API server starts, so the database is always in sync with the code on every deploy — no manual migration step, no drift.

For this project (single developer, dev environment), migrations are periodically squashed into a single `0001_initial_schema.py` to keep the history clean. The mechanism remains the same regardless of how many files are in the chain.

**Alternatives considered:**
- **Yoyo** — simpler, but tightly coupled to raw SQL strings and has no SQLAlchemy integration.
- **Auto-migrations (like Django's)** — convenient but dangerous in production; Alembic's explicit, reviewable migration files are safer.

---

### asyncpg

asyncpg is a high-performance, pure-Python PostgreSQL driver built for asyncio. It is the fastest Python driver for PostgreSQL by a significant margin (benchmarks consistently show 3–5× the throughput of psycopg2 at the connection level) because it implements the PostgreSQL wire protocol directly without going through libpq.

SQLAlchemy's async engine uses asyncpg under the hood, so the choice is transparent to application code — connection strings start with `postgresql+asyncpg://` and everything else stays the same.

**Alternatives considered:**
- **psycopg2** — synchronous; requires running in a thread executor with `asyncio`, which adds latency and caps concurrency.
- **psycopg3 (async)** — a viable modern alternative, but asyncpg has a larger installed base and more battle-tested SQLAlchemy integration.

---

## Frontend

### React 18

React's component model, unidirectional data flow, and ecosystem size make it the default choice for a dashboard-style application. React 18's concurrent features (automatic batching, `useTransition`) improve perceived performance in list-heavy views like the ticket queue.

The codebase is intentionally simple React — no state management library, no context sprawl. Server state is owned by TanStack Query; local UI state lives in `useState`. This keeps the component tree readable and easy to reason about.

**Alternatives considered:**
- **Vue 3** — excellent DX and a leaner bundle, but the ecosystem for dashboards (data tables, charts) is narrower and the team's existing knowledge was React-skewed.
- **Svelte** — compelling performance story, but the tooling and component ecosystem are less mature for this kind of admin UI.
- **Next.js** — adds SSR and routing, but this is a fully authenticated SPA served behind nginx; SSR adds complexity without benefit.

---

### Vite

Vite is the build tool. In development, it serves modules natively via ESM with near-instant hot module replacement. In production, it bundles with Rollup. The result is a development loop that feels instant (sub-100ms HMR) and a production build that completes in under 5 seconds.

**Alternatives considered:**
- **Create React App (webpack)** — the legacy standard; cold starts take 10–30 seconds and HMR is slow on larger codebases. CRA is effectively unmaintained.
- **webpack directly** — powerful but requires significant configuration to match what Vite provides out of the box.

---

### TypeScript

TypeScript is non-negotiable for a codebase of this size. The benefits are concrete:

- **API contract safety** — the `TicketRead`, `ReplyRead`, and other interfaces mirror the backend Pydantic schemas. TypeScript catches shape mismatches at compile time, not at runtime in production.
- **Refactoring confidence** — renaming a field, changing a hook signature, or restructuring a component is safe because the compiler finds every affected callsite.
- **IDE intelligence** — autocomplete and inline documentation work across the entire codebase, including third-party libraries.

The TypeScript configuration uses `strict: true`, which catches the most common classes of bugs (null dereferences, implicit any, unchecked union members).

---

### TanStack Query v5

TanStack Query (formerly React Query) manages all server state. It handles caching, background refetching, loading and error states, and cache invalidation — the entire lifecycle of every API call — with a consistent, declarative API.

Key reasons it was chosen:
- **`refetchInterval`** — adding background polling to any query is a one-liner (`refetchInterval: 30_000`). The queue, ticket detail, and replies all auto-refresh without any manual timer management.
- **`invalidateQueries`** — after a mutation (adding a reply, changing status), the relevant queries are invalidated and immediately refetched. The UI is always consistent with the server without manual state updates.
- **Deduplication** — multiple components using the same query key share one in-flight request and one cached result. The ticket detail page can mount several components that all need the ticket data; TanStack Query makes exactly one API call.
- **Tab visibility awareness** — polling pauses when the browser tab is hidden and resumes when it becomes active, avoiding wasted requests.

**Alternatives considered:**
- **SWR** — similar concept, made by Vercel, but TanStack Query has a richer API (optimistic updates, dependent queries, prefetching) and better TypeScript types.
- **Redux Toolkit Query** — comprehensive but heavy; introduces the Redux mental model and boilerplate for a codebase that doesn't need global synchronous state.
- **`useEffect` + `fetch`** — the DIY approach. Quickly becomes unmaintainable once caching, loading states, error boundaries, and invalidation are added.

---

### Recharts

Recharts is the charting library used in the Reports page. It is built on D3 under the hood but exposes a React component API — charts are declared as JSX, not imperatively constructed. This makes them easy to compose, theme, and maintain alongside the rest of the React codebase.

**Alternatives considered:**
- **Chart.js** — popular and performant, but requires a canvas-based imperative API that does not integrate naturally with React's declarative model.
- **D3.js directly** — extremely powerful and flexible, but requires significant boilerplate to integrate with React's rendering lifecycle (managing DOM mutations alongside React's virtual DOM is error-prone).
- **Victory** — similar API to Recharts but a smaller community and less active maintenance.

---

## Database

### PostgreSQL 16

PostgreSQL is the right database for a helpdesk application for several reasons:

- **Full-text search** — PostgreSQL's built-in FTS (`tsvector`, `to_tsquery`) powers the ticket search across title, description, and reply bodies without an external search service like Elasticsearch.
- **JSONB** — the audit log's `payload` column stores arbitrary field change data as JSONB, which can be queried and indexed without a rigid schema.
- **Reliability and ACID compliance** — ticket data must be consistent. Partial writes (a reply saved without the Slack ts, or a status change without the history entry) must never happen. PostgreSQL's transaction model guarantees this.
- **Ecosystem maturity** — asyncpg, SQLAlchemy, and Alembic all have first-class PostgreSQL support. Extensions, advisory locks, and `RETURNING` clauses are all available when needed.

**Alternatives considered:**
- **MySQL / MariaDB** — viable, but PostgreSQL's FTS, JSONB, and window functions are significantly more capable. SQLAlchemy handles both, so the switch cost was low.
- **SQLite** — appropriate for local development or tiny deployments, but not suitable for concurrent writes and lacks FTS capabilities.

---

## Authentication

### Local email/password + JWT (HS256)

Authentication is intentionally simple: admin-created local accounts, bcrypt-hashed passwords, and short-lived JWTs signed with an HS256 secret that is auto-generated on first boot and persisted in the database.

The design choices here reflect the deployment target: a small internal IT team where:
- **SSO / OAuth** is overkill — there is no need to federate identity with an external provider for a 5-person team.
- **Sessions with server-side storage** add operational complexity (session store, sticky sessions) that HS256 JWTs avoid entirely.
- **Auto-generated secret** means there is nothing to configure. The secret is created on first boot, stored in `app_settings`, and reused on every subsequent start. Key rotation is manual but intentional.

End users (Slack submitters) have **no portal accounts**. They interact exclusively through Slack — their identity is their `slack_user_id`.

---

## Slack Integration

### Slack Bolt (Python)

`slack-bolt` is Slack's official Python SDK for building apps. It handles the Socket Mode WebSocket connection, event dispatch, action routing, and view submissions with a clean decorator-based API (`@app.event`, `@app.action`, `@app.view`). The async variant integrates directly with FastAPI's asyncio event loop — the Slack bot runs as a background task inside the same process, not as a separate service.

### Socket Mode

Socket Mode connects to Slack over a persistent WebSocket rather than receiving inbound HTTP webhooks. This is the critical architectural decision for self-hosted deployments:

- **No public URL required** — the server does not need to be reachable from the internet. It can run on a local network, behind a corporate firewall, or on a developer's laptop.
- **No port forwarding** — no NAT traversal, no ngrok, no reverse proxy configuration.
- **Simpler security model** — there is no inbound endpoint to protect with signature verification on every request.

The trade-off is that Socket Mode requires an always-on WebSocket connection. For a self-hosted internal tool, this is perfectly acceptable — the process stays running as long as Docker Compose is up.

**Alternatives considered:**
- **HTTP webhooks** — require a public URL, TLS, and signature verification on every request. Not workable for a local-network deployment.
- **Polling the Slack API** — against Slack's terms of service and rate limits; not a real alternative.

---

## Infrastructure

### Docker Compose

Docker Compose runs three services: `db` (PostgreSQL), `api` (FastAPI + Slack bot), and `frontend` (nginx serving the Vite build). The entire stack starts with a single command:

```bash
docker compose up -d
```

Design decisions:
- **No source volume mounts on the API container** — the backend is baked into the image at build time. This means `docker compose restart` does not pick up code changes; a `docker compose build` is required. This is a deliberate trade-off: the running container is always a known, reproducible artefact, not a live filesystem that can drift from the image.
- **Migrations on startup** — `entrypoint.sh` runs `alembic upgrade head` before Uvicorn starts. The database is always current. No separate migration job or manual step.
- **Internal bridge network** — only port 3000 (nginx) is exposed to the host. The API and database are not reachable from outside the Docker network.
- **Health checks** — the `api` service has a health check (`GET /api/health`) that the `frontend` service depends on, ensuring nginx only starts routing traffic after the API is ready.

**Alternatives considered:**
- **Kubernetes** — appropriate at scale, but massively over-engineered for a single-node internal tool. Helm charts, namespaces, and rolling deployments add weeks of operational work for zero benefit here.
- **Bare metal / systemd** — works, but loses the reproducibility and isolation that Docker provides. Dependency management and port conflicts become manual problems.
- **Docker Swarm** — a middle ground, but Compose is simpler for single-node deployments and has broader tooling support.

---

## Scheduled Jobs

### APScheduler (AsyncIOScheduler)

APScheduler's `AsyncIOScheduler` runs the SLA breach detection and warning jobs inside the same process as the FastAPI application. Jobs are scheduled at one-minute intervals and execute as coroutines on the existing asyncio event loop.

The in-process approach means:
- **No separate worker** — no Celery, no Redis, no additional container to deploy and monitor.
- **Shared event loop** — the scheduled jobs use the same asyncio machinery as FastAPI request handlers and the Slack bot, with no thread boundaries to cross.
- **Simple lifecycle** — the scheduler starts in the FastAPI `lifespan` context and shuts down cleanly when the application stops.

The trade-off is that jobs run on the same process as the API server. For SLA checks that run once per minute and touch a small number of rows, this is entirely appropriate. If the job load grew to require dedicated workers, migrating to Celery would be straightforward.

**Alternatives considered:**
- **Celery + Redis** — the standard Python distributed task queue. Correct choice at scale, but requires two additional services (worker + broker) for what amounts to two one-minute cron jobs.
- **PostgreSQL `pg_cron`** — runs SQL on a schedule inside the database. Avoids the extra process but cannot call Slack APIs or Python business logic directly.
- **OS cron** — simple but not container-friendly and not aware of the application lifecycle.
