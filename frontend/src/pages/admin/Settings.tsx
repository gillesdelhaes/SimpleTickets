import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AppShell from '../../components/layout/AppShell'
import { useAuth } from '../../contexts/AuthContext'
import api, { apiErrorMessage } from '../../lib/api'
import { parseUTC } from '../../types/ticket'

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'general' | 'slack' | 'categories' | 'sla' | 'statuses' | 'backup' | 'account'

const ADMIN_TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'slack', label: 'Slack' },
  { id: 'categories', label: 'Categories' },
  { id: 'sla', label: 'SLA policies' },
  { id: 'statuses', label: 'Statuses' },
  { id: 'backup', label: 'Backup & restore' },
  { id: 'account', label: 'My account' },
]

const USER_TABS: { id: Tab; label: string }[] = [
  { id: 'account', label: 'My account' },
]

type Priority = 'low' | 'medium' | 'high' | 'critical'

interface SettingRead { key: string; value: string | null; is_secret: boolean; group_name: string }
interface CategoryRead { id: number; name: string; is_archived: boolean; created_at: string }
interface SLAPolicyRead { id: number; name: string; priority: Priority; first_response_minutes: number; resolution_minutes: number }
interface StatusRow { id: number; name: string; label: string; color: string; pauses_sla: boolean; is_default: boolean; is_resolved_state: boolean; sort_order: number; is_archived: boolean }
interface StatusForm { name: string; label: string; color: string; pauses_sla: boolean; is_default: boolean; is_resolved_state: boolean; sort_order: number }

// ── Shared building blocks ────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <section className="panel" style={{ overflow: 'hidden', ...style }}>{children}</section>
}

function CardHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="panel-head" style={{ paddingBottom: 12, borderBottom: '1px solid var(--track)' }}>
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 650 }}>{children}</h2>
}

function SaveBar({ dirty, pending, onSave }: { dirty: boolean; pending: boolean; onSave: () => void }) {
  if (!dirty) return null
  return (
    <div className="px-5 py-3 border-t border-track flex justify-end">
      <button className="btn" onClick={onSave} disabled={pending} style={pending ? { opacity: 0.7, cursor: 'wait' } : undefined}>
        {pending ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  )
}

function Saved() {
  return <span className="text-[12px] font-semibold text-ok-ink">✓ Saved</span>
}

// ── Settings API helpers ───────────────────────────────────────────────────────

function useSettingsQuery() {
  return useQuery<{ settings: SettingRead[] }>({
    queryKey: ['admin-settings'],
    queryFn: async () => (await api.get('/admin/settings')).data,
  })
}

function useSaveMutation(onDone?: () => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (updates: { key: string; value: string }[]) => {
      await api.patch('/admin/settings', { settings: updates })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-settings'] }); onDone?.() },
  })
}

// ── General tab ───────────────────────────────────────────────────────────────

const TIMEZONES = [
  'UTC',
  'Europe/London','Europe/Paris','Europe/Brussels','Europe/Amsterdam','Europe/Berlin',
  'Europe/Rome','Europe/Madrid','Europe/Zurich','Europe/Stockholm','Europe/Helsinki',
  'Europe/Warsaw','Europe/Bucharest','Europe/Moscow',
  'America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
  'America/Toronto','America/Vancouver','America/Mexico_City','America/Sao_Paulo',
  'Asia/Dubai','Asia/Kolkata','Asia/Singapore','Asia/Tokyo','Asia/Shanghai','Asia/Seoul',
  'Australia/Sydney','Pacific/Auckland',
]

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function SettingSwitch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(!on) } }}
      style={{ width: 44, height: 24, borderRadius: 12, cursor: 'pointer', background: on ? 'var(--brand-grad)' : 'var(--track)', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}
    >
      <div style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
    </div>
  )
}

function SettingRow({ label, hint, children, last }: { label: string; hint: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div
      className={last ? '' : 'border-b border-track'}
      style={{ padding: '18px 22px', display: 'grid', gridTemplateColumns: '220px 1fr', gap: 24, alignItems: 'center' }}
    >
      <div>
        <div className="text-[13.5px] font-semibold text-ink">{label}</div>
        <div className="text-[12px] text-ink-3 mt-0.5">{hint}</div>
      </div>
      {children}
    </div>
  )
}

