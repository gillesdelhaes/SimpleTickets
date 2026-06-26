import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from 'recharts'
import AppShell from '../components/layout/AppShell'
import { statusColor } from '../types/ticket'
import api from '../lib/api'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Overview {
  total: number
  resolved: number
  open: number
  sla_compliance_pct: number | null
  avg_resolution_hours: number | null
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
}

// ── Colours ────────────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#EF4444',
  high:     '#F97316',
  medium:   '#EAB308',
  low:      '#3B82F6',
}


const CATEGORY_COLOR = '#AD1164'

const SOURCE_COLORS: Record<string, string> = {
  slack: '#10B981',
  web:   '#3B82F6',
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
  label, value, sub, accent,
}: {
  label: string
  value: string | number
  sub?: string
  accent?: string
}) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #E5E5E5', borderRadius: 12,
      padding: '18px 22px',
      borderTop: `3px solid ${accent ?? '#FF4713'}`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#A3A3A3', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 32, fontWeight: 700, color: '#0A0A0A', letterSpacing: '-0.03em', lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: '#737373', marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

// ── Section card ───────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E5E5', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid #F2F2F2',
        fontSize: 13, fontWeight: 600, color: '#0A0A0A',
      }}>
        {title}
      </div>
      <div style={{ padding: '20px' }}>
        {children}
      </div>
    </div>
  )
}

