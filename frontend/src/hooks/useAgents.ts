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
      const p = new URLSearchParams()
      p.append('role', 'technician')
      p.append('role', 'admin')
      p.set('limit', '100')
      const { data } = await api.get<{ items: UserRead[]; total: number }>(
        `/admin/users?${p.toString()}`
      )
      return data.items.filter(u => u.is_active)
    },
    staleTime: 5 * 60_000,
    enabled: isAdmin,
  })
}