function GeneralTab() {
  const { data, isLoading } = useSettingsQuery()
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const mutation = useSaveMutation(() => { setEdits({}); setSaved(true); setTimeout(() => setSaved(false), 2000) })

  if (isLoading) return <div className="text-[13px] text-ink-3">Loading…</div>

  const sm = Object.fromEntries((data?.settings ?? []).map(s => [s.key, s.value ?? '']))
  function get(key: string, def: string) { return key in edits ? edits[key] : (sm[key] || def) }
  function set(key: string, val: string) { setEdits(e => ({ ...e, [key]: val })) }

  const tz = get('timezone', 'UTC')
  const bizEnabled = get('business_hours_enabled', 'false') === 'true'
  const bizStart = get('business_hours_start', '09:00')
  const bizEnd = get('business_hours_end', '17:00')
  const bizDaysStr = get('business_days', '0,1,2,3,4')
  const bizDays = new Set(bizDaysStr.split(',').map(d => d.trim()).filter(Boolean).map(Number))
  const csatDays = get('csat_auto_close_days', '7')

  function toggleDay(d: number) {
    const next = new Set(bizDays)
    if (next.has(d)) next.delete(d); else next.add(d)
    set('business_days', [...next].sort((a, b) => a - b).join(',') || '')
  }

  const dirty = Object.keys(edits).length > 0

  return (
    <Card>
      <CardHeader>
        <SectionLabel>General</SectionLabel>
        {saved && <span className="ml-auto"><Saved /></span>}
      </CardHeader>

      <SettingRow label="Timezone" hint="All timestamps are displayed in this timezone">
        <div className="selectwrap" style={{ maxWidth: 320 }}>
          <select className="select" value={tz} onChange={e => set('timezone', e.target.value)}>
            {TIMEZONES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </SettingRow>

      <SettingRow label="Business hours" hint="SLA deadlines only count time within working hours" last={!bizEnabled}>
        <SettingSwitch on={bizEnabled} onChange={v => set('business_hours_enabled', v ? 'true' : 'false')} />
      </SettingRow>

      {bizEnabled && (
        <>
          <SettingRow label="Working hours" hint="SLA clock runs between these times">
            <div className="flex items-center gap-2.5">
              <input type="time" className="input" style={{ width: 120 }} value={bizStart} onChange={e => set('business_hours_start', e.target.value)} />
              <span className="text-[13px] text-ink-3">to</span>
              <input type="time" className="input" style={{ width: 120 }} value={bizEnd} onChange={e => set('business_hours_end', e.target.value)} />
            </div>
          </SettingRow>

          <SettingRow label="Working days" hint="Days when the SLA clock is active" last>
            <div className="flex gap-1.5">
              {DAY_LABELS.map((label, i) => (
                <button
                  key={i}
                  onClick={() => toggleDay(i)}
                  className="chip"
                  style={bizDays.has(i)
                    ? { background: 'var(--brand-grad)', color: '#fff', borderColor: 'transparent' }
                    : undefined}
                >
                  {label}
                </button>
              ))}
            </div>
          </SettingRow>
        </>
      )}

      <SettingRow label="CSAT auto-close" hint="Resolved tickets with no survey response close after this many days" last>
        <div className="flex items-center gap-2">
          <input
            type="number"
            className="input"
            min={1}
            max={90}
            value={csatDays}
            onChange={e => set('csat_auto_close_days', e.target.value)}
            style={{ width: 90 }}
          />
          <span className="text-[13px] text-ink-2">days</span>
        </div>
      </SettingRow>

      <SaveBar dirty={dirty} pending={mutation.isPending} onSave={() => mutation.mutate(Object.entries(edits).map(([key, value]) => ({ key, value })))} />
    </Card>
  )
}

// ── Slack tab ─────────────────────────────────────────────────────────────────

const SLACK_KEYS = ['slack_bot_token', 'slack_app_token', 'slack_signing_secret', 'slack_trigger_emoji', 'slack_two_way_sync'] as const
const SLACK_META: Record<string, { label: string; hint: string; placeholder?: string }> = {
  slack_bot_token:      { label: 'Bot token',       hint: 'Starts with xoxb-',                         placeholder: 'xoxb-…'   },
  slack_app_token:      { label: 'App-level token', hint: 'Socket Mode — starts with xapp-',           placeholder: 'xapp-…'   },
  slack_signing_secret: { label: 'Signing secret',  hint: 'From Basic Information → App Credentials',  placeholder: '••••••••' },
  slack_trigger_emoji:  { label: 'Trigger emoji',   hint: 'Reaction name that creates a ticket',       placeholder: 'clipboard'},
  slack_two_way_sync:   { label: 'Two-way sync',    hint: 'Sync web replies to Slack threads and vice versa' },
}

function SlackTab() {
  const { data, isLoading } = useSettingsQuery()
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [revealing, setRevealing] = useState<Record<string, boolean>>({})
  const [testResult, setTestResult] = useState<{ ok: boolean; team_name?: string; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [slackStatus, setSlackStatus] = useState<{ ok: boolean; team_name?: string; error?: string } | null>(null)

  const settingMap = Object.fromEntries((data?.settings ?? []).map(s => [s.key, s]))
  const mutation = useSaveMutation(() => { setEdits({}); setRevealing({}); setSaved(true); setTimeout(() => setSaved(false), 2500) })

  function getValue(key: string) { return key in edits ? edits[key] : (settingMap[key]?.value ?? '') }
  function edit(key: string, value: string) { setEdits(e => ({ ...e, [key]: value })) }
  const dirty = SLACK_KEYS.some(k => k in edits)

  useEffect(() => {
    api.get('/admin/settings/slack-status').then(r => setSlackStatus(r.data)).catch(() => {})
  }, [])

  async function handleTest() {
    const bot = getValue('slack_bot_token'); const app = getValue('slack_app_token')
    setTesting(true); setTestResult(null)
    try {
      const result = (await api.post('/admin/settings/test-slack', { bot_token: bot, app_token: app })).data
      setTestResult(result)
      setSlackStatus(result)
    }
    catch { setTestResult({ ok: false, error: 'Request failed' }) }
    finally { setTesting(false) }
  }

  if (isLoading) return <div className="text-[13px] text-ink-3">Loading…</div>
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <SectionLabel>Slack integration</SectionLabel>
            {slackStatus && (
              <span className={`pill ${slackStatus.ok ? 'use' : 'danger'}`}>
                {slackStatus.ok ? slackStatus.team_name : 'Disconnected'}
              </span>
            )}
          </div>
          <div className="flex gap-2 items-center ml-auto">
            {saved && <Saved />}
            {testResult && (
              <span className={`text-[12px] ${testResult.ok ? 'text-ok-ink' : 'text-danger-ink'}`}>
                {testResult.ok ? `✓ Connected to ${testResult.team_name}` : `✗ ${testResult.error}`}
              </span>
            )}
            <button className="btn ghost sm" onClick={handleTest} disabled={testing}>
              {testing ? 'Testing…' : 'Test connection'}
            </button>
          </div>
        </CardHeader>

        {SLACK_KEYS.map((key, i) => {
          const meta = SLACK_META[key]
          const row = settingMap[key]
          const isToggle = key === 'slack_two_way_sync'
          const isRevealing = revealing[key] ?? false
          const val = getValue(key)

          return (
            <div
              key={key}
              className={i < SLACK_KEYS.length - 1 ? 'border-b border-track' : ''}
              style={{ padding: '14px 22px', display: 'grid', gridTemplateColumns: '220px 1fr auto', gap: 16, alignItems: 'center' }}
            >
              <div>
                <div className="text-[13.5px] font-semibold text-ink">{meta.label}</div>
                <div className="text-[12px] text-ink-3 mt-0.5">{meta.hint}</div>
              </div>
              <div>
                {isToggle ? (
                  <SettingSwitch on={val !== 'false'} onChange={v => edit(key, v ? 'true' : 'false')} />
                ) : row?.is_secret && !isRevealing ? (
                  <span className="font-mono text-[13px] text-ink-3">{val || '—'}</span>
                ) : (
                  <input
                    className={`input${row?.is_secret ? ' font-mono' : ''}`}
                    value={val}
                    type={row?.is_secret ? 'password' : 'text'}
                    onChange={e => edit(key, e.target.value)}
                    placeholder={meta.placeholder ?? ''}
                    onFocus={() => { if (row?.is_secret && !isRevealing) { setRevealing(r => ({ ...r, [key]: true })); edit(key, '') } }}
                  />
                )}
              </div>
              <div style={{ width: 60, textAlign: 'right' }}>
                {row?.is_secret && !isRevealing && (
                  <button
                    onClick={() => { setRevealing(r => ({ ...r, [key]: true })); edit(key, '') }}
                    className="bg-transparent border-0 cursor-pointer text-[12px] font-semibold text-brand-ink px-2 py-1"
                  >
                    Edit
                  </button>
                )}
              </div>
            </div>
          )
        })}
        <SaveBar dirty={dirty} pending={mutation.isPending} onSave={() => mutation.mutate(SLACK_KEYS.filter(k => k in edits).map(k => ({ key: k, value: edits[k] })))} />
      </Card>

      {/* Setup guide */}
      <div>
        <button
          onClick={() => setShowGuide(v => !v)}
          className="flex items-center gap-2 bg-transparent border-0 cursor-pointer text-[13px] font-medium text-ink-2 hover:text-ink py-1 px-0"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transition: 'transform 0.2s', transform: showGuide ? 'rotate(90deg)' : 'none' }}>
            <path d="M4 2l4 4-4 4" />
          </svg>
          {showGuide ? 'Hide' : 'Show'} Slack app setup guide
        </button>
        {showGuide && <SlackGuide />}
      </div>
    </div>
  )
}

