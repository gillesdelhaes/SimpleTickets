import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'

export interface SlackUser {
  id: string
  name: string
}

/**
 * Members of one Slack workspace, for the reporter picker. Pass the
 * workspace the reporter should come from — Slack user IDs only make sense
 * within the workspace that issued them. Disabled (returns nothing, doesn't
 * fetch) until a workspaceId is chosen.
 */
export function useSlackUsers(workspaceId: number | null | undefined) {
  return useQuery<SlackUser[]>({
    queryKey: ['slack-users', workspaceId],
    queryFn: async () => {
      const { data } = await api.get<SlackUser[]>(`/slack/workspaces/${workspaceId}/users`)
      return data
    },
    staleTime: 5 * 60_000, // 5 min — workspace membership doesn't change often
    enabled: workspaceId != null,
  })
}
