import { Navigate, useLocation } from 'react-router-dom'
import { useSetupStatus } from '../hooks/useSetupStatus'

/**
 * Wraps the entire app. Redirects to /setup if setup is not complete.
 * Shows a minimal loading state while checking — keeps it invisible.
 */
export default function SetupGuard({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useSetupStatus()
  const location = useLocation()

  // Don't block rendering while checking
  if (isLoading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          border: '3px solid var(--track)',
          borderTopColor: 'var(--b1)',
          animation: 'spin 0.7s linear infinite',
        }} />
      </div>
    )
  }

  // Already on /setup — don't redirect
  if (location.pathname.startsWith('/setup')) {
    // If setup is complete and they somehow land here, send to login
    if (data?.setup_complete) {
      return <Navigate to="/login" replace />
    }
    return <>{children}</>
  }

  // Needs setup
  if (data && (!data.setup_complete || !data.has_admin)) {
    return <Navigate to="/setup" replace />
  }

  return <>{children}</>
}
