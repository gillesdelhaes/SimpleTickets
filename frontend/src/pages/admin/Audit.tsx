import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import AdminPageShell from '../../components/admin/AdminPageShell'
import api from '../../lib/api'

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

// ── Action badge ───────────────────────────────────────────────────────────────

const ACTION_COLORS: Record<string, { color: string; bg: string; border: string }> = {
  'user.': { color: '#3B82F6', bg: '#EFF6FF', border: '#BFDBFE' },
  'ticket.': { color: '#FF4713', bg: '#FFF5F0', border: '#FECACA' },
  'reply.': { color: '#10B981', bg: '#F0FDF4', border: '#6EE7B7' },
}

function getActionStyle(action: string) {
  for (const prefix of Object.keys(ACTION_COLORS)) {
    if (action.startsWith(prefix)) return ACTION_COLORS[prefix]
  }
  return { color: '#737373', bg: '#F9F9F9', border: '#E5E5E5' }
}

function ActionBadge({ action }: { action: string }) {
  const style = getActionStyle(action)
  return (
    <span
      style={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
        fontWeight: 600,
        color: style.color,
        background: style.bg,
        border: `1px solid ${style.border}`,
        borderLeft: `3px solid ${style.color}`,
        borderRadius: '0 5px 5px 0',
        padding: '3px 8px 3px 7px',
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
        display: 'inline-block',
      }}
    >
      {action}
    </span>
  )
}

