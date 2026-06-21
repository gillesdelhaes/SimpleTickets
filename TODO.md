# SimpleTickets — Release TODO

Generated from: MD roadmap review + gap analysis + deep code audit (2026-06-21)

---

## EMERGENCY — Block release, fix before v1 ships

### Security

**1. Zip Slip in backup restore** — `backend/app/routers/backup.py:239-243`
Zip entries like `attachments/../../etc/cron.d/evil` write files anywhere on the server. Any authenticated admin uploading a crafted backup achieves arbitrary file write.
Fix: after computing `dest`, assert `dest.resolve().is_relative_to(storage_root.resolve())`.

**2. CORS wildcard in production** — `backend/app/main.py:57-63`
`allow_origins=["*"]` with `allow_credentials=True` is a security misconfiguration. Since nginx proxies all API calls, the browser sees a single origin — CORS middleware may not be needed at all. See discussion below.

**3. XSS via `ts_headline` in search** — `frontend/src/pages/Search.tsx:47-51`
`dangerouslySetInnerHTML` renders Postgres-generated highlights of user-supplied ticket content. A crafted ticket title can inject and execute arbitrary JS.
Fix: strip all tags from headline output or sanitize with DOMPurify before injecting.

**4. No real IP behind reverse proxy** — `backend/app/routers/auth.py:46`
Behind nginx the rate limiter sees the proxy IP, not the real client IP. Add `ProxyHeadersMiddleware` to FastAPI.

**5. Full file buffered before attachment size check** — `backend/app/routers/attachments.py:108`
Entire upload loaded into memory before rejection. Stream-cap or check `Content-Length` before reading.

**6. No upload size limit on backup restore** — `backend/app/routers/backup.py:174`
`await file.read()` with no size cap. Add a max size check before reading.

**7. File MIME type trusts client claim** — `backend/app/routers/attachments.py:122-131`
MIME taken from `file.content_type` (client-controlled). Use `python-magic` to verify by file content.

### Bugs that break core features

**8. Reports use hardcoded `TicketStatus` enum instead of dynamic statuses** — `backend/app/routers/reports.py:47,202`
Any team that customizes statuses gets wrong counts in all reports. The rest of the codebase queries `TicketStatusConfig.is_resolved_state` correctly; reports don't.
Fix: replace `TicketStatus.resolved/closed` with a subquery on `TicketStatusConfig.is_resolved_state == True`.

**9. Slack status labels hardcoded** — `backend/app/slack/service.py:32`
`_STATUS_LABELS` dict only covers the original 5 statuses. Custom statuses appear as raw slugs in all Slack notifications.
Fix: fall back to DB lookup for statuses not in the dict.

**10. `end_user` role in frontend has no backend counterpart** — `frontend/src/contexts/AuthContext.tsx:4`
`UserRole` includes `'end_user'` but the backend only has `technician` and `admin`. Routes protected only by `get_current_user` are accessible to an `end_user` JWT. Remove the role from the frontend type or implement it properly.

**11. Attachment delete endpoint missing** — `backend/app/routers/attachments.py:13`
Documented in the module docstring, not implemented. `TicketAttachment` also has no `uploader_id` field so the "uploader OR technician/admin can delete" rule is unenforceable. Files can never be deleted via the API.

---

## HIGH — Fix before or at release

**12. In-memory rate limiter not restart-safe** — `backend/app/routers/auth.py:23-36`
Resets on every container restart, fully bypassing the 10-attempt/60s limit. `_attempts` dict also grows unbounded with unique IPs (memory leak under scan traffic). Acceptable risk for single-container v1 but document it explicitly.

**13. Backup restore doesn't invalidate settings cache** — `backend/app/routers/backup.py:228`
After restore, `settings_manager` holds pre-restore Slack tokens until the 30s cache TTL expires. Force a cache flush and reconnect after successful restore.

**14. Logout doesn't invalidate JWT** — `backend/app/routers/auth.py:78-81`
Logout is a no-op server-side. Tokens remain valid for 8 hours post-logout. Low risk for an internal tool but worth noting.

**15. JWT in localStorage** — `frontend/src/lib/api.ts:13`
Accessible to any JS on the page. `HttpOnly` cookies are safer, especially relevant given the XSS issue (#3). Known trade-off, but #3 makes this more urgent.

**16. Restore can lock out current admin**
Restore wipes and rewrites all users including the requesting admin. A corrupt backup could eliminate the current admin with no recovery. Add a check that at least one admin exists in the restored dataset before committing.

---

## MEDIUM — Important cleanup, not blocking

**17. `TicketStatus` enum is dead code** — `backend/app/models/enums.py:9-14`
Superseded by `TicketStatusConfig` but still exported and used in reports (which is a bug — see #8). Remove after fixing reports.

**18. 5 orphaned admin page files** — `frontend/src/pages/admin/`
`BackupRestore.tsx`, `Categories.tsx`, `SlackSetup.tsx`, `SLAPolicies.tsx`, `TicketStatuses.tsx` — none are imported or routed. All functionality is in `Settings.tsx`. Delete them.

**19. Slack setup guide missing `/ticket` slash command** — `README.md`
Setup section lists bot events but not the `/ticket` slash command. New admins will miss it; users see "This slash command is not configured."

**20. `GET /admin/users/{id}` documented but not implemented** — `backend/app/routers/admin.py:7`
Misleading module docstring. Low-impact since the frontend uses the list endpoint.

**21. `_DT_COLS["app_settings"]` dead code in backup** — `backend/app/routers/backup.py:73`
Key exists in `_DT_COLS` but `AppSetting` is not in `_EXPORT_MODELS`, so this entry is never reached. Harmless but confusing.

**22. `app_secret_key` fallback silent on DB write failure** — `backend/app/config.py`
First-boot DB write failure silently falls back to `"dev-secret-change-in-production"`. Should be an explicit startup crash.

---

## ROADMAP — Post-release (Phase 3 per ROADMAP.md)

- **Reports CSV export** — admins can't export raw data outside the UI
- **AI triage via Gemini/Vertex AI** — auto-diagnosis panel on ticket creation
- **Business hours SLA** — SLA countdowns pause outside working hours
- **Ticket watchers** — technicians can watch without being assignee
- **Configurable monitored channels** — passive ticket creation from public Slack channels
