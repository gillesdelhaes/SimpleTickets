import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import api, { apiErrorMessage } from '../../lib/api'
import { CATEGORY_PALETTE, useThemeAttr } from '../../lib/chartPalette'
import { statusLabel } from '../../types/ticket'
import type { AskBlock } from '../../hooks/useAsk'

// Each tool result ("block") has a kind; each kind has one renderer here.
// Numbers are drawn straight from the tool result, never from the AI's text.

const TICK = { fontSize: 10, fill: 'var(--ink-3)', fontFamily: "'JetBrains Mono', monospace" }
const tid = (id: number) => `TKT-${String(id).padStart(4, '0')}`

export function queueLink(ids: number[]): string {
  return `/queue?ids=${ids.slice(0, 200).join(',')}`
}

function fmtValue(v: number | null | undefined, unit: string): string {
  if (v == null) return '—'
  if (unit === '%') return `${v}%`
  if (unit === 'min') return v < 60 ? `${v}m` : `${Math.floor(v / 60)}h ${v % 60}m`
  if (unit === 'h') return v < 48 ? `${v}h` : `${Math.round(v / 24 * 10) / 10}d`
  return v.toLocaleString()
}

function fmtDate(d: string, bucket?: string): string {
  const dt = new Date(d + 'T00:00:00')
  if (bucket === 'month') return dt.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

function Card({ block, children, right }: { block: AskBlock; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="ask-card">
      <div className="ask-card-head">
        <h3>{block.title}</h3>
        {right && <div className="ml-auto flex gap-1.5 items-center">{right}</div>}
      </div>
      {children}
      {(block.basis || block.note) && (
        <div className="ask-basis">
          {block.basis && <span>Based on {block.basis}</span>}
          {block.note && <span className="ask-note">{block.note}</span>}
        </div>
      )}
    </div>
  )
}

function HBars({ rows, label, color }: { rows: { key: string; count: number; share_pct?: number | null }[]; label?: (k: string) => string; color?: string }) {
  const max = Math.max(1, ...rows.map(r => r.count))
  return (
    <div className="ask-hbars">
      {rows.map(r => (
        <div key={r.key} className="ask-hbar">
          <span className="k" title={label ? label(r.key) : r.key}>{label ? label(r.key) : r.key}</span>
          <span className="bar"><span style={{ width: `${(r.count / max) * 100}%`, background: color ?? 'var(--brand-grad)' }} /></span>
          <span className="n">{r.count.toLocaleString()}{r.share_pct != null && <small> · {r.share_pct}%</small>}</span>
        </div>
      ))}
    </div>
  )
}

function TicketChips({ ids, max = 4 }: { ids: number[]; max?: number }) {
  if (!ids?.length) return null
  return (
    <span className="ask-chips">
      {ids.slice(0, max).map(i => <Link key={i} className="ask-tchip" to={`/tickets/${i}`}>{tid(i)}</Link>)}
      {ids.length > max && <span className="ask-tchip muted">+{ids.length - max}</span>}
    </span>
  )
}

function QueueButton({ ids, label }: { ids?: number[]; label?: string }) {
  const navigate = useNavigate()
  if (!ids?.length) return null
  return (
    <button type="button" className="ask-link" onClick={() => navigate(queueLink(ids))}>
      {label ?? `Open ${ids.length} in Queue`} →
    </button>
  )
}

function ViewToggle({ view, setView }: { view: 'chart' | 'table'; setView: (v: 'chart' | 'table') => void }) {
  return (
    <>
      <button type="button" className={`ask-seg${view === 'chart' ? ' on' : ''}`} onClick={() => setView('chart')}>Chart</button>
      <button type="button" className={`ask-seg${view === 'table' ? ' on' : ''}`} onClick={() => setView('table')}>Table</button>
    </>
  )
}

function Tooltipbox({ active, payload, label, bucket }: any) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((s: number, p: any) => s + (p.value ?? 0), 0)
  return (
    <div className="ask-tip">
      <div className="ask-tip-h">{bucket === 'week' ? 'Week of ' : ''}{fmtDate(label, bucket)}{payload[0]?.payload?.partial ? ' · partial' : ''}</div>
      {[...payload].reverse().map((p: any) => (
        <div key={p.dataKey} className="ask-tip-row">
          <span style={{ background: p.color }} />{p.name}<b>{p.value}</b>
        </div>
      ))}
      {payload.length > 1 && <div className="ask-tip-total">Total <b>{total}</b></div>}
    </div>
  )
}

