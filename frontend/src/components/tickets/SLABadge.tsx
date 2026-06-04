import { parseSLABar, type SLABarResult, type TicketRead } from '../../types/ticket'

interface Props {
  ticket?: TicketRead
  /** Pre-computed SLA result — overrides ticket-based computation when provided */
  slaResult?: SLABarResult | null
  /** 'bar' = inline progress bar (for tables), 'pill' = text pill (for detail views) */
  variant?: 'bar' | 'pill'
}

export default function SLABadge({ ticket, slaResult, variant = 'bar' }: Props) {
  const sla = slaResult !== undefined ? slaResult : (ticket ? parseSLABar(ticket) : null)

  if (!sla) {
    return (
      <span style={{ fontSize: '11px', color: '#A3A3A3', fontStyle: 'italic' }}>No SLA</span>
    )
  }

  if (variant === 'pill') {
    return (
      <>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '2px 8px',
            borderRadius: '999px',
            fontSize: '11px',
            fontWeight: 600,
            color: sla.color,
            background: `${sla.color}18`,
            border: `1px solid ${sla.color}30`,
            animation: sla.breached ? 'sla-pulse 1.5s ease-in-out infinite' : 'none',
          }}
        >
          {sla.breached && (
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: sla.color, flexShrink: 0 }} />
          )}
          {sla.label}
        </span>
        {sla.breached && (
          <style>{`
            @keyframes sla-pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.55; }
            }
          `}</style>
        )}
      </>
    )
  }

  // Bar variant — progress bar with time/breach label below
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 90 }}>
      <div
        style={{
          width: '100%',
          height: 4,
          borderRadius: 2,
          background: '#E5E5E5',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            width: `${Math.max(sla.breached ? 100 : sla.pct * 100, 2)}%`,
            borderRadius: 2,
            background: sla.color,
            transition: 'width 0.3s ease',
            animation: sla.breached ? 'sla-bar-pulse 1.5s ease-in-out infinite' : 'none',
          }}
        />
      </div>
      <span
        style={{
          fontSize: '10px',
          fontFamily: 'JetBrains Mono, monospace',
          color: sla.breached ? sla.color : '#737373',
          fontWeight: sla.breached ? 700 : 400,
          letterSpacing: '0.01em',
          lineHeight: 1,
        }}
      >
        {sla.label}
      </span>

      {sla.breached && (
        <style>{`
          @keyframes sla-bar-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
        `}</style>
      )}
    </div>
  )
}
