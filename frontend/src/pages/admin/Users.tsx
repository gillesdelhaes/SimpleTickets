import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AdminPageShell from '../../components/admin/AdminPageShell'
import api, { apiErrorMessage } from '../../lib/api'
import { parseUTC } from '../../types/ticket'

// ── Types ──────────────────────────────────────────────────────────────────────

type UserRole = 'technician' | 'admin'
type AuthProvider = 'local'

interface UserRead {
  id: number
  email: string
  name: string
  role: UserRole
  auth_provider: AuthProvider
  slack_user_id: string | null
  is_active: boolean
  created_at: string
  last_login_at: string | null
}

interface UserListResponse { items: UserRead[]; total: number }

// ── Helpers ────────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  technician: 'Technician',
}

function timeAgo(d: string) {
  const diff = Date.now() - parseUTC(d).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  return parseUTC(d).toLocaleDateString()
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

  const mutation = useMutation({
    mutationFn: () =>
      api.post<UserRead>('/admin/users', { name, email, password, role }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      onClose()
    },
    onError: (err: unknown) => {
      setError(apiErrorMessage(err, 'Failed to create user.'))
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

  return (
    <>
      <div className="scrim open" style={{ zIndex: 200 }} onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Create local account" className="modal open" style={{ zIndex: 201, width: 'min(420px, 94vw)' }}>
        <h2>Create local account</h2>
        <p className="sub">Local accounts sign in with email and password.</p>
        <form onSubmit={handleSubmit}>
          <div className="fieldrow">
            <label htmlFor="new-user-name">Full name</label>
            <input id="new-user-name" className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" />
          </div>
          <div className="fieldrow">
            <label htmlFor="new-user-email">Email</label>
            <input id="new-user-email" className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com" />
          </div>
          <div className="fieldrow">
            <label htmlFor="new-user-password">Password</label>
            <div className="relative">
              <input
                id="new-user-password"
                className="input"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                style={{ paddingRight: 52 }}
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-0 cursor-pointer text-ink-3 hover:text-ink text-[11px] font-semibold"
              >
                {showPw ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          <div className="fieldrow">
            <label htmlFor="new-user-role">Role</label>
            <div className="selectwrap">
              <select id="new-user-role" className="select" value={role} onChange={e => setRole(e.target.value as UserRole)}>
                <option value="technician">Technician</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          {error && (
            <div className="px-3 py-2 rounded-control mb-3 text-[13px] text-danger-ink" style={{ background: 'var(--danger-bg)' }}>
              {error}
            </div>
          )}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button
              type="submit"
              className="btn"
              disabled={mutation.isPending}
              style={mutation.isPending ? { opacity: 0.7, cursor: 'wait' } : undefined}
            >
              {mutation.isPending ? 'Creating…' : 'Create account'}
            </button>
          </div>
        </form>
      </div>
    </>
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
    onError: (err: unknown) => {
      // e.g. 409 demoting the last active admin — must not fail invisibly
      window.alert(apiErrorMessage(err, 'Failed to change role.'))
      setEditing(false)
    },
  })

  if (editing) {
    return (
      <select
        autoFocus
        className="select"
        style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
        defaultValue={user.role}
        onChange={e => mutation.mutate(e.target.value as UserRole)}
        onBlur={() => setEditing(false)}
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
      className={`pill ${user.role === 'admin' ? 'use' : 'avail'} cursor-pointer select-none`}
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
        className="input font-mono"
        style={{ width: 140, padding: '4px 9px', fontSize: 12 }}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') { setValue(user.slack_user_id ?? ''); setEditing(false) }
        }}
        placeholder="U0123ABCDEF"
      />
    )
  }

  return (
    <span
      onClick={() => setEditing(true)}
      title="Click to set Slack user ID"
      className={`font-mono text-[11px] cursor-pointer px-1.5 py-0.5 rounded-md hover:bg-row-hover ${user.slack_user_id ? 'text-ink-2' : 'text-ink-3 italic'}`}
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
      const res = (err as { response?: { status?: number } })?.response
      const message = apiErrorMessage(err, 'Failed to update user.')
      // Only the open-tickets 409 is forceable ("… Deactivate anyway?"). The
      // last-admin 409 (or a forced retry failing again) can never succeed —
      // surface it instead of re-prompting forever.
      if (
        res?.status === 409 && variables.is_active === false &&
        !variables.force && message.includes('Deactivate anyway')
      ) {
        if (window.confirm(message)) {
          toggleActive.mutate({ ...variables, force: true })
        }
      } else {
        window.alert(message)
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

  const tableHeaders = ['User', 'Role', 'Slack ID', 'Status', 'Last login', 'Created', 'Actions']

  return (
    <AdminPageShell title="Users">
      {/* Filter bar */}
      <div className="flex gap-3 items-center mb-4 flex-wrap">
        <div className="relative" style={{ flex: '0 0 230px' }}>
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-ink-3" width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="8" cy="8" r="5.5" />
            <path d="M12.5 12.5L16 16" />
          </svg>
          <input
            className="input"
            style={{ paddingLeft: 34 }}
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            placeholder="Search name or email…"
          />
        </div>

        <div className="flex gap-1.5 flex-wrap">
          {FILTER_PILLS.map(p => (
            <button
              key={p.id}
              onClick={() => { setRoleFilter(p.id as UserRole | 'all'); setPage(0) }}
              className={`chip${roleFilter === p.id ? ' on' : ''}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1.5">
          {ACTIVE_PILLS.map(p => (
            <button
              key={p.id}
              onClick={() => { setActiveFilter(p.id); setPage(0) }}
              className={`chip${activeFilter === p.id ? ' on' : ''}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <button className="btn sm ml-auto" onClick={() => setShowCreate(true)}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M7 2v10M2 7h10" />
          </svg>
          Create user
        </button>
      </div>

      {/* Table */}
      <section className="panel">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                {tableHeaders.map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div style={{ width: 30, height: 30, borderRadius: 10, background: 'var(--track)', animation: 'shimmer 1.5s ease-in-out infinite' }} />
                        <div>
                          <div style={{ width: 100, height: 12, borderRadius: 6, background: 'var(--track)', marginBottom: 5, animation: 'shimmer 1.5s ease-in-out infinite' }} />
                          <div style={{ width: 140, height: 10, borderRadius: 6, background: 'var(--track)', animation: 'shimmer 1.5s ease-in-out infinite' }} />
                        </div>
                      </div>
                    </td>
                    {[1, 2, 3, 4, 5, 6].map(j => (
                      <td key={j}>
                        <div style={{ height: 12, width: '70%', borderRadius: 6, background: 'var(--track)', animation: 'shimmer 1.5s ease-in-out infinite' }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : data?.items.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '48px 24px', textAlign: 'center', whiteSpace: 'normal' }} className="text-ink-3">
                    No users found
                  </td>
                </tr>
              ) : (
                data?.items.map(user => (
                  <tr key={user.id}>
                    {/* User */}
                    <td>
                      <div className="who">
                        <div className="avatar" style={{ width: 30, height: 30, fontSize: 11 }}>
                          {initials(user.name)}
                        </div>
                        <div>
                          <div className="name" style={{ fontSize: 13 }}>{user.name}</div>
                          <div className="model">{user.email}</div>
                        </div>
                      </div>
                    </td>
                    {/* Role */}
                    <td><RoleBadge user={user} /></td>
                    {/* Slack ID */}
                    <td><SlackIdCell user={user} /></td>
                    {/* Status */}
                    <td>
                      <span className={`pill ${user.is_active ? 'use' : 'retired'}`}>
                        {user.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {/* Last login */}
                    <td>
                      <span className="font-mono text-[11px] text-ink-2">
                        {user.last_login_at ? timeAgo(user.last_login_at) : <span className="text-ink-3 italic">Never</span>}
                      </span>
                    </td>
                    {/* Created */}
                    <td>
                      <span className="font-mono text-[11px] text-ink-3">{timeAgo(user.created_at)}</span>
                    </td>
                    {/* Actions */}
                    <td>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => toggleActive.mutate({ id: user.id, is_active: !user.is_active })}
                          className={`btn ghost sm${user.is_active ? ' danger' : ''}`}
                          style={{ padding: '4px 11px', fontSize: 11.5 }}
                        >
                          {user.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                        <button
                          onClick={() => setPasswordFor === user.id ? (setSetPasswordFor(null), setNewPassword(''), setSetPasswordState('idle')) : openSetPassword(user.id)}
                          className="btn ghost sm"
                          style={{ padding: '4px 11px', fontSize: 11.5 }}
                        >
                          Set password
                        </button>
                      </div>
                      {setPasswordFor === user.id && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <input
                            type="password"
                            className="input"
                            value={newPassword}
                            onChange={e => { setNewPassword(e.target.value); setSetPasswordState('idle') }}
                            placeholder="New password (min 8)"
                            autoFocus
                            style={{ width: 180, padding: '5px 10px', fontSize: 12 }}
                          />
                          <button
                            onClick={() => handleSetPassword(user.id)}
                            disabled={newPassword.length < 8 || setPasswordState === 'saving'}
                            className="btn sm"
                            style={newPassword.length < 8 ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                          >
                            {setPasswordState === 'saving' ? '…' : setPasswordState === 'ok' ? '✓ Saved' : 'Save'}
                          </button>
                          {setPasswordState === 'error' && <span className="text-[11px] text-danger-ink">Failed</span>}
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
          <div className="flex items-center justify-between px-6 py-3 border-t border-track">
            <span className="font-mono text-[11px] text-ink-3">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, data.total)} of {data.total}
            </span>
            <div className="flex gap-2">
              {[{ label: 'Previous', disabled: page === 0, onClick: () => setPage(p => p - 1) },
                { label: 'Next', disabled: (page + 1) * PAGE_SIZE >= data.total, onClick: () => setPage(p => p + 1) }]
                .map(btn => (
                  <button
                    key={btn.label}
                    onClick={btn.onClick}
                    disabled={btn.disabled}
                    className="btn ghost sm"
                    style={btn.disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                  >
                    {btn.label}
                  </button>
                ))}
            </div>
          </div>
        )}
      </section>

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} />}
    </AdminPageShell>
  )
}
