import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AdminPageShell from '../../components/admin/AdminPageShell'
import api from '../../lib/api'

type Priority = 'low' | 'medium' | 'high' | 'critical'

interface SLAPolicyRead {
  id: number
  name: string
  priority: Priority
  first_response_minutes: number
  resolution_minutes: number
}

const PRIORITY_COLORS: Record<Priority, string> = {
  critical: '#AD1164',
  high: '#FF4713',
  medium: '#F59E0B',
  low: '#3B82F6',
}

const PRIORITY_LABELS: Record<Priority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

const PRIORITY_ORDER: Priority[] = ['critical', 'high', 'medium', 'low']

function formatMinutes(m: number): string {
  if (m < 60) return `${m}m`
  const days = Math.floor(m / 1440)
  const hours = Math.floor((m % 1440) / 60)
  const mins = m % 60
  if (days > 0) return mins > 0 ? `${days}d ${hours}h ${mins}m` : hours > 0 ? `${days}d ${hours}h` : `${days}d`
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

const numInp: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 7, border: '1.5px solid #E5E5E5',
  fontSize: 13, color: '#262626', background: '#fff', outline: 'none',
  fontFamily: 'Inter, system-ui, sans-serif', width: '100%', boxSizing: 'border-box',
  transition: 'border-color 0.15s',
}

// ── Editable row ───────────────────────────────────────────────────────────────

interface PolicyRowProps {
  policy: SLAPolicyRead
}

