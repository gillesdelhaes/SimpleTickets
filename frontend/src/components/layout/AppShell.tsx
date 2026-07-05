import { useState, useEffect, useRef } from 'react'
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useTheme } from '../../hooks/useTheme'
import { useAppConfig } from '../../hooks/useAppConfig'
import { useUnreadReplies } from '../../hooks/useUnreadReplies'

// Tracks whether the viewport is phone-width. Drives the mobile drawer instead
// of relying on Tailwind responsive utilities that aren't wired up here.
function useIsMobile(): boolean {
  const query = '(max-width: 767px)'
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    setIsMobile(mq.matches)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isMobile
}

// ── Inline SVG icons (17×17, stroke-based) ────────────────────────────────────

function IconDashboard() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="1.5" width="6" height="6" rx="1.5" />
      <rect x="10.5" y="1.5" width="6" height="6" rx="1.5" />
      <rect x="1.5" y="10.5" width="6" height="6" rx="1.5" />
      <rect x="10.5" y="10.5" width="6" height="6" rx="1.5" />
    </svg>
  )
}

function IconQueue() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 4.5h12M3 9h12M3 13.5h8" />
    </svg>
  )
}

function IconSearch() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M12.5 12.5L16 16" />
    </svg>
  )
}

function IconReports() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 15V9M7.5 15V3M13 15v-4" />
    </svg>
  )
}

function IconUsers() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="6" r="3" />
      <path d="M1.5 15c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5" />
      <path d="M13 4a3 3 0 0 1 0 6M16.5 15c0-2-1.12-3.75-2.75-4.65" />
    </svg>
  )
}

function IconAudit() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3h12M3 7.5h12M3 12h7" />
      <circle cx="14" cy="13.5" r="2.5" />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
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
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2a5.5 5.5 0 0 1 5.5 5.5c0 3 1.5 4.5 1.5 4.5H2s1.5-1.5 1.5-4.5A5.5 5.5 0 0 1 9 2z" />
      <path d="M7.5 14.5a1.5 1.5 0 0 0 3 0" />
    </svg>
  )
}

function IconLogout() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
      <path d="M11 11l3-3-3-3M14 8H6" />
    </svg>
  )
}

function IconSun() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

function IconMoon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

