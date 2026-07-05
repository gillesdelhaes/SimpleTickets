import { PRIORITY_LABELS, type Priority } from '../../types/ticket'

interface Props {
  priority: Priority
  size?: 'sm' | 'md'
}

// Urgency wears the reserved semantic tokens: critical = danger, high = warn,
// medium/low stay neutral ink so only what matters draws the eye.
const PRIORITY_STYLE: Record<Priority, { dot: string; text: string }> = {
  critical: { dot: 'var(--danger-ink)', text: 'var(--danger-ink)' },
  high: { dot: 'var(--warn-ink)', text: 'var(--warn-ink)' },
  medium: { dot: 'var(--ink-2)', text: 'var(--ink)' },
  low: { dot: 'var(--ink-3)', text: 'var(--ink-2)' },
}

export default function PriorityBadge({ priority, size = 'sm' }: Props) {
  const label = PRIORITY_LABELS[priority]
  const s = PRIORITY_STYLE[priority]
  const dotSize = size === 'sm' ? 6 : 7

  return (
    <span
      className={`inline-flex items-center gap-[5px] font-medium whitespace-nowrap ${
        size === 'sm' ? 'text-[12px]' : 'text-[13px]'
      }`}
      style={{ color: s.text }}
    >
      <span
        className="rounded-full flex-shrink-0"
        style={{ width: dotSize, height: dotSize, background: s.dot }}
      />
      {label}
    </span>
  )
}
