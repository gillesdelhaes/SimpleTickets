import { parseSLABar, type SLABarResult, type TicketRead } from '../../types/ticket'

interface Props {
  ticket?: TicketRead
  /** Pre-computed SLA result — overrides ticket-based computation when provided */
  slaResult?: SLABarResult | null
  /** 'bar' = countdown meter (for tables), 'pill' = text pill (for detail views) */
  variant?: 'bar' | 'pill'
}

// Follows the Glasshouse countdown meter (.warr): mono time + short meter,
// danger red when breached or nearly out, muted when the SLA is paused.
export default function SLABadge({ ticket, slaResult, variant = 'bar' }: Props) {
  const sla = slaResult !== undefined ? slaResult : (ticket ? parseSLABar(ticket) : null)

  if (!sla) {
    return <span className="text-[11px] text-ink-3 italic">No SLA</span>
  }

  const paused = sla.label === 'Paused'
  const hot = sla.breached || (!paused && sla.pct <= 0.2)

  if (variant === 'pill') {
    return (
      <span className={`pill ${sla.breached ? 'danger' : hot ? 'warn' : paused ? 'retired' : 'avail'}`}>
        {sla.label}
      </span>
    )
  }

  // Bar variant — countdown meter for table rows
  return (
    <span className="warr">
      <span className={`d${hot ? ' hot' : ''}`} style={paused ? { color: 'var(--ink-3)' } : undefined}>
        {sla.label}
      </span>
      <span className="m">
        <i
          className={hot ? 'hot' : ''}
          style={{
            width: `${Math.max((sla.breached ? 1 : sla.pct) * 100, 4)}%`,
            ...(paused ? { background: 'var(--ink-3)' } : {}),
          }}
        />
      </span>
    </span>
  )
}
