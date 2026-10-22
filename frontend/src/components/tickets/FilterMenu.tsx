import { useEffect, useRef, useState } from 'react'

// ── Compact filter dropdown ───────────────────────────────────────────────────
// A pill-shaped trigger reading "Label: value ▾" that opens a small menu.
// Highlighted (chip "on") when the filter differs from its default, so the
// bar shows at a glance which filters are narrowing the list.

interface FilterMenuProps {
  label: string
  /** Shown after "Label:"; omit for a bare "Label ▾" trigger. */
  value?: string
  active: boolean
  /** Menu body. Receives close() for single-pick menus that shut on choice. */
  children: (close: () => void) => React.ReactNode
  align?: 'left' | 'right'
  width?: number
}

export default function FilterMenu({ label, value, active, children, align = 'left', width = 220 }: FilterMenuProps) {
  const [open, setOpen] = useState(false)
  const [side, setSide] = useState(align)
  const ref = useRef<HTMLDivElement>(null)

  // Open on the preferred side unless the menu would spill off-screen there
  // (the bar wraps on narrow screens, so a trigger's position isn't fixed).
  function toggle() {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect()
      if (align === 'right' && r.right - width < 8) setSide('left')
      else if (align === 'left' && r.left + width > window.innerWidth - 8) setSide('right')
      else setSide(align)
    }
    setOpen(o => !o)
  }

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className={`chip${active ? ' on' : ''}`}
        onClick={toggle}
        aria-haspopup="true"
        aria-expanded={open}
        style={{ gap: 5, padding: '7px 11px' }}
      >
        {value === undefined ? (
          <span>{label}</span>
        ) : (
          <>
            <span className="text-ink-3" style={active ? { color: 'inherit', opacity: 0.75 } : undefined}>{label}:</span>
            <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
          </>
        )}
        <span aria-hidden="true" style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>
      {open && (
        <div
          className="overlay-surface animate-fade-up"
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', [side]: 0, zIndex: 50,
            width, maxHeight: 340, overflowY: 'auto', borderRadius: 14, padding: 5,
            // Opaque: the glass overlay let the ticket table read through the menu.
            background: 'var(--menu-bg)', backdropFilter: 'none',
          }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

// ── Menu rows ─────────────────────────────────────────────────────────────────

const rowClass =
  'flex items-center gap-2.5 w-full px-2.5 py-[7px] rounded-[9px] text-left text-[13px] text-ink ' +
  'bg-transparent border-0 cursor-pointer hover:bg-row-hover'

/** Checkbox row for multi-pick menus (status, priority). */
export function MenuCheck({ label, checked, onClick }: { label: React.ReactNode; checked: boolean; onClick: () => void }) {
  return (
    <button type="button" role="menuitemcheckbox" aria-checked={checked} className={rowClass} onClick={onClick}>
      <span
        aria-hidden="true"
        style={{
          width: 15, height: 15, borderRadius: 5, flexShrink: 0, display: 'grid', placeItems: 'center',
          border: checked ? 'none' : '1.5px solid var(--ink-3)',
          background: checked ? 'var(--brand-grad)' : 'transparent', color: '#fff', fontSize: 10, fontWeight: 700,
        }}
      >
        {checked ? '✓' : ''}
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}

/** Radio-style row for single-pick menus and "reset to default" rows. */
export function MenuOption({ label, selected, onClick }: { label: React.ReactNode; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      className={rowClass}
      style={selected ? { color: 'var(--brand-ink)', fontWeight: 600 } : undefined}
      onClick={onClick}
    >
      <span aria-hidden="true" style={{ width: 15, flexShrink: 0, textAlign: 'center' }}>{selected ? '●' : ''}</span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}

export function MenuDivider() {
  return <div style={{ height: 1, background: 'var(--track)', margin: '4px 6px' }} />
}
