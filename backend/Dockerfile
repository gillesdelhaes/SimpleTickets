# ── Stage 1: dependencies ─────────────────────────────────────────────────────
FROM python:3.12-slim AS deps

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libmagic1 && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml uv.lock ./
# Install from the exact versions pinned in uv.lock, not the floor-pinned
# ranges in pyproject.toml — reproducible builds. `--frozen` uses the lock
# as committed, no network resolve; regenerate it with `uv lock` after
# changing dependencies. Deps only (--no-emit-project) so this layer stays
# cached across source changes; the app itself isn't pip-installed at all,
# it runs via cwd-relative imports (see WORKDIR below).
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir uv \
    && uv export --frozen --no-hashes --no-emit-project -o requirements.lock.txt \
    && pip install --no-cache-dir -r requirements.lock.txt

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM deps AS runtime

# Create a non-root user for security
RUN groupadd --gid 1001 appgroup && \
    useradd --uid 1001 --gid appgroup --shell /bin/sh --create-home appuser

WORKDIR /app
COPY --chown=appuser:appgroup . .

# Attachment storage + secret key directories — must be writable by appuser
RUN mkdir -p /data/attachments /data/secret && chown -R appuser:appgroup /data

# Make entrypoint executable
RUN chmod +x /app/entrypoint.sh

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
