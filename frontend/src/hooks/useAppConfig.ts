import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'
import { setStatuses, setTimezone, type StatusConfig } from '../types/ticket'

interface AppConfig {
  timezone: string
  statuses: StatusConfig[]
  slack_configured: boolean
}

export function useAppConfig() {
  return useQuery<AppConfig>({
    queryKey: ['app-config'],
    queryFn: async () => {
      const { data } = await api.get<AppConfig>('/app-config')
      setTimezone(data.timezone)
      setStatuses(data.statuses)
      return data
    },
    staleTime: 60 * 1000,
  })
}
