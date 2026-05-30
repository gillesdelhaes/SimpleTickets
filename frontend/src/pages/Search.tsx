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
// The backend returns ts_headline output with <b>…</b> tags for matches.
// We render this as HTML safely — the content is server-generated from
// trusted DB data, not user-supplied HTML.

function Headline({ html }: { html: string }) {
  if (!html) return null
  return (
    <p
      style={{ margin: 0, fontSize: 12, color: '#737373', lineHeight: 1.6 }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: ts_headline output, not user HTML
      dangerouslySetInnerHTML={{
        __html: html.replace(/<b>/g, '<mark style="background:rgba(255,71,19,0.12);color:#CC3300;border-radius:2px;padding:0 2px;font-weight:600">').replace(/<\/b>/g, '</mark>'),
      }}
    />
  )
}

// ── Result card ───────────────────────────────────────────────────────────────

function ResultCard({ item, onClick }: { item: SearchResultItem; onClick: () => void }) {
  const { ticket, headline } = item
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '14px 18px',
        background: '#fff',
        border: '1px solid #E5E5E5',
        borderRadius: 10,
        cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
      onMouseOver={e => {
        e.currentTarget.style.borderColor = '#FF4713'
        e.currentTarget.style.boxShadow = '0 0 0 3px rgba(255,71,19,0.07)'
      }}
      onMouseOut={e => {
        e.currentTarget.style.borderColor = '#E5E5E5'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 10, letterSpacing: '0.06em',
          color: '#A3A3A3', flexShrink: 0,
        }}>
          {ticket.display_id}
        </span>
        <StatusBadge status={ticket.status as never} />
        <PriorityBadge priority={ticket.priority as never} />
        {ticket.category_name && (
          <span style={{
            fontSize: 11, color: '#737373',
            background: '#F5F5F5', borderRadius: 4,
            padding: '1px 7px', border: '1px solid #E5E5E5',
          }}>
            {ticket.category_name}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: '#A3A3A3', flexShrink: 0 }}>
          {timeAgo(ticket.updated_at)}
        </span>
      </div>

      {/* Title */}
      <p style={{
        margin: '0 0 6px', fontSize: 14, fontWeight: 600,
        color: '#0A0A0A', lineHeight: 1.4,
      }}>
        {ticket.title}
      </p>

      {/* Headline snippet */}
      <Headline html={headline} />

      {/* Bottom row */}
      {ticket.assignee_name && (
        <p style={{ margin: '6px 0 0', fontSize: 11, color: '#A3A3A3' }}>
          Assigned to <strong style={{ fontWeight: 600, color: '#737373' }}>{ticket.assignee_name}</strong>
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
        <form onSubmit={handleSubmit} style={{ marginBottom: 24 }}>
          <div style={{ position: 'relative', display: 'flex', gap: 8 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <span style={{
                position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                color: '#A3A3A3', pointerEvents: 'none', display: 'flex',
              }}>
                <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="8" cy="8" r="5.5" /><path d="M12.5 12.5L16 16" />
                </svg>
              </span>
              <input
                ref={inputRef}
                value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                placeholder='Search tickets, replies, notes… (supports AND, OR, "phrases", -negation)'
                style={{
                  width: '100%',
                  height: 42,
                  paddingLeft: 36,
                  paddingRight: 12,
                  border: '1.5px solid #E5E5E5',
                  borderRadius: 10,
                  fontSize: 13,
                  color: '#0A0A0A',
                  background: '#fff',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
                onFocus={e => {
                  e.target.style.borderColor = '#FF4713'
                  e.target.style.boxShadow = '0 0 0 3px rgba(255,71,19,0.09)'
                }}
                onBlur={e => {
                  e.target.style.borderColor = '#E5E5E5'
                  e.target.style.boxShadow = 'none'
                }}
              />
            </div>
            <button
              type="submit"
              disabled={inputVal.trim().length < 2}
              style={{
                height: 42, paddingLeft: 20, paddingRight: 20,
                borderRadius: 10, border: 'none',
                background: inputVal.trim().length < 2
                  ? 'rgba(255,71,19,0.35)'
                  : 'linear-gradient(135deg, #FF4713 0%, #AD1164 100%)',
                color: '#fff', fontWeight: 600, fontSize: 13,
                cursor: inputVal.trim().length < 2 ? 'not-allowed' : 'pointer',
                flexShrink: 0,
                transition: 'background 0.15s',
              }}
            >
              Search
            </button>
          </div>
        </form>

        {/* Status bar */}
        {hasQuery && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 14,
          }}>
            <p style={{ margin: 0, fontSize: 13, color: '#737373' }}>
              {isFetching ? (
                <span>Searching…</span>
              ) : isError ? (
                <span style={{ color: '#EF4444' }}>Search failed. Try again.</span>
              ) : (
                <>
                  <strong style={{ color: '#0A0A0A' }}>{data?.total ?? 0}</strong>{' '}
                  result{(data?.total ?? 0) !== 1 ? 's' : ''} for{' '}
                  <strong style={{ color: '#0A0A0A' }}>"{q}"</strong>
                </>
              )}
            </p>
          </div>
        )}

        {/* Results */}
        {hasQuery && !isFetching && !isError && results.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
          <div style={{
            textAlign: 'center', padding: '60px 24px',
            background: '#fff', border: '1px solid #E5E5E5', borderRadius: 12,
          }}>
            <p style={{ fontSize: 13, color: '#A3A3A3', margin: 0 }}>
              No tickets found for <strong style={{ color: '#737373' }}>"{q}"</strong>
            </p>
            <p style={{ fontSize: 12, color: '#C3C3C3', margin: '6px 0 0' }}>
              Try different keywords or check your spelling
            </p>
          </div>
        )}

        {/* Idle state */}
        {!hasQuery && (
          <div style={{
            textAlign: 'center', padding: '60px 24px',
            background: '#fff', border: '1px solid #E5E5E5', borderRadius: 12,
          }}>
            <p style={{ fontSize: 13, color: '#A3A3A3', margin: 0 }}>
              Enter at least 2 characters to search
            </p>
            <p style={{ fontSize: 12, color: '#C3C3C3', margin: '6px 0 0' }}>
              Searches ticket titles, descriptions, replies, and internal notes
            </p>
          </div>
        )}
      </div>
    </AppShell>
  )
}
