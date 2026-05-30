import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../components/layout/AppShell'
import StatusBadge from '../components/tickets/StatusBadge'
import PriorityBadge from '../components/tickets/PriorityBadge'
import SLABadge from '../components/tickets/SLABadge'
import { useTickets } from '../hooks/useTickets'
import { useUnreadReplies } from '../hooks/useUnreadReplies'
import { PRIORITY_ORDER, timeAgo, type TicketRead } from '../types/ticket'

// ── Stat card ──────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: number
  accent: string
  icon: React.ReactNode
  sub?: string
}

function StatCard({ label, value, accent, icon, sub }: StatCardProps) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #E5E5E5',
        borderRadius: 12,
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        flex: 1,
        minWidth: 0,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Accent line top */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accent, borderRadius: '12px 12px 0 0' }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div
            style={{
              fontSize: 32,
              fontWeight: 700,
              color: '#0A0A0A',
              lineHeight: 1,
              letterSpacing: '-0.02em',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {value}
          </div>
          <div style={{ fontSize: 13, color: '#737373', marginTop: 6, fontWeight: 500 }}>{label}</div>
        </div>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: `${accent}15`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: accent,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: '#A3A3A3', borderTop: '1px solid #F2F2F2', paddingTop: 10 }}>
          {sub}
        </div>
      )}
    </div>
  )
}

// ── Table ──────────────────────────────────────────────────────────────────────

interface TicketRowProps {
  ticket: TicketRead
  hasUnread?: boolean
  onClick: () => void
}

function TicketRow({ ticket, hasUnread, onClick }: TicketRowProps) {
  return (
    <tr
      onClick={onClick}
      style={{
        cursor: 'pointer', transition: 'background 0.12s', borderBottom: '1px solid #F9F9F9',
        background: hasUnread ? 'rgba(255,71,19,0.02)' : 'transparent',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = '#F9F9F9')}
      onMouseLeave={e => (e.currentTarget.style.background = hasUnread ? 'rgba(255,71,19,0.02)' : 'transparent')}
    >
      <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {hasUnread && (
            <span title="New replies" style={{
              width: 7, height: 7, borderRadius: '50%',
              background: '#FF4713', flexShrink: 0, display: 'inline-block',
            }} />
          )}
          <span
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11,
              color: '#737373',
              letterSpacing: '0.03em',
            }}
          >
            {ticket.display_id}
          </span>
        </div>
      </td>
      <td style={{ padding: '10px 16px', maxWidth: 320 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: '#0A0A0A',
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {ticket.title}
        </span>
        {ticket.category_name && (
          <span style={{ fontSize: 11, color: '#A3A3A3', marginTop: 2, display: 'block' }}>
            {ticket.category_name}
          </span>
        )}
      </td>
      <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>
        <PriorityBadge priority={ticket.priority} />
      </td>
      <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>
        <StatusBadge status={ticket.status} />
      </td>
      <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>
        {ticket.assignee_name ? (
          <span style={{ fontSize: 12, color: '#262626', fontWeight: 500 }}>{ticket.assignee_name}</span>
        ) : (
          <span style={{ fontSize: 12, color: '#A3A3A3', fontStyle: 'italic' }}>Unassigned</span>
        )}
      </td>
      <td style={{ padding: '10px 16px' }}>
        <SLABadge ticket={ticket} variant="bar" />
      </td>
      <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 12, color: '#737373' }}>{timeAgo(ticket.created_at)}</span>
      </td>
    </tr>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <tr>
      <td colSpan={7} style={{ padding: '60px 24px', textAlign: 'center' }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: '#F2F2F2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 12px',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" stroke="#A3A3A3" strokeWidth="1.5" strokeLinecap="round"/>
            <rect x="9" y="3" width="6" height="4" rx="1" stroke="#A3A3A3" strokeWidth="1.5"/>
          </svg>
        </div>
        <p style={{ fontSize: 14, fontWeight: 600, color: '#262626', margin: 0 }}>All clear</p>
        <p style={{ fontSize: 13, color: '#A3A3A3', marginTop: 4 }}>No open or in-progress tickets right now.</p>
      </td>
    </tr>
  )
}

