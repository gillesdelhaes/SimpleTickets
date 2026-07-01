import { useState, useEffect, useRef } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useAppConfig } from '../../hooks/useAppConfig'
import { useUnreadReplies } from '../../hooks/useUnreadReplies'

// ── Inline SVG icons (18×18, stroke-based) ────────────────────────────────────

function IconDashboard() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="1.5" width="6" height="6" rx="1.2" />
      <rect x="10.5" y="1.5" width="6" height="6" rx="1.2" />
      <rect x="1.5" y="10.5" width="6" height="6" rx="1.2" />
      <rect x="10.5" y="10.5" width="6" height="6" rx="1.2" />
    </svg>
  )
}

function IconQueue() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 4.5h12M3 9h12M3 13.5h8" />
    </svg>
  )
}


function IconSearch() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M12.5 12.5L16 16" />
    </svg>
  )
}

function IconReports() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="14" height="14" rx="2" />
      <path d="M5.5 12V9M9 12V7M12.5 12V5" />
    </svg>
  )
}

function IconUsers() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="6" r="3" />
      <path d="M1.5 15c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5" />
      <path d="M13 4a3 3 0 0 1 0 6M16.5 15c0-2-1.12-3.75-2.75-4.65" />
    </svg>
  )
}


function IconAudit() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
      <path d="M6.5 6.5h5M6.5 9.5h5M6.5 12.5h3" />
    </svg>
  )
}


function IconSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function IconChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11L5 7l4-4" />
    </svg>
  )
}

function IconChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 3l4 4-4 4" />
    </svg>
  )
}

function IconBell() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2a5.5 5.5 0 0 1 5.5 5.5c0 3 1.5 4.5 1.5 4.5H2s1.5-1.5 1.5-4.5A5.5 5.5 0 0 1 9 2z" />
      <path d="M7.5 14.5a1.5 1.5 0 0 0 3 0" />
    </svg>
  )
}

function IconLogout() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
      <path d="M11 11l3-3-3-3M14 8H6" />
    </svg>
  )
}

// ── Nav data ──────────────────────────────────────────────────────────────────

const NAV_MAIN = [
  { to: '/dashboard', label: 'Dashboard', icon: <IconDashboard /> },
  { to: '/queue', label: 'Queue', icon: <IconQueue /> },
  { to: '/search', label: 'Search', icon: <IconSearch /> },
  { to: '/reports', label: 'Reports', icon: <IconReports /> },
]

const NAV_ADMIN = [
  { to: '/admin/users', label: 'Users', icon: <IconUsers /> },
  { to: '/admin/audit', label: 'Audit Log', icon: <IconAudit /> },
  { to: '/admin/settings', label: 'Settings', icon: <IconSettings /> },
]

// ── Component ─────────────────────────────────────────────────────────────────

interface AppShellProps {
  title: string
  children: React.ReactNode
}

const SIDEBAR_COLLAPSED_KEY = 'st_sidebar_collapsed'

