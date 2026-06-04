export type TicketStatus = string   // dynamic — any slug from ticket_statuses table
export type Priority = 'low' | 'medium' | 'high' | 'critical'
export type Channel = 'web' | 'slack' | 'email'

export interface StatusConfig {
  name: string
  label: string
  color: string
  pauses_sla: boolean
  is_default: boolean
  is_resolved_state: boolean
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
  sla_policy_id: number | null
  sla_deadline: string | null
  sla_breached: boolean
  duplicate_of_id: number | null
  duplicate_of_title: string | null
  slack_channel_id: string | null
  slack_message_ts: string | null
  first_response_deadline: string | null
  first_responded_at: string | null
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
  ['open',         { name: 'open',         label: 'Open',         color: '#3B82F6', pauses_sla: false, is_default: true,  is_resolved_state: false, sort_order: 0 }],
  ['in_progress',  { name: 'in_progress',  label: 'In Progress',  color: '#FF4713', pauses_sla: false, is_default: false, is_resolved_state: false, sort_order: 1 }],
  ['pending_user', { name: 'pending_user', label: 'Pending User', color: '#F59E0B', pauses_sla: true,  is_default: false, is_resolved_state: false, sort_order: 2 }],
  ['resolved',     { name: 'resolved',     label: 'Resolved',     color: '#10B981', pauses_sla: false, is_default: false, is_resolved_state: true,  sort_order: 3 }],
  ['closed',       { name: 'closed',       label: 'Closed',       color: '#737373', pauses_sla: false, is_default: false, is_resolved_state: true,  sort_order: 4 }],
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

export const PRIORITY_COLORS: Record<Priority, string> = {
  low: '#3B82F6',
  medium: '#F59E0B',
  high: '#FF4713',
  critical: '#AD1164',
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
}

export const PRIORITY_ORDER: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

// Format milliseconds remaining into a human-readable duration
export function formatDuration(ms: number): string {
  if (ms <= 0) return 'Overdue'
  const totalSecs = Math.floor(ms / 1000)
  const days = Math.floor(totalSecs / 86400)
  const hours = Math.floor((totalSecs % 86400) / 3600)
  const mins = Math.floor((totalSecs % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

export type SLABarResult = { pct: number; label: string; color: string; breached: boolean }

export function parseSLABarRaw(
  deadline: string | null,
  created_at: string,
  preBreached = false,
): SLABarResult | null {
  if (!deadline || !created_at) return null

  if (preBreached) {
    return { pct: 0, label: 'Breached', color: '#EF4444', breached: true }
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

export function parseSLABar(ticket: TicketRead): SLABarResult | null {
  const statusConfig = _statusMap.get(ticket.status)
  if (statusConfig?.pauses_sla) {
    if (!ticket.sla_deadline || !ticket.created_at) return null
    const dl      = new Date(ticket.sla_deadline + 'Z').getTime()
    const created = new Date(ticket.created_at   + 'Z').getTime()
    const now     = Date.now()
    const pct     = Math.max(0, Math.min(1, (dl - now) / (dl - created)))
    return { pct, label: 'Paused', color: statusConfig.color, breached: false }
  }
  return parseSLABarRaw(ticket.sla_deadline, ticket.created_at, ticket.sla_breached)
}

let _timezone = 'UTC'

export function setTimezone(tz: string) {
  _timezone = tz
}

export function formatAbsDate(dateStr: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: _timezone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(dateStr + 'Z'))
  } catch {
    return new Date(dateStr).toLocaleString()
  }
}

export function timeAgo(dateStr: string): string {
  const date = new Date(dateStr + 'Z')
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