function formatDate(d: string) {
  return new Date(d).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const PAGE_SIZE = 50

const ENTITY_TYPES = ['', 'user', 'ticket', 'reply', 'category', 'sla_policy']

export default function Audit() {
  const navigate = useNavigate()
  const [actionFilter, setActionFilter] = useState('')
  const [entityType, setEntityType] = useState('')
  const [actorSearch, setActorSearch] = useState('')
  const [page, setPage] = useState(0)

  const params = new URLSearchParams()
  if (actionFilter) params.set('action', actionFilter)
  if (entityType) params.set('entity_type', entityType)
  params.set('limit', String(PAGE_SIZE))
  params.set('offset', String(page * PAGE_SIZE))

  const { data, isLoading } = useQuery<AuditLogResponse>({
    queryKey: ['audit-log', { actionFilter, entityType, page }],
    queryFn: () => api.get<AuditLogResponse>(`/admin/audit?${params}`).then(r => r.data),
    staleTime: 15_000,
  })

  // client-side actor name filter
  const items = actorSearch.trim()
    ? (data?.items ?? []).filter(e =>
        e.actor_name?.toLowerCase().includes(actorSearch.toLowerCase()) ||
        e.actor_email?.toLowerCase().includes(actorSearch.toLowerCase())
      )
    : (data?.items ?? [])

  const headers = ['Timestamp', 'Actor', 'Action', 'Entity', 'IP']

  return (
    <AdminPageShell title="Audit Log">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0A0A0A', letterSpacing: '-0.02em', margin: 0 }}>Audit Log</h1>
        <p style={{ fontSize: 13, color: '#737373', marginTop: 3 }}>
          Immutable record of all significant system actions.
        </p>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={actionFilter}
          onChange={e => { setActionFilter(e.target.value); setPage(0) }}
          placeholder="Action prefix (e.g. user.)"
          style={{ padding: '7px 12px', borderRadius: 8, border: '1.5px solid #E5E5E5', fontSize: 14, color: '#262626', outline: 'none', fontFamily: 'JetBrains Mono, monospace', width: 200, transition: 'border-color 0.15s' }}
          onFocus={e => (e.currentTarget.style.borderColor = '#FF4713')}
          onBlur={e => (e.currentTarget.style.borderColor = '#E5E5E5')}
        />

        <select
          value={entityType}
          onChange={e => { setEntityType(e.target.value); setPage(0) }}
          style={{ padding: '7px 28px 7px 12px', borderRadius: 8, border: '1.5px solid #E5E5E5', fontSize: 14, color: entityType ? '#262626' : '#A3A3A3', outline: 'none', background: '#fff', cursor: 'pointer', appearance: 'none',
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none'%3E%3Cpath d='M6 9l6 6 6-6' stroke='%23737373' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', fontFamily: 'Inter, system-ui, sans-serif' }}>
          {ENTITY_TYPES.map(t => (
            <option key={t} value={t}>{t ? t.replace('_', ' ') : 'All entity types'}</option>
          ))}
        </select>

        <input
          value={actorSearch}
          onChange={e => setActorSearch(e.target.value)}
          placeholder="Filter by actor…"
          style={{ padding: '7px 12px', borderRadius: 8, border: '1.5px solid #E5E5E5', fontSize: 14, color: '#262626', outline: 'none', fontFamily: 'Inter, system-ui, sans-serif', width: 180, transition: 'border-color 0.15s' }}
          onFocus={e => (e.currentTarget.style.borderColor = '#FF4713')}
          onBlur={e => (e.currentTarget.style.borderColor = '#E5E5E5')}
        />

        {(actionFilter || entityType || actorSearch) && (
          <button
            onClick={() => { setActionFilter(''); setEntityType(''); setActorSearch(''); setPage(0) }}
            style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid #E5E5E5', background: '#fff', fontSize: 12, color: '#737373', cursor: 'pointer' }}>
            Clear filters
          </button>
        )}

        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#A3A3A3' }}>
          {data ? `${data.total.toLocaleString()} total entries` : ''}
        </span>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', border: '1px solid #E5E5E5', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #F2F2F2' }}>
                {headers.map(h => (
                  <th key={h} style={{ padding: '9px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#A3A3A3', textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #F9F9F9' }}>
                    {[140, 160, 200, 100, 90].map((w, j) => (
                      <td key={j} style={{ padding: '11px 16px' }}>
                        <div style={{ height: 12, width: w, borderRadius: 4, background: '#F2F2F2', animation: 'shimmer 1.5s ease-in-out infinite' }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '48px', textAlign: 'center', color: '#A3A3A3', fontSize: 14 }}>
                    No audit entries match your filters.
                  </td>
                </tr>
              ) : (
                items.map(entry => (
                  <tr
                    key={entry.id}
                    style={{ borderBottom: '1px solid #F9F9F9', transition: 'background 0.1s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#FAFAFA')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {/* Timestamp */}
                    <td style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#737373' }}>
                        {formatDate(entry.created_at)}
                      </span>
                    </td>
                    {/* Actor */}
                    <td style={{ padding: '11px 16px' }}>
                      {entry.actor_name ? (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 500, color: '#262626' }}>{entry.actor_name}</div>
                          <div style={{ fontSize: 11, color: '#A3A3A3', marginTop: 1 }}>{entry.actor_email}</div>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: '#A3A3A3', fontStyle: 'italic' }}>System</span>
                      )}
                    </td>
                    {/* Action */}
                    <td style={{ padding: '11px 16px' }}>
                      <ActionBadge action={entry.action} />
                    </td>
                    {/* Entity */}
                    <td style={{ padding: '11px 16px' }}>
                      <span style={{ fontSize: 12, color: '#262626', fontWeight: 500 }}>
                        {entry.entity_type}
                      </span>
                      {entry.entity_id && (
                        entry.entity_type === 'ticket' ? (
                          <span
                            onClick={() => navigate(`/tickets/${entry.entity_id}`)}
                            style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6366F1', marginLeft: 5, cursor: 'pointer', textDecoration: 'underline' }}
                          >
                            #{entry.entity_id}
                          </span>
                        ) : (
                          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#A3A3A3', marginLeft: 5 }}>
                            #{entry.entity_id}
                          </span>
                        )
                      )}
                    </td>
                    {/* IP */}
                    <td style={{ padding: '11px 16px' }}>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#C0C0C0' }}>
                        {entry.ip_address ?? '—'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.total > PAGE_SIZE && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid #F2F2F2', background: '#FAFAFA' }}>
            <span style={{ fontSize: 12, color: '#737373' }}>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, data.total)} of {data.total.toLocaleString()}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { label: '← Prev', dis: page === 0, fn: () => setPage(p => p - 1) },
                { label: 'Next →', dis: (page + 1) * PAGE_SIZE >= data.total, fn: () => setPage(p => p + 1) },
              ].map(b => (
                <button key={b.label} onClick={b.fn} disabled={b.dis}
                  style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500, border: '1px solid #E5E5E5', background: b.dis ? '#F9F9F9' : '#fff', color: b.dis ? '#C0C0C0' : '#262626', cursor: b.dis ? 'not-allowed' : 'pointer' }}>
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes shimmer { 0%,100% { opacity:1; } 50% { opacity:0.4; } }`}</style>
    </AdminPageShell>
  )
}