export default function AppShell({ title, children }: AppShellProps) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { data: appConfig } = useAppConfig()
  const { data: unreadData } = useUnreadReplies()
  const myUnreadCount = unreadData?.my_unread_count ?? 0
  const myUnreadTickets = unreadData?.my_unread_tickets ?? []
  const [bellOpen, setBellOpen] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
  })
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchVal, setSearchVal] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed))
  }, [collapsed])

  // Close mobile drawer on route change
  useEffect(() => { setMobileOpen(false) }, [navigate])

  // Close bell dropdown on outside click
  useEffect(() => {
    if (!bellOpen) return
    function handle(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [bellOpen])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = searchVal.trim()
    if (q) {
      navigate(`/search?q=${encodeURIComponent(q)}`)
      setSearchVal('')
    }
  }

  const sidebarWidth = collapsed ? 60 : 220
  const isAdmin = user?.role === 'admin'
  const avatarInitial = user?.name?.charAt(0).toUpperCase() ?? '?'
  const rolePill = user?.role === 'admin' ? 'Admin' : user?.role === 'technician' ? 'Tech' : 'User'

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
      {/* ── Mobile overlay backdrop ── */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            zIndex: 40, display: 'none',
          }}
          className="md:block"
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        style={{
          width: sidebarWidth,
          minWidth: sidebarWidth,
          background: '#0A0A0A',
          display: 'flex',
          flexDirection: 'column',
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 50,
          transition: 'width 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          overflow: 'hidden',
        }}
        className="hidden md:flex"
      >
        {/* Top gradient rule */}
        <div style={{ height: 2, background: 'linear-gradient(90deg, #FF4713, #AD1164)', flexShrink: 0 }} />

        {/* Wordmark */}
        <div style={{
          padding: collapsed ? '16px 0' : '18px 20px 16px',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          height: 60,
          overflow: 'hidden',
        }}>
          {collapsed ? (
            <div style={{
              width: 28, height: 28, borderRadius: 6, flexShrink: 0,
              background: 'linear-gradient(135deg, #FF4713, #AD1164)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ color: '#fff', fontWeight: 800, fontSize: 13, letterSpacing: '-0.03em' }}>S</span>
            </div>
          ) : (
            <Link to="/dashboard" style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}>
              <span style={{ fontSize: 16, letterSpacing: '-0.04em', lineHeight: 1 }}>
                <span style={{ fontWeight: 200, color: 'rgba(255,255,255,0.85)' }}>Simple</span>
                <span style={{
                  fontWeight: 800,
                  background: 'linear-gradient(135deg, #FF4713, #AD1164)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}>Tickets</span>
              </span>
            </Link>
          )}
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '4px 0', overflowY: 'auto', overflowX: 'hidden' }}>
          {NAV_MAIN.map(item => (
            <NavItem key={item.to} {...item} collapsed={collapsed} />
          ))}

          {!isAdmin && (
            <NavItem to="/admin/settings" label="My Account" icon={<IconSettings />} collapsed={collapsed} />
          )}

          {isAdmin && (
            <>
              {/* Admin section divider */}
              <div style={{
                margin: '12px 0 6px',
                padding: collapsed ? '0 10px' : '0 16px',
              }}>
                {!collapsed && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
                    textTransform: 'uppercase', color: 'rgba(115,115,115,0.6)',
                  }}>Admin</span>
                )}
                {collapsed && <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />}
              </div>
              {NAV_ADMIN.map(item => (
                <NavItem key={item.to} {...item} collapsed={collapsed} />
              ))}
            </>
          )}
        </nav>

        {/* Bottom: user section */}
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.06)',
          padding: collapsed ? '12px 0' : '12px 16px',
          flexShrink: 0,
        }}>
          {!collapsed ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Avatar */}
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg, #FF4713, #AD1164)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700, color: '#fff',
              }}>
                {avatarInitial}
              </div>
              {/* Name + role */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12, fontWeight: 600, color: 'rgba(242,242,242,0.85)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {user?.name ?? user?.email}
                </div>
                <div style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'rgba(115,115,115,0.65)',
                }}>
                  {rolePill}
                </div>
              </div>
              {/* Logout */}
              <button
                onClick={logout}
                title="Sign out"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'rgba(115,115,115,0.6)', padding: 4, borderRadius: 4,
                  display: 'flex', alignItems: 'center', transition: 'color 0.15s',
                  flexShrink: 0,
                }}
                onMouseOver={e => (e.currentTarget.style.color = '#EF4444')}
                onMouseOut={e => (e.currentTarget.style.color = 'rgba(115,115,115,0.6)')}
              >
                <IconLogout />
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: 'linear-gradient(135deg, #FF4713, #AD1164)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700, color: '#fff',
              }}>
                {avatarInitial}
              </div>
              <button
                onClick={logout}
                title="Sign out"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'rgba(115,115,115,0.5)', padding: 4, borderRadius: 4,
                  display: 'flex', alignItems: 'center',
                }}
                onMouseOver={e => (e.currentTarget.style.color = '#EF4444')}
                onMouseOut={e => (e.currentTarget.style.color = 'rgba(115,115,115,0.5)')}
              >
                <IconLogout />
              </button>
            </div>
          )}

          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed(c => !c)}
            style={{
              marginTop: 10,
              width: '100%',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 6,
              cursor: 'pointer',
              color: 'rgba(115,115,115,0.6)',
              padding: '5px 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseOver={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
              e.currentTarget.style.color = 'rgba(242,242,242,0.8)'
            }}
            onMouseOut={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
              e.currentTarget.style.color = 'rgba(115,115,115,0.6)'
            }}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <IconChevronRight /> : <IconChevronLeft />}
          </button>
        </div>
      </aside>

      {/* ── Main area (offset by sidebar width on desktop) ── */}
      <div style={{
        flex: 1,
        marginLeft: sidebarWidth,
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        background: '#F2F2F2',
        transition: 'margin-left 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
      }}>

        {/* ── Top bar ── */}
        <header style={{
          height: 56,
          background: '#fff',
          borderBottom: '1px solid #E5E5E5',
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          gap: 16,
          position: 'sticky',
          top: 0,
          zIndex: 30,
          flexShrink: 0,
        }}>
          {/* Page title */}
          <h1 style={{
            fontSize: 15, fontWeight: 700, color: '#0A0A0A',
            letterSpacing: '-0.02em', lineHeight: 1.25, margin: 0, flex: 1,
          }}>
            {title}
          </h1>

          {/* Global search */}
          <form onSubmit={handleSearch} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <span style={{
                position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                color: '#A3A3A3', pointerEvents: 'none', display: 'flex',
              }}>
                <IconSearch />
              </span>
              <input
                ref={searchRef}
                value={searchVal}
                onChange={e => setSearchVal(e.target.value)}
                placeholder="Search tickets…"
                style={{
                  height: 34,
                  paddingLeft: 34,
                  paddingRight: 12,
                  border: '1px solid #E5E5E5',
                  borderRadius: 8,
                  fontSize: 13,
                  background: '#F9F9F9',
                  color: '#0A0A0A',
                  outline: 'none',
                  width: 200,
                  transition: 'border-color 0.15s, box-shadow 0.15s, width 0.2s',
                }}
                onFocus={e => {
                  e.target.style.borderColor = '#FF4713'
                  e.target.style.boxShadow = '0 0 0 3px rgba(255,71,19,0.1)'
                  e.target.style.width = '260px'
                }}
                onBlur={e => {
                  e.target.style.borderColor = '#E5E5E5'
                  e.target.style.boxShadow = 'none'
                  e.target.style.width = '200px'
                }}
              />
            </div>
          </form>

          {/* Notification bell */}
          <div ref={bellRef} style={{ position: 'relative', display: 'inline-flex' }}>
            <button
              onClick={() => setBellOpen(o => !o)}
              style={{
                background: bellOpen ? '#F2F2F2' : 'none',
                border: 'none', cursor: 'pointer',
                color: myUnreadCount > 0 ? '#FF4713' : '#737373',
                padding: 6, borderRadius: 8,
                display: 'flex', alignItems: 'center',
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseOver={e => (e.currentTarget.style.background = '#F2F2F2')}
              onMouseOut={e => (e.currentTarget.style.background = bellOpen ? '#F2F2F2' : 'none')}
              title={myUnreadCount > 0 ? `${myUnreadCount} ticket${myUnreadCount > 1 ? 's' : ''} with unread replies` : 'Notifications'}
            >
              <IconBell />
            </button>
            {myUnreadCount > 0 && (
              <span style={{
                position: 'absolute', top: 2, right: 2,
                minWidth: 16, height: 16, borderRadius: 8,
                background: '#FF4713', color: '#fff',
                fontSize: 10, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 3px', pointerEvents: 'none', lineHeight: 1,
                border: '1.5px solid #fff',
              }}>
                {myUnreadCount > 99 ? '99+' : myUnreadCount}
              </span>
            )}

            {/* Dropdown */}
            {bellOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                width: 320, background: '#fff',
                border: '1px solid #E5E5E5', borderRadius: 12,
                boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
                zIndex: 100, overflow: 'hidden',
              }}>
                <div style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid #F2F2F2',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#0A0A0A' }}>Unread replies</span>
                  {myUnreadCount > 0 && (
                    <span style={{
                      fontSize: 11, fontWeight: 600, color: '#FF4713',
                      background: 'rgba(255,71,19,0.08)', borderRadius: 6, padding: '2px 7px',
                    }}>
                      {myUnreadCount} ticket{myUnreadCount > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {myUnreadTickets.length === 0 ? (
                  <div style={{ padding: '24px 16px', textAlign: 'center' }}>
                    <p style={{ fontSize: 13, color: '#A3A3A3', margin: 0 }}>You're all caught up</p>
                  </div>
                ) : (
                  <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                    {myUnreadTickets.map(t => (
                      <BellTicketRow
                        key={t.id}
                        ticket={t}
                        onNavigate={() => {
                          setBellOpen(false)
                          navigate(`/tickets/${t.id}`)
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {/* ── Slack offline banner ── */}
        {appConfig?.slack_configured && !appConfig?.slack_online && (
          <div style={{
            background: '#7C2D12',
            color: '#FED7AA',
            padding: '8px 20px',
            fontSize: 13,
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            position: 'sticky',
            top: 56,
            zIndex: 29,
            flexShrink: 0,
          }}>
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M7.5 1L14 13H1L7.5 1z" />
              <path d="M7.5 6v3.5" />
              <circle cx="7.5" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
            </svg>
            <span>Slack bot is disconnected — ticket notifications from Slack are paused.</span>
            <Link
              to="/admin/settings"
              style={{ color: '#FED7AA', textDecoration: 'underline', marginLeft: 4, whiteSpace: 'nowrap' }}
            >
              Go to Settings
            </Link>
          </div>
        )}

        {/* ── Content ── */}
        <main style={{ flex: 1, padding: 0, minWidth: 0 }}>
          {children}
        </main>
      </div>
    </div>
  )
}

// ── BellTicketRow sub-component ───────────────────────────────────────────────

function BellTicketRow({
  ticket,
  onNavigate,
}: {
  ticket: { id: number; display_id: string; title: string }
  onNavigate: () => void
}) {
  return (
    <button
      onClick={onNavigate}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '10px 16px',
        background: 'none', border: 'none', cursor: 'pointer',
        borderBottom: '1px solid #F9F9F9', textAlign: 'left',
        transition: 'background 0.12s',
      }}
      onMouseOver={e => (e.currentTarget.style.background = '#F9F9F9')}
      onMouseOut={e => (e.currentTarget.style.background = 'none')}
    >
      <span style={{
        width: 7, height: 7, borderRadius: '50%',
        background: '#FF4713', flexShrink: 0,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
          color: '#A3A3A3', letterSpacing: '0.04em', display: 'block',
        }}>
          {ticket.display_id}
        </span>
        <span style={{
          fontSize: 12, fontWeight: 500, color: '#0A0A0A',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          display: 'block', marginTop: 1,
        }}>
          {ticket.title}
        </span>
      </div>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#A3A3A3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M4.5 2.5l3 3.5-3 3.5" />
      </svg>
    </button>
  )
}

// ── NavItem sub-component ─────────────────────────────────────────────────────

function NavItem({
  to,
  label,
  icon,
  collapsed,
}: {
  to: string
  label: string
  icon: React.ReactNode
  collapsed: boolean
}) {
  return (
    <NavLink
      to={to}
      end={to === '/queue' ? false : true}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: collapsed ? '9px 0' : '9px 16px',
        margin: '1px 8px',
        borderRadius: 7,
        textDecoration: 'none',
        fontSize: 13,
        fontWeight: isActive ? 600 : 400,
        color: isActive ? '#FF4713' : 'rgba(242,242,242,0.50)',
        background: isActive ? 'rgba(255,71,19,0.08)' : 'transparent',
        borderLeft: isActive ? '3px solid #FF4713' : '3px solid transparent',
        transition: 'background 0.15s, color 0.15s',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        justifyContent: collapsed ? 'center' : 'flex-start',
        position: 'relative',
      })}
      title={collapsed ? label : undefined}
    >
      {({ isActive }) => (
        <>
          <span style={{
            flexShrink: 0,
            color: isActive ? '#FF4713' : 'rgba(242,242,242,0.35)',
            display: 'flex',
          }}>
            {icon}
          </span>
          {!collapsed && <span>{label}</span>}
        </>
      )}
    </NavLink>
  )
}
