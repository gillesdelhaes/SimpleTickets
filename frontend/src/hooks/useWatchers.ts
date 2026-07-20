import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

export interface WatcherRead {
  user_id: number
  name: string
  // false = no Slack ID linked, so this watcher won't receive DMs
  slack_linked: boolean
}

export function useWatchers(ticketId: number) {
  return useQuery<WatcherRead[]>({
    queryKey: ['watchers', ticketId],
    queryFn: async () => (await api.get<WatcherRead[]>(`/tickets/${ticketId}/watchers`)).data,
    staleTime: 30_000,
  })
}

export function useAddWatcher(ticketId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (userId: number) => api.put(`/tickets/${ticketId}/watchers/${userId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['watchers', ticketId] }),
  })
}

export function useRemoveWatcher(ticketId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (userId: number) => api.delete(`/tickets/${ticketId}/watchers/${userId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['watchers', ticketId] }),
  })
}
