import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AdminPageShell from '../../components/admin/AdminPageShell'
import api from '../../lib/api'

// ── Types ──────────────────────────────────────────────────────────────────────

type UserRole = 'technician' | 'admin'
type AuthProvider = 'local'

interface UserRead {
  id: number
  email: string
  name: string
  avatar_url: string | null
  role: UserRole
  auth_provider: AuthProvider
  slack_user_id: string | null
  is_active: boolean
  created_at: string
  last_login_at: string | null
}

interface UserListResponse { items: UserRead[]; total: number }

// ── Helpers ────────────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<UserRole, string> = {
  admin: '#AD1164',
  technician: '#FF4713',
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  technician: 'Technician',
}

const ROLE_BG: Record<UserRole, string> = {
  admin: '#AD116415',
  technician: '#FF471315',
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(d).toLocaleDateString()
}

const AVATAR_GRADIENTS: [string, string][] = [
  ['#FF4713', '#AD1164'],
  ['#3B82F6', '#6366F1'],
  ['#10B981', '#059669'],
  ['#F59E0B', '#EF4444'],
  ['#8B5CF6', '#EC4899'],
]

function nameGradient(name: string) {
  const idx = name.charCodeAt(0) % AVATAR_GRADIENTS.length
  const [a, b] = AVATAR_GRADIENTS[idx]
  return `linear-gradient(135deg, ${a}, ${b})`
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return parts.length === 1 ? parts[0][0].toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// ── Shared input style ─────────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 7,
  border: '1.5px solid #E5E5E5',
  fontSize: 13,
  color: '#262626',
  background: '#fff',
  outline: 'none',
  fontFamily: 'Inter, system-ui, sans-serif',
  width: '100%',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s',
}

// ── Create User Modal ──────────────────────────────────────────────────────────

interface CreateModalProps {
  onClose: () => void
}

