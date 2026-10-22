import { useState, useEffect } from 'react'
import { parseUTC } from '../types/ticket'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AppShell from '../components/layout/AppShell'
import api, { apiErrorMessage } from '../lib/api'
import { useWorkspaceOptions, type WorkspaceOption } from '../hooks/useWorkspaces'
import { useSlackUsers } from '../hooks/useSlackUsers'
import type { SlackIdentity } from '../hooks/useAgents'
import { useAuth } from '../contexts/AuthContext'

interface AccountRead {
  id: number
  name: string
  email: string
  role: 'admin' | 'technician'
  auth_provider: 'local' | 'google'
  slack_identities: SlackIdentity[]
  pending_slack_links: { workspace_id: number; slack_user_id: string; expires_at: string }[]
}

type PendingLink = AccountRead['pending_slack_links'][number]

const ACCOUNT_KEY = ['account']

// ── Shared building blocks ────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return <section className="panel" style={{ overflow: 'hidden', marginBottom: 18 }}>{children}</section>
}

function CardHeader({ title, sub }: { title: string; sub?: React.ReactNode }) {
  return (
    <div className="panel-head" style={{ paddingBottom: 12, borderBottom: '1px solid var(--track)', display: 'block' }}>
      <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 650 }}>{title}</h2>
      {sub && <p className="m-0 mt-1 text-[12.5px] text-ink-3 leading-relaxed">{sub}</p>}
    </div>
  )
}

function Spin() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin"><path d="M7 1a6 6 0 1 1-4.24 1.76" /></svg>
}

// ── Profile ───────────────────────────────────────────────────────────────────