function Timeseries({ data }: { data: { bucket: string; series: string[]; points: any[] } }) {
  const theme = useThemeAttr()
  const multi = data.series.length > 1
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data.points} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="askGradV" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--b1)" />
            <stop offset="100%" stopColor="var(--b2)" />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--track)" vertical={false} />
        <XAxis dataKey="date" tick={TICK} tickFormatter={v => fmtDate(v, data.bucket)} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={18} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip content={<Tooltipbox bucket={data.bucket} />} cursor={{ fill: 'var(--track)', opacity: 0.5 }} />
        {multi && <Legend formatter={v => <span className="text-[12px] text-ink-2">{v}</span>} iconType="square" iconSize={9} />}
        {data.series.map((s, i) => (
          <Bar
            key={s} dataKey={s} name={s} stackId="a" maxBarSize={34}
            fill={multi ? (s === 'Other' ? 'var(--ink-3)' : CATEGORY_PALETTE[i % CATEGORY_PALETTE.length][theme]) : 'url(#askGradV)'}
            stroke={multi ? 'var(--bg)' : undefined} strokeWidth={multi ? 1 : 0}
            radius={i === data.series.length - 1 ? [4, 4, 0, 0] : undefined}
          >
            {/* A week or month the period only partly covers is drawn faint */}
            {data.points.map(p => <Cell key={p.date} fillOpacity={p.partial ? 0.35 : 1} />)}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

function TimeseriesTable({ data }: { data: { bucket: string; series: string[]; points: any[] } }) {
  return (
    <div className="ask-table-wrap">
      <table className="ask-table">
        <thead><tr><th>{data.bucket === 'week' ? 'Week of' : data.bucket === 'month' ? 'Month' : 'Day'}</th>
          {data.series.length > 1 && data.series.map(s => <th key={s} className="num">{s}</th>)}
          <th className="num">Total</th></tr></thead>
        <tbody>{data.points.map(p => (
          <tr key={p.date}><td>{fmtDate(p.date, data.bucket)}</td>
            {data.series.length > 1 && data.series.map(s => <td key={s} className="num">{p[s] ?? 0}</td>)}
            <td className="num">{p.total}</td></tr>
        ))}</tbody>
      </table>
    </div>
  )
}

// ── Renderers per kind ────────────────────────────────────────────────────────

function StatsBlock({ block }: { block: AskBlock }) {
  const items: any[] = block.data.items ?? []
  return (
    <Card block={block}>
      <div className="ask-stats">
        {items.map(it => {
          let tone = ''
          if (it.change_pct != null && it.better !== 'neutral' && Math.abs(it.change_pct) >= 2) {
            const up = it.change_pct > 0
            tone = (up && it.better === 'up') || (!up && it.better === 'down') ? 'good' : 'bad'
          }
          return (
            <div key={it.label} className="ask-stat">
              <div className="l">{it.label}</div>
              <div className="v">{fmtValue(it.value, it.unit)}</div>
              {it.previous != null && (
                <div className={`d ${tone}`}>
                  {it.change_pct != null ? `${it.change_pct > 0 ? '▲' : it.change_pct < 0 ? '▼' : '='} ${Math.abs(it.change_pct)}% ` : ''}
                  <span className="muted">from {fmtValue(it.previous, it.unit)}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function TimeseriesBlock({ block }: { block: AskBlock }) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  return (
    <Card block={block} right={<ViewToggle view={view} setView={setView} />}>
      {view === 'chart' ? <Timeseries data={block.data as any} /> : <TimeseriesTable data={block.data as any} />}
      {view === 'chart' && (block.data.points ?? []).some((p: any) => p.partial) && (
        <div className="ask-cellsub mt-1">Faint bars are a {block.data.bucket} the period only partly covers.</div>
      )}
    </Card>
  )
}

function BarsBlock({ block }: { block: AskBlock }) {
  const dim = block.data.dimension
  const label = dim === 'status' ? statusLabel : (k: string) => (dim === 'priority' || dim === 'source' || dim === 'kind') ? k.charAt(0).toUpperCase() + k.slice(1) : k
  return <Card block={block}><HBars rows={block.data.rows ?? []} label={label} /></Card>
}

function TableBlock({ block }: { block: AskBlock }) {
  const cols: { key: string; label: string; num?: boolean }[] = block.data.columns ?? []
  return (
    <Card block={block}>
      <div className="ask-table-wrap">
        <table className="ask-table">
          <thead><tr>{cols.map(c => <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr></thead>
          <tbody>{(block.data.rows ?? []).map((r: any, i: number) => (
            <tr key={i}>{cols.map(c => <td key={c.key} className={c.num ? 'num' : ''}>{r[c.key] ?? '—'}</td>)}</tr>
          ))}</tbody>
        </table>
      </div>
    </Card>
  )
}

function TicketTable({ rows, cols }: { rows: any[]; cols: ('status' | 'priority' | 'topic' | 'category' | 'assignee_name' | 'assignee' | 'idle_days')[] }) {
  const heads: Record<string, string> = { status: 'Status', priority: 'Priority', topic: 'Topic', category: 'Category', assignee_name: 'Assignee', assignee: 'Assignee', idle_days: 'Idle (days)' }
  return (
    <div className="ask-table-wrap">
      <table className="ask-table">
        <thead><tr><th>Ticket</th>{cols.map(c => <th key={c} className={c === 'idle_days' ? 'num' : ''}>{heads[c]}</th>)}</tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.id}>
            <td className="ask-ticket-cell"><Link to={`/tickets/${r.id}`}><span className="mono">{tid(r.id)}</span> {r.title}</Link></td>
            {cols.map(c => (
              <td key={c} className={c === 'idle_days' ? 'num' : ''}>
                {c === 'status' ? statusLabel(r.status) : c === 'priority' ? <span className={`ask-prio ${r.priority}`}>{r.priority}</span> : (r[c] ?? '—')}
              </td>
            ))}
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

function BacklogBlock({ block }: { block: AskBlock }) {
  return (
    <Card block={block}>
      <div className="ask-two">
        <div><div className="ask-sub">By age</div><HBars rows={block.data.by_age ?? []} /></div>
        <div><div className="ask-sub">By status</div><HBars rows={block.data.by_status ?? []} label={statusLabel} /></div>
      </div>
      {block.data.tickets?.length > 0 && (
        <>
          <div className="ask-sub mt-3">No update for 5+ days</div>
          <TicketTable rows={block.data.tickets} cols={['status', 'assignee', 'idle_days']} />
        </>
      )}
    </Card>
  )
}

function TopicsBlock({ block }: { block: AskBlock }) {
  const items: any[] = block.data.items ?? []
  const max = Math.max(1, ...items.map(i => i.count))
  if (!items.length) return <Card block={block}><p className="ask-empty">Nothing stands out yet.</p></Card>
  return (
    <Card block={block}>
      <div className="ask-topics">
        {items.map((t, i) => (
          <div key={t.topic} className="ask-topic">
            <span className="rank">{i + 1}</span>
            <div className="body">
              <div className="row1">
                <h4>{t.topic}</h4>
                <span className="cnt">{t.count}<small>{t.share_pct != null ? ` · ${t.share_pct}%` : ''}</small></span>
              </div>
              <span className="bar"><span style={{ width: `${(t.count / max) * 100}%` }} /></span>
              <div className="meta">
                {t.categories?.map((c: any) => <span key={c.name} className="ask-cat">{c.name} {c.count}</span>)}
                {t.systems?.length > 0 && <span className="muted">· {t.systems.join(', ')}</span>}
              </div>
              <div className="meta muted">
                {t.last_14_days != null && <span>{t.last_14_days} in the last 14 days (about {t.expected_14_days} expected) · first seen {t.first_seen}</span>}
                {t.last_14_days == null && t.change_pct != null && <span>{t.change_pct > 0 ? '▲' : '▼'} {Math.abs(t.change_pct)}% vs the period before ({t.previous_period})</span>}
                {t.last_14_days == null && t.previous_period === 0 && <span>New this period</span>}
                {t.median_hours_to_resolve != null && <span>· median {fmtValue(t.median_hours_to_resolve, 'h')} to resolve</span>}
                {t.open > 0 && <span>· {t.open} open</span>}
              </div>
              {t.resolutions?.length > 0 && (
                <div className="meta">
                  <span className="muted">Fixed by:</span>
                  {t.resolutions.map((r: any) => <span key={r.text} className="ask-fix">“{r.text}” ×{r.count}</span>)}
                  {t.same_fix_pct != null && <span className="muted">({t.same_fix_pct}% the same fix)</span>}
                </div>
              )}
              <div className="meta">
                <TicketChips ids={t.example_ids} />
                <QueueButton ids={t.ticket_ids} label={`Open all ${t.count}`} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function TopicBlock({ block }: { block: AskBlock }) {
  const s = block.summary
  return (
    <Card block={block} right={<QueueButton ids={block.data.ticket_ids} />}>
      <div className="ask-stats">
        <div className="ask-stat"><div className="l">Tickets</div><div className="v">{s.tickets}</div><div className="d muted">first seen {s.first_seen}</div></div>
        <div className="ask-stat"><div className="l">Still open</div><div className="v">{s.open}</div></div>
        <div className="ask-stat"><div className="l">Median time to resolve</div><div className="v">{fmtValue(s.median_hours_to_resolve, 'h')}</div></div>
      </div>
      <Timeseries data={block.data as any} />
      <div className="ask-two">
        {block.data.systems?.length > 0 && <div><div className="ask-sub">Systems</div><HBars rows={block.data.systems} /></div>}
        {block.data.fixes?.length > 0 && <div><div className="ask-sub">How they were fixed</div><HBars rows={block.data.fixes} /></div>}
      </div>
      {block.data.tickets?.length > 0 && <><div className="ask-sub mt-3">Latest tickets</div><TicketTable rows={block.data.tickets.slice(0, 8)} cols={['status', 'category']} /></>}
    </Card>
  )
}

const VERDICT_TONE: Record<string, string> = {
  good: 'ok', mixed: 'warn', 'catch-all': 'warn', 'mostly misfiled': 'bad', 'rarely used': 'neutral',
  unused: 'neutral', placeable: 'brand', ok: 'neutral',
}

function CategoryHealthBlock({ block }: { block: AskBlock }) {
  return (
    <Card block={block}>
      <div className="ask-table-wrap">
        <table className="ask-table ask-health">
          <thead><tr><th>Category</th><th className="num">Tickets</th><th>Fit</th><th className="num" title="Likely misfiled">Misfiled</th><th>Verdict</th></tr></thead>
          <tbody>{(block.data.rows ?? []).map((r: any) => (
            <tr key={r.category}>
              <td>{r.category}<div className="ask-cellsub topics" title={r.top_topics?.join(' · ')}>{r.top_topics?.join(' · ')}</div></td>
              <td className="num">{r.tickets}<div className="ask-cellsub">{r.per_week}/wk</div></td>
              <td style={{ minWidth: 110 }}>
                {r.fit_pct != null ? (
                  <div className="ask-fit"><span className="bar"><span style={{ width: `${r.fit_pct}%` }} className={r.fit_pct < 50 ? 'bad' : r.fit_pct < 75 ? 'warn' : 'ok'} /></span><span className="mono">{r.fit_pct}%</span></div>
                ) : '—'}
              </td>
              <td className="num">{r.misfiled || '—'}</td>
              <td><span className={`ask-badge ${VERDICT_TONE[r.verdict] ?? 'neutral'}`}>{r.verdict === 'placeable' ? `${r.misfiled} can be placed` : r.verdict}</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Card>
  )
}

function MisfiledBlock({ block, isAdmin }: { block: AskBlock; isAdmin: boolean }) {
  const rows: any[] = block.data.rows ?? []
  const [done, setDone] = useState<Record<number, 'moved' | 'kept' | 'skipped'>>({})
  const [confirmAll, setConfirmAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const pending = rows.filter(r => !done[r.id] && (isAdmin || !r.resolved))

  async function move(items: any[]) {
    setBusy(true); setMsg(null)
    try {
      const groups = new Map<number, number[]>()
      items.forEach(r => groups.set(r.suggested_id, [...(groups.get(r.suggested_id) ?? []), r.id]))
      let moved = 0
      for (const [category_id, ticket_ids] of groups) {
        const res = await api.post('/ask/actions/recategorize', { ticket_ids, category_id })
        moved += res.data.moved
      }
      setDone(d => ({ ...d, ...Object.fromEntries(items.map(r => [r.id, 'moved' as const])) }))
      setMsg(`Moved ${moved} ticket${moved === 1 ? '' : 's'}. Each change is in the ticket's history.`)
    } catch (e) {
      setMsg(apiErrorMessage(e, "Couldn't move the tickets."))
    } finally {
      setBusy(false); setConfirmAll(false)
    }
  }

  return (
    <Card block={block} right={pending.length > 1 && (confirmAll ? (
      <span className="ask-confirm-inline">Move {pending.length}?
        <button className="ask-btn primary" disabled={busy} onClick={() => move(pending)}>Confirm</button>
        <button className="ask-btn" onClick={() => setConfirmAll(false)}>Cancel</button></span>
    ) : <button className="ask-btn" onClick={() => setConfirmAll(true)}>Move all {pending.length} shown</button>)}>
      {block.summary?.top_moves?.length > 0 && (
        <div className="ask-chips mb-2">{block.summary.top_moves.map((m: any) => (
          <span key={m.from + m.to} className="ask-cat">{m.from} → {m.to} · {m.count}</span>
        ))}</div>
      )}
      <div className="ask-moves">
        {rows.map(r => {
          const state = done[r.id]
          const locked = r.resolved && !isAdmin
          return (
            <div key={r.id} className={`ask-move${state ? ' done' : ''}`}>
              <div className="t"><Link to={`/tickets/${r.id}`}><span className="mono muted">{tid(r.id)}</span> {r.title}</Link></div>
              <div className="m"><span className="ask-cat">{r.current}</span> → <span className="ask-cat">{r.suggested}</span>
                <span className="muted">{r.confidence} confidence{r.topic ? ` · ${r.topic}` : ''}{r.resolved ? ' · resolved' : ''}</span></div>
              <div className="a">
                {state === 'moved' && <span className="ask-badge ok">Moved</span>}
                {state === 'kept' && <span className="ask-badge neutral">Kept</span>}
                {!state && locked && <span className="ask-badge neutral" title="Resolved tickets are frozen; an admin can correct them">Resolved</span>}
                {!state && !locked && <>
                  <button className="ask-btn primary" disabled={busy} onClick={() => move([r])}>Move</button>
                  <button className="ask-btn" onClick={() => setDone(d => ({ ...d, [r.id]: 'kept' }))}>Keep</button>
                </>}
              </div>
            </div>
          )
        })}
      </div>
      {msg && <div className="ask-result">{msg}</div>}
      {block.summary?.likely_misfiled > rows.length && (
        <div className="mt-2"><QueueButton ids={block.data.all_ids} label={`Open all ${block.summary.likely_misfiled} in Queue`} /></div>
      )}
    </Card>
  )
}

const PROP_LABEL: Record<string, string> = { add: 'Add', merge: 'Merge', archive: 'Archive', split: 'Too broad', incident: "Don't add" }

function ProposalCard({ p, isAdmin, onAsk }: { p: any; isAdmin: boolean; onAsk: (q: string) => void }) {
  const [name, setName] = useState<string>(p.suggested_name ?? '')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const f = p.facts ?? {}

  async function run() {
    setBusy(true); setError(null)
    try {
      if (p.type === 'add') {
        const r = await api.post('/ask/actions/create-category', p.topic_id != null
          ? { name, topic_id: p.topic_id } : { name, ticket_ids: p.ticket_ids ?? [] })
        setMsg(`Created “${r.data.category.name}” and moved ${r.data.moved} tickets (${r.data.moved_closed} of them closed, still closed).`)
      } else if (p.type === 'merge') {
        const r = await api.post('/ask/actions/merge-category', { from_id: p.category_id, into_id: p.into_id })
        setMsg(`Moved ${r.data.moved} tickets to ${r.data.into} (${r.data.moved_closed} closed, still closed) and archived ${r.data.archived}.`)
      } else if (p.type === 'archive') {
        await api.patch(`/categories/${p.category_id}`, { is_archived: true })
        setMsg(`Archived ${p.title}.`)
      }
    } catch (e) {
      setError(apiErrorMessage(e, "That didn't work."))
    } finally {
      setBusy(false); setConfirm(false)
    }
  }

  const allTime = p.all_time ?? p.ticket_ids?.length ?? 0
  const actionLabel = p.type === 'add' ? `Create and move all ${allTime} tickets`
    : p.type === 'merge' ? `Merge all ${allTime} tickets into ${p.into}` : p.type === 'archive' ? 'Archive it' : null
  // What the confirmation says will happen
  const scope = p.type === 'add'
    ? `Every ticket about “${p.title}” moves, all time: ${allTime} tickets, not only the ${f.tickets} in this period.`
    : p.type === 'merge' ? `All ${allTime} tickets in ${p.title} move to ${p.into}, all time, and ${p.title} is archived.`
      : `${p.title} can't be picked for new tickets; existing tickets keep it.`

  return (
    <div className="ask-prop">
      <span className={`kind ${p.type}`}>{PROP_LABEL[p.type] ?? p.type}</span>
      <h4>{p.type === 'merge' ? `${p.title} → ${p.into}` : p.title}</h4>
      <p>{p.reason}</p>
      <div className="facts">
        {f.tickets != null && <span>{f.tickets} tickets</span>}
        {f.per_week != null && <span>{f.per_week}/week</span>}
        {f.fit_pct != null && <span>{f.fit_pct}% fit</span>}
        {f.first_seen && <span>since {f.first_seen}{f.per_week_since != null ? `, ${f.per_week_since}/week` : ''}</span>}
        {f.filed_under && <span>filed under {Object.entries(f.filed_under).map(([k, n]) => `${k} ${n}`).join(', ')}</span>}
        {f.topics && <span>{Object.keys(f.topics).join(' · ')}</span>}
      </div>
      <div className="foot">
        {msg ? <span className="ask-badge ok">{msg}</span> : actionLabel && (isAdmin ? (
          confirm ? (
            <div className="ask-confirm">
              {p.type === 'add' && (
                <label className="block text-[12px] text-ink-2">Category name
                  <input className="input mt-1" value={name} onChange={e => setName(e.target.value)} maxLength={80} />
                </label>
              )}
              <span>{scope}</span>
              {p.type !== 'archive' && <span className="text-ink-2">Closed tickets stay closed: only their category changes. Each move is in the ticket's history and the audit log.</span>}
              <div className="flex gap-1.5">
                <button className="ask-btn primary" disabled={busy || (p.type === 'add' && !name.trim())} onClick={run}>Confirm</button>
                <button className="ask-btn" onClick={() => setConfirm(false)}>Cancel</button>
              </div>
            </div>
          ) : <button className="ask-btn primary" onClick={() => setConfirm(true)}>{actionLabel}</button>
        ) : <span className="muted text-[12px]">An admin can make this change.</span>)}
        {p.type === 'split' && <button className="ask-link" onClick={() => onAsk(`What topics are in ${p.title}, and how could it be split?`)}>See its topics →</button>}
        {(p.type === 'incident' || p.type === 'add') && !msg && <QueueButton ids={p.ticket_ids} label="See the tickets" />}
        {error && <span className="ask-error-inline">{error}</span>}
      </div>
    </div>
  )
}

function ProposalsBlock({ block, isAdmin, onAsk }: { block: AskBlock; isAdmin: boolean; onAsk: (q: string) => void }) {
  const items: any[] = block.data.items ?? []
  return (
    <Card block={block}>
      {items.length === 0 ? <p className="ask-empty">The category list fits the tickets well. Nothing to change right now.</p> : (
        <div className="ask-props">{items.map((p, i) => <ProposalCard key={i} p={p} isAdmin={isAdmin} onAsk={onAsk} />)}</div>
      )}
    </Card>
  )
}

function TicketsBlock({ block }: { block: AskBlock }) {
  const tickets: any[] = block.data.tickets ?? []
  const groups: any[] = block.data.groups ?? []
  const hasTopic = tickets.some(t => t.topic)
  const cols: any[] = ['status']
  if (tickets.some(t => t.priority)) cols.push('priority')
  if (hasTopic) cols.push('topic')
  if (tickets.some(t => t.category)) cols.push('category')
  if (tickets.some(t => t.assignee_name)) cols.push('assignee_name')
  return (
    <Card block={block} right={<QueueButton ids={block.data.ticket_ids} />}>
      {groups.length > 0 && <div className="ask-chips mb-2">{groups.map(g => <span key={g.topic} className="ask-cat">{g.topic} · {g.count}</span>)}</div>}
      {tickets.length ? <TicketTable rows={tickets.slice(0, 15)} cols={cols} /> : <p className="ask-empty">No tickets.</p>}
    </Card>
  )
}

function TicketBlock({ block }: { block: AskBlock }) {
  const t = block.data.ticket ?? {}
  const rows: [string, any][] = [
    ['Status', statusLabel(t.status)], ['Priority', t.priority], ['Category', t.category], ['Assignee', t.assignee],
    ['Topic', t.topic], ['System', t.system], ['Created', t.created], ['Resolved', t.resolved], ['How it was fixed', t.fix],
    ['Replies', t.replies], ['SLA', t.sla_breached ? 'Breached' : 'Met or running'],
  ]
  return (
    <Card block={block} right={<Link className="ask-link" to={`/tickets/${t.id}`}>Open ticket →</Link>}>
      {t.assistant_summary && <p className="text-[13.5px] text-ink-2 mb-2">{t.assistant_summary}</p>}
      <dl className="ask-kv">{rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl>
    </Card>
  )
}

function BusyBlock({ block }: { block: AskBlock }) {
  const hours: any[] = (block.data.by_hour ?? []).filter((h: any) => {
    const n = Number(h.key.slice(0, 2)); return n >= 6 && n <= 20
  })
  const max = Math.max(1, ...hours.map(h => h.count))
  return (
    <Card block={block}>
      <div className="ask-two">
        <div><div className="ask-sub">By weekday</div><HBars rows={block.data.by_weekday ?? []} /></div>
        <div>
          <div className="ask-sub">By hour (06:00–20:00)</div>
          <div className="ask-cols">{hours.map(h => (
            <div key={h.key} className="col" title={`${h.key}: ${h.count}`}>
              <span style={{ height: `${(h.count / max) * 100}%` }} />
              <small>{h.key.slice(0, 2)}</small>
            </div>
          ))}</div>
        </div>
      </div>
    </Card>
  )
}

export function AskBlockView({ block, isAdmin, onAsk }: { block: AskBlock; isAdmin: boolean; onAsk: (q: string) => void }) {
  switch (block.kind) {
    case 'stats': return <StatsBlock block={block} />
    case 'timeseries': return <TimeseriesBlock block={block} />
    case 'bars': return <BarsBlock block={block} />
    case 'table': return <TableBlock block={block} />
    case 'backlog': return <BacklogBlock block={block} />
    case 'topics': return <TopicsBlock block={block} />
    case 'topic': return <TopicBlock block={block} />
    case 'category_health': return <CategoryHealthBlock block={block} />
    case 'misfiled': return <MisfiledBlock block={block} isAdmin={isAdmin} />
    case 'proposals': return <ProposalsBlock block={block} isAdmin={isAdmin} onAsk={onAsk} />
    case 'tickets': return <TicketsBlock block={block} />
    case 'ticket': return <TicketBlock block={block} />
    case 'busy': return <BusyBlock block={block} />
    default: return <Card block={block}><p className="ask-empty">Nothing found.</p></Card>
  }
}

// Plain-language names for the "how I got this" list
export const TOOL_LABELS: Record<string, string> = {
  overview: 'Headline numbers', volume_trend: 'Tickets over time', breakdown: 'Breakdown',
  technician_performance: 'Technician stats', workload: 'Open tickets per person', backlog: 'Open backlog',
  top_topics: 'Topics', topic_detail: 'One topic in detail', category_health: 'Category fit',
  misfiled_tickets: 'Possibly misfiled tickets', category_suggestions: 'Category suggestions',
  problem_tickets: 'Problem tickets', find_tickets: 'Ticket search', ticket_details: 'One ticket',
  busiest_times: 'When tickets come in', triage_accuracy: 'Assistant category accuracy',
}
