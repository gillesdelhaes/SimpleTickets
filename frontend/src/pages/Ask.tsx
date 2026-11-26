import { Fragment, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import AppShell from '../components/layout/AppShell'
import { AskBlockView, TOOL_LABELS } from '../components/ask/AskBlocks'
import api, { apiErrorMessage } from '../lib/api'
import { timeAgo } from '../types/ticket'
import {
  askStream, useAskDigest, useAskPin, useAskPins, useAskStatus, useAskThread, useAskThreads,
  type AskMessage,
} from '../hooks/useAsk'

const PERIODS = [30, 90, 180, 365] as const

const STARTERS = [
  "What's the ticket trend?",
  "What's the main issue we face?",
  'Are tickets properly categorised, or should we refine the categories?',
  'Should we add new ticket categories?',
  'Which issues could users fix themselves with a help article?',
  "Who's overloaded right now?",
  'How are we doing on SLA compared to last month?',
  'What is new or rising this week?',
]

// ── Small pieces ──────────────────────────────────────────────────────────────

function Sparkle({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    </svg>
  )
}

/** **bold**, TKT-0042 links, paragraphs and "- " lists. Nothing else. */
function RichAnswer({ text }: { text: string }) {
  const inline = (s: string, key: string) => s.split(/(\*\*[^*]+\*\*|TKT-\d{3,6})/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={key + i}>{part.slice(2, -2)}</strong>
    const m = /^TKT-(\d+)$/.exec(part)
    if (m) return <Link key={key + i} className="ask-inline-tkt" to={`/tickets/${Number(m[1])}`}>{part}</Link>
    return <Fragment key={key + i}>{part}</Fragment>
  })
  return (
    <div className="ask-text">
      {text.split(/\n{2,}/).map((para, i) => {
        const lines = para.split('\n')
        if (lines.every(l => /^\s*[-•]\s/.test(l))) {
          return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-•]\s/, ''), `${i}-${j}-`)}</li>)}</ul>
        }
        return <p key={i}>{inline(para, `${i}-`)}</p>
      })}
    </div>
  )
}

function Thumbs({ m, onChange }: { m: AskMessage; onChange: (v: boolean | null) => void }) {
  return (
    <span className="ask-thumbs">
      <button type="button" aria-label="Helpful" className={m.helpful === true ? 'on' : ''} onClick={() => onChange(m.helpful === true ? null : true)}>👍</button>
      <button type="button" aria-label="Not helpful" className={m.helpful === false ? 'on' : ''} onClick={() => onChange(m.helpful === false ? null : false)}>👎</button>
    </span>
  )
}

