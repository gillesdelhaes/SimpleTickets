import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AppShell from '../components/layout/AppShell'
import StatusBadge from '../components/tickets/StatusBadge'
import PriorityBadge from '../components/tickets/PriorityBadge'
import SLABadge from '../components/tickets/SLABadge'
import CreateTicketModal from '../components/tickets/CreateTicketModal'
import { useTickets } from '../hooks/useTickets'
import { useAuth } from '../contexts/AuthContext'
import { useUnreadReplies } from '../hooks/useUnreadReplies'
import { PRIORITY_ORDER, getAllStatuses, timeAgo, type Priority } from '../types/ticket'
import { useAppConfig } from '../hooks/useAppConfig'

const PAGE_SIZE = 25

const ALL_PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low']

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

type SortCol = 'priority' | 'status' | 'created_at' | 'sla'
type SortDir = 'asc' | 'desc'

export default function Queue() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data: appConfig } = useAppConfig()
  const allStatuses = appConfig?.statuses ?? getAllStatuses()
  const statusOrder: Record<string, number> = Object.fromEntries(
    allStatuses.map((s, i) => [s.name, i])
  )
  const [searchParams, setSearchParams] = useSearchParams()
  const [sortCol, setSortCol] = useState<SortCol>('priority')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [createOpen, setCreateOpen] = useState(false)

  // Read filters from URL
  const selectedStatuses = searchParams.getAll('status')
  const selectedPriorities = searchParams.getAll('priority') as Priority[]
  const assigneeFilter = searchParams.get('assignee') ?? 'all'
  const page = parseInt(searchParams.get('page') ?? '0', 10)

  // Derive API params — default to non-resolved statuses when no explicit filter is set
  const activeStatusNames = allStatuses.filter(s => !s.is_resolved_state).map(s => s.name)
  const statusParam = selectedStatuses.length > 0 ? selectedStatuses : activeStatusNames
  const priorityParam = selectedPriorities.length > 0 ? selectedPriorities : undefined
  const assigneeIdParam: number | undefined =
    assigneeFilter === 'mine' ? (user?.id ?? undefined) : undefined
  const unassignedParam = assigneeFilter === 'unassigned'

  // Map UI sort column to API sort param (status stays client-side — dynamic ordering)
  const apiSort = sortCol === 'status' ? undefined : sortCol === 'sla' ? 'sla_deadline' : sortCol
  const apiSortDir = sortCol === 'status' ? undefined : sortDir

  const { data, isLoading } = useTickets({
    status: statusParam,
    priority: priorityParam,
    assignee_id: assigneeIdParam,
    unassigned: unassignedParam,
    sort: apiSort,
    sort_dir: apiSortDir,
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

  function toggleStatus(s: string) {
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

  // Status sort is client-side only (dynamic ordering from appConfig); everything
  // else is sorted by the server via sort/sort_dir query params.
  const sortedItems = sortCol === 'status' && data?.items
    ? [...data.items].sort((a, b) => {
        const cmp = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99)
        return sortDir === 'asc' ? cmp : -cmp
      })
    : (data?.items ?? [])

  function handleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  return (
    <AppShell title="Ticket Queue">
      <CreateTicketModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <div style={{ padding: '28px 32px' }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <button
            onClick={() => setCreateOpen(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              border: 'none',
              background: 'linear-gradient(135deg, #FF4713, #AD1164)',
              color: '#fff', cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(255,71,19,0.25)',
              transition: 'opacity 0.15s',
            }}
            onMouseOver={e => (e.currentTarget.style.opacity = '0.88')}
            onMouseOut={e => (e.currentTarget.style.opacity = '1')}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M7 2v10M2 7h10" />
            </svg>
            New Ticket
          </button>
        </div>
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
              label="Active"
              active={selectedStatuses.length === 0}
              onClick={() => setParam('status', [])}
            />
            {allStatuses.map(s => (
              <Pill
                key={s.name}
                label={s.label}
                active={selectedStatuses.includes(s.name)}
                color={s.color}
                onClick={() => toggleStatus(s.name)}
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
                  {([
                    { label: 'ID', col: null },
                    { label: 'Title', col: null },
                    { label: 'Reporter', col: null },
                    { label: 'Priority', col: 'priority' as SortCol },
                    { label: 'Status', col: 'status' as SortCol },
                    { label: 'Assignee', col: null },
                    { label: 'SLA', col: 'sla' as SortCol },
                    { label: 'Created', col: 'created_at' as SortCol },
                  ] as { label: string; col: SortCol | null }[]).map(({ label, col }) => (
                    <th
                      key={label}
                      onClick={col ? () => handleSort(col) : undefined}
                      style={{
                        padding: '8px 16px',
                        textAlign: 'left',
                        fontSize: 11,
                        fontWeight: 600,
                        color: col && sortCol === col ? '#FF4713' : '#A3A3A3',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        whiteSpace: 'nowrap',
                        cursor: col ? 'pointer' : 'default',
                        userSelect: 'none',
                      }}
                    >
                      {label}
                      {col && sortCol === col && (
                        <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: PAGE_SIZE }).map((_, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #F9F9F9' }}>
                      {Array.from({ length: 8 }).map((_, j) => (
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
                    <td colSpan={8} style={{ padding: '60px 24px', textAlign: 'center' }}>
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
                      <td style={{ padding: '9px 16px', maxWidth: 280 }}>
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
                          {ticket.channel === 'web' && ticket.slack_channel_id && (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.75 }}>
                              <circle cx="12" cy="12" r="10"/>
                              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
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
                        {ticket.submitter_name
                          ? <span style={{ fontSize: 12, color: '#262626' }}>{ticket.submitter_name}</span>
                          : <span style={{ fontSize: 12, color: '#A3A3A3', fontStyle: 'italic' }}>Unknown</span>
                        }
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
