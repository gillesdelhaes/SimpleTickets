import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

export type UserRole = 'technician' | 'admin'

export interface AuthUser {
  id: number
  email: string
  name: string
  role: UserRole
}

interface AuthContextValue {
  user: AuthUser | null
  token: string | null
  loading: boolean
  login: (token: string) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    // Base64url → base64 → decode
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='))
    return JSON.parse(json)
  } catch {
    return null
  }
}

function tokenToUser(token: string): AuthUser | null {
  const payload = decodeJwtPayload(token)
  if (!payload) return null

  const exp = payload['exp'] as number | undefined
  if (exp && exp < Date.now() / 1000) return null // expired

  const sub = payload['sub']
  const email = payload['email']
  const role = payload['role']
  const name = payload['name']

  if (!sub || !email || !role) return null

  return {
    id: Number(sub),
    email: String(email),
    name: name ? String(name) : String(email).split('@')[0],
    role: String(role) as UserRole,
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  // Bootstrap from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('st_token')
    if (stored) {
      const decoded = tokenToUser(stored)
      if (decoded) {
        setToken(stored)
        setUser(decoded)
      } else {
        // Token exists but is expired/invalid — clear it
        localStorage.removeItem('st_token')
      }
    }
    setLoading(false)
  }, [])

  const login = useCallback((newToken: string) => {
    const decoded = tokenToUser(newToken)
    if (!decoded) return
    localStorage.setItem('st_token', newToken)
    setToken(newToken)
    setUser(decoded)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('st_token')
    setToken(null)
    setUser(null)
    navigate('/login')
  }, [navigate])

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
