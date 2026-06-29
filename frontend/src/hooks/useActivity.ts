import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'

export type ActivityEventType = 'ticket_created' | 'field_changed' | 'reply_added'

export interface ActivityEvent {
  type: ActivityEventType
  ticket_id: number
  ticket_display_id: string
  ticket_title: string
  actor_name: string | null
  created_at: string
  // field_changed
  field?: string
  old_value?: string | null
  new_value?: string | null
  // reply_added
  body?: string
}

export function useActivity(limit = 20) {
  return useQuery<ActivityEvent[]>({
    queryKey: ['activity', limit],
    queryFn: async () => {
      const { data } = await api.get<ActivityEvent[]>(`/activity?limit=${limit}`)
      return data
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
