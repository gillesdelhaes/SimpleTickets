import { Navigate, Outlet } from 'react-router-dom'
import { useAuth, UserRole } from '../contexts/AuthContext'

interface ProtectedRouteProps {
  roles?: UserRole[]
}

export default function ProtectedRoute({ roles }: ProtectedRouteProps) {
  const { user, loading } = useAuth()

  if (loading) return null

  if (!user) return <Navigate to="/login" replace />

  // Role check — this portal is for IT staff only
  if (roles && !roles.includes(user.role)) {
    return (
      <>
        <div className="aura" aria-hidden="true" />
        <div className="relative min-h-screen flex items-center justify-center" style={{ zIndex: 1 }}>
          <div className="panel text-center px-8 py-9" style={{ maxWidth: 400 }}>
            <div
              className="w-14 h-14 rounded-block flex items-center justify-center mx-auto mb-5"
              style={{ background: 'var(--brand-tint)', color: 'var(--brand-ink)' }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-ink mb-2 tracking-tight">IT staff only</h1>
            <p className="text-sm text-ink-2 leading-relaxed m-0">
              This portal is restricted to IT technicians and administrators.
              Submit requests via Slack instead.
            </p>
          </div>
        </div>
      </>
    )
  }

  return <Outlet />
}