function PolicyRow({ policy }: PolicyRowProps) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [name, setName] = useState(policy.name)
  const [resp, setResp] = useState(String(policy.first_response_minutes))
  const [res, setRes] = useState(String(policy.resolution_minutes))

  const patchMutation = useMutation({
    mutationFn: () =>
      api.patch<SLAPolicyRead>(`/sla-policies/${policy.id}`, {
        name: name.trim() || undefined,
        first_response_minutes: resp ? Number(resp) : undefined,
        resolution_minutes: res ? Number(res) : undefined,
      }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sla-policies'] })
      setEditing(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/sla-policies/${policy.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sla-policies'] })
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      alert(msg ?? 'Cannot delete this policy.')
      setConfirmDelete(false)
    },
  })

  const color = PRIORITY_COLORS[policy.priority]

  if (editing) {
    return (
      <tr style={{ background: '#FFFBF0', borderBottom: '1px solid #FDE68A' }}>
        <td style={{ padding: '10px 16px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, color, background: `${color}15`, border: `1px solid ${color}25` }}>
            {PRIORITY_LABELS[policy.priority]}
          </span>
        </td>
        <td style={{ padding: '10px 16px' }}>
          <input value={name} onChange={e => setName(e.target.value)}
            style={{ ...numInp, minWidth: 160 }} />
        </td>
        <td style={{ padding: '10px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="number" min="1" value={resp} onChange={e => setResp(e.target.value)}
              style={{ ...numInp, width: 80 }} />
            <span style={{ fontSize: 12, color: '#737373' }}>min</span>
          </div>
        </td>
        <td style={{ padding: '10px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="number" min="1" value={res} onChange={e => setRes(e.target.value)}
              style={{ ...numInp, width: 80 }} />
            <span style={{ fontSize: 12, color: '#737373' }}>min</span>
          </div>
        </td>
        <td style={{ padding: '10px 16px' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => patchMutation.mutate()}
              disabled={patchMutation.isPending}
              style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#10B981', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {patchMutation.isPending ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => { setEditing(false); setName(policy.name); setResp(String(policy.first_response_minutes)); setRes(String(policy.resolution_minutes)) }}
              style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #E5E5E5', background: '#fff', color: '#737373', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </td>
      </tr>
    )
  }

  if (confirmDelete) {
    return (
      <tr style={{ background: '#FEF2F2', borderBottom: '1px solid #FECACA' }}>
        <td colSpan={4} style={{ padding: '12px 16px' }}>
          <span style={{ fontSize: 13, color: '#DC2626', fontWeight: 500 }}>
            Delete "{policy.name}"? This will unlink tickets using this policy.
          </span>
        </td>
        <td style={{ padding: '12px 16px' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#EF4444', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {deleteMutation.isPending ? 'Deleting…' : 'Confirm Delete'}
            </button>
            <button onClick={() => setConfirmDelete(false)}
              style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #E5E5E5', background: '#fff', color: '#737373', fontSize: 12, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr
      style={{ borderBottom: '1px solid #F9F9F9', transition: 'background 0.1s' }}
      onMouseEnter={e => (e.currentTarget.style.background = '#FAFAFA')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <td style={{ padding: '12px 16px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, color, background: `${color}15`, border: `1px solid ${color}25` }}>
          {PRIORITY_LABELS[policy.priority]}
        </span>
      </td>
      <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 500, color: '#0A0A0A' }}>{policy.name}</td>
      <td style={{ padding: '12px 16px' }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#262626' }}>
          {formatMinutes(policy.first_response_minutes)}
        </span>
      </td>
      <td style={{ padding: '12px 16px' }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#262626' }}>
          {formatMinutes(policy.resolution_minutes)}
        </span>
      </td>
      <td style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setEditing(true)}
            style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #E5E5E5', background: '#fff', fontSize: 11, fontWeight: 600, color: '#262626', cursor: 'pointer' }}>
            Edit
          </button>
          <button onClick={() => setConfirmDelete(true)}
            style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #E5E5E5', background: '#fff', fontSize: 11, fontWeight: 500, color: '#EF4444', cursor: 'pointer' }}>
            Delete
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── SLA Policies page ──────────────────────────────────────────────────────────

export default function SLAPolicies() {
  const queryClient = useQueryClient()
  const [showAddForm, setShowAddForm] = useState(false)
  const [newPriority, setNewPriority] = useState<Priority>('medium')
  const [newName, setNewName] = useState('')
  const [newResp, setNewResp] = useState('')
  const [newRes, setNewRes] = useState('')
  const [addError, setAddError] = useState<string | null>(null)

  const { data: policies, isLoading } = useQuery<SLAPolicyRead[]>({
    queryKey: ['sla-policies'],
    queryFn: () => api.get<SLAPolicyRead[]>('/sla-policies').then(r => r.data),
    staleTime: 60_000,
  })

  const existingPriorities = new Set(policies?.map(p => p.priority) ?? [])
  const availablePriorities = PRIORITY_ORDER.filter(p => !existingPriorities.has(p))

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<SLAPolicyRead>('/sla-policies', {
        name: newName.trim(),
        priority: newPriority,
        first_response_minutes: Number(newResp),
        resolution_minutes: Number(newRes),
      }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sla-policies'] })
      setNewName(''); setNewResp(''); setNewRes(''); setAddError(null); setShowAddForm(false)
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setAddError(msg ?? 'Failed to create policy.')
    },
  })

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setAddError(null)
    if (!newName.trim() || !newResp || !newRes) { setAddError('All fields are required.'); return }
    if (Number(newResp) <= 0 || Number(newRes) <= 0) { setAddError('Minutes must be positive.'); return }
    createMutation.mutate()
  }

  const sorted = [...(policies ?? [])].sort(
    (a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority)
  )

  return (
    <AdminPageShell title="SLA Policies">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0A0A0A', letterSpacing: '-0.02em', margin: 0 }}>SLA Policies</h1>
          <p style={{ fontSize: 13, color: '#737373', marginTop: 3 }}>
            One policy per priority. Times are in minutes — displayed as human-readable durations.
          </p>
        </div>
        {availablePriorities.length > 0 && (
          <button
            onClick={() => { setShowAddForm(v => !v); if (availablePriorities.length > 0) setNewPriority(availablePriorities[0]) }}
            style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: showAddForm ? '#F2F2F2' : 'linear-gradient(135deg, #FF4713, #AD1164)', color: showAddForm ? '#737373' : '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
            {showAddForm ? 'Cancel' : '+ Add Policy'}
          </button>
        )}
      </div>

      {/* Add form */}
      {showAddForm && availablePriorities.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #E5E5E5', borderTop: '3px solid #FF4713', borderRadius: 12, padding: '20px 24px', marginBottom: 20 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: '#262626', margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>New Policy</h3>
          <form onSubmit={handleCreate}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#262626', marginBottom: 5 }}>Priority</label>
                <select value={newPriority} onChange={e => setNewPriority(e.target.value as Priority)}
                  style={{ ...numInp, appearance: 'none', cursor: 'pointer', paddingRight: 28, fontWeight: 700, color: PRIORITY_COLORS[newPriority],
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none'%3E%3Cpath d='M6 9l6 6 6-6' stroke='%23737373' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}>
                  {availablePriorities.map(p => (
                    <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#262626', marginBottom: 5 }}>Policy Name</label>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. High Priority SLA" style={numInp} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#262626', marginBottom: 5 }}>First Response (min)</label>
                <input type="number" min="1" value={newResp} onChange={e => setNewResp(e.target.value)} placeholder="60" style={numInp} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#262626', marginBottom: 5 }}>Resolution (min)</label>
                <input type="number" min="1" value={newRes} onChange={e => setNewRes(e.target.value)} placeholder="480" style={numInp} />
              </div>
            </div>
            {addError && <p style={{ fontSize: 12, color: '#EF4444', marginTop: 8 }}>{addError}</p>}
            <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
              <button type="submit" disabled={createMutation.isPending}
                style={{ padding: '8px 18px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg, #FF4713, #AD1164)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {createMutation.isPending ? 'Creating…' : 'Create Policy'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Policies table */}
      <div style={{ background: '#fff', border: '1px solid #E5E5E5', borderRadius: 12, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: '24px' }}>
            {[1, 2, 3, 4].map(i => (
              <div key={i} style={{ height: 44, borderRadius: 8, background: '#F2F2F2', marginBottom: 8, animation: 'shimmer 1.5s ease-in-out infinite' }} />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#A3A3A3', fontSize: 14 }}>
            No SLA policies configured. Add one above.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #F2F2F2' }}>
                {['Priority', 'Name', 'First Response', 'Resolution', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '9px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#A3A3A3', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(policy => <PolicyRow key={policy.id} policy={policy} />)}
            </tbody>
          </table>
        )}
      </div>

      {policies && existingPriorities.size === 4 && (
        <p style={{ fontSize: 12, color: '#A3A3A3', marginTop: 10, textAlign: 'center' }}>
          All four priority levels have policies configured.
        </p>
      )}
      <style>{`@keyframes shimmer { 0%,100% { opacity:1; } 50% { opacity:0.4; } }`}</style>
    </AdminPageShell>
  )
}