function PinButton({ m, defaultTitle, onPinned }: { m: AskMessage; defaultTitle: string; onPinned: () => void }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(defaultTitle.slice(0, 120))
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  if (!m.can_pin) return null
  if (state === 'done') return <span className="ask-badge ok">Pinned</span>
  if (!open) return <button type="button" className="ask-link small" onClick={() => setOpen(true)}>Pin this answer</button>
  return (
    <form className="ask-pinform" onSubmit={async e => {
      e.preventDefault(); setState('busy'); setError(null)
      try { await api.post('/ask/pins', { message_id: m.id, title }); setState('done'); onPinned() }
      catch (err) { setError(apiErrorMessage(err, "Couldn't pin it.")); setState('idle') }
    }}>
      <input id={`pin-${m.id}`} className="input" value={title} onChange={e => setTitle(e.target.value)} maxLength={120} aria-label="Pin title" />
      <button className="ask-btn primary" disabled={state === 'busy' || !title.trim()}>Pin</button>
      <button type="button" className="ask-btn" onClick={() => setOpen(false)}>Cancel</button>
      {error && <span className="ask-error-inline">{error}</span>}
    </form>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Ask() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const threadId = Number(params.get('t')) || null
  const pinId = Number(params.get('pin')) || null
  const { data: status } = useAskStatus()
  const { data: threads } = useAskThreads()
  const { data: pins } = useAskPins()
  const { data: digest } = useAskDigest(!!status?.available)
  const { data: thread } = useAskThread(threadId)
  const { data: pin, isFetching: pinLoading } = useAskPin(pinId)
  const [days, setDays] = useState<number>(90)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<{ question: string; steps: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const isAdmin = !!status?.is_admin

  useEffect(() => { if (thread) setDays(thread.days) }, [thread?.id])
  useEffect(() => {
    const el = scroller.current
    // Follow the conversation; the welcome screen stays at the top
    if (el && ((thread?.messages.length ?? 0) > 0 || pending)) el.scrollTop = el.scrollHeight
  }, [thread?.messages.length, pending?.steps.length, pending?.question])

  function openThread(id: number | null) {
    setError(null)
    setParams(id ? { t: String(id) } : {})
  }

  async function ask(question: string) {
    const q = question.trim()
    if (!q || pending) return
    setDraft(''); setError(null)
    setPending({ question: q, steps: [] })
    let tid = threadId
    await askStream({ question: q, thread_id: threadId, days }, {
      onStart: e => {
        tid = e.thread_id
        if (!threadId) setParams({ t: String(e.thread_id) }, { replace: true })
      },
      onStep: text => setPending(p => p && { ...p, steps: [...p.steps, text] }),
      onMessage: async () => {
        await qc.invalidateQueries({ queryKey: ['ask', 'thread', tid] })
        qc.invalidateQueries({ queryKey: ['ask', 'threads'] })
        qc.invalidateQueries({ queryKey: ['ask', 'status'] })
        setPending(null)
      },
      onError: async message => {
        await qc.invalidateQueries({ queryKey: ['ask', 'thread', tid] })
        setPending(null); setError(message)
      },
    })
  }

  async function changeDays(d: number) {
    setDays(d)
    if (threadId) {
      await api.patch(`/ask/threads/${threadId}`, { days: d }).catch(() => undefined)
      qc.invalidateQueries({ queryKey: ['ask', 'thread', threadId] })
    }
  }

  async function feedback(m: AskMessage, helpful: boolean | null) {
    await api.post(`/ask/messages/${m.id}/feedback`, { helpful }).catch(() => undefined)
    qc.invalidateQueries({ queryKey: ['ask', 'thread', threadId] })
  }

  async function removeThread(id: number) {
    await api.delete(`/ask/threads/${id}`).catch(() => undefined)
    qc.invalidateQueries({ queryKey: ['ask', 'threads'] })
    if (id === threadId) openThread(null)
  }

  async function removePin(id: number) {
    await api.delete(`/ask/pins/${id}`).catch(() => undefined)
    qc.invalidateQueries({ queryKey: ['ask', 'pins'] })
    if (id === pinId) openThread(null)
  }

  const messages = thread?.messages ?? []
  const lastUser = [...messages].reverse().find(m => m.role === 'user')
  const showPendingQuestion = pending && !(lastUser && lastUser.text === pending.question && messages[messages.length - 1]?.role === 'user')
  const cov = status?.coverage_90_days
  const coverageGap = cov && cov.total > 0 && cov.labelled < cov.total

  // ── Unavailable ──
  if (status && !status.available) {
    return (
      <AppShell title="Ask">
        <section className="panel ask-off">
          <div className="ai-mark-lg"><Sparkle size={22} /></div>
          <h2>Ask isn't available yet</h2>
          <p>{status.reason} Ask uses the same AI provider as the Assistant.</p>
          {isAdmin
            ? <button className="btn" onClick={() => navigate('/admin/settings?tab=ai')}>Open AI settings</button>
            : <p className="muted">An admin can switch it on in Settings → AI assistant.</p>}
        </section>
      </AppShell>
    )
  }

  return (
    <AppShell title="Ask">
      <div className="ask-page">
        <section className="panel ask-chat" aria-label={pinId ? 'Pinned answer' : 'Conversation'}>
          <div className="ask-toolbar">
            {pinId ? (
              <>
                <button type="button" className="ask-link" onClick={() => openThread(null)}>← Back to Ask</button>
                <span className="muted text-[12.5px]">Pinned answers refresh from the data each time. No AI is used.</span>
              </>
            ) : (
              <>
                <div className="ask-periods" role="group" aria-label="Period">
                  {PERIODS.map(p => (
                    <button key={p} type="button" className={`ask-seg${days === p ? ' on' : ''}`} onClick={() => changeDays(p)}>
                      {p === 365 ? '1 year' : `${p} days`}
                    </button>
                  ))}
                </div>
                {coverageGap && (
                  <span className="ask-coverage" title="Ask reads each ticket once to learn its topic and whether its category fits. Topic answers get more complete as it reads the rest.">
                    <span className="dot" /> Read {cov!.labelled.toLocaleString()} of {cov!.total.toLocaleString()} tickets
                  </span>
                )}
                <button type="button" className="btn sm ml-auto" onClick={() => openThread(null)}>+ New chat</button>
              </>
            )}
          </div>

          <div className="ask-thread" ref={scroller} aria-live="polite">
            {pinId ? (
              pin ? (
                <div className="ask-msg-ai">
                  <div className="ai-mark"><Sparkle /></div>
                  <div className="ai-body">
                    <h2 className="ask-pin-title">{pin.title}</h2>
                    {pin.question && <p className="muted text-[13px]">From the question “{pin.question}” · last {pin.days} days</p>}
                    {pin.blocks.map(b => <AskBlockView key={b.id} block={b} isAdmin={isAdmin} onAsk={q => { openThread(null); setTimeout(() => ask(q)) }} />)}
                  </div>
                </div>
              ) : <div className="ask-thinking"><div><span className="dot" />{pinLoading ? 'Refreshing…' : 'Loading…'}</div></div>
            ) : messages.length === 0 && !pending ? (
              <div className="ask-welcome">
                <div className="ai-mark-lg"><Sparkle size={22} /></div>
                <h2>Ask about your tickets</h2>
                <p>Trends, recurring problems, whether the categories still fit, workload, SLAs. Answers come from your ticket data, with the numbers and tickets behind them.</p>
                <div className="ask-starters">
                  {STARTERS.map(s => <button key={s} type="button" className="ask-suggest" onClick={() => ask(s)}>{s}</button>)}
                </div>
              </div>
            ) : (
              <>
                {messages.map((m, idx) => m.role === 'user' ? (
                  <div key={m.id} className="ask-msg-user">{m.text}</div>
                ) : (
                  <div key={m.id} className="ask-msg-ai">
                    <div className="ai-mark"><Sparkle /></div>
                    <div className="ai-body">
                      {m.error ? (
                        <div className="ask-error">{m.error}
                          {messages[idx - 1]?.role === 'user' && (
                            <button type="button" className="ask-link small" onClick={() => ask(messages[idx - 1].text)}>Try again</button>
                          )}
                        </div>
                      ) : (
                        <>
                          <RichAnswer text={m.text} />
                          {m.unverified && (
                            <div className="ask-warn">Some numbers in this text weren't found in the data below. Trust the charts and tables.</div>
                          )}
                          {m.blocks.map(b => <AskBlockView key={b.id} block={b} isAdmin={isAdmin} onAsk={ask} />)}
                          {m.blocks.length > 0 && (
                            <details className="ask-sources">
                              <summary>How I got this · {m.blocks.length} lookup{m.blocks.length === 1 ? '' : 's'}</summary>
                              <ol>{m.blocks.map(b => <li key={b.id}>{TOOL_LABELS[b.tool] ?? b.tool}: {b.basis || b.title}</li>)}</ol>
                            </details>
                          )}
                          {m.follow_ups.length > 0 && idx === messages.length - 1 && !pending && (
                            <div className="ask-follow">{m.follow_ups.map(q => <button key={q} type="button" className="ask-suggest" onClick={() => ask(q)}>{q}</button>)}</div>
                          )}
                          <div className="ask-msg-foot">
                            <Thumbs m={m} onChange={v => feedback(m, v)} />
                            <PinButton m={m} defaultTitle={messages[idx - 1]?.text ?? 'Pinned answer'} onPinned={() => qc.invalidateQueries({ queryKey: ['ask', 'pins'] })} />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {pending && (
                  <>
                    {showPendingQuestion && <div className="ask-msg-user">{pending.question}</div>}
                    <div className="ask-msg-ai">
                      <div className="ai-mark"><Sparkle /></div>
                      <div className="ai-body">
                        <div className="ask-thinking">
                          {pending.steps.length === 0 && <div><span className="dot" />Thinking…</div>}
                          {pending.steps.map((s, i) => (
                            <div key={i}>{i < pending.steps.length - 1 ? <span className="ok">✓</span> : <span className="dot" />}{s}…</div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
            {error && <div className="ask-error" role="alert">{error}</div>}
          </div>

          {!pinId && (
            <div className="ask-composer">
              {messages.length > 0 && !pending && (
                <div className="ask-starter-row">
                  {STARTERS.filter(s => !messages.some(m => m.text === s)).slice(0, 4).map(s => (
                    <button key={s} type="button" className="ask-suggest" onClick={() => ask(s)}>{s}</button>
                  ))}
                </div>
              )}
              <form className="ask-input" onSubmit={e => { e.preventDefault(); ask(draft) }}>
                <label htmlFor="ask-q" className="sr-only">Ask about your tickets</label>
                <textarea
                  id="ask-q" ref={inputRef} rows={1} value={draft} maxLength={1000}
                  placeholder="Ask about your tickets…"
                  onChange={e => {
                    setDraft(e.target.value)
                    e.target.style.height = 'auto'
                    e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'
                  }}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(draft) } }}
                  disabled={!!pending}
                />
                <button className="ask-send" type="submit" aria-label="Send" disabled={!!pending || !draft.trim()}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </button>
              </form>
              <div className="ask-disclaim">Answers come from ticket data; the AI only picks what to look up and writes the summary. Changes happen only after you confirm them.</div>
            </div>
          )}
        </section>

        <aside className="ask-rail">
          {digest && (
            <section className="panel">
              <div className="panel-head"><h2>Worth a look</h2><span className="sub">from the data, no AI</span></div>
              <ul className="ask-digest">
                {digest.rising.length > 0 && (
                  <li><button type="button" onClick={() => ask('What is new or rising this week?')}>
                    <b>Rising</b><span>{digest.rising.join(' · ')}</span></button></li>
                )}
                {!!digest.misfiled && (
                  <li><button type="button" onClick={() => ask('Which tickets are in the wrong category?')}>
                    <b>{digest.misfiled} tickets</b><span>may be in the wrong category (30 days)</span></button></li>
                )}
                {!!digest.suggestions && (
                  <li><button type="button" onClick={() => ask('Should we add new ticket categories?')}>
                    <b>{digest.suggestions} suggestions</b><span>for the category list (90 days)</span></button></li>
                )}
                {!!digest.stuck && (
                  <li><button type="button" onClick={() => ask('Which open tickets are stuck?')}>
                    <b>{digest.stuck} stuck</b><span>no update for 5+ days, of {digest.open} open</span></button></li>
                )}
              </ul>
            </section>
          )}

          <section className="panel">
            <div className="panel-head"><h2>Conversations</h2></div>
            <div className="ask-list">
              {(threads ?? []).length === 0 && <p className="muted text-[12.5px] px-1">Your questions are kept here. Only you can see them.</p>}
              {(threads ?? []).slice(0, 12).map(t => (
                <div key={t.id} className={`ask-list-row${t.id === threadId && !pinId ? ' on' : ''}`}>
                  <button type="button" onClick={() => openThread(t.id)}>
                    <span className="t">{t.title || 'Untitled'}</span>
                    <small>{timeAgo(t.updated_at)}</small>
                  </button>
                  <button type="button" className="x" aria-label="Delete conversation" onClick={() => removeThread(t.id)}>×</button>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Pinned answers</h2></div>
            <div className="ask-list">
              {(pins ?? []).length === 0 && <p className="muted text-[12.5px] px-1">Pin an answer to check it again later. It refreshes from the data, with no AI cost.</p>}
              {(pins ?? []).map(p => (
                <div key={p.id} className={`ask-list-row${p.id === pinId ? ' on' : ''}`}>
                  <button type="button" onClick={() => setParams({ pin: String(p.id) })}>
                    <span className="t">{p.title}</span><small>last {p.days} days</small>
                  </button>
                  <button type="button" className="x" aria-label="Unpin" onClick={() => removePin(p.id)}>×</button>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </AppShell>
  )
}
