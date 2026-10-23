export type TicketStatus = string   // dynamic — any slug from ticket_statuses table
export type Priority = 'low' | 'medium' | 'high' | 'critical'
export type Channel = 'web' | 'slack'

export interface StatusConfig {
  name: string
  label: string
  color: string
  pauses_sla: boolean
  is_default: boolean
  is_resolved_state: boolean
  sends_csat: boolean
  sort_order: number
}

export interface TicketRead {
  id: number
  display_id: string
  title: string
  description: string
  status: TicketStatus
  priority: Priority
  channel: Channel
  category_id: number | null
  category_name: string | null
  submitter_id: number | null
  submitter_name: string | null
  assignee_id: number | null
  assignee_name: string | null
  sla_deadline: string | null
  sla_breached: boolean
  /** When the SLA clock last stopped (paused or resolved); null while running */
  sla_paused_at?: string | null
  duplicate_of_id: number | null
  duplicate_of_title: string | null
  workspace_id: number | null
  workspace_name: string | null
  slack_channel_id: string | null
  slack_message_ts: string | null
  first_response_deadline: string | null
  first_responded_at: string | null
  sla_policy_id?: number | null
  created_at: string
  updated_at: string
  resolved_at: string | null
}

export interface TicketListResponse {
  items: TicketRead[]
  total: number
}

// ── Dynamic status registry (populated by useAppConfig) ───────────────────────

let _statusMap: Map<string, StatusConfig> = new Map([
  ['open',         { name: 'open',         label: 'Open',         color: '#3B82F6', pauses_sla: false, is_default: true,  is_resolved_state: false, sends_csat: false, sort_order: 0 }],
  ['in_progress',  { name: 'in_progress',  label: 'In Progress',  color: '#FF4713', pauses_sla: false, is_default: false, is_resolved_state: false, sends_csat: false, sort_order: 1 }],
  ['pending_user', { name: 'pending_user', label: 'Pending User', color: '#F59E0B', pauses_sla: true,  is_default: false, is_resolved_state: false, sends_csat: false, sort_order: 2 }],
  ['resolved',     { name: 'resolved',     label: 'Resolved',     color: '#10B981', pauses_sla: false, is_default: false, is_resolved_state: true,  sends_csat: true,  sort_order: 3 }],
  ['closed',       { name: 'closed',       label: 'Closed',       color: '#737373', pauses_sla: false, is_default: false, is_resolved_state: true,  sends_csat: false, sort_order: 4 }],
])

export function setStatuses(statuses: StatusConfig[]) {
  _statusMap = new Map(statuses.map(s => [s.name, s]))
}

export function getAllStatuses(): StatusConfig[] {
  return [..._statusMap.values()].sort((a, b) => a.sort_order - b.sort_order)
}

export function statusColor(name: string): string {
  return _statusMap.get(name)?.color ?? '#737373'
}

export function statusLabel(name: string): string {
  return _statusMap.get(name)?.label ?? name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// Legacy constants kept for backward compat — backed by the dynamic map
export const STATUS_COLORS: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_t, name: string) => statusColor(name),
})
export const STATUS_LABELS: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_t, name: string) => statusLabel(name),
})

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
}


