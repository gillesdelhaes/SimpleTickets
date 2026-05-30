import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

export interface UnreadTicketSummary {
  id: number
  display_id: string
  title: string
}

export interface UnreadResponse {
  my_unread_count: number
  my_unread_tickets: UnreadTicketSummary[]
  ticket_ids_with_unread: number[]
}

export function useUnreadReplies() {
  return useQuery<UnreadResponse>({
    queryKey: ['notifications', 'unread'],
    queryFn: async () => {
      const { data } = await api.get<UnreadResponse>('/notifications/unread')
      return data
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}

export function useMarkTicketRead(ticketId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post(`/tickets/${ticketId}/mark-read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread'] })
    },
  })
}
