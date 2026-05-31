import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'
import type { TicketListResponse } from '../types/ticket'

interface UseTicketsParams {
  status?: string[]
  priority?: string[]
  assignee_id?: number | null
  unassigned?: boolean
  category_id?: number | null
  submitter_id?: number | null
  q?: string
  limit?: number
  offset?: number
}

export function useTickets(params: UseTicketsParams = {}) {
  const { status, priority, assignee_id, unassigned, category_id, submitter_id, q, limit = 50, offset = 0 } = params

  const queryKey = ['tickets', { status, priority, assignee_id, unassigned, category_id, submitter_id, q, limit, offset }]

  return useQuery<TicketListResponse>({
    queryKey,
    queryFn: async () => {
      const p = new URLSearchParams()
      status?.forEach(s => p.append('status', s))
      priority?.forEach(pr => p.append('priority', pr))
      if (assignee_id != null) p.set('assignee_id', String(assignee_id))
      if (unassigned) p.set('unassigned', 'true')
      if (category_id != null) p.set('category_id', String(category_id))
      if (submitter_id != null) p.set('submitter_id', String(submitter_id))
      if (q) p.set('q', q)
      p.set('limit', String(limit))
      p.set('offset', String(offset))
      const { data } = await api.get<TicketListResponse>(`/tickets?${p.toString()}`)
      return data
    },
    staleTime: 30_000, // 30 s — queue doesn't need to be real-time
  })
}
