import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'
import type { TicketRead } from '../types/ticket'

export function useTicket(id: number) {
  return useQuery<TicketRead>({
    queryKey: ['ticket', id],
    queryFn: async () => {
      const { data } = await api.get<TicketRead>(`/tickets/${id}`)
      return data
    },
    staleTime: 15_000,
    refetchInterval: 15_000, // poll every 15 s
  })
}