function IconMenu() {
  return (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M3 5h14M3 10h14M3 15h14" />
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
  { to: '/admin/audit', label: 'Audit log', icon: <IconAudit /> },
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
  const location = useLocation()
  const isMobile = useIsMobile()
  const { theme, toggleTheme } = useTheme()
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

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed))
  }, [collapsed])

  // Close mobile drawer on route change (key on the actual path — navigate is a
  // stable ref and never triggered this before).
  useEffect(() => { setMobileOpen(false) }, [location.pathname])

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

  // On phones the sidebar becomes a slide-in drawer and always renders expanded.
  const sidebarCollapsed = isMobile ? false : collapsed
  const isAdmin = user?.role === 'admin'
  const avatarInitial = user?.name?.charAt(0).toUpperCase() ?? '?'
  const roleLabel = user?.role === 'admin' ? 'Admin' : user?.role === 'technician' ? 'Technician' : 'User'

  const sidebarClass = [
    'sidebar',
    sidebarCollapsed ? 'collapsed' : '',
    isMobile ? 'drawer' : '',
    isMobile && mobileOpen ? 'open' : '',
  ].filter(Boolean).join(' ')

  return (
    <>
      <div className="aura" aria-hidden="true" />
      <div className="shell">
        {/* Mobile overlay backdrop */}
        {isMobile && mobileOpen && (
          <div
            className={`scrim${mobileOpen ? ' open' : ''}`}
            style={{ zIndex: 40 }}
            onClick={() => setMobileOpen(false)}
          />
        )}

        <aside className={sidebarClass}>
          <div className="wordmark">
            <Link to="/dashboard" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="lite">Simple</span>
              <span className="brand">Tickets</span>
            </Link>
          </div>

          <nav aria-label="Main">
            {NAV_MAIN.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/queue' ? false : true}
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                title={sidebarCollapsed ? item.label : undefined}
              >
                {item.icon}
                <span>{item.label}</span>
              </NavLink>
            ))}

            {!isAdmin && (
              <NavLink
                to="/admin/settings"
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                title={sidebarCollapsed ? 'My account' : undefined}
              >
                <IconSettings />
                <span>My account</span>
              </NavLink>
            )}

            {isAdmin && (
              <>
                <div className="nav-sep">Admin</div>
                {NAV_ADMIN.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                    title={sidebarCollapsed ? item.label : undefined}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </>
            )}
          </nav>

          <div className="side-foot">
            <div className="avatar">{avatarInitial}</div>
            <div className="who">
              <b>{user?.name ?? user?.email}</b>
              <span>{roleLabel}</span>
            </div>
            <button
              onClick={logout}
              aria-label="Sign out"
              className="text-ink-3 hover:text-danger-ink"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', flexShrink: 0 }}
            >
              <IconLogout />
            </button>
          </div>

          {!isMobile && (
            <button
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="collapse-toggle"
            >
              {collapsed ? <IconChevronRight /> : <IconChevronLeft />}
            </button>
          )}
        </aside>

        <main>
          <header className="topbar">
            {isMobile && (
              <button
                className="icon-btn"
                onClick={() => setMobileOpen((o) => !o)}
                aria-label="Open navigation"
              >
                <IconMenu />
              </button>
            )}

            <div>
              <h1>{title}</h1>
            </div>

            <form onSubmit={handleSearch} className="search" style={{ overflow: 'visible' }}>
              <IconSearch />
              <input
                value={searchVal}
                onChange={(e) => setSearchVal(e.target.value)}
                placeholder="Search tickets…"
                aria-label="Search tickets"
                style={{
                  flex: 1, minWidth: 0, background: 'transparent', border: 'none',
                  outline: 'none', font: 'inherit', color: 'var(--ink)',
                }}
              />
            </form>

            {/* Notification bell */}
            <div ref={bellRef} style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
              <button
                className="icon-btn"
                onClick={() => setBellOpen((o) => !o)}
                aria-label={myUnreadCount > 0 ? `${myUnreadCount} tickets with unread replies` : 'Notifications'}
                style={myUnreadCount > 0 ? { color: 'var(--brand-ink)' } : undefined}
              >
                <IconBell />
              </button>
              {myUnreadCount > 0 && (
                <span
                  aria-hidden="true"
                  className="font-mono"
                  style={{
                    position: 'absolute', top: -2, right: -2,
                    minWidth: 17, height: 17, borderRadius: 9,
                    background: 'var(--brand-grad)', color: '#fff',
                    fontSize: 9.5, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 4px', pointerEvents: 'none', lineHeight: 1,
                  }}
                >
                  {myUnreadCount > 99 ? '99+' : myUnreadCount}
                </span>
              )}

              {bellOpen && (
                <div
                  className="overlay-surface animate-fade-up"
                  style={{
                    position: 'absolute', top: 'calc(100% + 10px)', right: 0,
                    width: 330, zIndex: 100, overflow: 'hidden', borderRadius: 18, padding: '4px 0',
                  }}
                >
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-track">
                    <span className="text-[13px] font-semibold text-ink">Unread replies</span>
                    {myUnreadCount > 0 && (
                      <span className="pill use plain">{myUnreadCount} ticket{myUnreadCount > 1 ? 's' : ''}</span>
                    )}
                  </div>
                  {myUnreadTickets.length === 0 ? (
                    <p className="m-0 px-4 py-6 text-center text-[13px] text-ink-3">You're all caught up</p>
                  ) : (
                    <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                      {myUnreadTickets.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => {
                            setBellOpen(false)
                            navigate(`/tickets/${t.id}`)
                          }}
                          className="flex items-center gap-2.5 w-full px-4 py-2.5 text-left bg-transparent border-0 cursor-pointer hover:bg-row-hover"
                        >
                          <span style={{
                            width: 7, height: 7, borderRadius: '50%',
                            background: 'var(--b1)', flexShrink: 0,
                          }} />
                          <span className="flex-1 min-w-0">
                            <span className="block font-mono text-[10px] text-ink-3 tracking-wide">{t.display_id}</span>
                            <span className="block text-[12.5px] font-medium text-ink truncate mt-0.5">{t.title}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              className="icon-btn"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {theme === 'dark' ? <IconSun /> : <IconMoon />}
            </button>
          </header>

          {/* Slack offline banner */}
          {appConfig?.slack_configured && !appConfig?.slack_online && (
            <div
              className="flex items-center gap-2.5 mb-4 px-4 py-3 rounded-block text-[13px] font-medium text-warn-ink"
              style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-bg)' }}
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M7.5 1L14 13H1L7.5 1z" />
                <path d="M7.5 6v3.5" />
                <circle cx="7.5" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
              </svg>
              <span>Slack bot is disconnected — ticket notifications from Slack are paused.</span>
              <Link to="/admin/settings" className="text-warn-ink underline whitespace-nowrap">
                Go to settings
              </Link>
            </div>
          )}

          {children}
        </main>
      </div>
    </>
  )
}
