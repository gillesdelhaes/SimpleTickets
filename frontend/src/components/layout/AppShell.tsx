import { useState, useEffect, useRef } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

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

function IconMyQueue() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6.5" cy="5" r="2.5" />
      <path d="M2 14.5c0-2.485 2.015-4.5 4.5-4.5" />
      <path d="M11 9.5h6M11 12.5h6M11 15.5h4" />
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

function IconCategories() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2.5L16 9l-6.5 6.5-2-2L12 9 7.5 4.5z" />
      <circle cx="5.5" cy="9" r="2.5" />
    </svg>
  )
}

function IconSLA() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="7" />
      <path d="M9 5v4l2.5 2.5" />
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
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="2.5" />
      <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.697 3.697l1.414 1.414M12.889 12.889l1.414 1.414M3.697 14.303l1.414-1.414M12.889 5.111l1.414-1.414" />
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

function IconMenu() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M3 5h14M3 10h14M3 15h14" />
    </svg>
  )
}

// ── Nav data ──────────────────────────────────────────────────────────────────

const NAV_MAIN = [
  { to: '/dashboard', label: 'Dashboard', icon: <IconDashboard /> },
  { to: '/queue', label: 'Queue', icon: <IconQueue /> },
  { to: '/queue/mine', label: 'My Queue', icon: <IconMyQueue /> },
  { to: '/search', label: 'Search', icon: <IconSearch /> },
  { to: '/reports', label: 'Reports', icon: <IconReports /> },
]

const NAV_ADMIN = [
  { to: '/admin/users', label: 'Users', icon: <IconUsers /> },
  { to: '/admin/categories', label: 'Categories', icon: <IconCategories /> },
  { to: '/admin/sla', label: 'SLA Policies', icon: <IconSLA /> },
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
              <span style={{ fontSize: 17, letterSpacing: '-0.04em', lineHeight: 1 }}>
                <span style={{ fontWeight: 200, color: 'rgba(255,255,255,0.85)' }}>Simply</span>
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
                  fontSize: 12, fontWeight: 600, color: 'rgba(242,242,242,0.9)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {user?.name ?? user?.email}
                </div>
                <div style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'rgba(115,115,115,0.7)',
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
          padding: '0 20px',
          gap: 16,
          position: 'sticky',
          top: 0,
          zIndex: 30,
          flexShrink: 0,
        }}>
          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(o => !o)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#737373', padding: 4, display: 'flex', alignItems: 'center',
            }}
            className="md:hidden"
          >
            <IconMenu />
          </button>

          {/* Page title */}
          <h1 style={{
            fontSize: 15, fontWeight: 700, color: '#0A0A0A',
            letterSpacing: '-0.02em', margin: 0, flex: 1,
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

          {/* Notification bell (placeholder) */}
          <button style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#737373', padding: 6, borderRadius: 8,
            display: 'flex', alignItems: 'center',
            transition: 'background 0.15s',
          }}
            onMouseOver={e => (e.currentTarget.style.background = '#F2F2F2')}
            onMouseOut={e => (e.currentTarget.style.background = 'none')}
            title="Notifications"
          >
            <IconBell />
          </button>
        </header>

        {/* ── Content ── */}
        <main style={{ flex: 1, padding: '24px 24px 40px', minWidth: 0 }}>
          {children}
        </main>
      </div>
    </div>
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
        color: isActive ? '#FF4713' : 'rgba(242,242,242,0.55)',
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
            color: isActive ? '#FF4713' : 'rgba(242,242,242,0.45)',
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