// ── Slack setup guide ─────────────────────────────────────────────────────────

const SLACK_MANIFEST = JSON.stringify({
  _metadata: { major_version: 1, minor_version: 1 },
  display_information: {
    name: "SimpleTickets",
    description: "Self-hosted IT helpdesk — submit and track support tickets without leaving Slack.",
    background_color: "#111111",
  },
  features: {
    bot_user: { display_name: "SimpleTickets", always_online: true },
    slash_commands: [{ command: "/ticket", description: "Submit a support ticket", should_escape: false }],
    app_home: { home_tab_enabled: true, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
    shortcuts: [{ name: "Create ticket", type: "message", callback_id: "create_ticket_from_message", description: "Turn any Slack message into a support ticket" }],
  },
  oauth_config: {
    scopes: {
      bot: ["chat:write", "chat:write.public", "im:write", "im:history", "channels:history", "groups:history", "reactions:read", "files:read", "files:write", "users:read", "commands"],
    },
  },
  settings: {
    event_subscriptions: { bot_events: ["app_home_opened", "message.channels", "message.groups", "message.im", "reaction_added"] },
    interactivity: { is_enabled: true },
    org_deploy_enabled: false,
    socket_mode_enabled: true,
    token_rotation_enabled: false,
  },
}, null, 2)

function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) }) }}
      className="font-mono text-[11px] inline-flex items-center gap-1 px-2 py-0.5 rounded-md cursor-pointer flex-shrink-0"
      style={{
        background: copied ? 'var(--brand-tint)' : 'rgba(255,255,255,0.06)',
        border: `1px solid ${copied ? 'transparent' : 'rgba(255,255,255,0.1)'}`,
        color: copied ? 'var(--brand-ink)' : 'rgba(255,255,255,0.7)',
        transition: 'all 0.15s',
      }}
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  )
}

function StepDot({ n }: { n: number }) {
  return (
    <div
      className="flex items-center justify-center flex-shrink-0 text-[12px] font-bold text-white mt-0.5"
      style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--brand-grad)' }}
    >
      {n}
    </div>
  )
}

function Code({ children, brand }: { children: React.ReactNode; brand?: boolean }) {
  return (
    <code
      className={`font-mono text-[12px] px-1 py-px rounded ${brand ? 'text-brand-ink' : 'text-ink'}`}
      style={{ background: 'var(--field)' }}
    >
      {children}
    </code>
  )
}

