import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AskBlock {
  id: string
  tool: string
  args: Record<string, unknown>
  kind: string
  title: string
  summary: Record<string, any>
  data: Record<string, any>
  basis: string
  note: string | null
}

export interface AskMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  error: string | null
  blocks: AskBlock[]
  follow_ups: string[]
  can_pin: boolean
  unverified: boolean
  helpful: boolean | null
  created_at: string
}

export interface AskThreadSummary { id: number; title: string; days: number; updated_at: string }
export interface AskThread extends AskThreadSummary { messages: AskMessage[] }

export interface AskStatus {
  available: boolean
  reason: string | null
  is_admin: boolean
  coverage_90_days: { total: number; labelled: number }
  tokens_today: number
  daily_budget: number
}

export interface AskPin { id: number; title: string; question: string; days: number; created_at: string }
export interface AskDigest {
  rising: string[]
  misfiled: number | null
  stuck: number | null
  open: number | null
  suggestions: number | null
}

// ── Queries ────────────────────────────────────────────────────────────────────

export function useAskStatus() {
  return useQuery<AskStatus>({
    queryKey: ['ask', 'status'],
    queryFn: async () => (await api.get('/ask/status')).data,
    refetchInterval: 60_000,
  })
}

export function useAskThreads() {
  return useQuery<AskThreadSummary[]>({
    queryKey: ['ask', 'threads'],
    queryFn: async () => (await api.get('/ask/threads')).data,
  })
}

export function useAskThread(id: number | null) {
  return useQuery<AskThread>({
    queryKey: ['ask', 'thread', id],
    queryFn: async () => (await api.get(`/ask/threads/${id}`)).data,
    enabled: id != null,
  })
}

export function useAskPins() {
  return useQuery<AskPin[]>({
    queryKey: ['ask', 'pins'],
    queryFn: async () => (await api.get('/ask/pins')).data,
  })
}

export function useAskPin(id: number | null) {
  return useQuery<AskPin & { blocks: AskBlock[] }>({
    queryKey: ['ask', 'pin', id],
    queryFn: async () => (await api.get(`/ask/pins/${id}/run`)).data,
    enabled: id != null,
  })
}

export function useAskDigest(enabled: boolean) {
  return useQuery<AskDigest>({
    queryKey: ['ask', 'digest'],
    queryFn: async () => (await api.get('/ask/digest')).data,
    enabled,
    staleTime: 5 * 60_000,
  })
}

export function useAskInvalidate() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['ask'] })
}

// ── Asking: server-sent events over fetch (EventSource can't POST) ─────────────

export interface AskHandlers {
  onStart: (e: { thread_id: number; days: number; question: AskMessage }) => void
  onStep: (text: string) => void
  onMessage: (m: AskMessage) => void
  onError: (message: string) => void
}

export async function askStream(
  body: { question: string; thread_id?: number | null; days?: number },
  h: AskHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    const token = localStorage.getItem('st_token')
    res = await fetch('/api/ask/ask', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    h.onError("Couldn't reach the server. Check your connection and try again.")
    return
  }
  if (res.status === 401) {
    window.location.href = '/login'
    return
  }
  if (!res.ok || !res.body) {
    let detail = 'Ask is unavailable right now.'
    try {
      const j = await res.json()
      if (typeof j?.detail === 'string') detail = j.detail
    } catch { /* not JSON */ }
    h.onError(detail)
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let cut: number
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 2)
      let event = 'message'
      let data = ''
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7)
        else if (line.startsWith('data: ')) data += line.slice(6)
      }
      if (!data) continue // keep-alive comment
      const payload = JSON.parse(data)
      if (event === 'start') h.onStart(payload)
      else if (event === 'step') h.onStep(payload.text)
      else if (event === 'message') { finished = true; h.onMessage(payload) }
      else if (event === 'error') { finished = true; h.onError(payload.message) }
    }
  }
  if (!finished) h.onError('The answer was cut off. It may still appear when you reopen this conversation.')
}
