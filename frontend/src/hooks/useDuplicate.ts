import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'
import type { TicketRead } from '../types/ticket'

export function useMarkDuplicate(ticketId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (duplicateOfId: number) =>
      api.post<TicketRead>(`/tickets/${ticketId}/mark-duplicate`, { duplicate_of_id: duplicateOfId }).then(r => r.data),
    onSuccess: updated => {
      queryClient.setQueryData(['ticket', ticketId], updated)
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      queryClient.invalidateQueries({ queryKey: ['ticket-history', ticketId] })
    },
  })
}

export function useUnmarkDuplicate(ticketId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api.delete<TicketRead>(`/tickets/${ticketId}/mark-duplicate`).then(r => r.data),
    onSuccess: updated => {
      queryClient.setQueryData(['ticket', ticketId], updated)
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      queryClient.invalidateQueries({ queryKey: ['ticket-history', ticketId] })
    },
  })
}
