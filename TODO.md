# SimpleTickets — Open Items

Last updated: 2026-06-26 (session 6)

---

## Known limitations (accepted for v1)

**L1.** In-memory rate limiter resets on container restart — low risk for single-container internal deployment.
**L2.** Logout doesn't invalidate JWT — client-side only, 8-hour token lives until expiry.
**L3.** JWT in localStorage — HttpOnly cookies safer, known trade-off.
**L4.** DB password defaults to `postgres` — port 5432 not exposed externally.
**L5.** Full-text search hardcoded to English — non-English teams get wrong stemming.

---

## Must-have before v1 ship

**P1. Slack App Home for technicians** [Effort: M]
`build_home_view()` shows submitter tickets only — techs with no submitted tickets see an empty home.
Fix: show assigned queue + SLA countdowns for techs/admins; Block Kit infrastructure already in place.

**P2. Slash commands for existing tickets** [Effort: S]
`/ticket` only opens the create modal. Techs can't touch existing tickets from Slack without finding the original thread.
Fix: `/ticket list` (my queue), `/ticket close TKT-0042`, `/ticket assign TKT-0042 @alice`.

**P3. Password reset via Slack DM** [Effort: S]
No reset flow — if an admin forgets their password the system is inaccessible.
Fix: "Forgot password" sends a one-time reset link via Slack DM; no email needed.

---

## High-impact (quick wins — all S effort)

**P4. CSAT survey on resolution** [Effort: S]
No feedback loop after a ticket closes.
Fix: auto-DM submitter 👍/👎 when ticket resolves; results visible in reports.

**P5. SLA escalation routing** [Effort: S]
SLA breach DMs every active tech — noisy at odd hours.
Fix: let admin configure a target (Slack channel or named user) instead of blast-all.

**P6. Ticket templates** [Effort: S]
Standard requests (new hire, VPN, laptop refresh) always need the same fields — submitters miss context.
Fix: pre-fill title + description + category + priority from a saved template.

**P7. Proactive idle DM** [Effort: S]
Ticket open 4+ hours with no reply — submitter has no idea if anyone saw it.
Fix: background job auto-DMs submitter after configurable idle time.

**P8. One-click resolution from Slack thread** [Effort: S]
Techs who live in Slack must open the portal to close a ticket.
Fix: react ✅ in ticket thread → ticket auto-resolves (mirrors the emoji-to-create flow).

---

## Medium effort

**P9. Ticket watchers / CC** [Effort: M]
Only submitter and assignee receive notifications — managers are blind.
Fix: "Watch this ticket" → Slack DMs on status changes and replies.

**P10. Monitored Slack channels** [Effort: M]
`#it-help` messages are silently dropped — the most natural onboarding path is unused.
Fix: configurable list of channels where top-level messages auto-create tickets (or prompt "Convert to ticket?").

**P11. Bulk queue operations** [Effort: M]
No multi-select on the queue — every action is one page load per ticket.
Fix: checkbox selection + batch close/assign/re-prioritise.

**P12. Saved queue views** [Effort: S]
URL filter state is already serialised — just needs persistence.
Fix: name and save filter presets; one click to "Unassigned critical" or "My in-progress".

---

## Roadmap (post-v1)

- **Maintenance mode / incidents** — parent incident ticket + broadcast to `#it-help`; stop duplicate-ticket storms [M]
- **SSO (Google / Azure AD)** — removes "another password to manage" objection [L]
- **Time tracking** — per-ticket time log; feeds reports and staffing decisions [M]
- **AI triage** — auto-categorise, suggest assignee, suggest reply on creation
- **Slack App Directory** — "Add to Slack" OAuth button for zero-friction installs