function ProfileCard({ account }: { account: AccountRead }) {
  const { logout } = useAuth()
  const rows: [string, string][] = [
    ['Email', account.email],
    ['Role', account.role === 'admin' ? 'Admin' : 'Technician'],
    ['Sign-in method', account.auth_provider === 'google' ? 'Google' : 'Email & password'],
  ]
  return (
    <Card>
      <div className="flex items-center gap-3.5" style={{ padding: '18px 22px' }}>
        <div className="avatar" style={{ width: 44, height: 44, borderRadius: 14, fontSize: 17 }}>
          {account.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold text-ink truncate">{account.name}</div>
          <div className="text-[12.5px] text-ink-3 truncate">{account.email}</div>
        </div>
        <button type="button" className="btn ghost sm" onClick={logout} style={{ flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
            <path d="M11 11l3-3-3-3M14 8H6" />
          </svg>
          Sign out
        </button>
      </div>
      <dl className="m-0 border-t border-track" style={{ padding: '6px 22px 14px' }}>
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-2 text-[13px]">
            <dt className="text-ink-3">{k}</dt>
            <dd className="m-0 text-ink font-medium text-right">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}

// ── Slack IDs (one per workspace) ─────────────────────────────────────────────

function SlackIdentityRow({ workspace, current, pending }: {
  workspace: WorkspaceOption
  current: string | null
  pending: PendingLink | null
}) {
  const qc = useQueryClient()
  const [value, setValue] = useState(current ?? '')
  const [notice, setNotice] = useState<string | null>(null)
  const { data: members } = useSlackUsers(workspace.id)

  useEffect(() => { setValue(current ?? '') }, [current])
  // The link lands when the person clicks 👍 in Slack — announce it here.
  useEffect(() => {
    if (current && !pending) setNotice(n => (n === 'sent' ? 'linked' : n))
  }, [current, pending])

  const onDone = (data: AccountRead) => {
    qc.setQueryData(ACCOUNT_KEY, data)
    qc.invalidateQueries({ queryKey: ['admin-users'] })
  }
  const mutation = useMutation({
    mutationFn: async (slackUserId: string | null) =>
      (await api.put<AccountRead>(`/account/slack-identity/${workspace.id}`, { slack_user_id: slackUserId })).data,
    onSuccess: (data, slackUserId) => { onDone(data); setNotice(slackUserId ? 'sent' : 'unlinked') },
  })
  const cancel = useMutation({
    mutationFn: async () => (await api.delete<AccountRead>(`/account/slack-link-request/${workspace.id}`)).data,
    onSuccess: (data) => { onDone(data); setNotice(null); setValue(current ?? '') },
  })

  const trimmed = value.trim()
  const dirty = trimmed !== (current ?? '')
  const busy = mutation.isPending || cancel.isPending
  const listId = `slack-members-${workspace.id}`
  const nameOf = (id: string) => members?.find(m => m.id === id)?.name
  const linkedName = current ? nameOf(current) : undefined

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (dirty) mutation.mutate(trimmed || null)
  }

  return (
    <form onSubmit={save} className="py-3.5 border-b border-track last:border-b-0">
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <label htmlFor={`slack-id-${workspace.id}`} className="text-[13px] font-semibold text-ink">{workspace.name}</label>
        {current
          ? <span className="text-[11.5px] text-ok-ink font-semibold">Linked{linkedName ? ` as ${linkedName}` : ''}</span>
          : pending
            ? <span className="text-[11.5px] text-warn-ink font-semibold">Waiting for confirmation</span>
            : <span className="text-[11.5px] text-ink-3">Not linked</span>}
      </div>
      <div className="flex gap-2 flex-wrap">
        <input
          id={`slack-id-${workspace.id}`}
          className="input font-mono"
          style={{ flex: '1 1 180px', minWidth: 0 }}
          value={value}
          onChange={e => { setValue(e.target.value); mutation.reset(); setNotice(null) }}
          placeholder={members?.length ? 'Pick your name or paste your member ID' : 'U0123ABCDEF'}
          list={members?.length ? listId : undefined}
          autoComplete="off"
          spellCheck={false}
        />
        {members && members.length > 0 && (
          <datalist id={listId}>
            {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </datalist>
        )}
        <button
          type="submit"
          className="btn sm"
          disabled={!dirty || busy}
          style={!dirty ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
        >
          {mutation.isPending && <Spin />}
          {current && !trimmed ? 'Unlink' : pending?.slack_user_id === trimmed ? 'Resend' : 'Send confirmation'}
        </button>
        {current && trimmed && !dirty && (
          <button
            type="button"
            className="btn ghost sm"
            disabled={busy}
            onClick={() => { setValue(''); mutation.mutate(null) }}
          >
            Unlink
          </button>
        )}
      </div>

      {pending && (
        <div
          className="flex items-start justify-between gap-3 mt-2.5 rounded-control px-3 py-2.5 text-[12.5px] text-warn-ink"
          style={{ background: 'var(--warn-bg)' }}
        >
          <span className="leading-relaxed">
            We sent a Slack DM to <b className="font-mono">{pending.slack_user_id}</b>
            {nameOf(pending.slack_user_id) ? ` (${nameOf(pending.slack_user_id)})` : ''}.
            {' '}Click <b>👍 Yes, that's me</b> there to finish linking.
            {' '}Expires {parseUTC(pending.expires_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.
          </span>
          <button
            type="button"
            className="bg-transparent border-0 cursor-pointer text-warn-ink underline whitespace-nowrap p-0 text-[12.5px] font-semibold"
            disabled={busy}
            onClick={() => cancel.mutate()}
          >
            Cancel request
          </button>
        </div>
      )}

      {mutation.isError && (
        <p className="m-0 mt-1.5 text-[12px] text-danger-ink">{apiErrorMessage(mutation.error, 'Failed to update Slack ID.')}</p>
      )}
      {cancel.isError && (
        <p className="m-0 mt-1.5 text-[12px] text-danger-ink">{apiErrorMessage(cancel.error, 'Failed to cancel the request.')}</p>
      )}
      {notice === 'linked' && <p className="m-0 mt-1.5 text-[12px] font-semibold text-ok-ink">✓ Confirmed in Slack — you're linked.</p>}
      {notice === 'unlinked' && <p className="m-0 mt-1.5 text-[12px] font-semibold text-ok-ink">✓ Unlinked</p>}
    </form>
  )
}

function SlackIdentitiesCard({ account }: { account: AccountRead }) {
  const { data: workspaces, isLoading } = useWorkspaceOptions({ refetchOnMount: true })
  const byWorkspace = new Map(account.slack_identities.map(i => [i.workspace_id, i.slack_user_id]))
  const pendingByWorkspace = new Map(account.pending_slack_links.map(p => [p.workspace_id, p]))

  return (
    <Card>
      <CardHeader
        title="Slack IDs"
        sub={<>
          Link your Slack account so ticket notifications, mentions and password-reset codes reach you in Slack.
          Slack IDs differ per workspace, so there's one row per connected workspace
          {workspaces?.length ? ` (${workspaces.length} connected)` : ''} — link each one you use.
          To find your ID: in Slack, open your profile → <b>⋮</b> → <b>Copy member ID</b>.
          The bot then DMs that account, and the link is made once you confirm there.
        </>}
      />
      <div style={{ padding: '4px 22px 8px' }}>
        {isLoading ? (
          <p className="text-[13px] text-ink-3 py-3 m-0">Loading workspaces…</p>
        ) : !workspaces || workspaces.length === 0 ? (
          <p className="text-[13px] text-ink-3 py-3 m-0">No Slack workspace is connected yet.</p>
        ) : (
          workspaces.map(w => (
            <SlackIdentityRow
              key={w.id}
              workspace={w}
              current={byWorkspace.get(w.id) ?? null}
              pending={pendingByWorkspace.get(w.id) ?? null}
            />
          ))
        )}
      </div>
    </Card>
  )
}

// ── Change password ───────────────────────────────────────────────────────────

function PasswordCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNext, setShowNext] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const mismatch = next.length > 0 && confirm.length > 0 && next !== confirm
  const canSubmit = current.length > 0 && next.length >= 8 && next === confirm && status !== 'saving'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setStatus('saving')
    setErrorMsg('')
    try {
      const res = await api.post('/auth/change-password', { current_password: current, new_password: next })
      // The change revokes every token issued before it (other devices, stolen
      // sessions) — swap in the fresh one so this session isn't logged out too.
      if (res.data?.access_token) localStorage.setItem('st_token', res.data.access_token)
      setStatus('ok')
      setCurrent(''); setNext(''); setConfirm('')
      setTimeout(() => setStatus('idle'), 3000)
    } catch (err: unknown) {
      setErrorMsg(apiErrorMessage(err, 'Something went wrong'))
      setStatus('error')
    }
  }

  const eyeIcon = (visible: boolean) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {visible
        ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></>
        : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>
      }
    </svg>
  )

  return (
    <Card>
      <CardHeader title="Change password" sub="Changing your password signs you out on every other device." />
      <form onSubmit={handleSubmit}>
        <div style={{ padding: '18px 22px' }}>
          <div className="fieldrow">
            <label htmlFor="pw-current">Current password</label>
            <div className="relative">
              <input
                id="pw-current"
                className="input"
                type={showCurrent ? 'text' : 'password'}
                value={current}
                onChange={e => setCurrent(e.target.value)}
                autoComplete="current-password"
                style={{ paddingRight: 40 }}
              />
              <button
                type="button"
                onClick={() => setShowCurrent(v => !v)}
                aria-label={showCurrent ? 'Hide password' : 'Show password'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 bg-transparent border-0 cursor-pointer text-ink-3 hover:text-ink flex p-0.5"
              >
                {eyeIcon(showCurrent)}
              </button>
            </div>
          </div>

          <div className="fieldrow">
            <label htmlFor="pw-next">New password <span className="font-normal text-ink-3">(min 8 characters)</span></label>
            <div className="relative">
              <input
                id="pw-next"
                className="input"
                type={showNext ? 'text' : 'password'}
                value={next}
                onChange={e => setNext(e.target.value)}
                autoComplete="new-password"
                style={{ paddingRight: 40 }}
              />
              <button
                type="button"
                onClick={() => setShowNext(v => !v)}
                aria-label={showNext ? 'Hide password' : 'Show password'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 bg-transparent border-0 cursor-pointer text-ink-3 hover:text-ink flex p-0.5"
              >
                {eyeIcon(showNext)}
              </button>
            </div>
          </div>

          <div className="fieldrow">
            <label htmlFor="pw-confirm">Confirm new password</label>
            <input
              id="pw-confirm"
              className="input"
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              autoComplete="new-password"
              style={mismatch ? { borderColor: 'var(--danger-ink)' } : undefined}
            />
            {mismatch && <span className="text-[12px] text-danger-ink">Passwords don't match</span>}
          </div>

          {status === 'error' && (
            <div className="rounded-control px-3 py-2 mb-3.5 text-[13px] text-danger-ink" style={{ background: 'var(--danger-bg)' }}>
              {errorMsg}
            </div>
          )}
          {status === 'ok' && (
            <div className="rounded-control px-3 py-2 mb-3.5 text-[13px]" style={{ background: 'var(--brand-tint)', color: 'var(--brand-ink)' }}>
              Password updated successfully.
            </div>
          )}

          <button
            type="submit"
            className="btn"
            disabled={!canSubmit}
            style={!canSubmit ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            {status === 'saving' && <Spin />}
            Update password
          </button>
        </div>
      </form>
    </Card>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Account() {
  const { data: account, isLoading, isError } = useQuery<AccountRead>({
    queryKey: ACCOUNT_KEY,
    queryFn: async () => (await api.get<AccountRead>('/account')).data,
    // While a link waits for 👍 in Slack, poll so the page flips to "Linked"
    // on its own once the person confirms.
    refetchInterval: (q) => (q.state.data?.pending_slack_links.length ? 4000 : false),
  })

  return (
    <AppShell title="My account">
      <div style={{ maxWidth: 560 }}>
        {isLoading && <p className="text-[13px] text-ink-3">Loading…</p>}
        {isError && <p className="text-[13px] text-danger-ink">Couldn't load your account.</p>}
        {account && (
          <>
            <ProfileCard account={account} />
            <SlackIdentitiesCard account={account} />
            {account.auth_provider === 'local' ? (
              <PasswordCard />
            ) : (
              <Card>
                <CardHeader
                  title="Password"
                  sub="You sign in with Google, so there's no SimpleTickets password to change — manage it in your Google account."
                />
              </Card>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
