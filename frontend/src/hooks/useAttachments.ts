import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'

export interface AttachmentRead {
  id: number
  ticket_id: number
  reply_id: number | null
  filename: string
  mime_type: string
  size_bytes: number
  created_at: string
}

export function useAttachments(ticketId: number) {
  return useQuery<AttachmentRead[]>({
    queryKey: ['attachments', ticketId],
    queryFn: async () => (await api.get(`/tickets/${ticketId}/attachments`)).data,
    staleTime: 30_000,
    refetchInterval: 15_000,
  })
}

export function isImage(mime: string): boolean {
  return mime.startsWith('image/')
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
