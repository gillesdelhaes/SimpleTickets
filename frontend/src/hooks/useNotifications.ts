import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

export type NotificationKind =
  | 'assigned'
  | 'sla_warning'
  | 'first_response_warning'
  | 'sla_breached'
  | 'csat_negative'

export interface NotificationItem {
  id: number
  kind: NotificationKind | string
  ticket_id: number
  display_id: string
  ticket_title: string
  actor_name: string | null
  created_at: string
  read: boolean
}

/** Bell notifications (assigned, SLA warning/breach, 👎 survey). Unread
 *  replies are separate — see useUnreadReplies. */
export function useNotifications() {
  return useQuery<{ items: NotificationItem[]; unread_count: number }>({
    queryKey: ['notifications', 'bell'],
    queryFn: async () => (await api.get('/notifications')).data,
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications', 'bell'] }),
  })
}

export function notificationText(n: NotificationItem): string {
  switch (n.kind) {
    case 'assigned': return n.actor_name ? `${n.actor_name} assigned it to you` : 'Assigned to you'
    case 'sla_warning': return 'SLA breaches in under 15 min'
    case 'first_response_warning': return 'First response due in under 15 min'
    case 'sla_breached': return 'SLA breached'
    case 'csat_negative': return 'Requester says it’s not solved — reopened'
    default: return n.kind.replace(/_/g, ' ')
  }
}
