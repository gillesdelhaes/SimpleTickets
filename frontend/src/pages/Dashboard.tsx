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
      width: w, height: h, borderRadius: 6, background: 'var(--track)',
      animation: 'shimmer 1.5s ease-in-out infinite', flexShrink: 0,
    }} />
  )
}

// ── Needs your attention ───────────────────────────────────────────────────────

function AttentionItem({ ticket, reason, onClick }: { ticket: TicketRead; reason: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="exp w-full text-left bg-transparent border-0 cursor-pointer"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-ink-3">{ticket.display_id}</span>
          <PriorityBadge priority={ticket.priority} />
        </div>
        <div className="text-[13px] font-semibold text-ink truncate mt-0.5">{ticket.title}</div>
        <div className="text-[11.5px] mt-0.5">{reason}</div>
      </div>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-ink-3 flex-shrink-0">
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
      <div className="flex flex-col gap-2.5 px-4 py-3.5">
        {[1, 2, 3].map(i => <Skel key={i} h={44} />)}
      </div>
    )
  }

  if (all.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <div className="w-9 h-9 rounded-[11px] mx-auto mb-2.5 flex items-center justify-center" style={{ background: 'var(--brand-tint)', color: 'var(--brand-ink)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <p className="text-[13px] font-semibold text-ink m-0">All clear</p>
        <p className="text-[12px] text-ink-3 mt-1 m-0">Nothing needs your attention right now.</p>
      </div>
    )
  }

  return (
    <div className="explist" style={{ paddingTop: 4 }}>
      {breached.map(t => (
        <AttentionItem
          key={t.id}
          ticket={t}
          onClick={() => navigate(`/tickets/${t.id}`)}
          reason={<span className="font-semibold text-danger-ink">SLA breached</span>}
        />
      ))}
      {unread.map(t => (
        <AttentionItem
          key={t.id}
          ticket={t}
          onClick={() => navigate(`/tickets/${t.id}`)}
          reason={<span className="text-brand-ink font-medium">Unread reply</span>}
        />
      ))}
      {negativeCsat.map(t => (
        <AttentionItem
          key={`csat-${t.id}`}
          ticket={t}
          onClick={() => navigate(`/tickets/${t.id}`)}
          reason={
            <span className="inline-flex items-center gap-1 font-semibold text-danger-ink">
              <ThumbDown size={12} /> Negative CSAT — reopened
            </span>
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
    <div
      className="flex items-center justify-between gap-3 mb-3.5 px-4 py-3 rounded-block text-[13px] text-warn-ink"
      style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-bg)' }}
    >
      <div className="flex items-center gap-2.5">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span>Slack is not configured — your team won't receive alerts for new tickets.</span>
      </div>
      <button
        onClick={() => navigate('/admin/settings')}
        className="btn ghost sm whitespace-nowrap"
      >
        Configure Slack
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
      className="panel w-full flex items-center justify-between gap-3 px-5 py-4 cursor-pointer text-left border-edge"
      style={{ font: 'inherit' }}
    >
      <div className="flex items-center gap-3.5">
        <div
          className="w-10 h-10 rounded-[12px] flex-shrink-0 flex items-center justify-center"
          style={count > 0
            ? { background: 'var(--brand-tint)', color: 'var(--brand-ink)' }
            : { background: 'var(--field)', color: 'var(--ink-3)', border: '1px solid var(--edge)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="23" y1="11" x2="17" y2="11" />
          </svg>
        </div>
        <div>
          <div
            className="text-[26px] font-[650] leading-none tracking-[-0.02em]"
            style={{ color: count > 0 ? 'var(--brand-ink)' : 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}
          >
            {count}
          </div>
          <div className="text-[12px] text-ink-2 mt-1">
            unassigned ticket{count !== 1 ? 's' : ''} waiting
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: count > 0 ? 'var(--brand-ink)' : 'var(--ink-3)' }}>
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
  let glyph: React.ReactNode
  if (type === 'ticket_created') {
    glyph = (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    )
  } else if (type === 'reply_added') {
    glyph = (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    )
  } else if (type === 'field_changed' && event.field === 'csat_response') {
    glyph = event.new_value === 'positive' ? <ThumbUp size={13} /> : <ThumbDown size={13} />
  } else {
    glyph = (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    )
  }
  return (
    <div
      className="w-7 h-7 rounded-[9px] flex items-center justify-center flex-shrink-0"
      style={{ background: 'var(--brand-tint)', color: 'var(--brand-ink)' }}
    >
      {glyph}
    </div>
  )
}

function ActivityDescription({ event }: { event: ActivityEvent }) {
  const actor = <span className="font-semibold text-ink">{event.actor_name ?? 'Someone'}</span>
  const ticket = (
    <Link
      to={`/tickets/${event.ticket_id}`}
      onClick={e => e.stopPropagation()}
      className="font-mono text-[11px] text-ink-2 no-underline hover:text-brand-ink"
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
        <span
          className="inline-flex items-center gap-1 font-semibold"
          style={{ color: isPositive ? 'var(--brand-ink)' : 'var(--danger-ink)' }}
        >
          {isPositive ? <ThumbUp size={12} /> : <ThumbDown size={12} />}
          {isPositive ? 'positive' : 'negative'}
        </span>{' '}
        feedback on {ticket}
      </span>
    )
  }

  if (field === 'status' && newVal) {
    // Status colors are admin-configured data — inline stays, pill anatomy is Glasshouse
    const color = statusColor(newVal)
    return (
      <span>
        {actor} set {ticket} to{' '}
        <span
          className="inline-block px-1.5 py-px rounded-full text-[10px] font-semibold"
          style={{ background: `${color}24`, color }}
        >
          {statusLabel(newVal)}
        </span>
      </span>
    )
  }

  return (
    <span>
      {actor} changed {field} on {ticket} to <strong className="text-ink font-semibold">{newVal ?? 'none'}</strong>
    </span>
  )
}

function ActivityFeed() {
  const navigate = useNavigate()
  const { data: events, isLoading } = useActivity(20)

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 px-4 py-3.5">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="flex items-center gap-2.5">
            <Skel w={28} h={28} />
            <div className="flex-1 flex flex-col gap-1.5">
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
      <p className="px-4 py-10 text-center text-[13px] text-ink-3 m-0">
        No recent activity — new tickets and replies show up here.
      </p>
    )
  }

  return (
    <div className="py-2 scrollbar-thin" style={{ maxHeight: 480, overflowY: 'auto' }}>
      {events.map((event, i) => (
        <button
          key={i}
          onClick={() => navigate(`/tickets/${event.ticket_id}`)}
          className="flex items-start gap-2.5 w-full px-5 py-2.5 bg-transparent border-0 cursor-pointer text-left hover:bg-row-hover transition-colors"
          style={{ font: 'inherit' }}
        >
          <ActivityIcon event={event} />
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] text-ink-2 leading-normal">
              <ActivityDescription event={event} />
            </div>
            <div className="text-[11.5px] text-ink-3 mt-0.5 truncate">
              {event.type === 'reply_added' && event.body
                ? `"${event.body}"`
                : event.ticket_title}
            </div>
          </div>
          <span className="font-mono text-[10px] text-ink-3 whitespace-nowrap flex-shrink-0 mt-1">
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
      <SlackUnconfiguredBanner />

      <div className="mb-3.5">
        <UnassignedBanner />
      </div>

      <div className="grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Recent activity</h2>
          </div>
          <ActivityFeed />
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Needs your attention</h2>
          </div>
          {user?.id ? <NeedsAttention userId={user.id} /> : null}
        </section>
      </div>
    </AppShell>
  )
}
