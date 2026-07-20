import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import AppShell from '../components/layout/AppShell'
import StatusBadge from '../components/tickets/StatusBadge'
import PriorityBadge from '../components/tickets/PriorityBadge'
import SLABadge from '../components/tickets/SLABadge'
import CreateTicketModal from '../components/tickets/CreateTicketModal'
import { useTickets } from '../hooks/useTickets'
import { useCategories } from '../hooks/useCategories'
import { useSavedQueueViews } from '../hooks/useSavedQueueViews'
import { useAuth } from '../contexts/AuthContext'
import { useUnreadReplies } from '../hooks/useUnreadReplies'
import { getAllStatuses, timeAgo, PRIORITY_LABELS, type Priority } from '../types/ticket'
import { useAppConfig } from '../hooks/useAppConfig'
import { useWorkspaceOptions } from '../hooks/useWorkspaces'
import api, { apiErrorMessage } from '../lib/api'

const PAGE_SIZE = 25

const ALL_PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low']

// ── Filter chips ───────────────────────────────────────────────────────────────

interface ChipProps {
  label: string
  active: boolean
  onClick: () => void
}

function FilterChip({ label, active, onClick }: ChipProps) {
  return (
    <button type="button" onClick={onClick} className={`chip${active ? ' on' : ''}`}>
      {label}
    </button>
  )
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-3 mr-1 whitespace-nowrap">
      {children}
    </span>
  )
}

// ── Pagination ─────────────────────────────────────────────────────────────────

interface PaginationProps {
  page: number
  total: number
  pageSize: number
  onPrev: () => void
  onNext: () => void
}