// ── Custom tooltip ─────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 8, padding: '8px 12px', fontSize: 12,
    }}>
      {label && <div style={{ color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>{label}</div>}
      {payload.map((p: any) => (
        <div key={p.name} style={{ color: p.fill ?? p.stroke ?? '#fff', fontWeight: 600 }}>
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
      height, borderRadius: 8, background: '#F2F2F2',
      animation: 'shimmer 1.5s ease-in-out infinite',
    }} />
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Reports() {
  const [range, setRange] = useState<Range>('30d')
  const [exporting, setExporting] = useState(false)
  const params = rangeParams(range)

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

  const ov = overview.data

  const rangeLabels: Record<Range, string> = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days' }

  return (
    <AppShell title="Reports">
      <style>{`
        @keyframes shimmer { 0%,100%{opacity:1}50%{opacity:0.4} }
      `}</style>

      {/* ── Date range filter + export ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
        {(['7d', '30d', '90d'] as Range[]).map(r => (
          <button
            key={r}
            onClick={() => setRange(r)}
            style={{
              padding: '6px 16px', borderRadius: 8, border: '1px solid',
              fontSize: 13, fontWeight: range === r ? 600 : 400, cursor: 'pointer',
              borderColor: range === r ? '#FF4713' : '#E5E5E5',
              background: range === r ? 'rgba(255,71,19,0.06)' : '#fff',
              color: range === r ? '#FF4713' : '#737373',
              transition: 'all 0.12s',
            }}
          >
            {rangeLabels[r]}
          </button>
        ))}
        <span style={{ fontSize: 12, color: '#A3A3A3', marginLeft: 8 }}>
          {params.from_date} → {params.to_date}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={handleExport}
          disabled={exporting}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 8,
            border: '1px solid #E5E5E5', background: '#fff',
            fontSize: 13, fontWeight: 500, cursor: exporting ? 'not-allowed' : 'pointer',
            color: exporting ? '#A3A3A3' : '#262626',
            transition: 'all 0.12s',
          }}
          onMouseOver={e => { if (!exporting) { e.currentTarget.style.borderColor = '#0A0A0A'; e.currentTarget.style.color = '#0A0A0A' } }}
          onMouseOut={e => { e.currentTarget.style.borderColor = '#E5E5E5'; e.currentTarget.style.color = exporting ? '#A3A3A3' : '#262626' }}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6.5 1v7M3.5 5.5l3 3 3-3" />
            <path d="M1 10h11" />
          </svg>
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {/* ── KPI row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        {overview.isLoading ? (
          [1,2,3,4,5].map(i => <Skeleton key={i} height={96} />)
        ) : ov ? (
          <>
            <KpiCard label="Total tickets" value={ov.total} accent="#FF4713" />
            <KpiCard label="Resolved" value={ov.resolved} sub={ov.total ? `${Math.round(ov.resolved * 100 / ov.total)}% of total` : undefined} accent="#10B981" />
            <KpiCard label="Open" value={ov.open} accent="#3B82F6" />
            <KpiCard
              label="SLA compliance"
              value={ov.sla_compliance_pct != null ? `${ov.sla_compliance_pct}%` : '—'}
              sub="of tickets with SLA"
              accent={ov.sla_compliance_pct != null && ov.sla_compliance_pct < 80 ? '#EF4444' : '#10B981'}
            />
            <KpiCard
              label="Avg resolution"
              value={ov.avg_resolution_hours != null ? `${ov.avg_resolution_hours}h` : '—'}
              sub="for resolved tickets"
              accent="#8B5CF6"
            />
          </>
        ) : null}
      </div>

      {/* ── Volume over time ── */}
      <div style={{ marginBottom: 24 }}>
        <Section title="Ticket volume">
          {volume.isLoading ? <Skeleton height={220} /> : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={volume.data ?? []} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F2F2F2" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: '#A3A3A3' }}
                  tickFormatter={v => v.slice(5)}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 11, fill: '#A3A3A3' }} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  type="monotone" dataKey="count" stroke="#FF4713"
                  strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#FF4713' }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Section>
      </div>

      {/* ── Priority + Status ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <Section title="By priority">
          {byPriority.isLoading ? <Skeleton /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byPriority.data ?? []} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F2F2F2" vertical={false} />
                <XAxis dataKey="priority" tick={{ fontSize: 11, fill: '#A3A3A3' }} />
                <YAxis tick={{ fontSize: 11, fill: '#A3A3A3' }} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                <Bar dataKey="count" radius={[4,4,0,0]}>
                  {(byPriority.data ?? []).map(entry => (
                    <Cell key={entry.priority} fill={PRIORITY_COLORS[entry.priority] ?? '#E5E5E5'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Section>

        <Section title="By status">
          {byStatus.isLoading ? <Skeleton /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byStatus.data ?? []} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F2F2F2" vertical={false} />
                <XAxis
                  dataKey="status"
                  tick={{ fontSize: 10, fill: '#A3A3A3' }}
                  tickFormatter={v => v.replace('_', ' ')}
                />
                <YAxis tick={{ fontSize: 11, fill: '#A3A3A3' }} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                <Bar dataKey="count" radius={[4,4,0,0]}>
                  {(byStatus.data ?? []).map(entry => (
                    <Cell key={entry.status} fill={statusColor(entry.status)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Section>
      </div>

      {/* ── By category + By source ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, marginBottom: 24 }}>
        <Section title="By category">
          {byCategory.isLoading ? <Skeleton height={180} /> : (
            <ResponsiveContainer width="100%" height={Math.max(180, (byCategory.data?.length ?? 1) * 36)}>
              <BarChart
                data={byCategory.data ?? []}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 0, left: 100 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#F2F2F2" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#A3A3A3' }} allowDecimals={false} />
                <YAxis
                  type="category" dataKey="category"
                  tick={{ fontSize: 12, fill: '#737373' }}
                  width={96}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                <Bar dataKey="count" fill={CATEGORY_COLOR} radius={[0,4,4,0]} />
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
                >
                  {(bySource.data ?? []).map(entry => (
                    <Cell key={entry.source} fill={SOURCE_COLORS[entry.source] ?? '#E5E5E5'} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const p = payload[0]
                    return (
                      <div style={{ background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
                        <div style={{ color: 'rgba(255,255,255,0.5)', marginBottom: 2, textTransform: 'capitalize' }}>{p.name}</div>
                        <div style={{ color: p.payload.fill ?? '#fff', fontWeight: 600 }}>{p.value} tickets</div>
                      </div>
                    )
                  }}
                />
                <Legend
                  formatter={(value) => (
                    <span style={{ fontSize: 12, color: '#737373', textTransform: 'capitalize' }}>{value}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Section>
      </div>

      {/* ── Technician performance ── */}
      <Section title="Technician performance">
        {techs.isLoading ? <Skeleton height={120} /> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Name', 'Assigned', 'Resolved', 'Avg resolution', 'SLA compliance'].map(h => (
                  <th key={h} style={{
                    textAlign: 'left', padding: '6px 12px',
                    fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.07em', color: '#A3A3A3',
                    borderBottom: '1px solid #F2F2F2',
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(techs.data ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '24px 12px', textAlign: 'center', color: '#A3A3A3', fontSize: 13 }}>
                    No assigned tickets in this period
                  </td>
                </tr>
              ) : (techs.data ?? []).map(row => (
                <tr key={row.name} style={{ borderBottom: '1px solid #F9F9F9' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 500, color: '#262626' }}>{row.name}</td>
                  <td style={{ padding: '10px 12px', color: '#737373' }}>{row.total}</td>
                  <td style={{ padding: '10px 12px', color: '#737373' }}>
                    {row.resolved}
                    {row.total > 0 && (
                      <span style={{ color: '#A3A3A3', fontSize: 11, marginLeft: 4 }}>
                        ({Math.round(row.resolved * 100 / row.total)}%)
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#737373' }}>
                    {row.avg_hours != null ? `${row.avg_hours}h` : '—'}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {row.sla_pct != null ? (
                      <span style={{
                        fontWeight: 600,
                        color: row.sla_pct >= 90 ? '#10B981' : row.sla_pct >= 70 ? '#EAB308' : '#EF4444',
                      }}>
                        {row.sla_pct}%
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

    </AppShell>
  )
}
