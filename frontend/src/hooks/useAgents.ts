import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'
import { useAuth } from '../contexts/AuthContext'

export interface UserRead {
  id: number
  name: string
  email: string
  role: string
  is_active: boolean
}

export function useAgents() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  return useQuery<UserRead[]>({
    queryKey: ['agents'],
    queryFn: async () => {
      // No role filter: every User row is staff (technician or admin) — submitters
      // are Slack users, not accounts. Passing role twice used to collapse to a
      // scalar and silently drop all technicians, so we omit it entirely.
      const { data } = await api.get<{ items: UserRead[]; total: number }>(
        '/admin/users?limit=100'
      )
      return data.items.filter(u => u.is_active)
    },
    staleTime: 5 * 60_000,
    enabled: isAdmin,
  })
}
