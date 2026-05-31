import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'

export interface SlackUser {
  id: string
  name: string
}

export function useSlackUsers() {
  return useQuery<SlackUser[]>({
    queryKey: ['slack-users'],
    queryFn: async () => {
      const { data } = await api.get<SlackUser[]>('/slack/users')
      return data
    },
    staleTime: 5 * 60_000, // 5 min — workspace membership doesn't change often
  })
}
