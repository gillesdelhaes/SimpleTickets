import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ThumbUp, ThumbDown } from '../components/ThumbIcon'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend, LabelList,
} from 'recharts'
import AppShell from '../components/layout/AppShell'
import { getAllStatuses, parseUTC, statusColor, statusLabel } from '../types/ticket'
import { useAuth } from '../contexts/AuthContext'
import api from '../lib/api'
import { useAppConfig } from '../hooks/useAppConfig'
import { useCategories } from '../hooks/useCategories'
import { CATEGORY_PALETTE, HueGradientDefs, colorDistance, harmonize, hueGradientBar, isNeutral, useThemeAttr, type Theme } from '../lib/chartPalette'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Overview {
  total: number
  resolved: number
  open: number
  sla_compliance_pct: number | null
  avg_resolution_hours: number | null
  first_response_pct: number | null
  avg_first_response_minutes: number | null
  median_first_response_minutes: number | null
  csat_pct: number | null
  csat_total: number
  csat_positive: number
}
interface VolumePoint { date: string; count: number }
interface ByPriority { priority: string; count: number }
interface ByStatus { status: string; count: number }
interface ByCategory { category: string; count: number }
interface BySource { source: string; count: number }
interface TechRow {
  name: string
  total: number
  resolved: number
  avg_hours: number | null
  sla_pct: number | null
  first_response_pct: number | null
  avg_first_response_minutes: number | null
  csat_pct: number | null
}
interface CsatNegRow {
  id: number
  title: string
  status: string
  priority: string
  responded_at: string
  assignee_name: string | null
}
interface SlaBreachedRow {
  id: number
  title: string
  status: string
  priority: string
  sla_deadline: string | null
  assignee_name: string | null
}

// ── Chart styling (Glasshouse §10: brand gradient series, track grid, ink ticks) ──

const TICK_STYLE = { fontSize: 10, fill: 'var(--ink-3)', fontFamily: "'JetBrains Mono', monospace" }

// Colorful mode: each bar gets its own color (category, priority, status,
// channel) as a hue gradient within that color. Off, every bar wears the brand
// gradient. On by default — the brand gradient's two colors per bar were
// reported as reading like they meant something.
const COLORFUL_KEY = 'reports-colorful'

function loadColorful(): boolean {
  try {
    const v = localStorage.getItem(COLORFUL_KEY)
    if (v === '0') return false
  } catch { /* storage unavailable */ }
  return true
}

/** Palette icon; when colorful, its paint dots show the first category colors. */
function PaletteIcon({ dots }: { dots: string[] | null }) {
  const spots: [number, number][] = [[13.5, 6.5], [17.5, 10.5], [8.5, 7.5], [6.5, 12.5]]
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.55-2.5 5.55-5.55C21.97 6.01 17.46 2 12 2z" />
      {spots.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={dots ? 1.9 : 1} fill={dots ? dots[i] : 'currentColor'} stroke="none" />
      ))}
    </svg>
  )
}

/**
 * Chart color per status: its configured hue, re-toned to sit with the
 * palette. A gray-configured status (e.g. Closed) gets a real color instead —
 * the palette slot farthest from every other status's color in both themes — so the chart
 * never shows a gray bar. Computed over all configured statuses (not just the
 * ones in the current data) so a status keeps its color across date ranges.
 */
function statusColors(statuses: { name: string; color: string }[], theme: Theme): Map<string, string> {
  const themes: Theme[] = ['dark', 'light']
  // Chromatic statuses keep their hue; remember both themes' versions so a
  // gray status's pick is the same palette slot in either theme.
  const taken = new Map<string, Record<Theme, string>>()
  for (const s of statuses) {
    if (!isNeutral(s.color)) taken.set(s.name, { dark: harmonize(s.color, 'dark'), light: harmonize(s.color, 'light') })
  }
  for (const s of statuses) {
    if (taken.has(s.name)) continue
    const others = [...taken.values()]
    let best = { slot: CATEGORY_PALETTE[0], d: -1 }
    for (const slot of CATEGORY_PALETTE) {
      const d = Math.min(...others.flatMap(o => themes.map(t => colorDistance(slot[t], o[t]))), Infinity)
      if (d > best.d) best = { slot, d }
    }
    taken.set(s.name, { dark: best.slot.dark, light: best.slot.light })
  }
  return new Map([...taken].map(([name, c]) => [name, c[theme]]))
}