function SlackGuide() {
  return (
    <div className="mt-3" style={{ maxWidth: 720 }}>
      <p className="text-[13px] text-ink-2 mb-5 leading-relaxed">
        SimpleTickets uses a <strong className="text-ink">private Slack app</strong> installed in your workspace.
        Instead of configuring it manually, use the manifest below — Slack will set everything up automatically.
      </p>

      {/* Step 1 */}
      <div className="flex gap-3.5 mb-4">
        <StepDot n={1} />
        <div className="flex-1">
          <p className="text-[14px] font-semibold text-ink m-0 mb-2">Copy the manifest and open the Slack App Console</p>
          {/* Code block stays deliberately dark in both themes */}
          <div style={{ background: '#0A0C10', border: '1px solid var(--edge)', borderRadius: 14, overflow: 'hidden' }}>
            <div className="flex items-center justify-between px-3.5 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.04)' }}>
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'rgba(255,255,255,0.4)' }}>slack-manifest.json</span>
              <CopyBtn value={SLACK_MANIFEST} />
            </div>
            <pre className="m-0 px-4 py-3.5 font-mono text-[11px] overflow-x-auto scrollbar-thin" style={{ color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, maxHeight: 220, overflowY: 'auto' }}>{SLACK_MANIFEST}</pre>
          </div>
          <div className="mt-2.5">
            <a href="https://api.slack.com/apps?new_app=1" target="_blank" rel="noreferrer" className="btn ghost sm" style={{ textDecoration: 'none', color: 'var(--brand-ink)' }}>
              Open Slack App Console →
            </a>
          </div>
        </div>
      </div>

      {/* Step 2 */}
      <div className="flex gap-3.5 mb-4">
        <StepDot n={2} />
        <div className="flex-1">
          <p className="text-[14px] font-semibold text-ink m-0 mb-2">Create the app and generate your app-level token</p>
          <p className="text-[13px] text-ink-2 m-0 mb-2 leading-relaxed">
            In the Slack App Console: <strong className="text-ink">Create New App</strong> → <strong className="text-ink">From a manifest</strong> → select your workspace → paste the manifest → <strong className="text-ink">Next</strong> → <strong className="text-ink">Create</strong>. Then in the left sidebar go to <strong className="text-ink">Settings → Install App</strong> → <strong className="text-ink">Install to Workspace</strong> → <strong className="text-ink">Allow</strong>.
          </p>
          <p className="text-[13px] text-ink-2 m-0 leading-relaxed">
            Then go to <strong className="text-ink">Basic Information</strong> → <strong className="text-ink">App-Level Tokens</strong> → <strong className="text-ink">Generate Token and Scopes</strong> → name it anything → add scope <Code>connections:write</Code> → <strong className="text-ink">Generate</strong>. Copy the <Code brand>xapp-…</Code> token.
          </p>
        </div>
      </div>

      {/* Step 3 */}
      <div className="flex gap-3.5">
        <StepDot n={3} />
        <div className="flex-1">
          <p className="text-[14px] font-semibold text-ink m-0 mb-1.5">Copy your three tokens into the fields above</p>
          <div className="grid gap-1.5 text-[13px] text-ink-2 leading-relaxed">
            <span><Code>Bot token</Code> — OAuth &amp; Permissions → Bot User OAuth Token (starts with <Code brand>xoxb-</Code>)</span>
            <span><Code>App-level token</Code> — Basic Information → App-Level Tokens → Generate Token → add <Code brand>connections:write</Code> scope (starts with <Code brand>xapp-</Code>)</span>
            <span><Code>Signing secret</Code> — Basic Information → App Credentials → Signing Secret</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Categories tab ────────────────────────────────────────────────────────────

function timeAgo(d: string) {
  const days = Math.floor((Date.now() - parseUTC(d).getTime()) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  return parseUTC(d).toLocaleDateString()
}

function CategoriesTab() {
  const qc = useQueryClient()
  const [showArchived, setShowArchived] = useState(false)
  const [newName, setNewName] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')

  const { data: categories = [], isLoading } = useQuery<CategoryRead[]>({
    queryKey: ['categories-admin', showArchived],
    queryFn: () => api.get<CategoryRead[]>(`/categories?include_archived=${showArchived}`).then(r => r.data),
    staleTime: 30_000,
  })

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['categories-admin'] }); qc.invalidateQueries({ queryKey: ['categories'] }) }

  const createMutation = useMutation({
    mutationFn: (name: string) => api.post<CategoryRead>('/categories', { name }).then(r => r.data),
    onSuccess: () => { invalidate(); setNewName(''); setAddError(null) },
    onError: (err: any) => setAddError(apiErrorMessage(err, 'Failed to create category.')),
  })

  const patchMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: number; name?: string; is_archived?: boolean }) =>
      api.patch<CategoryRead>(`/categories/${id}`, body).then(r => r.data),
    onSuccess: () => { invalidate(); setEditingId(null) },
  })

  const active = categories.filter(c => !c.is_archived)
  const archived = categories.filter(c => c.is_archived)
  const shown = showArchived ? categories : active

  return (
    <div className="flex flex-col gap-4">
      {/* Add form */}
      <Card>
        <CardHeader><SectionLabel>Add category</SectionLabel></CardHeader>
        <div style={{ padding: '16px 22px' }}>
          <form onSubmit={e => { e.preventDefault(); if (newName.trim()) createMutation.mutate(newName.trim()) }} className="flex gap-2.5">
            <input
              className="input flex-1"
              value={newName}
              onChange={e => { setNewName(e.target.value); setAddError(null) }}
              placeholder="e.g. Billing, Infrastructure, HR…"
            />
            <button
              type="submit"
              className="btn"
              disabled={!newName.trim() || createMutation.isPending}
              style={!newName.trim() ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            >
              {createMutation.isPending ? 'Adding…' : 'Add category'}
            </button>
          </form>
          {addError && <p className="text-[12px] text-danger-ink mt-1.5 mb-0">{addError}</p>}
        </div>
      </Card>

      {/* List */}
      <Card>
        <CardHeader>
          <SectionLabel>{active.length} active{archived.length > 0 ? `, ${archived.length} archived` : ''}</SectionLabel>
          <label className="flex items-center gap-1.5 cursor-pointer text-[12px] text-ink-2 ml-auto">
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} style={{ accentColor: 'var(--b1)' }} />
            Show archived
          </label>
        </CardHeader>
        {isLoading ? (
          <div className="p-5">{[1, 2, 3].map(i => <div key={i} style={{ height: 50, borderRadius: 12, background: 'var(--track)', marginBottom: 8, animation: 'shimmer 1.5s ease-in-out infinite' }} />)}</div>
        ) : shown.length === 0 ? (
          <p className="px-6 py-10 text-center text-ink-3 text-[13px] m-0">
            {showArchived ? 'No categories yet — add one above.' : 'No active categories — add one above.'}
          </p>
        ) : (
          shown.map((cat, i) => (
            <div
              key={cat.id}
              className={`flex items-center gap-3 ${i < shown.length - 1 ? 'border-b border-track' : ''}`}
              style={{ padding: '12px 22px', opacity: cat.is_archived ? 0.6 : 1 }}
            >
              <div
                className="flex-shrink-0"
                style={{ width: 8, height: 8, borderRadius: '50%', background: cat.is_archived ? 'var(--ink-3)' : 'var(--brand-grad)' }}
              />
              <div className="flex-1">
                {editingId === cat.id ? (
                  <input
                    autoFocus
                    className="input"
                    style={{ width: 'auto', maxWidth: 260, padding: '6px 11px' }}
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={() => { if (editValue.trim() && editValue !== cat.name) patchMutation.mutate({ id: cat.id, name: editValue.trim() }); else setEditingId(null) }}
                    onKeyDown={e => { if (e.key === 'Enter') { if (editValue.trim() && editValue !== cat.name) patchMutation.mutate({ id: cat.id, name: editValue.trim() }); else setEditingId(null) } if (e.key === 'Escape') setEditingId(null) }}
                  />
                ) : (
                  <span
                    onClick={() => { setEditingId(cat.id); setEditValue(cat.name) }}
                    title="Click to rename"
                    className={`text-[13px] font-medium cursor-pointer ${cat.is_archived ? 'text-ink-3 line-through' : 'text-ink'} hover:text-brand-ink`}
                  >
                    {cat.name}
                  </span>
                )}
              </div>
              <span className="font-mono text-[10.5px] text-ink-3 whitespace-nowrap">{timeAgo(cat.created_at)}</span>
              <button
                onClick={() => patchMutation.mutate({ id: cat.id, is_archived: !cat.is_archived })}
                className={`btn ghost sm${cat.is_archived ? '' : ' danger'}`}
                style={{ padding: '3px 10px', fontSize: 11.5 }}
              >
                {cat.is_archived ? 'Restore' : 'Archive'}
              </button>
            </div>
          ))
        )}
      </Card>
    </div>
  )
}

