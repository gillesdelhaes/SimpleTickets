export type TicketStatus = 'open' | 'in_progress' | 'pending_user' | 'resolved' | 'closed'
export type Priority = 'low' | 'medium' | 'high' | 'critical'
export type Channel = 'web' | 'slack' | 'email'

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

// ── Display helpers ────────────────────────────────────────────────────────────

export const STATUS_COLORS: Record<TicketStatus, string> = {
  open: '#3B82F6',
  in_progress: '#FF4713',
  pending_user: '#F59E0B',
  resolved: '#10B981',
  closed: '#737373',
}

export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  pending_user: 'Pending',
  resolved: 'Resolved',
  closed: 'Closed',
}

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

export function parseSLABar(ticket: TicketRead): {
  pct: number
  label: string
  color: string
  breached: boolean
} | null {
  if (!ticket.sla_deadline || !ticket.created_at) return null

  if (ticket.sla_breached) {
    return { pct: 0, label: 'Breached', color: '#EF4444', breached: true }
  }

  const now = Date.now()
  const created = new Date(ticket.created_at).getTime()
  const deadline = new Date(ticket.sla_deadline).getTime()
  const total = deadline - created
  const remaining = deadline - now

  if (remaining <= 0) {
    return { pct: 0, label: 'Overdue', color: '#EF4444', breached: true }
  }

  const pct = Math.max(0, Math.min(1, remaining / total))
  const color = pct > 0.5 ? '#10B981' : pct > 0.2 ? '#F59E0B' : '#EF4444'
  return { pct, label: formatDuration(remaining), color, breached: false }
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
