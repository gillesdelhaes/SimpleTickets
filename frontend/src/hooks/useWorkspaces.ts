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
 * Settings → Slack tab, which calls /admin/slack-workspaces directly.
 */
export function useWorkspaceOptions({ refetchOnMount = false }: { refetchOnMount?: boolean } = {}) {
  return useQuery<WorkspaceOption[]>({
    queryKey: ['slack-workspace-options'],
    queryFn: async () => (await api.get<WorkspaceOption[]>('/slack/workspaces')).data,
    staleTime: 5 * 60_000,
    // Pages whose whole point is the workspace list (My account) pass true so
    // a workspace connected elsewhere — another admin, another tab — shows up.
    refetchOnMount: refetchOnMount ? 'always' : true,
  })
}