/** Urgency reuses the status tones (red/amber); Medium takes the palette's first hue. */
function priorityFill(key: string, hues: string[]): string {
  const fills: Record<string, string> = {
    critical: 'var(--danger-ink)',
    high: 'var(--warn-ink)',
    medium: hues[0],
    low: 'var(--ink-3)',
  }
  return fills[key] ?? 'var(--ink-3)'
}

/**
 * Category hue keyed by the category's identity (its position in the
 * category list by id), so a category keeps its color whatever its rank or
 * the date range. Categories past the palette's length, and "Uncategorised",
 * fall back to gray.
 */
function categoryHue(name: string, categories: { id: number; name: string }[] | undefined, hues: string[]): string {
  const ordered = [...(categories ?? [])].sort((a, b) => a.id - b.id)
  const i = ordered.findIndex(c => c.name === name)
  return i >= 0 && i < hues.length ? hues[i] : 'var(--ink-3)'
}

/** Solid hue for one bar (the gradient mode ignores it and uses the brand fill). */
function barColor(
  chart: 'priority' | 'status' | 'category',
  key: string,
  theme: Theme,
  hues: string[],
  statusMap: Map<string, string>,
  categories?: { id: number; name: string }[],
): string {
  if (chart === 'priority') return priorityFill(key, hues)
  if (chart === 'status') return statusMap.get(key) ?? harmonize(statusColor(key), theme)
  return categoryHue(key, categories, hues)
}

function gradientFill(chart: 'priority' | 'status' | 'category'): string {
  return chart === 'category' ? 'url(#ghGradH)' : 'url(#ghGradV)'
}

/** X-axis tick that wraps multi-word labels ("Pending User") onto two lines. */
function WrappedTick({ x = 0, y = 0, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  const words = statusLabel(payload?.value ?? '').split(' ')
  return (
    <text x={x} y={y + 10} textAnchor="middle" style={TICK_STYLE}>
      {words.map((w, i) => <tspan key={i} x={x} dy={i === 0 ? 0 : 11}>{w}</tspan>)}
    </text>
  )
}

// Value at the end of each bar — identity never rests on color alone
const VALUE_LABEL = { fontSize: 11, fill: 'var(--ink-2)', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }

/** Gradient definitions shared by every chart on the page (referenced by id). */
function ChartGradients() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        <linearGradient id="ghGradV" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--b1)" />
          <stop offset="100%" stopColor="var(--b2)" />
        </linearGradient>
        <linearGradient id="ghGradH" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--b2)" />
          <stop offset="100%" stopColor="var(--b1)" />
        </linearGradient>
      </defs>
    </svg>
  )
}

// ── Date range helpers ─────────────────────────────────────────────────────────

type Range = '7d' | '30d' | '90d'

function toISO(d: Date) {
  return d.toISOString().slice(0, 10)
}

function rangeParams(range: Range): { from_date: string; to_date: string } {
  const today = new Date()
  const days = range === '7d' ? 6 : range === '30d' ? 29 : 89
  const from = new Date(today)
  from.setDate(today.getDate() - days)
  return { from_date: toISO(from), to_date: toISO(today) }
}

// ── Fetch helpers ──────────────────────────────────────────────────────────────

function useReport<T>(path: string, params: Record<string, string>) {
  return useQuery<T>({
    queryKey: ['reports', path, params],
    queryFn: () => api.get<T>(`/reports/${path}`, { params }).then(r => r.data),
    staleTime: 60_000,
  })
}