// ── SLA Policies tab ──────────────────────────────────────────────────────────

const PRIORITY_LABELS: Record<Priority, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }
const PRIORITY_ORDER: Priority[] = ['critical', 'high', 'medium', 'low']
// Urgency wears the reserved semantic tokens (matches PriorityBadge)
const PRIORITY_PILL: Record<Priority, string> = { critical: 'danger', high: 'warn', medium: 'avail', low: 'retired' }

function formatMinutes(m: number): string {
  const days = Math.floor(m / 1440); const hours = Math.floor((m % 1440) / 60); const mins = m % 60
  if (m < 60) return `${m}m`
  if (days > 0) return mins > 0 ? `${days}d ${hours}h ${mins}m` : hours > 0 ? `${days}d ${hours}h` : `${days}d`
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

function SLARow({ policy, onDelete }: { policy: SLAPolicyRead; onDelete: () => void }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [name, setName] = useState(policy.name)
  const [resp, setResp] = useState(String(policy.first_response_minutes))
  const [res, setRes] = useState(String(policy.resolution_minutes))

  const patch = useMutation({
    mutationFn: () => api.patch(`/sla-policies/${policy.id}`, { name: name.trim() || undefined, first_response_minutes: resp ? Number(resp) : undefined, resolution_minutes: res ? Number(res) : undefined }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sla-policies'] }); setEditing(false) },
  })
  const del = useMutation({
    mutationFn: () => api.delete(`/sla-policies/${policy.id}`),
    onSuccess: onDelete,
    onError: (err: any) => { alert(apiErrorMessage(err, 'Cannot delete')); setConfirm(false) },
  })

  const badge = <span className={`pill ${PRIORITY_PILL[policy.priority]}`}>{PRIORITY_LABELS[policy.priority]}</span>

  if (confirm) return (
    <tr style={{ background: 'var(--danger-bg)' }}>
      <td colSpan={4} className="text-[13px] font-medium text-danger-ink">Delete "{policy.name}"?</td>
      <td>
        <div className="flex gap-1.5">
          <button onClick={() => del.mutate()} disabled={del.isPending} className="btn ghost sm danger">{del.isPending ? '…' : 'Delete'}</button>
          <button onClick={() => setConfirm(false)} className="btn ghost sm">Cancel</button>
        </div>
      </td>
    </tr>
  )

  if (editing) return (
    <tr style={{ background: 'var(--row-active)' }}>
      <td>{badge}</td>
      <td><input className="input" value={name} onChange={e => setName(e.target.value)} style={{ minWidth: 140, padding: '6px 11px' }} /></td>
      <td><div className="flex items-center gap-1.5"><input type="number" min="1" className="input" value={resp} onChange={e => setResp(e.target.value)} style={{ width: 80, padding: '6px 11px' }} /><span className="text-[12px] text-ink-3">min</span></div></td>
      <td><div className="flex items-center gap-1.5"><input type="number" min="1" className="input" value={res} onChange={e => setRes(e.target.value)} style={{ width: 80, padding: '6px 11px' }} /><span className="text-[12px] text-ink-3">min</span></div></td>
      <td>
        <div className="flex gap-1.5">
          <button onClick={() => patch.mutate()} disabled={patch.isPending} className="btn sm">{patch.isPending ? '…' : 'Save'}</button>
          <button onClick={() => setEditing(false)} className="btn ghost sm">Cancel</button>
        </div>
      </td>
    </tr>
  )

  return (
    <tr>
      <td>{badge}</td>
      <td className="name">{policy.name}</td>
      <td><span className="sn">{formatMinutes(policy.first_response_minutes)}</span></td>
      <td><span className="sn">{formatMinutes(policy.resolution_minutes)}</span></td>
      <td>
        <div className="flex gap-1.5">
          <button onClick={() => setEditing(true)} className="btn ghost sm" style={{ padding: '3px 10px', fontSize: 11.5 }}>Edit</button>
          <button onClick={() => setConfirm(true)} className="btn ghost sm danger" style={{ padding: '3px 10px', fontSize: 11.5 }}>Delete</button>
        </div>
      </td>
    </tr>
  )
}

function SLATab() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [newPriority, setNewPriority] = useState<Priority>('medium')
  const [newName, setNewName] = useState('')
  const [newResp, setNewResp] = useState('')
  const [newRes, setNewRes] = useState('')
  const [addError, setAddError] = useState<string | null>(null)

  const { data: policies = [], isLoading } = useQuery<SLAPolicyRead[]>({
    queryKey: ['sla-policies'],
    queryFn: () => api.get<SLAPolicyRead[]>('/sla-policies').then(r => r.data),
    staleTime: 60_000,
  })

  const existing = new Set(policies.map(p => p.priority))
  const available = PRIORITY_ORDER.filter(p => !existing.has(p))
  const sorted = [...policies].sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority))

  const createMutation = useMutation({
    mutationFn: () => api.post('/sla-policies', { name: newName.trim(), priority: newPriority, first_response_minutes: Number(newResp), resolution_minutes: Number(newRes) }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sla-policies'] }); setNewName(''); setNewResp(''); setNewRes(''); setAddError(null); setShowAdd(false) },
    onError: (err: any) => setAddError(apiErrorMessage(err, 'Failed.')),
  })

  function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setAddError(null)
    if (!newName.trim() || !newResp || !newRes) { setAddError('All fields are required.'); return }
    if (Number(newResp) <= 0 || Number(newRes) <= 0) { setAddError('Minutes must be positive.'); return }
    createMutation.mutate()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <p className="text-[13px] text-ink-2 m-0">One policy per priority. Times in minutes.</p>
        {available.length > 0 && (
          showAdd ? (
            <button className="btn ghost sm" onClick={() => setShowAdd(false)}>Cancel</button>
          ) : (
            <button className="btn sm" onClick={() => { setShowAdd(true); if (available.length) setNewPriority(available[0]) }}>
              Add policy
            </button>
          )
        )}
      </div>

      {showAdd && (
        <Card>
          <div style={{ padding: '18px 22px' }}>
            <form onSubmit={handleCreate}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
                <div className="fieldrow" style={{ marginBottom: 0 }}>
                  <label>Priority</label>
                  <div className="selectwrap">
                    <select className="select" value={newPriority} onChange={e => setNewPriority(e.target.value as Priority)}>
                      {available.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                    </select>
                  </div>
                </div>
                <div className="fieldrow" style={{ marginBottom: 0 }}>
                  <label>Name</label>
                  <input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. High priority SLA" />
                </div>
                <div className="fieldrow" style={{ marginBottom: 0 }}>
                  <label>First response (min)</label>
                  <input type="number" min="1" className="input" value={newResp} onChange={e => setNewResp(e.target.value)} placeholder="60" />
                </div>
                <div className="fieldrow" style={{ marginBottom: 0 }}>
                  <label>Resolution (min)</label>
                  <input type="number" min="1" className="input" value={newRes} onChange={e => setNewRes(e.target.value)} placeholder="480" />
                </div>
              </div>
              {addError && <p className="text-[12px] text-danger-ink mt-2 mb-0">{addError}</p>}
              <button type="submit" className="btn mt-3.5" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating…' : 'Create policy'}
              </button>
            </form>
          </div>
        </Card>
      )}

      <Card>
        {isLoading ? (
          <div className="p-5">{[1, 2, 3, 4].map(i => <div key={i} style={{ height: 42, borderRadius: 12, background: 'var(--track)', marginBottom: 8, animation: 'shimmer 1.5s ease-in-out infinite' }} />)}</div>
        ) : sorted.length === 0 ? (
          <p className="px-6 py-12 text-center text-ink-3 text-[13px] m-0">No SLA policies yet — add one to start the clocks.</p>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  {['Priority', 'Name', 'First response', 'Resolution', ''].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(p => <SLARow key={p.id} policy={p} onDelete={() => qc.invalidateQueries({ queryKey: ['sla-policies'] })} />)}
              </tbody>
            </table>
          </div>
        )}
        {existing.size === 4 && <p className="text-[12px] text-ink-3 text-center pt-2 pb-3 m-0">All four priority levels configured.</p>}
      </Card>
    </div>
  )
}

