import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ThumbUp, ThumbDown } from '../components/ThumbIcon'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from 'recharts'
import AppShell from '../components/layout/AppShell'
import { statusColor } from '../types/ticket'
import { useAuth } from '../contexts/AuthContext'
import api from '../lib/api'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Overview {
  total: number
  resolved: number
  open: number
  sla_compliance_pct: number | null
  avg_resolution_hours: number | null
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
  sub?: React.ReactNode
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

interface Assignee { id: number; name: string }

export default function Reports() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [range, setRange] = useState<Range>('30d')
  const [assigneeId, setAssigneeId] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)

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

  return (
    <AppShell title="Reports">
      {/* ── Toolbar: date range + technician filter + export ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {/* Date range pills */}
        {(['7d', '30d', '90d'] as Range[]).map(r => (
          <button key={r} onClick={() => setRange(r)} style={{
            padding: '6px 16px', borderRadius: 8, border: '1px solid',
            fontSize: 13, fontWeight: range === r ? 600 : 400, cursor: 'pointer',
            borderColor: range === r ? '#FF4713' : '#E5E5E5',
            background: range === r ? 'rgba(255,71,19,0.06)' : '#fff',
            color: range === r ? '#FF4713' : '#737373',
            transition: 'all 0.12s',
          }}>
            {rangeLabels[r]}
          </button>
        ))}
        <span style={{ fontSize: 12, color: '#A3A3A3', marginLeft: 4 }}>
          {params.from_date} → {params.to_date}
        </span>

        {/* Separator */}
        <div style={{ width: 1, height: 20, background: '#E5E5E5', margin: '0 4px' }} />

        {/* Technician filter */}
        {isAdmin ? (
          <select
            value={assigneeId ?? ''}
            onChange={e => setAssigneeId(e.target.value ? Number(e.target.value) : null)}
            style={{
              padding: '5px 10px', borderRadius: 8, border: '1px solid #E5E5E5',
              fontSize: 13, color: assigneeId != null ? '#FF4713' : '#737373',
              background: assigneeId != null ? 'rgba(255,71,19,0.04)' : '#fff',
              borderColor: assigneeId != null ? '#FF4713' : '#E5E5E5',
              cursor: 'pointer', outline: 'none',
            }}
          >
            <option value="">All team</option>
            {(assignees ?? []).map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        ) : (
          <>
            {(['all', 'me'] as const).map(mode => {
              const active = mode === 'all' ? assigneeId == null : assigneeId === user?.id
              return (
                <button key={mode} onClick={() => setAssigneeId(mode === 'all' ? null : (user?.id ?? null))}
                  style={{
                    padding: '5px 14px', borderRadius: 8, border: '1px solid', fontSize: 13,
                    cursor: 'pointer', transition: 'all 0.12s', fontWeight: active ? 600 : 400,
                    borderColor: active ? '#FF4713' : '#E5E5E5',
                    background: active ? 'rgba(255,71,19,0.06)' : '#fff',
                    color: active ? '#FF4713' : '#737373',
                  }}>
                  {mode === 'all' ? 'All team' : 'My stats'}
                </button>
              )
            })}
          </>
        )}

        {assigneeId != null && (
          <span style={{ fontSize: 12, color: '#FF4713', fontWeight: 500 }}>
            — {filterLabel}
          </span>
        )}

        <div style={{ flex: 1 }} />

        {isAdmin && (
          <button onClick={handleExport} disabled={exporting} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 8,
            border: '1px solid #E5E5E5', background: '#fff',
            fontSize: 13, fontWeight: 500, cursor: exporting ? 'not-allowed' : 'pointer',
            color: exporting ? '#A3A3A3' : '#262626', transition: 'all 0.12s',
          }}
            onMouseOver={e => { if (!exporting) { e.currentTarget.style.borderColor = '#0A0A0A'; e.currentTarget.style.color = '#0A0A0A' } }}
            onMouseOut={e => { e.currentTarget.style.borderColor = '#E5E5E5'; e.currentTarget.style.color = exporting ? '#A3A3A3' : '#262626' }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6.5 1v7M3.5 5.5l3 3 3-3" /><path d="M1 10h11" />
            </svg>
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        )}
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
            <KpiCard
              label="CSAT"
              value={ov.csat_pct != null ? `${ov.csat_pct}%` : '—'}
              sub={ov.csat_total
                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <ThumbUp color="#059669" /> {ov.csat_positive}
                    <span style={{ color: '#D1D5DB' }}>·</span>
                    <ThumbDown color="#DC2626" /> {ov.csat_total - ov.csat_positive}
                  </span>
                : 'No responses yet'}
              accent={ov.csat_pct != null && ov.csat_pct < 70 ? '#EF4444' : '#F59E0B'}
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
                {['Name', 'Assigned', 'Resolved', 'Avg resolution', 'SLA compliance', 'CSAT'].map(h => (
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
                  <td style={{ padding: '10px 12px' }}>
                    {row.csat_pct != null ? (
                      <span style={{
                        fontWeight: 600,
                        color: row.csat_pct >= 80 ? '#10B981' : row.csat_pct >= 60 ? '#EAB308' : '#EF4444',
                      }}>
                        {row.csat_pct}%
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>


      {/* ── Needs review ── */}
      <div style={{ marginTop: 32 }}>
        {/* Section header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '12px 20px',
          background: '#FFFBEB', border: '1px solid #FDE68A',
          borderRadius: '12px 12px 0 0',
          borderBottom: 'none',
        }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#92400E', letterSpacing: '0.01em' }}>
            Needs review
          </span>
          <span style={{ fontSize: 12, color: '#B45309', marginLeft: 2 }}>
            — tickets in this period that may require follow-up
          </span>
        </div>

        {/* SLA breaches sub-section */}
        <div style={{ background: '#fff', border: '1px solid #FDE68A', borderTop: '1px solid #F2F2F2', borderBottom: 'none' }}>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid #F2F2F2', fontSize: 12, fontWeight: 600, color: '#737373', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#EF4444' }}>⏱</span> SLA breaches
            {(slaBreached.data ?? []).length > 0 && (
              <span style={{ marginLeft: 4, padding: '1px 7px', borderRadius: 999, background: '#FEE2E2', color: '#DC2626', fontSize: 11, fontWeight: 700 }}>
                {slaBreached.data!.length}
              </span>
            )}
          </div>
          <div style={{ padding: '0 0 4px' }}>
            {slaBreached.isLoading ? <div style={{ padding: 20 }}><Skeleton height={60} /></div> : (slaBreached.data ?? []).length === 0 ? (
              <div style={{ textAlign: 'center', color: '#A3A3A3', fontSize: 13, padding: '20px 0' }}>No SLA breaches in this period</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {['Ticket', 'Title', 'Status', 'Priority', 'Assignee', 'SLA deadline'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '6px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#A3A3A3', borderBottom: '1px solid #F2F2F2' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(slaBreached.data ?? []).map(row => (
                    <tr key={row.id} style={{ borderBottom: '1px solid #F9F9F9', cursor: 'pointer' }} onClick={() => navigate(`/tickets/${row.id}`)} onMouseEnter={e => { e.currentTarget.style.background = '#F9F9F9' }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12, color: '#FF4713', whiteSpace: 'nowrap', textDecoration: 'underline' }}>TKT-{String(row.id).padStart(4, '0')}</td>
                      <td style={{ padding: '10px 12px', color: '#262626', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: '#F2F2F2', color: '#737373' }}>{row.status.replace('_', ' ')}</span>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#737373', textTransform: 'capitalize' }}>{row.priority}</td>
                      <td style={{ padding: '10px 12px', color: '#737373' }}>{row.assignee_name ?? '—'}</td>
                      <td style={{ padding: '10px 12px', color: '#EF4444', fontSize: 12 }}>{row.sla_deadline ? new Date(row.sla_deadline).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Negative CSAT sub-section */}
        <div style={{ background: '#fff', border: '1px solid #FDE68A', borderTop: '1px solid #F2F2F2', borderRadius: '0 0 12px 12px' }}>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid #F2F2F2', fontSize: 12, fontWeight: 600, color: '#737373', display: 'flex', alignItems: 'center', gap: 6 }}>
            <ThumbDown size={13} color="#DC2626" /> Negative CSAT feedback
            {(csatNeg.data ?? []).length > 0 && (
              <span style={{ marginLeft: 4, padding: '1px 7px', borderRadius: 999, background: '#FEE2E2', color: '#DC2626', fontSize: 11, fontWeight: 700 }}>
                {csatNeg.data!.length}
              </span>
            )}
          </div>
          <div style={{ padding: '0 0 4px' }}>
            {csatNeg.isLoading ? <div style={{ padding: 20 }}><Skeleton height={60} /></div> : (csatNeg.data ?? []).length === 0 ? (
              <div style={{ textAlign: 'center', color: '#A3A3A3', fontSize: 13, padding: '20px 0' }}>No negative CSAT feedback in this period</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {['Ticket', 'Title', 'Status', 'Priority', 'Assignee', 'Feedback received'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '6px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#A3A3A3', borderBottom: '1px solid #F2F2F2' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(csatNeg.data ?? []).map(row => (
                    <tr key={row.id} style={{ borderBottom: '1px solid #F9F9F9', cursor: 'pointer' }} onClick={() => navigate(`/tickets/${row.id}`)} onMouseEnter={e => { e.currentTarget.style.background = '#F9F9F9' }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12, color: '#FF4713', whiteSpace: 'nowrap', textDecoration: 'underline' }}>TKT-{String(row.id).padStart(4, '0')}</td>
                      <td style={{ padding: '10px 12px', color: '#262626', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: '#F2F2F2', color: '#737373' }}>{row.status.replace('_', ' ')}</span>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#737373', textTransform: 'capitalize' }}>{row.priority}</td>
                      <td style={{ padding: '10px 12px', color: '#737373' }}>{row.assignee_name ?? '—'}</td>
                      <td style={{ padding: '10px 12px', color: '#A3A3A3', fontSize: 12 }}>{new Date(row.responded_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

    </AppShell>
  )
}
