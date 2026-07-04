import { STATUS_COLORS, STATUS_LABELS, type TicketStatus } from '../../types/ticket'

interface Props {
  status: TicketStatus
  size?: 'sm' | 'md'
}

export default function StatusBadge({ status, size = 'sm' }: Props) {
  const color = STATUS_COLORS[status]
  const label = STATUS_LABELS[status]
  const fontSize = size === 'sm' ? '11px' : '12px'
  const padding = size === 'sm' ? '3px 9px' : '4px 10px'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding,
        borderRadius: '999px',
        fontSize,
        fontWeight: 600,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
        color,
        background: `${color}18`,
        border: `1px solid ${color}30`,
      }}
    >
      {label}
    </span>
  )
}
