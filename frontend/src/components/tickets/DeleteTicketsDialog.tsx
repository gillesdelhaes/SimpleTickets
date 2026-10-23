import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import api, { apiErrorMessage } from '../../lib/api'

interface Props {
  open: boolean
  onClose: () => void
  /** Tickets to delete: one ({id, display_id}) or many. */
  tickets: { id: number; display_id: string }[]
  onDeleted: () => void
}

// Admin-only permanent delete. The admin types the ticket ID (or DELETE for a
// bulk delete) and gives a reason, which lands in the audit log — the only
// trace left once the ticket, its replies, history and files are gone.
export default function DeleteTicketsDialog({ open, onClose, tickets, onDeleted }: Props) {
  const queryClient = useQueryClient()
  const [typed, setTyped] = useState('')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const single = tickets.length === 1
  const confirmWord = single ? tickets[0].display_id : 'DELETE'
  const canDelete = typed.trim().toUpperCase() === confirmWord.toUpperCase() && reason.trim().length > 0 && !pending

  useEffect(() => {
    if (open) { setTyped(''); setReason(''); setError(null); setPending(false) }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !pending) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, pending, onClose])

  if (!open) return null

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault()
    if (!canDelete) return
    setPending(true)
    setError(null)
    try {
      if (single) {
        await api.post(`/tickets/${tickets[0].id}/delete`, { reason: reason.trim() })
      } else {
        await api.post('/tickets/bulk-delete', { ids: tickets.map(t => t.id), reason: reason.trim() })
      }
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      onDeleted()
    } catch (err) {
      setError(apiErrorMessage(err, 'Delete failed — please try again.'))
      setPending(false)
    }
  }

  const what = single ? tickets[0].display_id : `${tickets.length} tickets`

  // Portalled to <body>: opened from the sticky, backdrop-filtered sidebar, a
  // fixed-position modal would otherwise be positioned inside that panel.
  return createPortal(
    <>
      <div className="scrim open" style={{ zIndex: 200 }} onClick={() => !pending && onClose()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Delete ${what}`}
        className="modal open"
        style={{ zIndex: 201, width: 'min(460px, 94vw)' }}
      >
        <h2 style={{ margin: 0 }}>Delete {what}?</h2>
        <p className="sub" style={{ margin: '8px 0 16px', lineHeight: 1.5 }}>
          This permanently removes {single ? 'the ticket' : 'these tickets'} with all replies, history,
          attachments and survey answers. It can't be undone — only an audit-log entry remains.
          {' '}To keep a record instead, use <b>Close without survey</b>.
        </p>
        <form onSubmit={handleDelete}>
          <div className="fieldrow">
            <label htmlFor="del-reason">Reason</label>
            <input
              id="del-reason"
              className="input"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. test ticket, created by mistake"
              autoFocus
            />
          </div>
          <div className="fieldrow">
            <label htmlFor="del-confirm">
              <span>Type <b className="font-mono" style={{ color: 'var(--ink)' }}>{confirmWord}</b> to confirm</span>
            </label>
            <input
              id="del-confirm"
              className="input font-mono"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {error && (
            <div className="rounded-control px-3 py-2 mb-3 text-[12.5px] text-danger-ink" style={{ background: 'var(--danger-bg)' }}>
              {error}
            </div>
          )}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose} disabled={pending}>Cancel</button>
            <button
              type="submit"
              className="btn"
              disabled={!canDelete}
              style={{
                background: 'var(--danger-ink)', boxShadow: 'none',
                ...(!canDelete ? { opacity: 0.45, cursor: 'not-allowed' } : {}),
              }}
            >
              {pending ? 'Deleting…' : `Delete ${what}`}
            </button>
          </div>
        </form>
      </div>
    </>,
    document.body,
  )
}