// Format milliseconds remaining into a human-readable duration
function formatDuration(ms: number): string {
  if (ms <= 0) return 'Overdue'
  const totalSecs = Math.floor(ms / 1000)
  const days = Math.floor(totalSecs / 86400)
  const hours = Math.floor((totalSecs % 86400) / 3600)
  const mins = Math.floor((totalSecs % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

export type SLABarResult = {
  pct: number
  label: string
  color: string
  breached: boolean
  /** Ticket is resolved — the clock stopped, so the result no longer moves. */
  frozen?: boolean
}

/** Whether a status is a resolved/closed state (the SLA clock stops there). */
export function isResolvedStatus(status: string): boolean {
  return _statusMap.get(status)?.is_resolved_state ?? false
}

export function parseSLABarRaw(
  deadline: string | null,
  created_at: string,
  preBreached = false,
  /** Set for resolved tickets: the clock is judged at the moment it stopped
   *  (sla_paused_at, else resolved_at), never against "now" — otherwise a
   *  closed ticket drifts into "Overdue". Pass null if neither is recorded. */
  stoppedAt?: string | null,
): SLABarResult | null {
  if (!deadline || !created_at) return null

  if (preBreached) {
    return { pct: 0, label: 'Breached', color: '#EF4444', breached: true, frozen: stoppedAt !== undefined }
  }

  if (stoppedAt !== undefined) {
    const dl = new Date(deadline + 'Z').getTime()
    const missed = stoppedAt !== null && new Date(stoppedAt + 'Z').getTime() > dl
    return missed
      ? { pct: 0, label: 'Breached', color: '#EF4444', breached: true, frozen: true }
      : { pct: 1, label: 'Met', color: '#10B981', breached: false, frozen: true }
  }

  const now = Date.now()
  const created = new Date(created_at + 'Z').getTime()
  const dl = new Date(deadline + 'Z').getTime()
  const total = dl - created
  const remaining = dl - now

  if (remaining <= 0) {
    return { pct: 0, label: 'Overdue', color: '#EF4444', breached: true }
  }

  const pct = Math.max(0, Math.min(1, remaining / total))
  const color = pct > 0.5 ? '#10B981' : pct > 0.2 ? '#F59E0B' : '#EF4444'
  return { pct, label: formatDuration(remaining), color, breached: false }
}

/**
 * A deadline whose clock is stopped (ticket waiting on the requester): the
 * time it had left when it stopped, frozen — it no longer runs down.
 */
export function parseSLAPaused(
  deadline: string | null,
  created_at: string,
  pausedAt: string | null | undefined,
  preBreached = false,
): SLABarResult | null {
  if (!deadline || !created_at) return null
  if (preBreached) return { pct: 0, label: 'Breached', color: '#EF4444', breached: true }
  const dl = new Date(deadline + 'Z').getTime()
  const created = new Date(created_at + 'Z').getTime()
  const stop = pausedAt ? new Date(pausedAt + 'Z').getTime() : Date.now()
  const left = dl - stop
  const pct = Math.max(0, Math.min(1, left / (dl - created)))
  return { pct, label: left > 0 ? `Paused · ${formatDuration(left)} left` : 'Paused', color: '#737373', breached: false }
}

/**
 * The SLA clock stops while a ticket waits on the requester or is resolved,
 * and a breach is recorded the moment it stops past the deadline (backend
 * services/sla.py) — so a resolved ticket met its SLA iff it isn't breached.
 */
export function parseSLABar(ticket: TicketRead): SLABarResult | null {
  const statusConfig = _statusMap.get(ticket.status)
  if (statusConfig?.is_resolved_state) {
    return parseSLABarRaw(ticket.sla_deadline, ticket.created_at, ticket.sla_breached, ticket.sla_paused_at ?? ticket.resolved_at)
  }
  if (statusConfig?.pauses_sla || ticket.sla_paused_at) {
    return parseSLAPaused(ticket.sla_deadline, ticket.created_at, ticket.sla_paused_at, ticket.sla_breached)
  }
  return parseSLABarRaw(ticket.sla_deadline, ticket.created_at, ticket.sla_breached)
}

let _timezone = 'UTC'

export function setTimezone(tz: string) {
  _timezone = tz
}

/**
 * Parse a backend timestamp as UTC. The API serializes naive datetimes with no
 * zone suffix, so `new Date(s)` would read them as the viewer's local time and
 * shift by their offset. Append a 'Z' unless the string already carries a zone.
 */
export function parseUTC(dateStr: string): Date {
  return /[zZ]|[+-]\d\d:?\d\d$/.test(dateStr) ? new Date(dateStr) : new Date(dateStr + 'Z')
}

export function timeAgo(dateStr: string): string {
  const date = parseUTC(dateStr)
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: _timezone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(date)
  } catch {
    return date.toLocaleDateString()
  }
}
