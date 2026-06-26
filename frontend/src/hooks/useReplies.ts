import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

export interface ReplyRead {
  id: number
  ticket_id: number
  author_id: number | null
  author_name: string | null
  body: string
  is_internal: boolean
  created_at: string
}

export interface ReplyCreate {
  body: string
  is_internal: boolean
}

export function useReplies(ticketId: number) {
  return useQuery<ReplyRead[]>({
    queryKey: ['replies', ticketId],
    queryFn: async () => {
      const { data } = await api.get<ReplyRead[]>(`/tickets/${ticketId}/replies`)
      return data
    },
    staleTime: 10_000,
    refetchInterval: 15_000, // poll every 15 s
  })
}

export function useAddReply(ticketId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ReplyCreate) =>
      api.post<ReplyRead>(`/tickets/${ticketId}/replies`, body).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['replies', ticketId] })
    },
  })
}
