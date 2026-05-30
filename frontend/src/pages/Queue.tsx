import { useNavigate, useSearchParams } from 'react-router-dom'
import AppShell from '../components/layout/AppShell'
import StatusBadge from '../components/tickets/StatusBadge'
import PriorityBadge from '../components/tickets/PriorityBadge'
import SLABadge from '../components/tickets/SLABadge'
import { useTickets } from '../hooks/useTickets'
import { useAuth } from '../contexts/AuthContext'
import { useUnreadReplies } from '../hooks/useUnreadReplies'
import { PRIORITY_ORDER, timeAgo, type Priority, type TicketStatus } from '../types/ticket'

const PAGE_SIZE = 25

const ALL_STATUSES: TicketStatus[] = ['open', 'in_progress', 'pending_user', 'resolved', 'closed']
const ALL_PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low']

const STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  pending_user: 'Pending',
  resolved: 'Resolved',
  closed: 'Closed',
}

const PRIORITY_LABELS: Record<Priority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

// ── Filter pills ───────────────────────────────────────────────────────────────

interface PillProps {
  label: string
  active: boolean
  color?: string
  onClick: () => void
}

function Pill({ label, active, color, onClick }: PillProps) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 12px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        border: active ? `1.5px solid ${color ?? '#FF4713'}` : '1.5px solid #E5E5E5',
        background: active ? (color ? `${color}15` : 'rgba(255,71,19,0.08)') : '#fff',
        color: active ? (color ?? '#FF4713') : '#737373',
        transition: 'all 0.12s',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

// ── Pagination ─────────────────────────────────────────────────────────────────

interface PaginationProps {
  page: number
  total: number
  pageSize: number
  onPrev: () => void
  onNext: () => void
}

function Pagination({ page, total, pageSize, onPrev, onNext }: PaginationProps) {
  const start = page * pageSize + 1
  const end = Math.min((page + 1) * pageSize, total)
  const hasPrev = page > 0
  const hasNext = end < total

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 24px',
        borderTop: '1px solid #F2F2F2',
        background: '#FAFAFA',
      }}
    >
      <span style={{ fontSize: 12, color: '#737373' }}>
        {total === 0 ? 'No tickets' : `${start}–${end} of ${total}`}
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onPrev}
          disabled={!hasPrev}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 500,
            border: '1px solid #E5E5E5',
            background: hasPrev ? '#fff' : '#F9F9F9',
            color: hasPrev ? '#262626' : '#C0C0C0',
            cursor: hasPrev ? 'pointer' : 'not-allowed',
          }}
        >
          ← Previous
        </button>
        <button
          onClick={onNext}
          disabled={!hasNext}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 500,
            border: '1px solid #E5E5E5',
            background: hasNext ? '#fff' : '#F9F9F9',
            color: hasNext ? '#262626' : '#C0C0C0',
            cursor: hasNext ? 'pointer' : 'not-allowed',
          }}
        >
          Next →
        </button>
      </div>
    </div>
  )
}

// ── Queue page ─────────────────────────────────────────────────────────────────