function CreateUserModal({ onClose }: CreateModalProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [role, setRole] = useState<UserRole>('technician')
  const [error, setError] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      api.post<UserRead>('/admin/users', { name, email, password, role }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      onClose()
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg ?? 'Failed to create user.')
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError('All fields are required.')
      return
    }
    mutation.mutate()
  }

  const focusStyle = (f: string): React.CSSProperties => ({
    ...inp,
    borderColor: focused === f ? '#FF4713' : '#E5E5E5',
    boxShadow: focused === f ? '0 0 0 3px rgba(255,71,19,0.07)' : 'none',
  })

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          background: '#fff', borderRadius: 14, width: 420, maxWidth: '90vw',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden',
          animation: 'modalIn 0.18s ease',
        }}
      >
        <div style={{ height: 3, background: 'linear-gradient(135deg, #FF4713, #AD1164)' }} />
        <div style={{ padding: '24px 28px 28px' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0A0A0A', margin: '0 0 20px', letterSpacing: '-0.01em' }}>
            Create Local Account
          </h2>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#262626', marginBottom: 5 }}>Full Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith"
                style={focusStyle('name')} onFocus={() => setFocused('name')} onBlur={() => setFocused(null)} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#262626', marginBottom: 5 }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com"
                style={focusStyle('email')} onFocus={() => setFocused('email')} onBlur={() => setFocused(null)} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#262626', marginBottom: 5 }}>Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Min. 8 characters" style={{ ...focusStyle('pw'), paddingRight: 40 }}
                  onFocus={() => setFocused('pw')} onBlur={() => setFocused(null)} />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#737373', fontSize: 11, fontWeight: 600 }}>
                  {showPw ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#262626', marginBottom: 5 }}>Role</label>
              <select value={role} onChange={e => setRole(e.target.value as UserRole)}
                style={{ ...inp, appearance: 'none', cursor: 'pointer', paddingRight: 28,
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none'%3E%3Cpath d='M6 9l6 6 6-6' stroke='%23737373' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}>
                <option value="technician">Technician</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            {error && (
              <div style={{ padding: '9px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 7, fontSize: 13, color: '#DC2626' }}>
                {error}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
              <button type="button" onClick={onClose}
                style={{ padding: '8px 18px', borderRadius: 7, border: '1px solid #E5E5E5', background: '#fff', fontSize: 13, fontWeight: 500, color: '#737373', cursor: 'pointer' }}>
                Cancel
              </button>
              <button type="submit" disabled={mutation.isPending}
                style={{ padding: '8px 18px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg, #FF4713, #AD1164)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: mutation.isPending ? 'not-allowed' : 'pointer', opacity: mutation.isPending ? 0.8 : 1 }}>
                {mutation.isPending ? 'Creating…' : 'Create Account'}
              </button>
            </div>
          </form>
        </div>
      </div>
      <style>{`@keyframes modalIn { from { opacity:0; transform:scale(0.95); } to { opacity:1; transform:scale(1); } }`}</style>
    </div>
  )
}

// ── Role Badge (clickable) ─────────────────────────────────────────────────────

interface RoleBadgeProps {
  user: UserRead
}

function RoleBadge({ user }: RoleBadgeProps) {
  const [editing, setEditing] = useState(false)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (role: UserRole) =>
      api.patch<UserRead>(`/admin/users/${user.id}`, { role }).then(r => r.data),
    onSuccess: updated => {
      queryClient.setQueryData<UserListResponse>(['admin-users', {}], old =>
        old ? { ...old, items: old.items.map(u => u.id === updated.id ? updated : u) } : old
      )
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setEditing(false)
    },
  })

  if (editing) {
    return (
      <select
        autoFocus
        defaultValue={user.role}
        onChange={e => mutation.mutate(e.target.value as UserRole)}
        onBlur={() => setEditing(false)}
        style={{ fontSize: 12, borderRadius: 6, border: '1px solid #E5E5E5', padding: '3px 6px', fontFamily: 'Inter, system-ui, sans-serif', cursor: 'pointer', outline: 'none' }}
      >
        <option value="technician">Technician</option>
        <option value="admin">Admin</option>
      </select>
    )
  }

  return (
    <span
      onClick={() => setEditing(true)}
      title="Click to change role"
      style={{
        display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 999,
        fontSize: 11, fontWeight: 600, cursor: 'pointer', userSelect: 'none',
        color: ROLE_COLORS[user.role], background: ROLE_BG[user.role],
        border: `1px solid ${ROLE_COLORS[user.role]}25`,
        transition: 'opacity 0.12s',
      }}
      onMouseEnter={e => (e.currentTarget.style.opacity = '0.75')}
      onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
    >
      {ROLE_LABELS[user.role]}
    </span>
  )
}

// ── Slack ID cell (inline editable) ───────────────────────────────────────────

function SlackIdCell({ user }: { user: UserRead }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(user.slack_user_id ?? '')

  // Keep local value in sync when the row refreshes after a save
  useEffect(() => {
    if (!editing) setValue(user.slack_user_id ?? '')
  }, [user.slack_user_id, editing])

  const mutation = useMutation({
    mutationFn: (slack_user_id: string | null) =>
      api.patch<UserRead>(`/admin/users/${user.id}`, { slack_user_id }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
    onError: () => {
      setValue(user.slack_user_id ?? '')
    },
  })

  function commit() {
    // Close immediately for instant feedback; mutation runs in background
    setEditing(false)
    const trimmed = value.trim() || null
    if (trimmed !== user.slack_user_id) mutation.mutate(trimmed)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') { setValue(user.slack_user_id ?? ''); setEditing(false) }
        }}
        placeholder="U0123ABCDEF"
        style={{ fontSize: 12, borderRadius: 6, border: '1px solid #FF4713', padding: '3px 8px', outline: 'none', width: 130, fontFamily: 'monospace' }}
      />
    )
  }

  return (
    <span
      onClick={() => setEditing(true)}
      title="Click to set Slack user ID"
      style={{ fontSize: 11, fontFamily: 'monospace', color: user.slack_user_id ? '#262626' : '#C0C0C0', cursor: 'pointer', padding: '2px 6px', borderRadius: 5, border: '1px dashed transparent', transition: 'all 0.12s' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#E5E5E5'; e.currentTarget.style.background = '#F9F9F9' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent' }}
    >
      {user.slack_user_id ?? 'not linked'}
    </span>
  )
}

// ── Users page ─────────────────────────────────────────────────────────────────

export default function Users() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all')
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [showCreate, setShowCreate] = useState(false)
  const [page, setPage] = useState(0)
  const debouncedSearch = useDebounce(search, 300)
  const PAGE_SIZE = 50

  const params = new URLSearchParams()
  if (debouncedSearch) params.set('q', debouncedSearch)
  if (roleFilter !== 'all') params.set('role', roleFilter)
  if (activeFilter === 'active') params.set('is_active', 'true')
  if (activeFilter === 'inactive') params.set('is_active', 'false')
  params.set('limit', String(PAGE_SIZE))
  params.set('offset', String(page * PAGE_SIZE))

  const { data, isLoading } = useQuery<UserListResponse>({
    queryKey: ['admin-users', { debouncedSearch, roleFilter, activeFilter, page }],
    queryFn: () => api.get<UserListResponse>(`/admin/users?${params}`).then(r => r.data),
    staleTime: 30_000,
  })

  const toggleActive = useMutation({
    mutationFn: ({ id, is_active, force = false }: { id: number; is_active: boolean; force?: boolean }) =>
      api.patch<UserRead>(`/admin/users/${id}${force ? '?force=true' : ''}`, { is_active }).then(r => r.data),
    onSuccess: updated => {
      queryClient.setQueryData<UserListResponse>(
        ['admin-users', { debouncedSearch, roleFilter, activeFilter, page }],
        old => old ? { ...old, items: old.items.map(u => u.id === updated.id ? updated : u) } : old
      )
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
    onError: (err: unknown, variables) => {
      const res = (err as { response?: { data?: { detail?: string }; status?: number } })?.response
      if (res?.status === 409 && variables.is_active === false) {
        if (window.confirm(res.data?.detail ?? 'This technician has open tickets. Deactivate anyway?')) {
          toggleActive.mutate({ ...variables, force: true })
        }
      }
    },
  })

  const [setPasswordFor, setSetPasswordFor] = useState<number | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [setPasswordState, setSetPasswordState] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')

  async function handleSetPassword(userId: number) {
    if (newPassword.length < 8) return
    setSetPasswordState('saving')
    try {
      await api.post(`/admin/users/${userId}/set-password`, { new_password: newPassword })
      setSetPasswordState('ok')
      setTimeout(() => {
        setSetPasswordFor(null)
        setNewPassword('')
        setSetPasswordState('idle')
      }, 1500)
    } catch {
      setSetPasswordState('error')
    }
  }

  function openSetPassword(userId: number) {
    setSetPasswordFor(userId)
    setNewPassword('')
    setSetPasswordState('idle')
  }

  const FILTER_PILLS = [
    { id: 'all', label: 'All' },
    { id: 'technician', label: 'Technician' },
    { id: 'admin', label: 'Admin' },
  ] as const

  const ACTIVE_PILLS = [
    { id: 'all', label: 'All' },
    { id: 'active', label: 'Active' },
    { id: 'inactive', label: 'Inactive' },
  ] as const

  const tableHeaders = ['User', 'Role', 'Slack ID', 'Status', 'Last Login', 'Created', 'Actions']

  return (
    <AdminPageShell title="User Management">
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0A0A0A', letterSpacing: '-0.02em', margin: 0 }}>Users</h1>
          <p style={{ fontSize: 13, color: '#737373', marginTop: 3 }}>Manage accounts, roles and access</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #FF4713, #AD1164)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Create User
        </button>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '0 0 220px' }}>
          <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="8" stroke="#A3A3A3" strokeWidth="2"/>
            <path d="m21 21-4.35-4.35" stroke="#A3A3A3" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <input
            value={search} onChange={e => { setSearch(e.target.value); setPage(0) }}
            placeholder="Search name or email…"
            style={{ ...inp, paddingLeft: 32, width: '100%' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {FILTER_PILLS.map(p => (
            <button key={p.id} onClick={() => { setRoleFilter(p.id as UserRole | 'all'); setPage(0) }}
              style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: roleFilter === p.id ? 600 : 500, border: roleFilter === p.id ? '1.5px solid #FF4713' : '1.5px solid #E5E5E5', background: roleFilter === p.id ? 'rgba(255,71,19,0.07)' : '#fff', color: roleFilter === p.id ? '#FF4713' : '#737373', cursor: 'pointer', transition: 'all 0.12s' }}>
              {p.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          {ACTIVE_PILLS.map(p => (
            <button key={p.id} onClick={() => { setActiveFilter(p.id); setPage(0) }}
              style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: activeFilter === p.id ? 600 : 500, border: activeFilter === p.id ? '1.5px solid #262626' : '1.5px solid #E5E5E5', background: activeFilter === p.id ? '#262626' : '#fff', color: activeFilter === p.id ? '#fff' : '#737373', cursor: 'pointer', transition: 'all 0.12s' }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', border: '1px solid #E5E5E5', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #F2F2F2' }}>
                {tableHeaders.map(h => (
                  <th key={h} style={{ padding: '9px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#A3A3A3', textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #F9F9F9' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#F2F2F2', animation: 'shimmer 1.5s ease-in-out infinite' }} />
                        <div>
                          <div style={{ width: 100, height: 12, borderRadius: 4, background: '#F2F2F2', marginBottom: 5, animation: 'shimmer 1.5s ease-in-out infinite' }} />
                          <div style={{ width: 140, height: 10, borderRadius: 4, background: '#F2F2F2', animation: 'shimmer 1.5s ease-in-out infinite' }} />
                        </div>
                      </div>
                    </td>
                    {[1, 2, 3, 4, 5, 6].map(j => (
                      <td key={j} style={{ padding: '12px 16px' }}>
                        <div style={{ height: 12, width: '70%', borderRadius: 4, background: '#F2F2F2', animation: 'shimmer 1.5s ease-in-out infinite' }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : data?.items.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '48px 24px', textAlign: 'center', color: '#A3A3A3', fontSize: 14 }}>
                    No users found
                  </td>
                </tr>
              ) : (
                data?.items.map(user => (
                  <tr
                    key={user.id}
                    style={{ borderBottom: '1px solid #F9F9F9', transition: 'background 0.1s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#FAFAFA')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {/* User */}
                    <td style={{ padding: '11px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: nameGradient(user.name), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                          {initials(user.name)}
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500, color: '#0A0A0A' }}>{user.name}</div>
                          <div style={{ fontSize: 11, color: '#A3A3A3', marginTop: 1 }}>{user.email}</div>
                        </div>
                      </div>
                    </td>
                    {/* Role */}
                    <td style={{ padding: '11px 16px' }}>
                      <RoleBadge user={user} />
                    </td>
                    {/* Slack ID */}
                    <td style={{ padding: '11px 16px' }}>
                      <SlackIdCell user={user} />
                    </td>
                    {/* Status */}
                    <td style={{ padding: '11px 16px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600, color: user.is_active ? '#059669' : '#737373', background: user.is_active ? '#D1FAE5' : '#F3F4F6', border: `1px solid ${user.is_active ? '#6EE7B7' : '#E5E5E5'}` }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: user.is_active ? '#10B981' : '#9CA3AF' }} />
                        {user.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {/* Last login */}
                    <td style={{ padding: '11px 16px' }}>
                      <span style={{ fontSize: 12, color: '#737373' }}>
                        {user.last_login_at ? timeAgo(user.last_login_at) : <span style={{ color: '#C0C0C0', fontStyle: 'italic' }}>Never</span>}
                      </span>
                    </td>
                    {/* Created */}
                    <td style={{ padding: '11px 16px' }}>
                      <span style={{ fontSize: 12, color: '#A3A3A3' }}>{timeAgo(user.created_at)}</span>
                    </td>
                    {/* Actions */}
                    <td style={{ padding: '11px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                          onClick={() => toggleActive.mutate({ id: user.id, is_active: !user.is_active })}
                          style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #E5E5E5', background: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: user.is_active ? '#EF4444' : '#10B981', transition: 'all 0.12s', whiteSpace: 'nowrap' }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = user.is_active ? '#FECACA' : '#6EE7B7'; e.currentTarget.style.background = user.is_active ? '#FEF2F2' : '#F0FDF4' }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = '#E5E5E5'; e.currentTarget.style.background = '#fff' }}
                        >
                          {user.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                        <button
                          onClick={() => setPasswordFor === user.id ? (setSetPasswordFor(null), setNewPassword(''), setSetPasswordState('idle')) : openSetPassword(user.id)}
                          style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #E5E5E5', background: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#737373', transition: 'all 0.12s', whiteSpace: 'nowrap' }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = '#C0C0C0'; e.currentTarget.style.background = '#F9F9F9' }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = '#E5E5E5'; e.currentTarget.style.background = '#fff' }}
                        >
                          Set password
                        </button>
                      </div>
                      {setPasswordFor === user.id && (
                        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="password"
                            value={newPassword}
                            onChange={e => { setNewPassword(e.target.value); setSetPasswordState('idle') }}
                            placeholder="New password (min 8)"
                            autoFocus
                            style={{ ...inp, width: 180, padding: '5px 8px', fontSize: 12 }}
                          />
                          <button
                            onClick={() => handleSetPassword(user.id)}
                            disabled={newPassword.length < 8 || setPasswordState === 'saving'}
                            style={{ padding: '5px 10px', borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 600, cursor: newPassword.length >= 8 ? 'pointer' : 'not-allowed', background: newPassword.length >= 8 ? '#0A0A0A' : '#F2F2F2', color: newPassword.length >= 8 ? '#fff' : '#A3A3A3', whiteSpace: 'nowrap' }}
                          >
                            {setPasswordState === 'saving' ? '…' : setPasswordState === 'ok' ? '✓ Saved' : 'Save'}
                          </button>
                          {setPasswordState === 'error' && <span style={{ fontSize: 11, color: '#EF4444' }}>Failed</span>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.total > PAGE_SIZE && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid #F2F2F2', background: '#FAFAFA' }}>
            <span style={{ fontSize: 12, color: '#737373' }}>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, data.total)} of {data.total}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              {[{ label: '← Prev', disabled: page === 0, onClick: () => setPage(p => p - 1) },
                { label: 'Next →', disabled: (page + 1) * PAGE_SIZE >= data.total, onClick: () => setPage(p => p + 1) }]
                .map(btn => (
                  <button key={btn.label} onClick={btn.onClick} disabled={btn.disabled}
                    style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500, border: '1px solid #E5E5E5', background: btn.disabled ? '#F9F9F9' : '#fff', color: btn.disabled ? '#C0C0C0' : '#262626', cursor: btn.disabled ? 'not-allowed' : 'pointer' }}>
                    {btn.label}
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} />}
      <style>{`
        @keyframes shimmer { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
      `}</style>
    </AdminPageShell>
  )
}