// ── Statuses tab ──────────────────────────────────────────────────────────────

const BLANK_STATUS: StatusForm = { name: '', label: '', color: '#737373', pauses_sla: false, is_default: false, is_resolved_state: false, sort_order: 0 }
// Preset swatches offered when creating a status — stored as data in the DB
const PRESET_COLORS = ['#3B82F6', '#FF4713', '#F59E0B', '#10B981', '#737373', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1']

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      style={{ width: 32, height: 18, borderRadius: 9, border: 'none', cursor: 'pointer', background: checked ? 'var(--brand-grad)' : 'var(--track)', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}
    >
      <span style={{ position: 'absolute', top: 2, left: checked ? 16 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.15)' }} />
    </button>
  )
}

function StatusesTab() {
  const qc = useQueryClient()
  const [form, setForm] = useState<StatusForm>(BLANK_STATUS)
  const [editId, setEditId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: statuses = [], isLoading } = useQuery<StatusRow[]>({
    queryKey: ['admin-ticket-statuses'],
    queryFn: async () => (await api.get<StatusRow[]>('/admin/ticket-statuses')).data,
  })

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['admin-ticket-statuses'] }); qc.invalidateQueries({ queryKey: ['app-config'] }) }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editId !== null) await api.patch(`/admin/ticket-statuses/${editId}`, form)
      else await api.post('/admin/ticket-statuses', form)
    },
    onSuccess: () => { invalidate(); setForm(BLANK_STATUS); setEditId(null); setError(null) },
    onError: (err: any) => setError(apiErrorMessage(err, 'Save failed')),
  })

  const archiveMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/ticket-statuses/${id}`),
    onSuccess: invalidate,
    onError: (err: any) => setError(apiErrorMessage(err, 'Failed')),
  })

  const patchMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: object }) => api.patch(`/admin/ticket-statuses/${id}`, patch),
    onSuccess: invalidate,
  })

  const active = statuses.filter(s => !s.is_archived)
  const archived = statuses.filter(s => s.is_archived)

  return (
    <div className="flex flex-col gap-4">
      {/* Table */}
      <Card>
        <CardHeader><SectionLabel>Active statuses</SectionLabel></CardHeader>
        {isLoading ? (
          <div className="p-5">{[1, 2, 3].map(i => <div key={i} style={{ height: 42, borderRadius: 12, background: 'var(--track)', marginBottom: 8, animation: 'shimmer 1.5s ease-in-out infinite' }} />)}</div>
        ) : active.length === 0 ? (
          <p className="px-6 py-10 text-center text-ink-3 text-[13px] m-0">No statuses yet — create one below.</p>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  {['Colour', 'Slug', 'Label', 'Pauses SLA', 'Default', 'Resolved', 'Order', ''].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {active.map(s => (
                  <tr key={s.id}>
                    {/* Status colors are admin-configured data — inline stays */}
                    <td><span style={{ display: 'inline-block', width: 22, height: 22, borderRadius: 7, background: s.color, border: '1px solid var(--edge)' }} /></td>
                    <td><span className="sn">{s.name}</span></td>
                    <td><span className="text-[13px] font-semibold" style={{ color: s.color }}>{s.label}</span></td>
                    <td><Toggle checked={s.pauses_sla} onChange={v => patchMutation.mutate({ id: s.id, patch: { pauses_sla: v } })} /></td>
                    <td><Toggle checked={s.is_default} onChange={v => patchMutation.mutate({ id: s.id, patch: { is_default: v } })} /></td>
                    <td><Toggle checked={s.is_resolved_state} onChange={v => patchMutation.mutate({ id: s.id, patch: { is_resolved_state: v } })} /></td>
                    <td><span className="sn">{s.sort_order}</span></td>
                    <td>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => { setEditId(s.id); setForm({ name: s.name, label: s.label, color: s.color, pauses_sla: s.pauses_sla, is_default: s.is_default, is_resolved_state: s.is_resolved_state, sort_order: s.sort_order }); setError(null) }}
                          className="btn ghost sm"
                          style={{ padding: '3px 10px', fontSize: 11.5 }}
                        >
                          Edit
                        </button>
                        {!s.is_default && (
                          <button
                            onClick={() => archiveMutation.mutate(s.id)}
                            className="btn ghost sm danger"
                            style={{ padding: '3px 10px', fontSize: 11.5 }}
                          >
                            Archive
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create / edit form */}
      <Card>
        <CardHeader><SectionLabel>{editId !== null ? 'Edit status' : 'New status'}</SectionLabel></CardHeader>
        <div style={{ padding: '18px 22px' }}>
          <div className="formgrid" style={{ marginBottom: 16 }}>
            <div className="fieldrow" style={{ marginBottom: 0 }}>
              <label>Slug</label>
              <input
                className="input"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))}
                disabled={editId !== null}
                placeholder="e.g. waiting_vendor"
                style={editId !== null ? { opacity: 0.5 } : undefined}
              />
              <p className="m-0 text-[11px] text-ink-3">Lowercase + underscores. Cannot change after creation.</p>
            </div>
            <div className="fieldrow" style={{ marginBottom: 0 }}>
              <label>Display label</label>
              <input className="input" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Waiting on vendor" />
            </div>
            <div className="fieldrow" style={{ marginBottom: 0 }}>
              <label>Colour</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form.color}
                  onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                  style={{ width: 36, height: 32, padding: 2, border: '1px solid var(--edge)', borderRadius: 8, cursor: 'pointer', background: 'var(--field)' }}
                />
                <div className="flex gap-1 flex-wrap">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setForm(f => ({ ...f, color: c }))}
                      aria-label={`Use colour ${c}`}
                      style={{ width: 20, height: 20, borderRadius: 6, background: c, border: 'none', cursor: 'pointer', outline: form.color === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="fieldrow" style={{ marginBottom: 0 }}>
              <label>Sort order</label>
              <input type="number" className="input" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))} style={{ width: 90 }} />
            </div>
          </div>

          <div className="flex gap-6 mb-4 flex-wrap">
            {[
              { key: 'pauses_sla', title: 'Pauses SLA', hint: 'SLA clock stops while in this status' },
              { key: 'is_default', title: 'Default status', hint: 'Applied to newly created tickets' },
              { key: 'is_resolved_state', title: 'Resolved state', hint: 'Tickets re-open on new Slack reply' },
            ].map(({ key, title, hint }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer text-[13px]">
                <input type="checkbox" checked={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))} style={{ accentColor: 'var(--b1)' }} />
                <div>
                  <div className="font-semibold text-ink">{title}</div>
                  <div className="text-[11px] text-ink-3">{hint}</div>
                </div>
              </label>
            ))}
          </div>

          {error && <div className="mb-3 text-[13px] text-danger-ink">{error}</div>}
          <div className="flex gap-2">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={!form.label || (!editId && !form.name) || saveMutation.isPending}
              className="btn"
              style={(!form.label || (!editId && !form.name)) ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            >
              {saveMutation.isPending ? 'Saving…' : editId !== null ? 'Save changes' : 'Create status'}
            </button>
            {editId !== null && (
              <button onClick={() => { setEditId(null); setForm(BLANK_STATUS); setError(null) }} className="btn ghost">
                Cancel
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Archived */}
      {archived.length > 0 && (
        <Card>
          <CardHeader><SectionLabel>Archived statuses</SectionLabel></CardHeader>
          <div className="flex flex-wrap gap-2" style={{ padding: '12px 22px 16px' }}>
            {archived.map(s => (
              <div key={s.id} className="flex items-center gap-1.5 bg-field border border-edge rounded-full px-2.5 py-1 text-[12px]">
                <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, display: 'inline-block' }} />
                <span className="text-ink-2">{s.label}</span>
                <button
                  onClick={() => patchMutation.mutate({ id: s.id, patch: { is_archived: false } })}
                  className="bg-transparent border-0 cursor-pointer text-[11px] text-brand-ink p-0 ml-1"
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

// ── Backup tab ────────────────────────────────────────────────────────────────

function BackupTab() {
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreResult, setRestoreResult] = useState<{ ok: boolean; restored_files: number } | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleDownload() {
    setDownloading(true); setDownloadError(null)
    try {
      const res = await api.get('/admin/backup', { responseType: 'blob' })
      const match = (res.headers['content-disposition'] ?? '').match(/filename="([^"]+)"/)
      const filename = match ? match[1] : 'simpletickets_backup.zip'
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/zip' }))
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url)
    } catch { setDownloadError('Download failed. Check the backend logs.') }
    finally { setDownloading(false) }
  }

  async function handleRestore() {
    if (!file || !confirmed) return
    setRestoring(true); setRestoreError(null); setRestoreResult(null)
    try {
      const form = new FormData(); form.append('file', file)
      const res = await api.post<{ ok: boolean; restored_files: number }>('/admin/restore', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      setRestoreResult(res.data); setFile(null); setConfirmed(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err: any) {
      setRestoreError(apiErrorMessage(err, 'Restore failed.'))
    } finally { setRestoring(false) }
  }

  function pickFile(f: File | undefined) {
    if (f) { setFile(f); setRestoreResult(null); setRestoreError(null) }
  }

  return (
    <div className="flex flex-col gap-4" style={{ maxWidth: 680 }}>
      {/* Export */}
      <Card>
        <CardHeader><SectionLabel>Export backup</SectionLabel></CardHeader>
        <div style={{ padding: '18px 22px' }}>
          <p className="text-[13px] text-ink-2 m-0 mb-4 leading-relaxed">
            Downloads a <span className="font-mono text-[12px] px-1 py-px rounded bg-field text-ink">.zip</span> with all tickets, replies, users, categories, SLA policies, settings, and attachments. Slack credentials and JWT secret are excluded.
          </p>
          <button className="btn" onClick={handleDownload} disabled={downloading} style={downloading ? { opacity: 0.7, cursor: 'wait' } : undefined}>
            {downloading ? <><Spin />&nbsp;Preparing…</> : 'Download backup'}
          </button>
          {downloadError && <p className="mt-2 mb-0 text-[13px] text-danger-ink">{downloadError}</p>}
        </div>
      </Card>

      {/* Restore */}
      <Card>
        <CardHeader><SectionLabel>Restore from backup</SectionLabel></CardHeader>
        <div style={{ padding: '18px 22px' }}>
          <div
            className="rounded-block px-3.5 py-2.5 mb-4 text-[13px] leading-relaxed text-danger-ink"
            style={{ background: 'var(--danger-bg)' }}
          >
            <strong>This permanently overwrites all data.</strong> Slack credentials and the JWT secret are not affected — re-enter them after restore.
          </div>
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f?.name.endsWith('.zip')) pickFile(f) }}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-block px-5 py-7 text-center cursor-pointer mb-4 bg-field border border-edge hover:bg-row-hover"
            style={{
              boxShadow: 'inset 0 1px 0 var(--specular)',
              ...(dragOver ? { borderColor: 'color-mix(in oklab, var(--b1) 55%, transparent)', background: 'var(--brand-tint)' } : {}),
            }}
          >
            <input ref={fileInputRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={e => pickFile(e.target.files?.[0])} />
            {file ? (
              <div className="text-[13px] font-semibold text-ink">
                {file.name} <span className="font-normal text-ink-2 font-mono text-[11.5px]">({(file.size / 1024 / 1024).toFixed(2)} MB)</span>
                <span className="font-normal text-ink-3"> — click to change</span>
              </div>
            ) : (
              <div className="text-[13px] text-ink-2">Drop a <strong className="text-ink">.zip</strong> backup here or click to browse</div>
            )}
          </div>
          <label className="flex items-start gap-2 cursor-pointer mb-4">
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} style={{ marginTop: 2, accentColor: 'var(--b1)' }} />
            <span className="text-[13px] text-ink leading-snug">I understand all current data will be permanently overwritten and cannot be recovered.</span>
          </label>
          <button
            onClick={handleRestore}
            disabled={!file || !confirmed || restoring}
            className="btn ghost danger"
            style={(!file || !confirmed || restoring) ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            {restoring ? <><Spin />&nbsp;Restoring…</> : 'Restore from backup'}
          </button>
          {restoreResult && (
            <div className="mt-3.5 rounded-block px-3.5 py-2.5 text-[13px]" style={{ background: 'var(--brand-tint)', color: 'var(--brand-ink)' }}>
              Restore complete. {restoreResult.restored_files} attachment file{restoreResult.restored_files !== 1 ? 's' : ''} restored. Reload to see updated data.
            </div>
          )}
          {restoreError && (
            <div className="mt-3.5 rounded-block px-3.5 py-2.5 text-[13px] text-danger-ink" style={{ background: 'var(--danger-bg)' }}>
              {restoreError}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

function Spin() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin"><path d="M7 1a6 6 0 1 1-4.24 1.76" /></svg>
}

// ── Account tab ────────────────────────────────────────────────────────────────

function AccountTab() {
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
      await api.post('/auth/change-password', { current_password: current, new_password: next })
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
    <div style={{ maxWidth: 420 }}>
      <Card>
        <CardHeader><SectionLabel>Change password</SectionLabel></CardHeader>
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
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Settings() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const tabs = isAdmin ? ADMIN_TABS : USER_TABS
  const defaultTab: Tab = isAdmin ? 'general' : 'account'

  const [searchParams, setSearchParams] = useSearchParams()
  // Validate the tab against what this role can actually see — otherwise a deep
  // link like ?tab=general for a non-admin (or a bogus value) renders nothing.
  const rawTab = searchParams.get('tab')
  const tab: Tab = tabs.some(t => t.id === rawTab) ? (rawTab as Tab) : defaultTab
  function setTab(t: Tab) { setSearchParams({ tab: t }, { replace: true }) }

  return (
    <AppShell title="Settings">
      <div style={{ maxWidth: 1100 }}>
        {/* Tab bar */}
        <div className="flex gap-1.5 mb-5 flex-wrap">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`chip${tab === t.id ? ' on' : ''}`}>
              {t.label}
            </button>
          ))}
        </div>

        {isAdmin && tab === 'general'    && <GeneralTab />}
        {isAdmin && tab === 'slack'      && <SlackTab />}
        {isAdmin && tab === 'categories' && <CategoriesTab />}
        {isAdmin && tab === 'sla'        && <SLATab />}
        {isAdmin && tab === 'statuses'   && <StatusesTab />}
        {isAdmin && tab === 'backup'     && <BackupTab />}
        {tab === 'account' && <AccountTab />}
      </div>
    </AppShell>
  )
}