// ── KPI card ───────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, tone,
}: {
  label: string
  value: string | number
  sub?: React.ReactNode
  tone?: 'warn' | 'danger'
}) {
  return (
    <div className="panel stat">
      <div className="label">{label}</div>
      <div
        className="value"
        style={{ fontSize: 30, color: tone === 'danger' ? 'var(--danger-ink)' : tone === 'warn' ? 'var(--warn-ink)' : undefined }}
      >
        {value}
      </div>
      {sub && <div className="text-[12px] text-ink-3">{sub}</div>}
    </div>
  )
}

// ── Section card ───────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
      </div>
      <div className="px-5 py-4">
        {children}
      </div>
    </section>
  )
}

// ── Custom tooltip — tier-2 glass ──────────────────────────────────────────────

const tooltipSurface: React.CSSProperties = {
  background: 'var(--glass-strong)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  border: '1px solid var(--edge)',
  borderRadius: 10,
  padding: '7px 11px',
  fontSize: 12,
  boxShadow: 'inset 0 1px 0 var(--specular), var(--shadow)',
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={tooltipSurface}>
      {label && <div className="font-mono text-[10px] text-ink-3 mb-1 uppercase tracking-wide">{label}</div>}
      {payload.map((p: any) => (
        <div key={p.name} className="font-mono text-[12px] font-semibold text-ink">
          {p.value}
        </div>
      ))}
    </div>
  )
}

// ── Skeleton ───────────────────────────────────────────────────────────────────

function Skeleton({ height = 200 }: { height?: number }) {
  return (
    <div style={{
      height, borderRadius: 12, background: 'var(--track)',
      animation: 'shimmer 1.5s ease-in-out infinite',
    }} />
  )
}

// ── Shared table cell styles ───────────────────────────────────────────────────

function pct(value: number | null, warnBelow: number, dangerBelow: number): React.ReactNode {
  if (value == null) return '—'
  const color = value < dangerBelow ? 'var(--danger-ink)' : value < warnBelow ? 'var(--warn-ink)' : 'var(--ink)'
  return <span className="font-semibold" style={{ color }}>{value}%</span>
}

// Response times are in minutes — show minutes under an hour, hours after
function fmtMinutes(m: number | null): string {
  if (m == null) return '—'
  return m < 60 ? `${m}m` : `${Math.round(m / 6) / 10}h`
}

// ── Main page ──────────────────────────────────────────────────────────────────

interface Assignee { id: number; name: string }

