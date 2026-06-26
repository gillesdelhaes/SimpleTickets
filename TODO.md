# SimpleTickets — Open Items

Last updated: 2026-06-26 (session 6)

---

## Known limitations (accepted for v1)

**L1. In-memory rate limiter resets on container restart**
Login/password rate limit lives in a Python dict. A restart clears it. Low risk for single-container internal deployment.

**L2. Logout doesn't invalidate JWT**
Logout is client-side only. 8-hour token remains valid server-side until expiry. Acceptable for an internal tool.

**L3. JWT stored in localStorage**
HttpOnly cookies would be safer. Known trade-off.

**L4. DB password defaults to `postgres`**
Port 5432 is not exposed externally (internal Docker network only). Do not add a host port mapping.

**L5. Full-text search hardcoded to English**
Non-English teams get incorrect stemming. Fix: make search language a configurable setting.

---

## Must-have before marketing push (blocks adoption)

~~**P1. Slack setup simplification**~~ ✓ Done — `slack-manifest.json` shipped, setup wizard and Settings guide both reduced to 3 steps with manifest copy, App-Level Token generation instructions, and Install App submenu navigation.

~~**P2. Submit on behalf of + Slack user linking**~~ ✓ Already done — the "Create ticket" modal already has a Slack user picker for the reporter, sends them a DM on creation, and gracefully skips DM when Slack isn't configured.

~~**P3. Email notifications**~~ — Removed from scope. Slack is the intentional notification channel; adding SMTP would complicate setup and contradict the tool's core premise.

**P13. Slack App Home for technicians** [Effort: M]
`build_home_view()` filters by submitter only — a tech who has no submitted tickets sees an empty home. Should show their assigned queue + SLA countdowns. Block Kit infrastructure already exists.

**P14. Slash commands for existing tickets** [Effort: S]
`/ticket` only opens the create modal. No `/ticket list` (my queue), `/ticket close TKT-0042`, `/ticket assign TKT-0042 @alice`. Techs can't touch existing tickets from Slack without finding the original thread.

**P15. Password reset via Slack DM** [Effort: S]
No password reset flow exists. If an admin forgets their password the system is inaccessible. Fix: "forgot password" sends a reset link via Slack DM — no email needed.

---

## High-impact features (retention and trust)

~~**P4. Slack bot health indicator**~~ ✓ Done — Settings page shows connected/disconnected pill with team name; global red sticky banner in AppShell appears on every page when the bot loses its Socket Mode connection; polls every 30 s and auto-clears when reconnected.

~~**P5. Business hours SLA**~~ ✓ Done — Settings → General has a toggle + working hours (start/end time) + working days (Mon–Sun pill buttons). When enabled, `compute_sla_deadline()` in `sla.py` walks only business time using `zoneinfo`; all three ticket-creation paths (REST, Slack, priority change) use it. Off by default — no change for existing installs.

~~**P6. Canned responses**~~ — Removed from scope. AI integration (planned) covers suggested replies; a manual template picker would be redundant and feel out of place in a Slack-first workflow.

**P7. CSAT survey on resolution** [Effort: S]
No feedback loop after a ticket closes.
Fix: auto-DM submitter with 👍/👎 when ticket resolves; results visible in admin reports.

~~**P8. Create ticket from any Slack message**~~ ✓ Done — message shortcut `create_ticket_from_message` registered in manifest; right-click any Slack message → modal pre-filled with message text and author as reporter → ticket created, confirmation posted in thread, DM sent to triggering tech.

**P16. SLA escalation routing** [Effort: S]
`post_sla_warning_to_technicians()` blasts every active tech on SLA breach. Admins should be able to configure a target: a specific Slack channel (`#it-critical`) or a named user. Turns a noisy feature into a useful one.

**P17. Ticket templates** [Effort: S]
Standard requests (new hire onboarding, VPN setup, laptop refresh) always need the same information. Templates pre-fill title + description + category + priority so submitters don't miss required context.

**P18. Ticket watchers / CC** [Effort: M]
Only the submitter and assignee receive notifications. Managers or secondary techs can't follow a ticket without being the assignee. Fix: "Watch this ticket" → get Slack DMs on status changes and replies.

---

## Quality-of-life (engagement and delight)

~~**P9. Tech self-service stats**~~ ✓ Done — Reports page open to all techs; global team view by default. Admins get a dropdown to filter by any technician; techs get "All team" / "My stats" pills. All charts and the technician table respect the filter. Export CSV remains admin-only.

~~**P10. CSV export for reports**~~ ✓ Done — "Export CSV" button on the Reports page streams all tickets (all time, not filtered by date range) as a CSV with full metadata: ID, title, description, status, priority, channel, category, submitter, assignee, timestamps, SLA fields.

**P11. Proactive idle DM** [Effort: S]
Ticket open 4+ hours with no tech reply — submitter has no idea if anyone saw it.
Fix: background job; auto-DM submitter "We're on it, still being worked" after configurable idle time.

**P12. One-click resolution from Slack thread** [Effort: S]
Techs who live in Slack have to open the portal to close a ticket.
Fix: react ✅ in the ticket thread → ticket auto-resolves (mirrors emoji-to-create flow already built).

**P19. Monitored Slack channels** [Effort: M]
Handler code references monitored channels but public channel messages are silently dropped. A setting to list channels where any top-level message auto-creates a ticket (or prompts "Convert to ticket?" via a button) is the most natural onboarding path for users who already post in `#it-help`.

**P20. Bulk queue operations** [Effort: M]
No selection mechanism on the queue. Batch close/assign/re-prioritise requires one page load per ticket. Common for Monday morning backlog reviews and onboarding new staff.

**P21. Saved / pinned queue views** [Effort: S]
URL filter state is already serialised — half-built. Just needs persistence across sessions and a way to name and share views. "Unassigned critical" and "my in-progress" are checked multiple times a day.

---

## Roadmap (post-v1, lower priority)

- **AI triage** — auto-categorisation, suggested assignee, and AI-suggested reply on ticket creation
- **Maintenance mode / incidents** — broadcast to `#it-help` when VPN is down; link duplicate incoming tickets to a parent incident; stop the notification storm [Effort: M]
- **SSO (Google / Azure AD)** — biggest enterprise credibility signal; removes "another password to manage" objection [Effort: L]
- **Time tracking** — per-ticket start/stop or manual entry; feeds "time spent" in CSV export and reports [Effort: M]
- **Publish to Slack App Directory** — "Add to Slack" button handles OAuth automatically
