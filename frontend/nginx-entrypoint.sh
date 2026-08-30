#!/bin/sh
set -e

CERT_DIR="${TLS_CERT_DIR:-/etc/nginx/certs}"

if [ -f "$CERT_DIR/fullchain.pem" ] && [ -f "$CERT_DIR/privkey.pem" ]; then
    echo "[nginx-entrypoint] TLS cert found at $CERT_DIR — serving HTTPS on :443, redirecting :80" >&2
    cp /etc/nginx/available/tls.conf /etc/nginx/conf.d/default.conf
else
    echo "[nginx-entrypoint] No TLS cert mounted at $CERT_DIR — serving plain HTTP on :80 only." >&2
    echo "[nginx-entrypoint] Not safe to expose this directly on a corporate network — mount a" >&2
    echo "[nginx-entrypoint] cert (see README 'TLS') or put a TLS-terminating proxy in front." >&2
    cp /etc/nginx/available/http.conf /etc/nginx/conf.d/default.conf
fi

exec /docker-entrypoint.sh "$@"
