import { useEffect } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  open: boolean
  /** Tickets being resolved that the requester never got a reply on. */
  unanswered: { id: number; display_id: string }[]
  /** How many tickets the action covers in total (bulk), for the wording. */
  total?: number
  statusLabel: string
  onCancel: () => void
  onConfirm: () => void
  /** Single ticket only: close the dialog and jump to the reply box. */
  onReplyFirst?: () => void
}

// A nudge, not a gate: resolving counts as the first response (Reports agree),
// so a technician never has to post "on it" just to stop the clock. But a
// requester who hears nothing until "resolved" may not know what was done, so
// this asks once before it happens.
export default function ResolveUnansweredDialog({
  open, unanswered, total, statusLabel, onCancel, onConfirm, onReplyFirst,
}: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open || unanswered.length === 0) return null

  const single = unanswered.length === 1 && (total ?? 1) === 1
  const ids = unanswered.slice(0, 6).map(t => t.display_id).join(', ') + (unanswered.length > 6 ? ` +${unanswered.length - 6} more` : '')

  // Portalled to <body> like DeleteTicketsDialog: the sidebar is sticky and
  // backdrop-filtered, which would trap a fixed-position modal inside it.
  return createPortal(
    <>
      <div className="scrim open" style={{ zIndex: 200 }} onClick={onCancel} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="resolve-unanswered-title"
        className="modal open"
        style={{ zIndex: 201, width: 'min(460px, 94vw)' }}
      >
        <h2 id="resolve-unanswered-title" style={{ margin: 0 }}>
          {single
            ? `Mark ${unanswered[0].display_id} ${statusLabel.toLowerCase()} without a reply?`
            : `${unanswered.length} of ${total ?? unanswered.length} tickets have no reply yet`}
        </h2>
        <p className="sub" style={{ margin: '8px 0 16px', lineHeight: 1.5 }}>
          {single
            ? 'The requester hasn’t had a reply from the team on this ticket. A short note on what was done helps them know it’s really sorted.'
            : <>No one from the team has replied on {ids}. A short note on what was done helps requesters know it’s really sorted.</>}
          {' '}You can still go ahead — it counts as answered either way.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
          {onReplyFirst && single && (
            <button type="button" className="btn ghost" onClick={onReplyFirst}>Write a reply first</button>
          )}
          <button type="button" className="btn" onClick={onConfirm} autoFocus>
            {single ? `Mark ${statusLabel.toLowerCase()}` : `Mark all ${statusLabel.toLowerCase()}`}
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}
