import { useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import AppShell from '../components/layout/AppShell'
import PriorityBadge from '../components/tickets/PriorityBadge'
import { useTickets } from '../hooks/useTickets'
import { useUnreadReplies } from '../hooks/useUnreadReplies'
import { useActivity, type ActivityEvent } from '../hooks/useActivity'
import { useAppConfig } from '../hooks/useAppConfig'
import { useAuth } from '../contexts/AuthContext'
import { getAllStatuses, statusColor, statusLabel, timeAgo, type TicketRead } from '../types/ticket'
import { ThumbUp, ThumbDown } from '../components/ThumbIcon'

// ── Helpers ────────────────────────────────────────────────────────────────────

const FIELD_LABEL: Record<string, string> = {
  status: 'status', priority: 'priority', assignee_id: 'assignee', category_id: 'category',
  csat_response: 'CSAT feedback',
}

// ── Skeleton ───────────────────────────────────────────────────────────────────

function Skel({ w = '100%', h = 14 }: { w?: string | number; h?: number }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: 4, background: '#F2F2F2',
      animation: 'shimmer 1.5s ease-in-out infinite', flexShrink: 0,
    }} />
  )
}

// ── Section card ───────────────────────────────────────────────────────────────

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E5E5', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{
        padding: '14px 18px', borderBottom: '1px solid #F2F2F2',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#0A0A0A' }}>{title}</span>
        {action}
      </div>
      {children}
    </div>
  )
}

// ── Needs your attention ───────────────────────────────────────────────────────

function AttentionItem({ ticket, reason, onClick }: { ticket: TicketRead; reason: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '10px 16px',
        background: 'none', border: 'none', cursor: 'pointer',
        borderBottom: '1px solid #F9F9F9', textAlign: 'left',
        transition: 'background 0.12s',
      }}
      onMouseOver={e => (e.currentTarget.style.background = '#FAFAFA')}
      onMouseOut={e => (e.currentTarget.style.background = 'none')}
    >
      <PriorityBadge priority={ticket.priority} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#A3A3A3' }}>
            {ticket.display_id}
          </span>
        </div>
        <div style={{
          fontSize: 12, fontWeight: 500, color: '#0A0A0A',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1,
        }}>
          {ticket.title}
        </div>
        <div style={{ fontSize: 11, marginTop: 2 }}>{reason}</div>
      </div>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#C0C0C0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M4.5 2.5l3 3.5-3 3.5" />
      </svg>
    </button>
  )
}

function NeedsAttention({ userId }: { userId: number }) {
  const navigate = useNavigate()
  const { data: appConfig } = useAppConfig()
  const activeStatuses = (appConfig?.statuses ?? getAllStatuses())
    .filter(s => !s.is_resolved_state)
    .map(s => s.name)
  const { data: myTickets, isLoading: myTicketsLoading } = useTickets({
    assignee_id: userId,
    status: activeStatuses,
    limit: 100,
  })
  const { data: negativeCsatData, isLoading: csatLoading } = useTickets({
    assignee_id: userId,
    status: activeStatuses,
    has_negative_csat: true,
    limit: 100,
  })
  const { data: unreadData } = useUnreadReplies()
  const unreadSet = new Set(unreadData?.ticket_ids_with_unread ?? [])

  const { breached, unread, negativeCsat } = useMemo(() => {
    const items = myTickets?.items ?? []
    const negCsatItems = negativeCsatData?.items ?? []
    return {
      breached: items.filter(t => t.sla_breached),
      unread: items.filter(t => !t.sla_breached && unreadSet.has(t.id)),
      negativeCsat: negCsatItems.filter(t => !t.sla_breached && !unreadSet.has(t.id)),
    }
  }, [myTickets, negativeCsatData, unreadData])  // eslint-disable-line react-hooks/exhaustive-deps

  const all = [...breached, ...unread, ...negativeCsat]
  const isLoading = myTicketsLoading || csatLoading

  if (isLoading) {
    return (
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[1, 2, 3].map(i => <Skel key={i} h={44} />)}
      </div>
    )
  }

  if (all.length === 0) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center' }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8, background: '#F0FFF4',
          display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px',
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <p style={{ fontSize: 13, fontWeight: 600, color: '#262626', margin: 0 }}>All clear</p>
        <p style={{ fontSize: 12, color: '#A3A3A3', marginTop: 3 }}>Nothing needs your attention right now.</p>
      </div>
    )
  }

  return (
    <div>
      {breached.map(t => (
        <AttentionItem
          key={t.id}
          ticket={t}
          onClick={() => navigate(`/tickets/${t.id}`)}
          reason={
            <span style={{ color: '#EF4444', fontWeight: 600 }}>SLA breached</span>
          }
        />
      ))}
      {unread.map(t => (
        <AttentionItem
          key={t.id}
          ticket={t}
          onClick={() => navigate(`/tickets/${t.id}`)}
          reason={
            <span style={{ color: '#FF4713' }}>Unread reply</span>
          }
        />
      ))}
      {negativeCsat.map(t => (
        <AttentionItem
          key={`csat-${t.id}`}
          ticket={t}
          onClick={() => navigate(`/tickets/${t.id}`)}
          reason={
            <span style={{ color: '#DC2626', display: 'inline-flex', alignItems: 'center', gap: 4 }}><ThumbDown size={12} color="#DC2626" /> Negative CSAT — reopened</span>
          }
        />
      ))}
    </div>
  )
}

