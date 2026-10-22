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

// ── Details column: one human-readable line per entry ─────────────────────────

type Payload = Record<string, unknown>

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (Array.isArray(v)) return v.length ? v.map(fmtValue).join(', ') : '—'
  if (typeof v === 'object') {
    const o = v as Payload
    if ('from' in o && 'to' in o) return `${fmtValue(o.from)} → ${fmtValue(o.to)}`
    return Object.entries(o).map(([k, x]) => `${k.replace(/_/g, ' ')}: ${fmtValue(x)}`).join(', ')
  }
  return String(v)
}

/** "name: a → b, archived: no → yes" from a {field: {from, to}} map. */
function fmtChanges(changes: unknown): string {
  if (!changes || typeof changes !== 'object') return ''
  return Object.entries(changes as Payload).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${fmtValue(v)}`).join(', ')
}

const minutes = (m: unknown) => {
  const n = Number(m)
  if (!Number.isFinite(n)) return fmtValue(m)
  return n % 60 === 0 ? `${n / 60}h` : n > 60 ? `${Math.floor(n / 60)}h ${n % 60}m` : `${n}m`
}

const DESCRIBE: Record<string, (p: Payload) => string> = {
  'instance.initialized': p => `Instance initialized — first admin ${fmtValue(p.admin_email)}` +
    (Array.isArray(p.slack_workspaces) && p.slack_workspaces.length ? `, Slack: ${fmtValue(p.slack_workspaces)}` : ', no Slack workspace'),
  'user.login': p => p.provider === 'google' ? 'Signed in with Google' : 'Signed in',
  'user.login_failed': p => `Failed sign-in for ${fmtValue(p.email)}${p.provider === 'google' ? ' (Google)' : ''} — ${fmtValue(p.reason)}`,
  'user.logout': () => 'Signed out',
  'user.password_changed': () => 'Changed own password — other sessions signed out',
  'user.password_change_failed': p => `Password change failed — ${fmtValue(p.reason)}`,
  'user.password_set': p => `Set password for ${fmtValue(p.email)}` + (p.auth_provider ? ` (sign-in ${fmtValue(p.auth_provider)})` : ''),
  'user.password_reset_requested': () => 'Requested a password-reset code via Slack',
  'user.password_reset_completed': () => 'Reset password with a Slack code',
  'user.created': p => `Created ${fmtValue(p.email)} — ${fmtValue(p.role)}, ${p.auth_provider === 'google' ? 'Google sign-in' : 'password sign-in'}`,
  'user.role_changed': p => `${fmtValue(p.email)}: role ${fmtValue(p.from)} → ${fmtValue(p.to)}`,
  'user.activated': p => `Activated ${fmtValue(p.email)}`,
  'user.deactivated': p => `Deactivated ${fmtValue(p.email)}`,
  'user.auth_provider_changed': p => `${fmtValue(p.email)}: sign-in ${fmtValue(p.from)} → ${fmtValue(p.to)}`,
  'user.slack_linked': p => `${fmtValue(p.email)} linked to Slack ${fmtValue(p.slack_user_id)} in ${fmtValue(p.workspace)}` +
    (p.previous_slack_user_id ? ` (was ${fmtValue(p.previous_slack_user_id)})` : '') +
    (p.confirmed_in_slack ? ' — confirmed in Slack' : ''),
  'user.slack_unlinked': p => `${fmtValue(p.email)} unlinked Slack ${fmtValue(p.slack_user_id)} in ${fmtValue(p.workspace)}`,
  'user.slack_link_requested': p => `Asked to link Slack ${fmtValue(p.slack_user_id)} in ${fmtValue(p.workspace)} — confirmation DM sent`,
  'user.slack_link_declined': p => `Slack ${fmtValue(p.slack_user_id)} in ${fmtValue(p.workspace)} answered "Not me" to ${fmtValue(p.email)}'s link request`,
  'user.slack_link_cancelled': p => `Cancelled pending link to Slack ${fmtValue(p.slack_user_id)} in ${fmtValue(p.workspace)}`,
  'category.created': p => `Created category "${fmtValue(p.name)}"`,
  'category.updated': p => `Category "${fmtValue(p.name)}": ${fmtChanges(p.changes)}`,
  'category.archived': p => `Archived category "${fmtValue(p.name)}"`,
  'category.unarchived': p => `Restored category "${fmtValue(p.name)}"`,
  'sla_policy.created': p => `Created SLA "${fmtValue(p.name)}" (${fmtValue(p.priority)}) — first response ${minutes(p.first_response_minutes)}, resolution ${minutes(p.resolution_minutes)}`,
  'sla_policy.updated': p => `SLA "${fmtValue(p.name)}" (${fmtValue(p.priority)}): ` + Object.entries((p.changes ?? {}) as Payload)
    .map(([k, v]) => {
      const c = v as Payload
      return k.endsWith('_minutes')
        ? `${k.replace('_minutes', '').replace(/_/g, ' ')} ${minutes(c.from)} → ${minutes(c.to)}`
        : `${k} ${fmtValue(v)}`
    }).join(', '),
  'sla_policy.deleted': p => `Deleted SLA "${fmtValue(p.name)}" (${fmtValue(p.priority)})`,
  'settings.updated': p => `Changed settings: ${fmtValue(p.keys)}`,
  'slack_workspace.created': p => `Connected workspace "${fmtValue(p.name)}"${p.team_name ? ` (${fmtValue(p.team_name)})` : ''}`,
  'slack_workspace.updated': p => `Workspace settings changed: ${fmtValue(p.keys)}`,
  'backup.downloaded': p => `Downloaded backup (${fmtValue(p.attachments)} attachments)`,
  'backup.restored': p => `Restored from backup (${fmtValue(p.restored_files)} files)`,
}

function describe(entry: AuditLogRead): string {
  const p = entry.payload ?? {}
  const fn = DESCRIBE[entry.action]
  if (fn) return fn(p)
  // Unknown or older entries: list the payload as "key: value" pairs.
  return Object.keys(p).length ? fmtValue(p) : ''
}

function formatDate(d: string) {
  return parseUTC(d).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const PAGE_SIZE = 50

const ENTITY_TYPES = ['', 'instance', 'user', 'ticket', 'reply', 'category', 'sla_policy', 'settings', 'slack_workspace', 'backup']

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

  const headers = ['Timestamp', 'Actor', 'Action', 'Details', 'Entity', 'IP']

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
                    {[140, 160, 200, 260, 100, 90].map((w, j) => (
                      <td key={j}>
                        <div style={{ height: 12, width: w, borderRadius: 6, background: 'var(--track)', animation: 'shimmer 1.5s ease-in-out infinite' }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '48px', textAlign: 'center', whiteSpace: 'normal' }} className="text-ink-3">
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
                    <td style={{ whiteSpace: 'normal', minWidth: 220, maxWidth: 420 }}>
                      <span className="text-[12.5px] text-ink-2 leading-snug">{describe(entry) || '—'}</span>
                    </td>
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
