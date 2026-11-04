import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api, { apiErrorMessage } from '../../lib/api'
import { timeAgo } from '../../types/ticket'

// The AI Assistant's current read of the ticket, for technicians. It's
// rewritten after each requester reply (see backend app/ai/triage.py), so this
// is one living summary rather than a trail of notes in the thread.

interface Assessment {
  clarity: 'clear' | 'needs_info' | 'unclear'
  summary: string
  known: string[]
  missing: string[]
  possible_fixes: string[]
  questions: string[]
  suggested_priority: 'low' | 'medium' | 'high' | 'critical'
  priority_reason: string
  suggested_category: string | null
  category_reason: string
}

interface TicketAssistant {
  active: boolean
  assessment: Assessment | null
  asked: string[]
  category_set: string | null
  title_set: { from: string; to: string } | null
  question_rounds: number
  max_question_rounds: number
  assessed_at: string | null
  updating: boolean
}

const CLARITY: Record<Assessment['clarity'], { label: string; pill: string }> = {
  clear: { label: 'Clear enough to start', pill: 'use' },
  needs_info: { label: 'Needs more information', pill: 'warn' },
  unclear: { label: 'Unclear', pill: 'danger' },
}
const PRIORITY: Record<Assessment['suggested_priority'], string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-3 mb-1">{title}</div>
      <ul className="m-0 pl-4 flex flex-col gap-0.5 text-[13px] text-ink-2 leading-relaxed">
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    </div>
  )
}

export default function AssistantPanel({ ticketId }: { ticketId: number }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { data } = useQuery<TicketAssistant>({
    queryKey: ['ticket-assistant', ticketId],
    queryFn: async () => (await api.get<TicketAssistant>(`/tickets/${ticketId}/assistant`)).data,
    // Faster while an update is on its way
    refetchInterval: q => (q.state.data?.updating ? 10_000 : 30_000),
  })
  const refresh = useMutation({
    mutationFn: async () => (await api.post<TicketAssistant>(`/tickets/${ticketId}/assistant/refresh`)).data,
    onMutate: () => setError(null),
    onSuccess: r => {
      qc.setQueryData(['ticket-assistant', ticketId], r)
      // It may have set the category or title
      qc.invalidateQueries({ queryKey: ['ticket', ticketId] })
      qc.invalidateQueries({ queryKey: ['ticket-history', ticketId] })
    },
    onError: err => setError(apiErrorMessage(err, 'The Assistant couldn’t run.')),
  })

  const a = data?.assessment
  if (!data || !a) return null
  const clarity = CLARITY[a.clarity]
  const asking = data.asked.length > 0

  return (
    <section className="panel">
      <div className="panel-head" style={{ paddingBottom: open ? 4 : 14 }}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="flex items-center gap-2 bg-transparent border-0 p-0 cursor-pointer text-left"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="text-ink-3" style={{ transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'none' }}>
            <path d="M4 2l4 4-4 4" />
          </svg>
          <h2 className="m-0">Assistant</h2>
        </button>
        <span className="text-[10px] font-bold uppercase tracking-[0.06em] rounded-md px-1.5 py-px text-brand-ink" style={{ background: 'var(--brand-tint)' }}>AI</span>
        <span className={`pill ${clarity.pill}`}>{clarity.label}</span>
        <span className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[10.5px] text-ink-3">
            {data.updating || refresh.isPending ? 'Updating…' : data.assessed_at ? `Updated ${timeAgo(data.assessed_at)}` : ''}
          </span>
          {data.active && (
            <button className="btn ghost sm" disabled={refresh.isPending} onClick={() => refresh.mutate()} title="Re-read the ticket now. Never messages the requester.">
              Refresh
            </button>
          )}
        </span>
      </div>

      {open && (
        <div className="px-5 pb-5 pt-2 flex flex-col gap-3.5">
          <p className="m-0 text-[13.5px] text-ink leading-relaxed">{a.summary}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <List title="Known" items={a.known} />
            <List title="Missing" items={a.missing} />
          </div>

          <List title="Possible fixes" items={a.possible_fixes} />

          {a.questions.length > 0 && (
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-3 mb-1">
                {asking ? 'Asked the requester' : 'Questions worth asking'}
              </div>
              <ul className="m-0 pl-4 flex flex-col gap-0.5 text-[13px] text-ink-2 leading-relaxed">
                {a.questions.map((q, i) => <li key={i}>{q}</li>)}
              </ul>
              {data.question_rounds > 0 && (
                <div className="text-[11.5px] text-ink-3 mt-1">
                  {data.question_rounds} of {data.max_question_rounds} rounds of questions sent. The Assistant stops asking once a technician replies.
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1 text-[12.5px] text-ink-2 border-t border-track pt-3">
            <span>
              <b className="text-ink">Priority:</b> {PRIORITY[a.suggested_priority]} suggested
              {a.priority_reason && <span className="text-ink-3"> — {a.priority_reason}</span>}
            </span>
            {data.title_set && (
              <span>
                <b className="text-ink">Title:</b> rewritten by the Assistant
                <span className="text-ink-3"> — was “{data.title_set.from}”</span>
              </span>
            )}
            {(data.category_set || a.suggested_category) && (
              <span>
                <b className="text-ink">Category:</b> {data.category_set ? `${data.category_set}, set by the Assistant` : `${a.suggested_category} suggested`}
                {a.category_reason && <span className="text-ink-3"> — {a.category_reason}</span>}
              </span>
            )}
          </div>

          {error && <div className="text-[12.5px] text-danger-ink">{error}</div>}
        </div>
      )}
    </section>
  )
}