// ── Slack unconfigured notice ──────────────────────────────────────────────────

function SlackUnconfiguredBanner() {
  const navigate = useNavigate()
  const { data: config } = useAppConfig()
  if (!config || config.slack_configured) return null
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 18px', marginBottom: 16,
      background: '#FFFBEB', border: '1px solid #FDE68A',
      borderRadius: 10, gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span style={{ fontSize: 13, color: '#92400E' }}>
          Slack is not configured — your team won't receive alerts for new tickets.
        </span>
      </div>
      <button
        onClick={() => navigate('/admin/settings')}
        style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #FDE68A', background: '#FEF3C7', fontSize: 12, fontWeight: 600, color: '#92400E', cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        Configure Slack →
      </button>
    </div>
  )
}

// ── Unassigned counter ─────────────────────────────────────────────────────────

function UnassignedBanner() {
  const navigate = useNavigate()
  const { data: bannerConfig } = useAppConfig()
  const bannerActiveStatuses = (bannerConfig?.statuses ?? getAllStatuses())
    .filter(s => !s.is_resolved_state)
    .map(s => s.name)
  const { data } = useTickets({ unassigned: true, status: bannerActiveStatuses, limit: 1 })
  const count = data?.total ?? 0

  return (
    <button
      onClick={() => navigate('/queue?assignee=unassigned')}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        width: '100%', padding: '14px 18px',
        background: count > 0 ? 'rgba(255,71,19,0.04)' : '#FAFAFA',
        border: `1px solid ${count > 0 ? 'rgba(255,71,19,0.2)' : '#E5E5E5'}`,
        borderRadius: 12, cursor: 'pointer', textAlign: 'left',
        transition: 'background 0.12s',
      }}
      onMouseOver={e => (e.currentTarget.style.background = count > 0 ? 'rgba(255,71,19,0.08)' : '#F2F2F2')}
      onMouseOut={e => (e.currentTarget.style.background = count > 0 ? 'rgba(255,71,19,0.04)' : '#FAFAFA')}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: count > 0 ? 'rgba(255,71,19,0.1)' : '#F2F2F2',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: count > 0 ? '#FF4713' : '#A3A3A3',
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <line x1="23" y1="11" x2="17" y2="11"/>
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700, color: count > 0 ? '#FF4713' : '#0A0A0A', lineHeight: 1, letterSpacing: '-0.02em' }}>
            {count}
          </div>
          <div style={{ fontSize: 12, color: '#737373', marginTop: 2 }}>
            unassigned ticket{count !== 1 ? 's' : ''} waiting
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, color: count > 0 ? '#FF4713' : '#A3A3A3' }}>
        View queue
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 3l4 4-4 4" />
        </svg>
      </div>
    </button>
  )
}

// ── Activity feed ──────────────────────────────────────────────────────────────