export default function Queue() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  // Read filters from URL
  const selectedStatuses = searchParams.getAll('status') as TicketStatus[]
  const selectedPriorities = searchParams.getAll('priority') as Priority[]
  const assigneeFilter = searchParams.get('assignee') ?? 'all'
  const page = parseInt(searchParams.get('page') ?? '0', 10)

  // Derive API params
  const statusParam = selectedStatuses.length > 0 ? selectedStatuses : undefined
  const priorityParam = selectedPriorities.length > 0 ? selectedPriorities : undefined
  const assigneeIdParam: number | undefined =
    assigneeFilter === 'mine' ? (user?.id ?? undefined) : undefined

  const { data, isLoading } = useTickets({
    status: statusParam,
    priority: priorityParam,
    assignee_id: assigneeIdParam,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })
  const { data: unreadData } = useUnreadReplies()
  const unreadSet = new Set(unreadData?.ticket_ids_with_unread ?? [])

  // ── Filter helpers ─────────────────────────────────────────────────────────

  function setParam(key: string, values: string[]) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete(key)
      values.forEach(v => next.append(key, v))
      next.set('page', '0')
      return next
    })
  }

  function toggleStatus(s: TicketStatus) {
    const next = selectedStatuses.includes(s)
      ? selectedStatuses.filter(x => x !== s)
      : [...selectedStatuses, s]
    setParam('status', next)
  }

  function togglePriority(p: Priority) {
    const next = selectedPriorities.includes(p)
      ? selectedPriorities.filter(x => x !== p)
      : [...selectedPriorities, p]
    setParam('priority', next)
  }

  function setAssignee(val: string) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('assignee', val)
      next.set('page', '0')
      return next
    })
  }

  function setPage(p: number) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('page', String(p))
      return next
    })
  }

  // Sort displayed items: critical first, then created_at
  const sortedItems = data?.items
    ? [...data.items].sort((a, b) => {
        const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
        if (pd !== 0) return pd
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      })
    : []

  return (
    <AppShell title="Ticket Queue">
      <div style={{ padding: '28px 32px' }}>
        {/* Filter bar */}
        <div
          style={{
            background: '#fff',
            border: '1px solid #E5E5E5',
            borderRadius: 12,
            padding: '14px 20px',
            marginBottom: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {/* Status pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#A3A3A3', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 4, whiteSpace: 'nowrap' }}>
              Status
            </span>
            <Pill
              label="All"
              active={selectedStatuses.length === 0}
              onClick={() => setParam('status', [])}
            />
            {ALL_STATUSES.map(s => (
              <Pill
                key={s}
                label={STATUS_LABELS[s]}
                active={selectedStatuses.includes(s)}
                color={
                  s === 'open' ? '#3B82F6' :
                  s === 'in_progress' ? '#FF4713' :
                  s === 'pending_user' ? '#F59E0B' :
                  s === 'resolved' ? '#10B981' : '#737373'
                }
                onClick={() => toggleStatus(s)}
              />
            ))}
          </div>

          {/* Priority + Assignee pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#A3A3A3', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 4, whiteSpace: 'nowrap' }}>
              Priority
            </span>
            <Pill
              label="All"
              active={selectedPriorities.length === 0}
              onClick={() => setParam('priority', [])}
            />
            {ALL_PRIORITIES.map(p => (
              <Pill
                key={p}
                label={PRIORITY_LABELS[p]}
                active={selectedPriorities.includes(p)}
                color={
                  p === 'critical' ? '#AD1164' :
                  p === 'high' ? '#FF4713' :
                  p === 'medium' ? '#F59E0B' : '#3B82F6'
                }
                onClick={() => togglePriority(p)}
              />
            ))}

            <span style={{ fontSize: 11, fontWeight: 600, color: '#A3A3A3', textTransform: 'uppercase', letterSpacing: '0.06em', marginLeft: 12, marginRight: 4, whiteSpace: 'nowrap' }}>
              Assignee
            </span>
            {[
              { val: 'all', label: 'All' },
              { val: 'mine', label: 'Mine' },
              { val: 'unassigned', label: 'Unassigned' },
            ].map(({ val, label }) => (
              <Pill
                key={val}
                label={label}
                active={assigneeFilter === val}
                onClick={() => setAssignee(val)}
              />
            ))}
          </div>
        </div>

        {/* Table */}
        <div
          style={{
            background: '#fff',
            border: '1px solid #E5E5E5',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          {/* Table header */}
          <div
            style={{
              padding: '14px 24px',
              borderBottom: '1px solid #F2F2F2',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: '#0A0A0A', margin: 0 }}>
                All Tickets
              </h2>
            </div>
            {data && (
              <span style={{ fontSize: 11, fontWeight: 600, color: '#737373', background: '#F2F2F2', borderRadius: 6, padding: '3px 8px' }}>
                {data.total} total
              </span>
            )}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #F2F2F2', background: '#FAFAFA' }}>
                  {['ID', 'Title', 'Priority', 'Status', 'Assignee', 'SLA', 'Created'].map(h => (
                    <th
                      key={h}
                      style={{
                        padding: '8px 16px',
                        textAlign: 'left',
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#A3A3A3',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: PAGE_SIZE }).map((_, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #F9F9F9' }}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} style={{ padding: '10px 16px' }}>
                          <div
                            style={{
                              height: 13,
                              borderRadius: 4,
                              background: '#F2F2F2',
                              width: j === 1 ? '55%' : j === 0 ? 60 : '75%',
                              animation: 'shimmer 1.5s ease-in-out infinite',
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : sortedItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '60px 24px', textAlign: 'center' }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: '#262626', margin: 0 }}>No tickets found</p>
                      <p style={{ fontSize: 13, color: '#A3A3A3', marginTop: 4 }}>
                        Try adjusting the filters above.
                      </p>
                    </td>
                  </tr>
                ) : (
                  sortedItems.map(ticket => {
                    const hasUnread = unreadSet.has(ticket.id)
                    return (
                    <tr
                      key={ticket.id}
                      onClick={() => navigate(`/tickets/${ticket.id}`)}
                      style={{
                        borderBottom: '1px solid #F9F9F9',
                        cursor: 'pointer',
                        transition: 'background 0.12s',
                        background: hasUnread ? 'rgba(255,71,19,0.02)' : 'transparent',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#F9F9F9')}
                      onMouseLeave={e => (e.currentTarget.style.background = hasUnread ? 'rgba(255,71,19,0.02)' : 'transparent')}
                    >
                      <td style={{ padding: '9px 16px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {hasUnread && (
                            <span
                              title="New replies"
                              style={{
                                width: 7, height: 7, borderRadius: '50%',
                                background: '#FF4713', flexShrink: 0,
                                display: 'inline-block',
                              }}
                            />
                          )}
                          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#737373', letterSpacing: '0.03em' }}>
                            {ticket.display_id}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: '9px 16px', maxWidth: 300 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                          {ticket.channel === 'slack' && (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, opacity: 0.7 }}>
                              <path d="M14.5 10c-.83 0-1.5-.67-1.5-1.5v-5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5z" fill="#10B981"/>
                              <path d="M20.5 10H19V8.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" fill="#10B981"/>
                              <path d="M9.5 14c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5S8 21.33 8 20.5v-5c0-.83.67-1.5 1.5-1.5z" fill="#10B981"/>
                              <path d="M3.5 14H5v1.5c0 .83-.67 1.5-1.5 1.5S2 16.33 2 15.5 2.67 14 3.5 14z" fill="#10B981"/>
                              <path d="M14 14.5c0-.83.67-1.5 1.5-1.5h5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-5c-.83 0-1.5-.67-1.5-1.5z" fill="#10B981"/>
                              <path d="M15.5 19H14v1.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5-.67-1.5-1.5-1.5z" fill="#10B981"/>
                              <path d="M10 9.5C10 8.67 9.33 8 8.5 8h-5C2.67 8 2 8.67 2 9.5S2.67 11 3.5 11h5c.83 0 1.5-.67 1.5-1.5z" fill="#10B981"/>
                              <path d="M8.5 5H10V3.5C10 2.67 9.33 2 8.5 2S7 2.67 7 3.5 7.67 5 8.5 5z" fill="#10B981"/>
                            </svg>
                          )}
                          <span style={{ fontSize: 13, fontWeight: 500, color: '#0A0A0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {ticket.title}
                          </span>
                        </div>
                        {ticket.category_name && (
                          <span style={{ fontSize: 11, color: '#A3A3A3', display: 'block', marginTop: 1 }}>{ticket.category_name}</span>
                        )}
                      </td>
                      <td style={{ padding: '9px 16px', whiteSpace: 'nowrap' }}>
                        <PriorityBadge priority={ticket.priority} />
                      </td>
                      <td style={{ padding: '9px 16px', whiteSpace: 'nowrap' }}>
                        <StatusBadge status={ticket.status} />
                      </td>
                      <td style={{ padding: '9px 16px', whiteSpace: 'nowrap' }}>
                        {ticket.assignee_name
                          ? <span style={{ fontSize: 12, color: '#262626', fontWeight: 500 }}>{ticket.assignee_name}</span>
                          : <span style={{ fontSize: 12, color: '#A3A3A3', fontStyle: 'italic' }}>Unassigned</span>
                        }
                      </td>
                      <td style={{ padding: '9px 16px' }}>
                        <SLABadge ticket={ticket} variant="bar" />
                      </td>
                      <td style={{ padding: '9px 16px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 12, color: '#737373' }}>{timeAgo(ticket.created_at)}</span>
                      </td>
                    </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {data && data.total > PAGE_SIZE && (
            <Pagination
              page={page}
              total={data.total}
              pageSize={PAGE_SIZE}
              onPrev={() => setPage(page - 1)}
              onNext={() => setPage(page + 1)}
            />
          )}
        </div>
      </div>

      <style>{`
        @keyframes shimmer {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </AppShell>
  )
}