function Pagination({ page, total, pageSize, onPrev, onNext }: PaginationProps) {
  const start = page * pageSize + 1
  const end = Math.min((page + 1) * pageSize, total)
  const hasPrev = page > 0
  const hasNext = end < total

  return (
    <div className="flex items-center justify-between px-6 py-3 border-t border-track">
      <span className="font-mono text-[11px] text-ink-3">
        {total === 0 ? 'No tickets' : `${start}–${end} of ${total}`}
      </span>
      <div className="flex gap-2">
        <button
          onClick={onPrev}
          disabled={!hasPrev}
          className="btn ghost sm"
          style={!hasPrev ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
        >
          Previous
        </button>
        <button
          onClick={onNext}
          disabled={!hasNext}
          className="btn ghost sm"
          style={!hasNext ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
        >
          Next
        </button>
      </div>
    </div>
  )
}

// ── Queue page ─────────────────────────────────────────────────────────────────

type SortCol = 'priority' | 'status' | 'created_at' | 'sla'
type SortDir = 'asc' | 'desc'

export default function Queue() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { data: appConfig } = useAppConfig()
  const { data: categories } = useCategories()
  const { data: workspaces } = useWorkspaceOptions()
  // Only worth a label once there's more than one workspace to disambiguate —
  // keeps the common single-workspace install decluttered.
  const showWorkspaceLabel = (workspaces?.length ?? 0) > 1
  const allStatuses = appConfig?.statuses ?? getAllStatuses()
  const statusOrder: Record<string, number> = Object.fromEntries(
    allStatuses.map((s, i) => [s.name, i])
  )
  const [searchParams, setSearchParams] = useSearchParams()
  const [sortCol, setSortCol] = useState<SortCol>('priority')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [createOpen, setCreateOpen] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkAssignId, setBulkAssignId] = useState<string>('')
  const [bulkPriority, setBulkPriority] = useState<string>('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const { views: savedViews, saveView, deleteView } = useSavedQueueViews()
  const [namingView, setNamingView] = useState(false)
  const [newViewName, setNewViewName] = useState('')

  // Read filters from URL
  const selectedStatuses = searchParams.getAll('status')
  const selectedPriorities = searchParams.getAll('priority') as Priority[]
  const assigneeFilter = searchParams.get('assignee') ?? 'all'
  const categoryFilter = searchParams.get('category') ?? 'all'
  const page = parseInt(searchParams.get('page') ?? '0', 10)

  // Derive API params — default to non-resolved statuses when no explicit filter is set
  const activeStatusNames = allStatuses.filter(s => !s.is_resolved_state).map(s => s.name)
  const statusParam = selectedStatuses.length > 0 ? selectedStatuses : activeStatusNames
  const priorityParam = selectedPriorities.length > 0 ? selectedPriorities : undefined
  const assigneeIdParam: number | undefined =
    assigneeFilter === 'mine' ? (user?.id ?? undefined) : undefined
  const unassignedParam = assigneeFilter === 'unassigned'
  const categoryIdParam: number | undefined =
    categoryFilter !== 'all' ? Number(categoryFilter) : undefined

  // Map UI sort column to API sort param (status stays client-side — dynamic ordering)
  const apiSort = sortCol === 'status' ? undefined : sortCol === 'sla' ? 'sla_deadline' : sortCol
  const apiSortDir = sortCol === 'status' ? undefined : sortDir

  const { data, isLoading } = useTickets({
    status: statusParam,
    priority: priorityParam,
    assignee_id: assigneeIdParam,
    unassigned: unassignedParam,
    category_id: categoryIdParam,
    sort: apiSort,
    sort_dir: apiSortDir,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })
  const { data: unreadData } = useUnreadReplies()
  const unreadSet = new Set(unreadData?.ticket_ids_with_unread ?? [])

  // ── Filter helpers ─────────────────────────────────────────────────────────

  function setParam(key: string, values: string[]) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete(key)
      values.forEach(v => next.append(key, v))
      next.set('page', '0')
      return next
    })
  }

  function toggleStatus(s: string) {
    const next = selectedStatuses.includes(s)
      ? selectedStatuses.filter(x => x !== s)
      : [...selectedStatuses, s]
    setParam('status', next)
  }

  function togglePriority(p: Priority) {
    const next = selectedPriorities.includes(p)
      ? selectedPriorities.filter(x => x !== p)
      : [...selectedPriorities, p]
    setParam('priority', next)
  }

  function setAssignee(val: string) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('assignee', val)
      next.set('page', '0')
      return next
    })
  }

  function setCategory(val: string) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('category', val)
      next.set('page', '0')
      return next
    })
  }

  // ── Saved views ────────────────────────────────────────────────────────────

  function currentFilterQuery(): string {
    const q = new URLSearchParams(searchParams)
    q.delete('page')
    return q.toString()
  }

  function applyView(query: string) {
    setSearchParams(new URLSearchParams(query))
  }

  function handleSaveView(e: React.FormEvent) {
    e.preventDefault()
    const name = newViewName.trim()
    if (!name) return
    saveView(name, currentFilterQuery())
    setNewViewName('')
    setNamingView(false)
  }

  async function handleClaim(e: React.MouseEvent, ticketId: number) {
    e.stopPropagation()
    try {
      await api.patch(`/tickets/${ticketId}`, { assignee_id: user?.id })
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
    } catch (err) {
      setBulkError(apiErrorMessage(err, 'Failed to claim the ticket — please try again.'))
    }
  }

  function setPage(p: number) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('page', String(p))
      return next
    })
  }

  // Technicians list for bulk assign (tech-accessible endpoint)
  const { data: technicians } = useQuery<{ id: number; name: string }[]>({
    queryKey: ['assignees'],
    queryFn: async () => {
      const { data } = await api.get<{ id: number; name: string }[]>('/reports/assignees')
      return data
    },
    staleTime: 5 * 60_000,
  })

  function toggleSelect(e: React.MouseEvent, id: number) {
    e.stopPropagation()
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === sortedItems.length && sortedItems.length > 0) {
      setSelected(new Set())
    } else {
      setSelected(new Set(sortedItems.map(t => t.id)))
    }
  }

  async function bulkAction(payload: Record<string, unknown>) {
    if (selected.size === 0) return
    setBulkLoading(true)
    setBulkError(null)
    try {
      await api.patch('/tickets/bulk', { ids: [...selected], ...payload })
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      setSelected(new Set())
      setBulkAssignId('')
      setBulkPriority('')
    } catch (err: any) {
      setBulkError(apiErrorMessage(err, 'Bulk update failed — please try again.'))
    } finally {
      setBulkLoading(false)
    }
  }

  // Technicians can't bulk-close (terminal resolved state with no survey) — that
  // would skip CSAT. They only get survey-sending resolved states (e.g. Resolved).
  const isAdmin = user?.role === 'admin'
  const resolvedStatuses = allStatuses.filter(s =>
    s.is_resolved_state && (isAdmin || s.sends_csat)
  )

  // Status sort is client-side only (dynamic ordering from appConfig); everything
  // else is sorted by the server via sort/sort_dir query params.
  const sortedItems = sortCol === 'status' && data?.items
    ? [...data.items].sort((a, b) => {
        const cmp = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99)
        return sortDir === 'asc' ? cmp : -cmp
      })
    : (data?.items ?? [])

  function handleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  return (
    <AppShell title="Queue">
      <CreateTicketModal open={createOpen} onClose={() => setCreateOpen(false)} />

      {/* Filter bar */}
      <div className="panel px-5 py-4 mb-3.5 flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <FilterLabel>Status</FilterLabel>
          <FilterChip
            label="Active"
            active={selectedStatuses.length === 0}
            onClick={() => setParam('status', [])}
          />
          {allStatuses.map(s => (
            <FilterChip
              key={s.name}
              label={s.label}
              active={selectedStatuses.includes(s.name)}
              onClick={() => toggleStatus(s.name)}
            />
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <FilterLabel>Priority</FilterLabel>
          <FilterChip
            label="All"
            active={selectedPriorities.length === 0}
            onClick={() => setParam('priority', [])}
          />
          {ALL_PRIORITIES.map(p => (
            <FilterChip
              key={p}
              label={PRIORITY_LABELS[p]}
              active={selectedPriorities.includes(p)}
              onClick={() => togglePriority(p)}
            />
          ))}

          <span className="ml-3" />
          <FilterLabel>Assignee</FilterLabel>
          {[
            { val: 'all', label: 'All' },
            { val: 'mine', label: 'Mine' },
            { val: 'unassigned', label: 'Unassigned' },
          ].map(({ val, label }) => (
            <FilterChip
              key={val}
              label={label}
              active={assigneeFilter === val}
              onClick={() => setAssignee(val)}
            />
          ))}
        </div>

        {categories && categories.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <FilterLabel>Category</FilterLabel>
            <FilterChip label="All" active={categoryFilter === 'all'} onClick={() => setCategory('all')} />
            {categories.map(c => (
              <FilterChip
                key={c.id}
                label={c.name}
                active={categoryFilter === String(c.id)}
                onClick={() => setCategory(String(c.id))}
              />
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <FilterLabel>Views</FilterLabel>
          {savedViews.map(v => (
            <span key={v.id} className={`chip${currentFilterQuery() === v.query ? ' on' : ''}`} style={{ paddingRight: 8 }}>
              <button
                type="button"
                onClick={() => applyView(v.query)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit' }}
              >
                {v.name}
              </button>
              <button
                type="button"
                onClick={() => deleteView(v.id)}
                aria-label={`Delete view ${v.name}`}
                className="text-ink-3 hover:text-danger-ink"
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', opacity: 0.7 }}
              >
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M1 1l8 8M9 1l-8 8" />
                </svg>
              </button>
            </span>
          ))}

          {namingView ? (
            <form onSubmit={handleSaveView} className="flex items-center gap-1.5">
              <input
                className="input"
                style={{ width: 170, padding: '5px 11px', fontSize: 12.5 }}
                autoFocus
                value={newViewName}
                onChange={e => setNewViewName(e.target.value)}
                placeholder="View name…"
                onKeyDown={e => { if (e.key === 'Escape') { setNamingView(false); setNewViewName('') } }}
              />
              <button type="submit" className="btn ghost sm" disabled={!newViewName.trim()}>Save</button>
              <button type="button" className="btn ghost sm" onClick={() => { setNamingView(false); setNewViewName('') }}>Cancel</button>
            </form>
          ) : (
            <FilterChip label="+ Save current filters" active={false} onClick={() => setNamingView(true)} />
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div
          className="flex items-center gap-3 flex-wrap mb-3 px-4 py-2.5 rounded-block"
          style={{ background: 'var(--brand-tint)', border: '1px solid color-mix(in oklab, var(--b1) 30%, transparent)' }}
        >
          <span className="text-[12px] font-bold text-brand-ink whitespace-nowrap">
            {selected.size} selected
          </span>
          <div className="flex items-center gap-1.5">
            <div className="selectwrap">
              <select
                className="select"
                style={{ padding: '6px 28px 6px 11px', fontSize: 12, width: 'auto' }}
                value={bulkAssignId}
                onChange={e => setBulkAssignId(e.target.value)}
                disabled={bulkLoading}
              >
                <option value="">Assign to…</option>
                {technicians?.map(t => (
                  <option key={t.id} value={String(t.id)}>{t.name}</option>
                ))}
              </select>
            </div>
            {bulkAssignId && (
              <button
                onClick={() => bulkAction({ assignee_id: Number(bulkAssignId) })}
                disabled={bulkLoading}
                className="btn sm"
              >
                Apply
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <div className="selectwrap">
              <select
                className="select"
                style={{ padding: '6px 28px 6px 11px', fontSize: 12, width: 'auto' }}
                value={bulkPriority}
                onChange={e => setBulkPriority(e.target.value)}
                disabled={bulkLoading}
              >
                <option value="">Set priority…</option>
                {ALL_PRIORITIES.map(p => (
                  <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                ))}
              </select>
            </div>
            {bulkPriority && (
              <button
                onClick={() => bulkAction({ priority: bulkPriority })}
                disabled={bulkLoading}
                className="btn sm"
              >
                Apply
              </button>
            )}
          </div>
          {resolvedStatuses.map(s => (
            <button
              key={s.name}
              onClick={() => bulkAction({ status: s.name })}
              disabled={bulkLoading}
              className="btn ghost sm"
            >
              ✓ {s.label}
            </button>
          ))}
          <button
            onClick={() => setSelected(new Set())}
            className="btn ghost sm ml-auto"
          >
            Clear
          </button>
        </div>
      )}

      {bulkError && (
        <div
          className="mb-3 px-3.5 py-2 rounded-control text-[12px] text-danger-ink"
          style={{ background: 'var(--danger-bg)' }}
        >
          {bulkError}
        </div>
      )}

      {/* Table */}
      <section className="panel">
        <div className="panel-head">
          <h2>All tickets</h2>
          {data && <span className="sub mono">{data.total} total</span>}
          <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setCreateOpen(true)}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M7 2v10M2 7h10" />
            </svg>
            New ticket
          </button>
        </div>

        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all tickets"
                    checked={sortedItems.length > 0 && selected.size === sortedItems.length}
                    ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < sortedItems.length }}
                    onChange={toggleSelectAll}
                    style={{ cursor: 'pointer', accentColor: 'var(--b1)' }}
                  />
                </th>
                {([
                  { label: 'ID', col: null },
                  { label: 'Title', col: null },
                  { label: 'Reporter', col: null },
                  { label: 'Priority', col: 'priority' as SortCol },
                  { label: 'Status', col: 'status' as SortCol },
                  { label: 'Assignee', col: null },
                  { label: 'SLA', col: 'sla' as SortCol },
                  { label: 'Created', col: 'created_at' as SortCol },
                ] as { label: string; col: SortCol | null }[]).map(({ label, col }) => (
                  <th
                    key={label}
                    onClick={col ? () => handleSort(col) : undefined}
                    style={{
                      cursor: col ? 'pointer' : 'default',
                      userSelect: 'none',
                      color: col && sortCol === col ? 'var(--brand-ink)' : undefined,
                    }}
                  >
                    {label}
                    {col && sortCol === col && (
                      <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    <td style={{ width: 36 }} />
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j}>
                        <div
                          style={{
                            height: 13,
                            borderRadius: 6,
                            background: 'var(--track)',
                            width: j === 1 ? '55%' : j === 0 ? 60 : '75%',
                            animation: 'shimmer 1.5s ease-in-out infinite',
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              ) : sortedItems.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: '60px 24px', textAlign: 'center', whiteSpace: 'normal' }}>
                    <p className="text-[14px] font-semibold text-ink m-0">No tickets found</p>
                    <p className="text-[13px] text-ink-3 mt-1 m-0">Try adjusting the filters above.</p>
                  </td>
                </tr>
              ) : (
                sortedItems.map(ticket => {
                  const hasUnread = unreadSet.has(ticket.id)
                  return (
                    <tr
                      key={ticket.id}
                      className="clickable"
                      aria-selected={selected.has(ticket.id) || undefined}
                      onClick={() => navigate(`/tickets/${ticket.id}`)}
                    >
                      <td style={{ width: 36 }} onClick={e => toggleSelect(e, ticket.id)}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${ticket.display_id}`}
                          checked={selected.has(ticket.id)}
                          onChange={() => {}}
                          style={{ cursor: 'pointer', accentColor: 'var(--b1)' }}
                        />
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          {hasUnread && (
                            <span
                              title="New replies"
                              className="inline-block w-[7px] h-[7px] rounded-full flex-shrink-0"
                              style={{ background: 'var(--b1)' }}
                            />
                          )}
                          <span className="sn">{ticket.display_id}</span>
                        </div>
                      </td>
                      <td style={{ maxWidth: 280 }}>
                        <div className="flex items-center gap-1.5 overflow-hidden">
                          {ticket.channel === 'slack' && (
                            <svg width="12" height="12" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-ink-3 flex-shrink-0" aria-label="Created from Slack">
                              <title>{ticket.workspace_name ? `Created from Slack — ${ticket.workspace_name}` : 'Created from Slack'}</title>
                              <path d="M15.5 11.5a1.5 1.5 0 0 1-1.5 1.5H5l-3 3V4a1.5 1.5 0 0 1 1.5-1.5h10.5A1.5 1.5 0 0 1 15.5 4z" />
                            </svg>
                          )}
                          {ticket.channel === 'web' && ticket.slack_channel_id && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-ink-3 flex-shrink-0" aria-label="Created on the web">
                              <title>{ticket.workspace_name ? `Created on the web — ${ticket.workspace_name}` : 'Created on the web'}</title>
                              <circle cx="12" cy="12" r="10" />
                              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                            </svg>
                          )}
                          <span className="name truncate" style={{ fontWeight: hasUnread ? 650 : 500 }}>
                            {ticket.title}
                          </span>
                        </div>
                        {(ticket.category_name || (showWorkspaceLabel && ticket.workspace_name)) && (
                          <span className="model block mt-px truncate">
                            {[ticket.category_name, showWorkspaceLabel ? ticket.workspace_name : null].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </td>
                      <td>
                        {ticket.submitter_name
                          ? <span className="text-[12.5px] text-ink-2">{ticket.submitter_name}</span>
                          : <span className="text-[12.5px] text-ink-3 italic">Unknown</span>
                        }
                      </td>
                      <td><PriorityBadge priority={ticket.priority} /></td>
                      <td><StatusBadge status={ticket.status} /></td>
                      <td>
                        {ticket.assignee_name
                          ? <span className="text-[12.5px] text-ink font-medium">{ticket.assignee_name}</span>
                          : (
                            <button
                              type="button"
                              onClick={e => handleClaim(e, ticket.id)}
                              className="btn ghost sm"
                              style={{ padding: '4px 11px', fontSize: 11.5, color: 'var(--brand-ink)' }}
                            >
                              Claim
                            </button>
                          )
                        }
                      </td>
                      <td><SLABadge ticket={ticket} variant="bar" /></td>
                      <td>
                        <span className="font-mono text-[11px] text-ink-3">{timeAgo(ticket.created_at)}</span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {data && data.total > PAGE_SIZE && (
          <Pagination
            page={page}
            total={data.total}
            pageSize={PAGE_SIZE}
            onPrev={() => setPage(page - 1)}
            onNext={() => setPage(page + 1)}
          />
        )}
      </section>
    </AppShell>
  )
}
