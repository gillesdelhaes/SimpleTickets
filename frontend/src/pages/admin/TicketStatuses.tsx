import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AdminPageShell from '../../components/admin/AdminPageShell'
import api from '../../lib/api'

interface StatusRow {
  id: number
  name: string
  label: string
  color: string
  pauses_sla: boolean
  is_default: boolean
  is_resolved_state: boolean
  sort_order: number
  is_archived: boolean
}

interface StatusForm {
  name: string
  label: string
  color: string
  pauses_sla: boolean
  is_default: boolean
  is_resolved_state: boolean
  sort_order: number
}

const BLANK: StatusForm = {
  name: '', label: '', color: '#737373',
  pauses_sla: false, is_default: false, is_resolved_state: false, sort_order: 0,
}

const PRESET_COLORS = [
  '#3B82F6', '#FF4713', '#F59E0B', '#10B981', '#737373',
  '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1',
]

export default function TicketStatuses() {
  const qc = useQueryClient()
  const [form, setForm] = useState<StatusForm>(BLANK)
  const [editId, setEditId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: statuses = [], isLoading } = useQuery<StatusRow[]>({
    queryKey: ['admin-ticket-statuses'],
    queryFn: async () => {
      const { data } = await api.get<StatusRow[]>('/admin/ticket-statuses')
      return data
    },
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-ticket-statuses'] })
    qc.invalidateQueries({ queryKey: ['app-config'] })
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editId !== null) {
        await api.patch(`/admin/ticket-statuses/${editId}`, form)
      } else {
        await api.post('/admin/ticket-statuses', form)
      }
    },
    onSuccess: () => {
      invalidate()
      setForm(BLANK)
      setEditId(null)
      setError(null)
    },
    onError: (err: any) => {
      setError(err?.response?.data?.detail ?? 'Save failed')
    },
  })

  const archiveMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/ticket-statuses/${id}`),
    onSuccess: invalidate,
    onError: (err: any) => {
      setError(err?.response?.data?.detail ?? 'Archive failed')
    },
  })

  const patchMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: object }) =>
      api.patch(`/admin/ticket-statuses/${id}`, patch),
    onSuccess: invalidate,
  })

  function startEdit(s: StatusRow) {
    setEditId(s.id)
    setForm({
      name: s.name, label: s.label, color: s.color,
      pauses_sla: s.pauses_sla, is_default: s.is_default,
      is_resolved_state: s.is_resolved_state, sort_order: s.sort_order,
    })
    setError(null)
  }

  function cancelEdit() {
    setEditId(null)
    setForm(BLANK)
    setError(null)
  }

  const active = statuses.filter(s => !s.is_archived)
  const archived = statuses.filter(s => s.is_archived)

  return (
    <AdminPageShell title="Ticket Statuses">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 860 }}>

        {/* Active statuses table */}
        <section style={{ background: '#fff', border: '1px solid #E5E5E5', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #F2F2F2', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0A0A0A', letterSpacing: '-0.02em' }}>Statuses</h2>
              <p style={{ margin: '3px 0 0', fontSize: 12, color: '#737373' }}>
                Drag to reorder — or edit sort_order values directly.
              </p>
            </div>
          </div>

          {isLoading ? (
            <div style={{ padding: '32px 24px', textAlign: 'center', color: '#A3A3A3', fontSize: 13 }}>Loading…</div>
          ) : active.length === 0 ? (
            <div style={{ padding: '32px 24px', textAlign: 'center', color: '#A3A3A3', fontSize: 13 }}>No statuses yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #F2F2F2' }}>
                  {['Colour', 'Slug', 'Label', 'Pauses SLA', 'Default', 'Resolved state', 'Order', ''].map(h => (
                    <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#A3A3A3', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {active.map(s => (
                  <tr key={s.id} style={{ borderBottom: '1px solid #F9F9F9' }}
                    onMouseOver={e => (e.currentTarget.style.background = '#FAFAFA')}
                    onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{
                        display: 'inline-block', width: 24, height: 24, borderRadius: 6,
                        background: s.color, border: '1px solid rgba(0,0,0,0.08)',
                      }} />
                    </td>
                    <td style={{ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#737373' }}>{s.name}</td>
                    <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: s.color }}>{s.label}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <Toggle
                        checked={s.pauses_sla}
                        onChange={v => patchMutation.mutate({ id: s.id, patch: { pauses_sla: v } })}
                      />
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <Toggle
                        checked={s.is_default}
                        onChange={v => patchMutation.mutate({ id: s.id, patch: { is_default: v } })}
                      />
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <Toggle
                        checked={s.is_resolved_state}
                        onChange={v => patchMutation.mutate({ id: s.id, patch: { is_resolved_state: v } })}
                      />
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: '#737373' }}>{s.sort_order}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => startEdit(s)} style={btnStyle('#0A0A0A')}>Edit</button>
                        {!s.is_default && (
                          <button
                            onClick={() => archiveMutation.mutate(s.id)}
                            style={btnStyle('#EF4444')}
                          >Archive</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Create / edit form */}
        <section style={{ background: '#fff', border: '1px solid #E5E5E5', borderRadius: 12, padding: '24px 28px' }}>
          <h2 style={{ margin: '0 0 20px', fontSize: 15, fontWeight: 700, color: '#0A0A0A', letterSpacing: '-0.02em' }}>
            {editId !== null ? 'Edit status' : 'New status'}
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Slug" hint="Lowercase, underscores only. Stored in the database — cannot be changed after creation.">
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))}
                disabled={editId !== null}
                placeholder="e.g. waiting_vendor"
                style={{ ...inputStyle, opacity: editId !== null ? 0.5 : 1 }}
              />
            </Field>

            <Field label="Display label">
              <input
                value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Waiting on Vendor"
                style={inputStyle}
              />
            </Field>

            <Field label="Colour">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="color"
                  value={form.color}
                  onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                  style={{ width: 36, height: 32, padding: 2, border: '1px solid #E5E5E5', borderRadius: 6, cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setForm(f => ({ ...f, color: c }))}
                      style={{
                        width: 20, height: 20, borderRadius: 4, background: c, border: 'none', cursor: 'pointer',
                        outline: form.color === c ? `2px solid ${c}` : 'none',
                        outlineOffset: 2,
                      }}
                    />
                  ))}
                </div>
              </div>
            </Field>

            <Field label="Sort order">
              <input
                type="number"
                value={form.sort_order}
                onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))}
                style={{ ...inputStyle, width: 80 }}
              />
            </Field>
          </div>

          <div style={{ display: 'flex', gap: 24, marginTop: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.pauses_sla}
                onChange={e => setForm(f => ({ ...f, pauses_sla: e.target.checked }))}
                style={{ accentColor: '#FF4713' }}
              />
              <div>
                <div style={{ fontWeight: 600 }}>Pauses SLA</div>
                <div style={{ fontSize: 11, color: '#737373' }}>SLA clock stops while ticket is in this status</div>
              </div>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.is_default}
                onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))}
                style={{ accentColor: '#FF4713' }}
              />
              <div>
                <div style={{ fontWeight: 600 }}>Default status</div>
                <div style={{ fontSize: 11, color: '#737373' }}>Applied to newly created tickets</div>
              </div>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.is_resolved_state}
                onChange={e => setForm(f => ({ ...f, is_resolved_state: e.target.checked }))}
                style={{ accentColor: '#FF4713' }}
              />
              <div>
                <div style={{ fontWeight: 600 }}>Resolved state</div>
                <div style={{ fontSize: 11, color: '#737373' }}>Tickets in this state re-open on new Slack reply</div>
              </div>
            </label>
          </div>

          {error && (
            <div style={{ marginTop: 12, fontSize: 13, color: '#EF4444' }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
            <button
              onClick={() => saveMutation.mutate()}
              disabled={!form.label || (!editId && !form.name) || saveMutation.isPending}
              style={{
                background: saveMutation.isPending ? '#F2F2F2' : '#0A0A0A',
                color: saveMutation.isPending ? '#A3A3A3' : '#fff',
                border: 'none', borderRadius: 7, padding: '8px 18px',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {saveMutation.isPending ? 'Saving…' : editId !== null ? 'Save changes' : 'Create status'}
            </button>
            {editId !== null && (
              <button onClick={cancelEdit} style={{ background: 'none', border: '1px solid #E5E5E5', borderRadius: 7, padding: '8px 14px', fontSize: 13, cursor: 'pointer', color: '#737373' }}>
                Cancel
              </button>
            )}
          </div>
        </section>

        {/* Archived */}
        {archived.length > 0 && (
          <section style={{ background: '#fff', border: '1px solid #E5E5E5', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid #F2F2F2' }}>
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#A3A3A3' }}>Archived statuses</h3>
            </div>
            <div style={{ padding: '12px 24px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {archived.map(s => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#F9F9F9', border: '1px solid #E5E5E5', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, display: 'inline-block' }} />
                  <span style={{ color: '#737373' }}>{s.label}</span>
                  <button
                    onClick={() => patchMutation.mutate({ id: s.id, patch: { is_archived: false } })}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#3B82F6', padding: 0, marginLeft: 4 }}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </AdminPageShell>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#737373', marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {label}
      </label>
      {children}
      {hint && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#A3A3A3', lineHeight: 1.4 }}>{hint}</p>}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px',
  border: '1px solid #E5E5E5', borderRadius: 7,
  fontSize: 13, color: '#0A0A0A', background: '#fff',
  outline: 'none', boxSizing: 'border-box',
}

function btnStyle(color: string): React.CSSProperties {
  return {
    background: 'none', border: `1px solid ${color}30`, borderRadius: 5,
    padding: '3px 9px', fontSize: 11, fontWeight: 600, color, cursor: 'pointer',
  }
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 32, height: 18, borderRadius: 9, border: 'none', cursor: 'pointer',
        background: checked ? '#10B981' : '#E5E5E5',
        position: 'relative', transition: 'background 0.2s',
        flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: checked ? 16 : 2,
        width: 14, height: 14, borderRadius: '50%', background: '#fff',
        transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
      }} />
    </button>
  )
}
