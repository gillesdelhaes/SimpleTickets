import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import api, { apiErrorMessage } from '../../lib/api'
import { useSlackUsers, type SlackUser } from '../../hooks/useSlackUsers'
import { useWorkspaceOptions } from '../../hooks/useWorkspaces'
import type { TicketRead } from '../../types/ticket'

// Email requester ↔ Slack user, so their email and Slack tickets count as one
// person. Matched automatically by address when Slack allows it; this is the
// manual fallback (personal addresses, vendors) and the way to undo a match.
// Identity only — replies on the ticket still go by email.
export default function RequesterSlackLink({ ticket, canEdit }: { ticket: TicketRead; canEdit: boolean }) {
  const qc = useQueryClient()
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  const [workspaceId, setWorkspaceId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const { data: workspaces = [] } = useWorkspaceOptions()
  const ws = workspaceId ?? (workspaces.length === 1 ? workspaces[0].id : null)
  const { data: users = [], isLoading } = useSlackUsers(picking ? ws : null)

  useEffect(() => { setPicking(false); setError(null) }, [ticket.id])
  useEffect(() => { if (picking) searchRef.current?.focus() }, [picking, ws])

  const mutation = useMutation({
    mutationFn: async (user: SlackUser | null) => (user
      ? await api.put<TicketRead>(`/tickets/${ticket.id}/slack-link`, { workspace_id: ws, slack_user_id: user.id })
      : await api.delete<TicketRead>(`/tickets/${ticket.id}/slack-link`)).data,
    onSuccess: updated => {
      qc.setQueryData(['ticket', ticket.id], updated)
      qc.invalidateQueries({ queryKey: ['requester-tickets'] })
      qc.invalidateQueries({ queryKey: ['ticket-history', ticket.id] })
      qc.invalidateQueries({ queryKey: ['tickets'] })
      setPicking(false); setQuery(''); setError(null)
    },
    onError: err => setError(apiErrorMessage(err, 'Linking failed.')),
  })

  if (ticket.channel !== 'email' || ticket.submitter_id != null || !ticket.email_requester) return null

  const linked = ticket.linked_slack_name
  const term = query.trim().toLowerCase()
  const matches = users.filter(u => !term || u.name.toLowerCase().includes(term)).slice(0, 50)

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-3">Slack account</span>

      {!picking && (
        <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
          {linked ? (
            <span className="text-ink" title={ticket.slack_link_source === 'auto' ? 'Matched by email address' : 'Linked by a technician'}>
              {linked}
              <span className="text-ink-3"> · {ticket.slack_link_source === 'auto' ? 'matched by email' : 'linked'}</span>
            </span>
          ) : (
            <span className="text-ink-3">Not linked</span>
          )}
          {canEdit && (
            <>
              <button type="button" className="bg-transparent border-0 p-0 cursor-pointer text-[12px] font-medium text-brand-ink hover:underline" onClick={() => setPicking(true)}>
                {linked ? 'Change' : 'Link to Slack user'}
              </button>
              {linked && (
                <button
                  type="button"
                  className="bg-transparent border-0 p-0 cursor-pointer text-[12px] font-medium text-ink-3 hover:text-danger-ink"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate(null)}
                >
                  Unlink
                </button>
              )}
            </>
          )}
        </div>
      )}

      {picking && (
        <div className="flex flex-col gap-1.5">
          {workspaces.length > 1 && (
            <div className="selectwrap">
              <select className="select" value={ws ?? ''} onChange={e => setWorkspaceId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Choose a workspace…</option>
                {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          )}
          {workspaces.length === 0 ? (
            <span className="text-[12px] text-ink-3">No Slack workspace is connected.</span>
          ) : ws != null && (
            <>
              <input
                ref={searchRef}
                className="input"
                style={{ fontSize: 12.5, padding: '6px 10px' }}
                placeholder="Type a name…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setPicking(false) }}
              />
              <div className="flex flex-col overflow-y-auto scrollbar-thin rounded-lg border border-edge" style={{ maxHeight: 200 }}>
                {isLoading ? (
                  <span className="px-2.5 py-2 text-[12px] text-ink-3">Loading people…</span>
                ) : matches.length === 0 ? (
                  <span className="px-2.5 py-2 text-[12px] text-ink-3">No one matches.</span>
                ) : matches.map(u => (
                  <button
                    key={u.id}
                    type="button"
                    disabled={mutation.isPending}
                    onClick={() => mutation.mutate(u)}
                    className="text-left bg-transparent border-0 cursor-pointer px-2.5 py-1.5 text-[12.5px] text-ink hover:bg-field"
                  >
                    {u.name}
                  </button>
                ))}
              </div>
            </>
          )}
          <button type="button" className="self-start bg-transparent border-0 p-0 cursor-pointer text-[12px] text-ink-3 hover:text-ink" onClick={() => { setPicking(false); setError(null) }}>
            Cancel
          </button>
        </div>
      )}

      {error && <span className="text-[12px] text-danger-ink">{error}</span>}
    </div>
  )
}
