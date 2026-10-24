import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import api from '../../lib/api'
import StatusBadge from './StatusBadge'
import { timeAgo, type RequesterTickets as RequesterTicketsData } from '../../types/ticket'

// "Other tickets from this person" — sidebar context for the ticket's
// requester. Renders nothing until there's at least one other ticket. The
// counts always show; the list stays collapsed until asked for, so a frequent
// requester doesn't push the rest of the sidebar out of view.
export default function RequesterTickets({ ticketId }: { ticketId: number }) {
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [ticketId])
  const { data } = useQuery<RequesterTicketsData>({
    queryKey: ['requester-tickets', ticketId],
    queryFn: async () => {
      const { data } = await api.get<RequesterTicketsData>(`/tickets/${ticketId}/requester-tickets`)
      return data
    },
    staleTime: 60_000,
  })

  if (!data || data.total_count === 0) return null

  const more = data.total_count - data.items.length

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-3">
        Other tickets from this person
      </span>
      <span className="text-[12px] text-ink-2">
        {data.open_count} open · {data.total_count} total
      </span>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="self-start inline-flex items-center gap-1 bg-transparent border-0 p-0 cursor-pointer text-[12px] font-medium text-brand-ink hover:underline"
      >
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }}
          aria-hidden
        >
          <path d="M3.5 2l3 3-3 3" />
        </svg>
        {open ? 'Hide tickets from this person' : 'See tickets from this person'}
      </button>
      {open && (
        <>
          <ul className="flex flex-col gap-1 m-0 p-0 list-none">
            {data.items.map(t => (
              <li key={t.id}>
                <Link
                  to={`/tickets/${t.id}`}
                  title={t.title}
                  className="flex flex-col gap-1 -mx-2 rounded-control px-2 py-1.5 no-underline hover:bg-row-hover"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-brand-ink">{t.display_id}</span>
                    <StatusBadge status={t.status} />
                  </span>
                  <span className="flex items-baseline justify-between gap-2 min-w-0">
                    <span className="text-[12.5px] text-ink truncate min-w-0">{t.title}</span>
                    <span className="font-mono text-[10.5px] text-ink-3 flex-shrink-0">{timeAgo(t.created_at)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link
            to={`/queue?requester=${ticketId}`}
            className="text-[11.5px] font-medium text-brand-ink no-underline hover:underline"
          >
            {more > 0 ? `See all ${data.total_count + 1} in the queue →` : 'Open in the queue →'}
          </Link>
        </>
      )}
    </div>
  )
}
