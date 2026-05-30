import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'

export interface SetupStatus {
  setup_complete: boolean
  has_admin: boolean
}

export function useSetupStatus() {
  return useQuery<SetupStatus>({
    queryKey: ['setup-status'],
    queryFn: async () => {
      const res = await api.get<SetupStatus>('/setup/status')
      return res.data
    },
    staleTime: Infinity,   // only check once per session
    retry: false,
  })
}
