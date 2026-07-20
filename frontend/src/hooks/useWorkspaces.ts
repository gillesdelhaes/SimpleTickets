import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'

export interface WorkspaceOption {
  id: number
  name: string
}

/**
 * Lightweight list of active Slack workspace connections — available to any
 * authenticated user (not just admins). Powers the reporter-workspace picker
 * in CreateTicketModal and the per-workspace Slack ID linker on Admin Users.
 * For the full admin CRUD shape (tokens, status, settings) see the
 * Settings → Workspaces tab, which calls /admin/slack-workspaces directly.
 */
export function useWorkspaceOptions() {
  return useQuery<WorkspaceOption[]>({
    queryKey: ['slack-workspace-options'],
    queryFn: async () => (await api.get<WorkspaceOption[]>('/slack/workspaces')).data,
    staleTime: 5 * 60_000,
  })
}