function ActivityIcon({ event }: { event: ActivityEvent }) {
  const { type } = event
  if (type === 'ticket_created') {
    return (
      <div style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(59,130,246,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </div>
    )
  }
  if (type === 'reply_added') {
    return (
      <div style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(16,185,129,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
    )
  }
  if (type === 'field_changed' && event.field === 'csat_response') {
    return (
      <div style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(99,102,241,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {event.new_value === 'positive'
          ? <ThumbUp size={13} color="#6366F1" />
          : <ThumbDown size={13} color="#6366F1" />}
      </div>
    )
  }
  return (
    <div style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(245,158,11,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    </div>
  )
}

function ActivityDescription({ event }: { event: ActivityEvent }) {
  const actor = <span style={{ fontWeight: 600, color: '#262626' }}>{event.actor_name ?? 'Someone'}</span>
  const ticket = (
    <Link
      to={`/tickets/${event.ticket_id}`}
      onClick={e => e.stopPropagation()}
      style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#737373', textDecoration: 'none' }}
    >
      {event.ticket_display_id}
    </Link>
  )

  if (event.type === 'ticket_created') {
    return <span>{actor} opened {ticket}</span>
  }

  if (event.type === 'reply_added') {
    return <span>{actor} replied on {ticket}</span>
  }

  // field_changed
  const field = FIELD_LABEL[event.field ?? ''] ?? event.field
  const newVal = event.new_value

  if (event.field === 'csat_response') {
    const isPositive = newVal === 'positive'
    return (
      <span>
        Submitter left{' '}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: 600, color: isPositive ? '#059669' : '#DC2626' }}>
          {isPositive ? <ThumbUp size={12} color="#059669" /> : <ThumbDown size={12} color="#DC2626" />}
          {isPositive ? 'positive' : 'negative'}
        </span>{' '}
        feedback on {ticket}
      </span>
    )
  }

  if (field === 'status' && newVal) {
    const color = statusColor(newVal)
    return (
      <span>
        {actor} set {ticket} to{' '}
        <span style={{
          display: 'inline-block', padding: '1px 6px', borderRadius: 999,
          fontSize: 10, fontWeight: 600,
          background: `${color}18`, color, border: `1px solid ${color}40`,
        }}>
          {statusLabel(newVal)}
        </span>
      </span>
    )
  }

  return (
    <span>
      {actor} changed {field} on {ticket} to <strong style={{ color: '#262626' }}>{newVal ?? 'none'}</strong>
    </span>
  )
}

function ActivityFeed() {
  const navigate = useNavigate()
  const { data: events, isLoading } = useActivity(20)

  if (isLoading) {
    return (
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Skel w={28} h={28} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Skel w="60%" />
              <Skel w="40%" h={11} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (!events?.length) {
    return (
      <div style={{ padding: '40px 16px', textAlign: 'center' }}>
        <p style={{ fontSize: 13, color: '#A3A3A3', margin: 0 }}>No recent activity.</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '8px 0', maxHeight: 480, overflowY: 'auto' }}>
      {events.map((event, i) => (
        <button
          key={i}
          onClick={() => navigate(`/tickets/${event.ticket_id}`)}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            width: '100%', padding: '9px 16px',
            background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
            transition: 'background 0.12s',
          }}
          onMouseOver={e => (e.currentTarget.style.background = '#FAFAFA')}
          onMouseOut={e => (e.currentTarget.style.background = 'none')}
        >
          <ActivityIcon event={event} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: '#262626', lineHeight: 1.5 }}>
              <ActivityDescription event={event} />
            </div>
            <div style={{
              fontSize: 11, color: '#A3A3A3', marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {event.type === 'reply_added' && event.body
                ? `"${event.body}"`
                : event.ticket_title
              }
            </div>
          </div>
          <span style={{ fontSize: 11, color: '#C0C0C0', whiteSpace: 'nowrap', flexShrink: 0, marginTop: 2 }}>
            {timeAgo(event.created_at)}
          </span>
        </button>
      ))}
    </div>
  )
}

// ── Dashboard page ─────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth()

  return (
    <AppShell title="Dashboard">
      <div style={{ padding: '28px 32px', maxWidth: 1200 }}>

        <SlackUnconfiguredBanner />

        {/* Unassigned banner */}
        <div style={{ marginBottom: 20 }}>
          <UnassignedBanner />
        </div>

        {/* Two-column layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, alignItems: 'start' }}>

          {/* Activity feed */}
          <Card title="Recent activity">
            <ActivityFeed />
          </Card>

          {/* Needs your attention */}
          <Card title="Needs your attention">
            {user?.id
              ? <NeedsAttention userId={user.id} />
              : null
            }
          </Card>

        </div>
      </div>

    </AppShell>
  )
}
