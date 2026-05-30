import { Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Splash from './pages/Splash'
import AuthCallback from './pages/AuthCallback'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'
import Queue from './pages/Queue'
import Portal from './pages/Portal'
import TicketDetail from './pages/TicketDetail'
import AdminUsers from './pages/admin/Users'
import AdminCategories from './pages/admin/Categories'
import AdminSLAPolicies from './pages/admin/SLAPolicies'
import AdminSettings from './pages/admin/Settings'
import AdminAudit from './pages/admin/Audit'

// Placeholder — replaced when each chunk is built
function Placeholder({ name }: { name: string }) {
  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
      <div className="text-center">
        <p className="font-mono text-xs text-brand-primary tracking-widest uppercase mb-3">
          Coming in next chunk
        </p>
        <h1 className="text-2xl font-bold text-neutral-950">{name}</h1>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Splash — active until auth is wired up */}
        <Route path="/" element={<Splash />} />

        {/* ── Public auth routes ── */}
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* ── Protected: any authenticated user ── */}
        <Route element={<ProtectedRoute roles={['end_user', 'technician', 'admin']} />}>
          <Route path="/portal" element={<Portal />} />
          <Route path="/tickets/new" element={<Placeholder name="New Ticket" />} />
          <Route path="/tickets/:id" element={<TicketDetail />} />
        </Route>

        {/* ── Protected: technician + admin ── */}
        <Route element={<ProtectedRoute roles={['technician', 'admin']} />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/queue/mine" element={<Placeholder name="My Queue" />} />
          <Route path="/search" element={<Placeholder name="Search" />} />
          <Route path="/reports" element={<Placeholder name="Reports" />} />
        </Route>

        {/* ── Protected: admin only ── */}
        <Route element={<ProtectedRoute roles={['admin']} />}>
          <Route path="/admin/users" element={<AdminUsers />} />
          <Route path="/admin/categories" element={<AdminCategories />} />
          <Route path="/admin/sla" element={<AdminSLAPolicies />} />
          <Route path="/admin/settings" element={<AdminSettings />} />
          <Route path="/admin/audit" element={<AdminAudit />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
