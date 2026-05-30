import { useState, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AdminPageShell from '../../components/admin/AdminPageShell'
import api from '../../lib/api'

interface CategoryRead {
  id: number
  name: string
  is_archived: boolean
  created_at: string
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(d).toLocaleDateString()
}

// ── Inline-editable category name ─────────────────────────────────────────────

interface CategoryNameProps {
  category: CategoryRead
  onSave: (name: string) => void
}

function EditableName({ category, onSave }: CategoryNameProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(category.name)
  const inputRef = useRef<HTMLInputElement>(null)

  function startEdit() {
    setValue(category.name)
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function commit() {
    const trimmed = value.trim()
    if (trimmed && trimmed !== category.name) onSave(trimmed)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        style={{
          fontSize: 14, fontWeight: 500, color: '#0A0A0A',
          border: '1.5px solid #FF4713', borderRadius: 6, padding: '4px 8px',
          outline: 'none', fontFamily: 'Inter, system-ui, sans-serif',
          boxShadow: '0 0 0 3px rgba(255,71,19,0.08)',
          width: '100%', maxWidth: 280,
        }}
      />
    )
  }

  return (
    <span
      onClick={startEdit}
      title="Click to rename"
      style={{
        fontSize: 14, fontWeight: 500, color: category.is_archived ? '#A3A3A3' : '#0A0A0A',
        cursor: 'pointer', borderBottom: '1px dashed transparent',
        textDecoration: category.is_archived ? 'line-through' : 'none',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderBottomColor = '#D4D4D4')}
      onMouseLeave={e => (e.currentTarget.style.borderBottomColor = 'transparent')}
    >
      {category.name}
    </span>
  )
}

// ── Categories page ────────────────────────────────────────────────────────────

export default function Categories() {
  const queryClient = useQueryClient()
  const [showArchived, setShowArchived] = useState(false)
  const [newName, setNewName] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)

  const { data: categories, isLoading } = useQuery<CategoryRead[]>({
    queryKey: ['categories-admin', showArchived],
    queryFn: () =>
      api.get<CategoryRead[]>(`/categories?include_archived=${showArchived}`).then(r => r.data),
    staleTime: 30_000,
  })

  const createMutation = useMutation({
    mutationFn: (name: string) =>
      api.post<CategoryRead>('/categories', { name }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories-admin'] })
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      setNewName('')
      setAddError(null)
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setAddError(msg ?? 'Failed to create category.')
    },
  })

  const patchMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: number; name?: string; is_archived?: boolean }) =>
      api.patch<CategoryRead>(`/categories/${id}`, body).then(r => r.data),
    onSuccess: updated => {
      queryClient.setQueryData<CategoryRead[]>(
        ['categories-admin', showArchived],
        old => old?.map(c => c.id === updated.id ? updated : c) ?? old
      )
      queryClient.invalidateQueries({ queryKey: ['categories'] })
    },
  })

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    createMutation.mutate(newName.trim())
  }

  const active = categories?.filter(c => !c.is_archived) ?? []
  const archived = categories?.filter(c => c.is_archived) ?? []
  const shown = showArchived ? categories ?? [] : active

  return (
    <AdminPageShell title="Categories">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0A0A0A', letterSpacing: '-0.02em', margin: 0 }}>Categories</h1>
        <p style={{ fontSize: 13, color: '#737373', marginTop: 3 }}>
          Organise tickets by topic. {active.length} active{archived.length > 0 ? `, ${archived.length} archived` : ''}.
        </p>
      </div>

      {/* Add Category form */}
      <div style={{ background: '#fff', border: '1px solid #E5E5E5', borderRadius: 12, padding: '18px 20px', marginBottom: 20 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, color: '#262626', margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Add Category
        </h2>
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <input
              value={newName}
              onChange={e => { setNewName(e.target.value); setAddError(null) }}
              placeholder="e.g. Billing, Infrastructure, HR…"
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              style={{
                width: '100%', padding: '9px 12px', borderRadius: 8,
                border: `1.5px solid ${focused ? '#FF4713' : '#E5E5E5'}`,
                boxShadow: focused ? '0 0 0 3px rgba(255,71,19,0.07)' : 'none',
                fontSize: 13, color: '#262626', outline: 'none',
                fontFamily: 'Inter, system-ui, sans-serif', boxSizing: 'border-box',
                transition: 'border-color 0.15s',
              }}
            />
            {addError && (
              <p style={{ fontSize: 12, color: '#EF4444', margin: '5px 0 0' }}>{addError}</p>
            )}
          </div>
          <button
            type="submit"
            disabled={!newName.trim() || createMutation.isPending}
            style={{
              padding: '9px 18px', borderRadius: 8, border: 'none', flexShrink: 0,
              background: newName.trim() ? 'linear-gradient(135deg, #FF4713, #AD1164)' : '#E5E5E5',
              color: newName.trim() ? '#fff' : '#A3A3A3',
              fontSize: 13, fontWeight: 600, cursor: newName.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            {createMutation.isPending ? 'Adding…' : 'Add Category'}
          </button>
        </form>
      </div>

      {/* Filter toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#262626' }}>
          {shown.length} {showArchived ? 'total' : 'active'} categories
        </span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 13, color: '#737373' }}>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={e => setShowArchived(e.target.checked)}
            style={{ width: 15, height: 15, accentColor: '#FF4713', cursor: 'pointer' }}
          />
          Show archived
        </label>
      </div>

      {/* Category list */}
      {isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{ height: 58, borderRadius: 10, background: '#F2F2F2', animation: 'shimmer 1.5s ease-in-out infinite' }} />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#A3A3A3', fontSize: 14, background: '#fff', border: '1px solid #E5E5E5', borderRadius: 12 }}>
          {showArchived ? 'No categories yet.' : 'No active categories. Add one above.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.map(cat => (
            <div
              key={cat.id}
              style={{
                background: '#fff', border: '1px solid #E5E5E5', borderRadius: 10,
                padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14,
                opacity: cat.is_archived ? 0.65 : 1, transition: 'opacity 0.2s',
              }}
            >
              {/* Color dot */}
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: cat.is_archived ? '#D4D4D4' : 'linear-gradient(135deg, #FF4713, #AD1164)', flexShrink: 0 }} />

              {/* Name */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <EditableName category={cat} onSave={name => patchMutation.mutate({ id: cat.id, name })} />
              </div>

              {/* Status chip */}
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
                color: cat.is_archived ? '#737373' : '#059669',
                background: cat.is_archived ? '#F3F4F6' : '#D1FAE5',
                border: `1px solid ${cat.is_archived ? '#E5E5E5' : '#6EE7B7'}`,
                whiteSpace: 'nowrap',
              }}>
                {cat.is_archived ? 'Archived' : 'Active'}
              </span>

              {/* Created date */}
              <span style={{ fontSize: 11, color: '#C0C0C0', whiteSpace: 'nowrap' }}>
                {timeAgo(cat.created_at)}
              </span>

              {/* Archive / Restore */}
              <button
                onClick={() => patchMutation.mutate({ id: cat.id, is_archived: !cat.is_archived })}
                style={{
                  padding: '4px 10px', borderRadius: 6, border: '1px solid #E5E5E5',
                  background: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  color: cat.is_archived ? '#10B981' : '#EF4444', whiteSpace: 'nowrap',
                  transition: 'all 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = cat.is_archived ? '#F0FDF4' : '#FEF2F2'; e.currentTarget.style.borderColor = cat.is_archived ? '#6EE7B7' : '#FECACA' }}
                onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#E5E5E5' }}
              >
                {cat.is_archived ? 'Restore' : 'Archive'}
              </button>
            </div>
          ))}
        </div>
      )}
      <style>{`@keyframes shimmer { 0%,100% { opacity:1; } 50% { opacity:0.4; } }`}</style>
    </AdminPageShell>
  )
}
