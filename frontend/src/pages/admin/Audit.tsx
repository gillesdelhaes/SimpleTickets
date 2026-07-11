import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import AdminPageShell from '../../components/admin/AdminPageShell'
import api from '../../lib/api'
import { parseUTC } from '../../types/ticket'
import { useAgents } from '../../hooks/useAgents'

interface AuditLogRead {
  id: number
  actor_id: number | null
  actor_name: string | null
  actor_email: string | null
  action: string
  entity_type: string
  entity_id: string | null
  payload: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
}

interface AuditLogResponse {
  items: AuditLogRead[]
  total: number
}

function ActionBadge({ action }: { action: string }) {
  return (
    <span className="inline-block font-mono text-[11px] font-semibold whitespace-nowrap px-2 py-0.5 rounded-md tracking-wide bg-field border border-edge text-ink-2">
      {action}
    </span>
  )
}

function formatDate(d: string) {
  return parseUTC(d).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const PAGE_SIZE = 50

const ENTITY_TYPES = ['', 'user', 'ticket', 'reply', 'category', 'sla_policy']

export default function Audit() {
  const navigate = useNavigate()
  const { data: agents } = useAgents()
  const [actionFilter, setActionFilter] = useState('')
  const [entityType, setEntityType] = useState('')
  const [entityId, setEntityId] = useState('')
  const [actorId, setActorId] = useState('')
  const [page, setPage] = useState(0)

  const params = new URLSearchParams()
  if (actionFilter) params.set('action', actionFilter)
  if (entityType) params.set('entity_type', entityType)
  if (entityId.trim()) params.set('entity_id', entityId.trim())
  if (actorId) params.set('actor_id', actorId)
  params.set('limit', String(PAGE_SIZE))
  params.set('offset', String(page * PAGE_SIZE))

  const { data, isLoading } = useQuery<AuditLogResponse>({
    queryKey: ['audit-log', { actionFilter, entityType, entityId, actorId, page }],
    queryFn: () => api.get<AuditLogResponse>(`/admin/audit?${params}`).then(r => r.data),
    staleTime: 15_000,
  })

  const items = data?.items ?? []
  const hasFilters = actionFilter || entityType || entityId || actorId

  const headers = ['Timestamp', 'Actor', 'Action', 'Entity', 'IP']

  return (
    <AdminPageShell title="Audit log">
      {/* Filters */}
      <div className="flex gap-2.5 mb-4 flex-wrap items-center">
        <input
          className="input font-mono"
          style={{ width: 210, fontSize: 12.5 }}
          value={actionFilter}
          onChange={e => { setActionFilter(e.target.value); setPage(0) }}
          placeholder="Action prefix (e.g. user.)"
        />

        <div className="selectwrap">
          <select
            className="select"
            style={{ width: 'auto', paddingRight: 32, ...(entityType ? {} : { color: 'var(--ink-3)' }) }}
            value={entityType}
            onChange={e => { setEntityType(e.target.value); setPage(0) }}
          >
            {ENTITY_TYPES.map(t => (
              <option key={t} value={t}>{t ? t.replace('_', ' ') : 'All entity types'}</option>
            ))}
          </select>
        </div>

        <input
          className="input font-mono"
          style={{ width: 110, fontSize: 12.5 }}
          value={entityId}
          onChange={e => { setEntityId(e.target.value); setPage(0) }}
          placeholder="Entity ID"
        />

        <div className="selectwrap">
          <select
            className="select"
            style={{ width: 'auto', paddingRight: 32, ...(actorId ? {} : { color: 'var(--ink-3)' }) }}
            value={actorId}
            onChange={e => { setActorId(e.target.value); setPage(0) }}
          >
            <option value="">All actors</option>
            {(agents ?? []).map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        {hasFilters && (
          <button
            onClick={() => { setActionFilter(''); setEntityType(''); setEntityId(''); setActorId(''); setPage(0) }}
            className="btn ghost sm"
          >
            Clear filters
          </button>
        )}

        <span className="ml-auto font-mono text-[11px] text-ink-3">
          {data ? `${data.total.toLocaleString()} total entries` : ''}
        </span>
      </div>

      {/* Table */}
      <section className="panel">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                {headers.map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}>
                    {[140, 160, 200, 100, 90].map((w, j) => (
                      <td key={j}>
                        <div style={{ height: 12, width: w, borderRadius: 6, background: 'var(--track)', animation: 'shimmer 1.5s ease-in-out infinite' }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '48px', textAlign: 'center', whiteSpace: 'normal' }} className="text-ink-3">
                    No audit entries match your filters.
                  </td>
                </tr>
              ) : (
                items.map(entry => (
                  <tr key={entry.id}>
                    <td>
                      <span className="font-mono text-[11px] text-ink-2">{formatDate(entry.created_at)}</span>
                    </td>
                    <td>
                      {entry.actor_name ? (
                        <div>
                          <div className="text-[12.5px] font-medium text-ink">{entry.actor_name}</div>
                          <div className="text-[11px] text-ink-3 mt-px">{entry.actor_email}</div>
                        </div>
                      ) : (
                        <span className="text-[12px] text-ink-3 italic">System</span>
                      )}
                    </td>
                    <td><ActionBadge action={entry.action} /></td>
                    <td>
                      <span className="text-[12.5px] text-ink font-medium">{entry.entity_type}</span>
                      {entry.entity_id && (
                        entry.entity_type === 'ticket' ? (
                          <span
                            onClick={() => navigate(`/tickets/${entry.entity_id}`)}
                            className="font-mono text-[11px] text-brand-ink ml-1.5 cursor-pointer underline"
                          >
                            #{entry.entity_id}
                          </span>
                        ) : (
                          <span className="font-mono text-[11px] text-ink-3 ml-1.5">#{entry.entity_id}</span>
                        )
                      )}
                    </td>
                    <td>
                      <span className="font-mono text-[11px] text-ink-3">{entry.ip_address ?? '—'}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-track">
            <span className="font-mono text-[11px] text-ink-3">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, data.total)} of {data.total.toLocaleString()}
            </span>
            <div className="flex gap-2">
              {[
                { label: 'Previous', dis: page === 0, fn: () => setPage(p => p - 1) },
                { label: 'Next', dis: (page + 1) * PAGE_SIZE >= data.total, fn: () => setPage(p => p + 1) },
              ].map(b => (
                <button
                  key={b.label}
                  onClick={b.fn}
                  disabled={b.dis}
                  className="btn ghost sm"
                  style={b.dis ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </AdminPageShell>
  )
}
