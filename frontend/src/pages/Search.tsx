import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import AppShell from '../components/layout/AppShell'
import StatusBadge from '../components/tickets/StatusBadge'
import PriorityBadge from '../components/tickets/PriorityBadge'
import api from '../lib/api'
import { timeAgo } from '../types/ticket'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TicketRead {
  id: number
  display_id: string
  title: string
  status: string
  priority: string
  assignee_name: string | null
  category_name: string | null
  created_at: string
  updated_at: string
}

interface SearchResultItem {
  ticket: TicketRead
  rank: number
  headline: string
}

interface SearchResponse {
  query: string
  total: number
  items: SearchResultItem[]
}

// ── Highlighted snippet ────────────────────────────────────────────────────────
// The backend returns ts_headline output with <b>…</b> tags around matched terms.
// We split on those tags, HTML-escape the text segments, then replace <b>/<b> with
// <mark> so arbitrary ticket content cannot inject HTML.

function sanitizeHeadline(html: string): string {
  return html
    .split(/(<b>|<\/b>)/g)
    .map(part => {
      if (part === '<b>' || part === '</b>') return part
      return part
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    })
    .join('')
}

function Headline({ html }: { html: string }) {
  if (!html) return null
  const safe = sanitizeHeadline(html)
    .replace(/<b>/g, '<mark style="background:var(--brand-tint);color:var(--brand-ink);border-radius:3px;padding:0 2px;font-weight:600">')
    .replace(/<\/b>/g, '</mark>')
  return (
    <p
      className="m-0 text-[12.5px] text-ink-2 leading-relaxed"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized — only <mark> tags remain
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  )
}

// ── Result card ───────────────────────────────────────────────────────────────

function ResultCard({ item, onClick }: { item: SearchResultItem; onClick: () => void }) {
  const { ticket, headline } = item
  return (
    <button onClick={onClick} className="panel block w-full text-left px-5 py-4 cursor-pointer" style={{ font: 'inherit' }}>
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className="font-mono text-[10.5px] tracking-wide text-ink-3 flex-shrink-0">
          {ticket.display_id}
        </span>
        <StatusBadge status={ticket.status as never} />
        <PriorityBadge priority={ticket.priority as never} />
        {ticket.category_name && (
          <span className="text-[11px] text-ink-2 rounded-full px-2 py-px border border-edge bg-field">
            {ticket.category_name}
          </span>
        )}
        <span className="flex-1" />
        <span className="font-mono text-[10.5px] text-ink-3 flex-shrink-0">
          {timeAgo(ticket.updated_at)}
        </span>
      </div>

      <p className="m-0 mb-1.5 text-[14px] font-semibold text-ink leading-snug">
        {ticket.title}
      </p>

      <Headline html={headline} />

      {ticket.assignee_name && (
        <p className="m-0 mt-1.5 text-[11.5px] text-ink-3">
          Assigned to <strong className="font-semibold text-ink-2">{ticket.assignee_name}</strong>
        </p>
      )}
    </button>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Search() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialQ = searchParams.get('q') ?? ''
  const [inputVal, setInputVal] = useState(initialQ)
  const inputRef = useRef<HTMLInputElement>(null)

  // Keep input in sync when URL changes (e.g. nav search bar)
  useEffect(() => {
    const q = searchParams.get('q') ?? ''
    setInputVal(q)
  }, [searchParams])

  // Auto-focus on load
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const q = searchParams.get('q') ?? ''

  const { data, isFetching, isError } = useQuery<SearchResponse>({
    queryKey: ['search', q],
    queryFn: async () => (await api.get('/search', { params: { q, limit: 50 } })).data,
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = inputVal.trim()
    if (trimmed.length >= 2) {
      setSearchParams({ q: trimmed })
    }
  }

  const hasQuery = q.trim().length >= 2
  const results = data?.items ?? []

  return (
    <AppShell title="Search">
      <div style={{ maxWidth: 780, margin: '0 auto' }}>

        {/* Search bar */}
        <form onSubmit={handleSubmit} className="mb-6">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none flex">
                <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="8" cy="8" r="5.5" /><path d="M12.5 12.5L16 16" />
                </svg>
              </span>
              <input
                ref={inputRef}
                className="input"
                style={{ paddingLeft: 38 }}
                value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                placeholder='Search tickets, replies, notes… (supports AND, OR, "phrases", -negation)'
              />
            </div>
            <button
              type="submit"
              className="btn"
              disabled={inputVal.trim().length < 2}
              style={inputVal.trim().length < 2 ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            >
              Search
            </button>
          </div>
        </form>

        {/* Status bar */}
        {hasQuery && (
          <div className="flex items-center justify-between mb-3.5">
            <p className="m-0 text-[13px] text-ink-2">
              {isFetching ? (
                <span>Searching…</span>
              ) : isError ? (
                <span className="text-danger-ink">Search failed — try again.</span>
              ) : (
                <>
                  <strong className="text-ink">{data?.total ?? 0}</strong>{' '}
                  result{(data?.total ?? 0) !== 1 ? 's' : ''} for{' '}
                  <strong className="text-ink">"{q}"</strong>
                </>
              )}
            </p>
          </div>
        )}

        {/* Results */}
        {hasQuery && !isFetching && !isError && results.length > 0 && (
          <div className="flex flex-col gap-2.5">
            {results.map(item => (
              <ResultCard
                key={item.ticket.id}
                item={item}
                onClick={() => navigate(`/tickets/${item.ticket.id}`)}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {hasQuery && !isFetching && !isError && results.length === 0 && (
          <div className="panel text-center px-6 py-14">
            <p className="text-[13px] text-ink-2 m-0">
              No tickets found for <strong className="text-ink">"{q}"</strong>
            </p>
            <p className="text-[12px] text-ink-3 mt-1.5 m-0">
              Try different keywords or check your spelling.
            </p>
          </div>
        )}

        {/* Idle state */}
        {!hasQuery && (
          <div className="panel text-center px-6 py-14">
            <p className="text-[13px] text-ink-2 m-0">
              Enter at least 2 characters to search.
            </p>
            <p className="text-[12px] text-ink-3 mt-1.5 m-0">
              Searches ticket titles, descriptions, replies, and internal notes.
            </p>
          </div>
        )}
      </div>
    </AppShell>
  )
}
