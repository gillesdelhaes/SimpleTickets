import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import SetupGuard from './components/SetupGuard'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Queue from './pages/Queue'
import TicketDetail from './pages/TicketDetail'
import AdminUsers from './pages/admin/Users'
import AdminSettings from './pages/admin/Settings'
import AdminAudit from './pages/admin/Audit'
import Search from './pages/Search'
import Reports from './pages/Reports'
import SetupWizard from './pages/setup/SetupWizard'

export default function App() {
  return (
    <AuthProvider>
      <SetupGuard>
        <Routes>
          <Route path="/setup" element={<SetupWizard />} />
          <Route path="/" element={<Navigate to="/queue" replace />} />
          <Route path="/login" element={<Login />} />

          {/* ── IT staff: technician + admin ── */}
          <Route element={<ProtectedRoute roles={['technician', 'admin']} />}>
            <Route path="/tickets/:id" element={<TicketDetail />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/queue" element={<Queue />} />
            <Route path="/search" element={<Search />} />
            <Route path="/reports" element={<Reports />} />
          </Route>

          {/* ── Settings: all logged-in users (admin tabs hidden for non-admins) ── */}
          <Route element={<ProtectedRoute roles={['technician', 'admin']} />}>
            <Route path="/admin/settings" element={<AdminSettings />} />
          </Route>

          {/* ── Admin only ── */}
          <Route element={<ProtectedRoute roles={['admin']} />}>
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/admin/audit" element={<AdminAudit />} />
          </Route>
        </Routes>
      </SetupGuard>
    </AuthProvider>
  )
}
