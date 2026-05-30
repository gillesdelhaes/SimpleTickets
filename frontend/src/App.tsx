import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import SetupGuard from './components/SetupGuard'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Queue from './pages/Queue'
import TicketDetail from './pages/TicketDetail'
import AdminUsers from './pages/admin/Users'
import AdminCategories from './pages/admin/Categories'
import AdminSLAPolicies from './pages/admin/SLAPolicies'
import AdminSettings from './pages/admin/Settings'
import AdminAudit from './pages/admin/Audit'
import Search from './pages/Search'
import SetupWizard from './pages/setup/SetupWizard'

function Placeholder({ name }: { name: string }) {
  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
      <div className="text-center">
        <p className="font-mono text-xs text-brand-primary tracking-widest uppercase mb-3">
          Coming soon
        </p>
        <h1 className="text-2xl font-bold text-neutral-950">{name}</h1>
      </div>
    </div>
  )
}

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
            <Route path="/reports" element={<Placeholder name="Reports" />} />
          </Route>

          {/* ── Admin only ── */}
          <Route element={<ProtectedRoute roles={['admin']} />}>
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/admin/categories" element={<AdminCategories />} />
            <Route path="/admin/sla" element={<AdminSLAPolicies />} />
            <Route path="/admin/settings" element={<AdminSettings />} />
            <Route path="/admin/audit" element={<AdminAudit />} />
          </Route>
        </Routes>
      </SetupGuard>
    </AuthProvider>
  )
}