export default function Reports() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [range, setRange] = useState<Range>('30d')
  const [assigneeId, setAssigneeId] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)
  // Subscribed so status bars repaint once configured status colors load
  const { data: appConfig } = useAppConfig()
  const { data: categories } = useCategories()
  const [colorful, setColorfulState] = useState(loadColorful)
  const theme = useThemeAttr()
  const hues = CATEGORY_PALETTE.map(c => c[theme])
  const statusMap = statusColors(appConfig?.statuses ?? getAllStatuses(), theme)
  // Channels: violet for Slack, sapphire for Web
  const channelFill = (source: string) =>
    source === 'slack' ? hues[3] : source === 'web' ? hues[0] : 'var(--ink-3)'
  const fillFor = (chart: 'priority' | 'status' | 'category', key: string) =>
    colorful ? barColor(chart, key, theme, hues, statusMap, categories) : gradientFill(chart)

  function toggleColorful() {
    setColorfulState(!colorful)
    try { localStorage.setItem(COLORFUL_KEY, colorful ? '0' : '1') } catch { /* storage unavailable */ }
  }

  const params: Record<string, string> = {
    ...rangeParams(range),
    ...(assigneeId != null ? { assignee_id: String(assigneeId) } : {}),
  }

  const { data: assignees } = useQuery<Assignee[]>({
    queryKey: ['reports-assignees'],
    queryFn: () => api.get<Assignee[]>('/reports/assignees').then(r => r.data),
    staleTime: 5 * 60_000,
    enabled: isAdmin,
  })

  async function handleExport() {
    setExporting(true)
    try {
      const res = await api.get('/reports/export', { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `simpletickets_${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const overview   = useReport<Overview>('overview', params)
  const volume     = useReport<VolumePoint[]>('volume', params)
  const byPriority = useReport<ByPriority[]>('by-priority', params)
  const byStatus   = useReport<ByStatus[]>('by-status', params)
  const byCategory = useReport<ByCategory[]>('by-category', params)
  const bySource   = useReport<BySource[]>('by-source', params)
  const techs      = useReport<TechRow[]>('technicians', params)
  const csatNeg    = useReport<CsatNegRow[]>('csat-negative', params)
  const slaBreached = useReport<SlaBreachedRow[]>('sla-breached', params)

  const ov = overview.data
  const rangeLabels: Record<Range, string> = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days' }

  const filterLabel = assigneeId == null
    ? 'All team'
    : assigneeId === user?.id
      ? 'My stats'
      : (assignees?.find(a => a.id === assigneeId)?.name ?? 'Filtered')

  const thClass = undefined // glasshouse styles th globally

  return (
    <AppShell title="Reports">
      <ChartGradients />
      {colorful && (
        <HueGradientDefs theme={theme} colors={[
          ...(byPriority.data ?? []).map(d => fillFor('priority', d.priority)),
          ...(byStatus.data ?? []).map(d => fillFor('status', d.status)),
          ...(byCategory.data ?? []).map(d => fillFor('category', d.category)),
        ]} />
      )}
      {/* ── Toolbar: date range + technician filter + export ── */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {(['7d', '30d', '90d'] as Range[]).map(r => (
          <button key={r} onClick={() => setRange(r)} className={`chip${range === r ? ' on' : ''}`}>
            {rangeLabels[r]}
          </button>
        ))}
        <span className="font-mono text-[11px] text-ink-3 ml-1">
          {params.from_date} → {params.to_date}
        </span>

        <div className="w-px h-5 bg-track mx-1" />

        {isAdmin ? (
          <div className="selectwrap">
            <select
              className="select"
              style={{ padding: '7px 28px 7px 12px', fontSize: 12.5, width: 'auto', ...(assigneeId != null ? { color: 'var(--brand-ink)', fontWeight: 600 } : {}) }}
              value={assigneeId ?? ''}
              onChange={e => setAssigneeId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">All team</option>
              {(assignees ?? []).map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        ) : (
          <>
            {(['all', 'me'] as const).map(mode => {
              const active = mode === 'all' ? assigneeId == null : assigneeId === user?.id
              return (
                <button
                  key={mode}
                  onClick={() => setAssigneeId(mode === 'all' ? null : (user?.id ?? null))}
                  className={`chip${active ? ' on' : ''}`}
                >
                  {mode === 'all' ? 'All team' : 'My stats'}
                </button>
              )
            })}
          </>
        )}

        {assigneeId != null && (
          <span className="text-[12px] font-medium text-brand-ink">— {filterLabel}</span>
        )}

        <div className="flex-1" />

        <button
          onClick={toggleColorful}
          className={`chip${colorful ? ' on' : ''}`}
          aria-pressed={colorful}
          aria-label="Colorful charts"
          title={colorful ? 'Each bar has its own color — click for the brand gradient' : 'Give each bar its own color'}
          style={{ display: 'inline-flex', alignItems: 'center', padding: '6px 9px' }}
        >
          <PaletteIcon dots={colorful ? hues.slice(0, 4) : null} />
        </button>

        {isAdmin && (
          <button
            onClick={handleExport}
            disabled={exporting}
            className="btn ghost sm"
            style={exporting ? { opacity: 0.6, cursor: 'wait' } : undefined}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6.5 1v7M3.5 5.5l3 3 3-3" /><path d="M1 10h11" />
            </svg>
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        )}
      </div>

      {/* ── KPI row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 14 }}>
        {overview.isLoading ? (
          [1, 2, 3, 4, 5, 6, 7].map(i => <Skeleton key={i} height={96} />)
        ) : ov ? (
          <>
            <KpiCard label="Total tickets" value={ov.total} />
            <KpiCard label="Resolved" value={ov.resolved} sub={ov.total ? `${Math.round(ov.resolved * 100 / ov.total)}% of total` : undefined} />
            <KpiCard label="Open" value={ov.open} />
            <KpiCard
              label="SLA compliance"
              value={ov.sla_compliance_pct != null ? `${ov.sla_compliance_pct}%` : '—'}
              sub="of tickets with SLA"
              tone={ov.sla_compliance_pct != null && ov.sla_compliance_pct < 80 ? 'danger' : undefined}
            />
            <KpiCard
              label="First response"
              value={ov.first_response_pct != null ? `${ov.first_response_pct}%` : '—'}
              sub={ov.median_first_response_minutes != null
                ? `median ${fmtMinutes(ov.median_first_response_minutes)} · avg ${fmtMinutes(ov.avg_first_response_minutes)}`
                : 'No responses yet'}
              tone={ov.first_response_pct != null && ov.first_response_pct < 80 ? 'danger' : undefined}
            />
            <KpiCard
              label="Avg resolution"
              value={ov.avg_resolution_hours != null ? `${ov.avg_resolution_hours}h` : '—'}
              sub="for resolved tickets"
            />
            <KpiCard
              label="CSAT"
              value={ov.csat_pct != null ? `${ov.csat_pct}%` : '—'}
              sub={ov.csat_total
                ? <span className="inline-flex items-center gap-1.5">
                    <ThumbUp size={12} /> {ov.csat_positive}
                    <span>·</span>
                    <ThumbDown size={12} /> {ov.csat_total - ov.csat_positive}
                  </span>
                : 'No responses yet'}
              tone={ov.csat_pct != null && ov.csat_pct < 70 ? 'danger' : undefined}
            />
          </>
        ) : null}
      </div>

      {/* ── Volume over time ── */}
      <div className="mb-3.5">
        <Section title="Ticket volume">
          {volume.isLoading ? <Skeleton height={220} /> : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={volume.data ?? []} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke="var(--track)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={TICK_STYLE}
                  tickFormatter={v => v.slice(5)}
                  interval="preserveStartEnd"
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tick={TICK_STYLE} allowDecimals={false} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  type="monotone" dataKey="count" stroke={colorful ? hues[0] : 'var(--b1)'}
                  strokeWidth={2} dot={false} activeDot={{ r: 4, fill: colorful ? hues[0] : 'var(--b1)', stroke: 'none' }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Section>
      </div>

      {/* ── Priority + Status ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <Section title="By priority">
          {byPriority.isLoading ? <Skeleton /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byPriority.data ?? []} margin={{ top: 20, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke="var(--track)" vertical={false} />
                <XAxis dataKey="priority" tick={TICK_STYLE} axisLine={false} tickLine={false} />
                <YAxis tick={TICK_STYLE} allowDecimals={false} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--row-hover)' }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} shape={colorful ? hueGradientBar(false) : undefined}>
                  {(byPriority.data ?? []).map(d => (
                    <Cell key={d.priority} fill={fillFor('priority', d.priority)} />
                  ))}
                  <LabelList dataKey="count" position="top" style={VALUE_LABEL} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Section>

        <Section title="By status">
          {byStatus.isLoading ? <Skeleton /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byStatus.data ?? []} margin={{ top: 20, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke="var(--track)" vertical={false} />
                <XAxis
                  dataKey="status"
                  tick={<WrappedTick />}
                  interval={0}
                  height={34}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tick={TICK_STYLE} allowDecimals={false} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--row-hover)' }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} shape={colorful ? hueGradientBar(false) : undefined}>
                  {(byStatus.data ?? []).map(d => (
                    <Cell key={d.status} fill={fillFor('status', d.status)} />
                  ))}
                  <LabelList dataKey="count" position="top" style={VALUE_LABEL} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Section>
      </div>

      {/* ── By category + By source ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 14, marginBottom: 14 }}>
        <Section title="By category">
          {byCategory.isLoading ? <Skeleton height={180} /> : (
            <ResponsiveContainer width="100%" height={Math.max(180, (byCategory.data?.length ?? 1) * 36)}>
              <BarChart
                data={byCategory.data ?? []}
                layout="vertical"
                margin={{ top: 4, right: 40, bottom: 0, left: 100 }}
              >
                <CartesianGrid stroke="var(--track)" horizontal={false} />
                <XAxis type="number" tick={TICK_STYLE} allowDecimals={false} axisLine={false} tickLine={false} />
                <YAxis
                  type="category" dataKey="category"
                  tick={{ fontSize: 12, fill: 'var(--ink-2)' }}
                  width={96}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--row-hover)' }} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} shape={colorful ? hueGradientBar(true) : undefined}>
                  {(byCategory.data ?? []).map(d => (
                    <Cell key={d.category} fill={fillFor('category', d.category)} />
                  ))}
                  <LabelList dataKey="count" position="right" style={VALUE_LABEL} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Section>

        <Section title="By channel">
          {bySource.isLoading ? <Skeleton height={180} /> : (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={bySource.data ?? []}
                  dataKey="count"
                  nameKey="source"
                  cx="50%"
                  cy="45%"
                  innerRadius={48}
                  outerRadius={72}
                  paddingAngle={3}
                  stroke="none"
                >
                  {(bySource.data ?? []).map((entry, i) => (
                    <Cell
                      key={entry.source}
                      fill={colorful
                        ? channelFill(entry.source)
                        : (i === 0 ? 'url(#ghGradV)' : 'var(--ink-3)')}
                    />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const p = payload[0]
                    return (
                      <div style={tooltipSurface}>
                        <div className="font-mono text-[10px] text-ink-3 mb-0.5 uppercase tracking-wide">{p.name}</div>
                        <div className="font-mono text-[12px] font-semibold text-ink">{p.value} tickets</div>
                      </div>
                    )
                  }}
                />
                <Legend
                  formatter={(value, entry: any) => (
                    <span className="text-[12px] text-ink-2 capitalize">
                      {value}{' '}
                      <span className="font-mono font-semibold text-ink">{entry?.payload?.count ?? ''}</span>
                    </span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Section>
      </div>

      {/* ── Technician performance ── */}
      <section className="panel">
        <div className="panel-head">
          <h2>Technician performance</h2>
        </div>
        <div className="tablewrap">
          {techs.isLoading ? <div className="p-3"><Skeleton height={120} /></div> : (
            <table>
              <thead>
                <tr>
                  {['Name', 'Assigned', 'Resolved', 'Avg resolution', 'SLA compliance', 'First response', 'CSAT'].map(h => (
                    <th key={h} className={thClass}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(techs.data ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '24px 12px', textAlign: 'center', whiteSpace: 'normal' }} className="text-ink-3">
                      No assigned tickets in this period
                    </td>
                  </tr>
                ) : (techs.data ?? []).map(row => (
                  <tr key={row.name}>
                    <td className="name">{row.name}</td>
                    <td className="text-ink-2">{row.total}</td>
                    <td className="text-ink-2">
                      {row.resolved}
                      {row.total > 0 && (
                        <span className="text-ink-3 text-[11px] ml-1">
                          ({Math.round(row.resolved * 100 / row.total)}%)
                        </span>
                      )}
                    </td>
                    <td className="text-ink-2">{row.avg_hours != null ? `${row.avg_hours}h` : '—'}</td>
                    <td>{pct(row.sla_pct, 90, 70)}</td>
                    <td>
                      {pct(row.first_response_pct, 90, 70)}
                      {row.avg_first_response_minutes != null && (
                        <span className="text-ink-3 text-[11px] ml-1">
                          (avg {fmtMinutes(row.avg_first_response_minutes)})
                        </span>
                      )}
                    </td>
                    <td>{pct(row.csat_pct, 80, 60)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ── Needs review ── */}
      <section className="panel mt-3.5">
        <div className="panel-head">
          <h2 className="flex items-center gap-2">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--warn-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Needs review
          </h2>
          <span className="sub">tickets in this period that may require follow-up</span>
        </div>

        {/* SLA breaches sub-section */}
        <div className="px-5 pt-3 pb-1 flex items-center gap-1.5 text-[12px] font-semibold text-ink-2">
          SLA breaches
          {(slaBreached.data ?? []).length > 0 && (
            <span className="pill danger plain" style={{ padding: '1px 8px', fontSize: 11 }}>
              {slaBreached.data!.length}
            </span>
          )}
        </div>
        <div className="tablewrap" style={{ paddingTop: 0 }}>
          {slaBreached.isLoading ? <div className="p-4"><Skeleton height={60} /></div> : (slaBreached.data ?? []).length === 0 ? (
            <p className="text-center text-ink-3 text-[13px] py-4 m-0">No SLA breaches in this period</p>
          ) : (
            <table>
              <thead>
                <tr>
                  {['Ticket', 'Title', 'Status', 'Priority', 'Assignee', 'SLA deadline'].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(slaBreached.data ?? []).map(row => (
                  <tr key={row.id} className="clickable" onClick={() => navigate(`/tickets/${row.id}`)}>
                    <td><span className="sn" style={{ color: 'var(--brand-ink)' }}>TKT-{String(row.id).padStart(4, '0')}</span></td>
                    <td style={{ maxWidth: 260 }}><span className="block truncate">{row.title}</span></td>
                    <td><span className="pill avail plain">{row.status.replace('_', ' ')}</span></td>
                    <td className="text-ink-2 capitalize">{row.priority}</td>
                    <td className="text-ink-2">{row.assignee_name ?? '—'}</td>
                    <td className="font-mono text-[11.5px] text-danger-ink">{row.sla_deadline ? parseUTC(row.sla_deadline).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Negative CSAT sub-section */}
        <div className="px-5 pt-1 pb-1 flex items-center gap-1.5 text-[12px] font-semibold text-ink-2 border-t border-track">
          <ThumbDown size={13} /> Negative CSAT feedback
          {(csatNeg.data ?? []).length > 0 && (
            <span className="pill danger plain" style={{ padding: '1px 8px', fontSize: 11 }}>
              {csatNeg.data!.length}
            </span>
          )}
        </div>
        <div className="tablewrap" style={{ paddingTop: 0 }}>
          {csatNeg.isLoading ? <div className="p-4"><Skeleton height={60} /></div> : (csatNeg.data ?? []).length === 0 ? (
            <p className="text-center text-ink-3 text-[13px] py-4 m-0">No negative CSAT feedback in this period</p>
          ) : (
            <table>
              <thead>
                <tr>
                  {['Ticket', 'Title', 'Status', 'Priority', 'Assignee', 'Feedback received'].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(csatNeg.data ?? []).map(row => (
                  <tr key={row.id} className="clickable" onClick={() => navigate(`/tickets/${row.id}`)}>
                    <td><span className="sn" style={{ color: 'var(--brand-ink)' }}>TKT-{String(row.id).padStart(4, '0')}</span></td>
                    <td style={{ maxWidth: 260 }}><span className="block truncate">{row.title}</span></td>
                    <td><span className="pill avail plain">{row.status.replace('_', ' ')}</span></td>
                    <td className="text-ink-2 capitalize">{row.priority}</td>
                    <td className="text-ink-2">{row.assignee_name ?? '—'}</td>
                    <td className="font-mono text-[11.5px] text-ink-3">{parseUTC(row.responded_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </AppShell>
  )
}
