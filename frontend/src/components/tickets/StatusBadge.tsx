import { STATUS_COLORS, STATUS_LABELS, type TicketStatus } from '../../types/ticket'

interface Props {
  status: TicketStatus
  size?: 'sm' | 'md'
}

// Status colors are admin-configured data (from the API), so they stay inline —
// the pill shape and dot follow the Glasshouse .pill anatomy.
export default function StatusBadge({ status, size = 'sm' }: Props) {
  const color = STATUS_COLORS[status]
  const label = STATUS_LABELS[status]

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap ${
        size === 'sm' ? 'px-2.5 py-1 text-[11.5px]' : 'px-3 py-1 text-[12px]'
      }`}
      style={{ backgroundColor: color + '24', color }}
    >
      <span
        className="w-[5px] h-[5px] rounded-full flex-shrink-0"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  )
}