// ── Dashboard page ─────────────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate()

  const { data: unreadData } = useUnreadReplies()
  const unreadSet = new Set(unreadData?.ticket_ids_with_unread ?? [])

  const { data: active, isLoading: loadingActive } = useTickets({
    status: ['open', 'in_progress'],
    limit: 200,
  })

  const { data: resolved } = useTickets({
    status: ['resolved'],
    limit: 200,
  })

  const stats = useMemo(() => {
    const openCount = active?.items.filter(t => t.status === 'open').length ?? 0
    const inProgressCount = active?.items.filter(t => t.status === 'in_progress').length ?? 0
    const breachedCount = active?.items.filter(t => t.sla_breached).length ?? 0

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const resolvedToday =
      resolved?.items.filter(t => {
        if (!t.resolved_at) return false
        return new Date(t.resolved_at).getTime() >= today.getTime()
      }).length ?? 0

    return { openCount, inProgressCount, breachedCount, resolvedToday }
  }, [active, resolved])

  const sortedTickets = useMemo(() => {
    if (!active?.items) return []
    return [...active.items].sort((a, b) => {
      const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
      if (pd !== 0) return pd
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    })
  }, [active])

  return (
    <AppShell title="Dashboard">
      <div style={{ padding: '28px 32px', maxWidth: 1200 }}>
        {/* Stats row */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 28 }}>
          <StatCard
            label="Open Tickets"
            value={stats.openCount}
            accent="#3B82F6"
            sub="Awaiting assignment or response"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8"/>
                <path d="M12 8v4l3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            }
          />
          <StatCard
            label="In Progress"
            value={stats.inProgressCount}
            accent="#FF4713"
            sub="Actively being worked"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M13 10V3L4 14h7v7l9-11h-7z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            }
          />
          <StatCard
            label="Breached SLA"
            value={stats.breachedCount}
            accent="#EF4444"
            sub={stats.breachedCount > 0 ? 'Needs immediate attention' : 'All tickets within SLA'}
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="1.8"/>
                <line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                <circle cx="12" cy="17" r="0.5" stroke="currentColor" strokeWidth="1.8" fill="currentColor"/>
              </svg>
            }
          />
          <StatCard
            label="Resolved Today"
            value={stats.resolvedToday}
            accent="#10B981"
            sub="Closed in the last 24h"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <polyline points="20 6 9 17 4 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            }
          />
        </div>

        {/* Active tickets table */}
        <div
          style={{
            background: '#fff',
            border: '1px solid #E5E5E5',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '16px 24px',
              borderBottom: '1px solid #F2F2F2',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: '#0A0A0A', margin: 0 }}>Active Tickets</h2>
              <p style={{ fontSize: 12, color: '#A3A3A3', margin: '2px 0 0' }}>
                Open and in-progress, sorted by priority
              </p>
            </div>
            {active && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#737373',
                  background: '#F2F2F2',
                  borderRadius: 6,
                  padding: '3px 8px',
                }}
              >
                {active.items.length} tickets
              </span>
            )}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #F2F2F2' }}>
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
                        background: '#FAFAFA',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loadingActive ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #F9F9F9' }}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} style={{ padding: '10px 16px' }}>
                          <div
                            style={{
                              height: 14,
                              borderRadius: 4,
                              background: '#F2F2F2',
                              width: j === 1 ? '60%' : j === 0 ? 60 : '80%',
                              animation: 'shimmer 1.5s ease-in-out infinite',
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : sortedTickets.length === 0 ? (
                  <EmptyState />
                ) : (
                  sortedTickets.map(ticket => (
                    <TicketRow
                      key={ticket.id}
                      ticket={ticket}
                      hasUnread={unreadSet.has(ticket.id)}
                      onClick={() => navigate(`/tickets/${ticket.id}`)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
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
