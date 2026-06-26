import { useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AppShell from '../../components/layout/AppShell'
import { useAuth } from '../../contexts/AuthContext'
import api from '../../lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'general' | 'slack' | 'categories' | 'sla' | 'statuses' | 'backup' | 'account'

const ADMIN_TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'slack', label: 'Slack' },
  { id: 'categories', label: 'Categories' },
  { id: 'sla', label: 'SLA Policies' },
  { id: 'statuses', label: 'Statuses' },
  { id: 'backup', label: 'Backup & Restore' },
  { id: 'account', label: 'My Account' },
]

const USER_TABS: { id: Tab; label: string }[] = [
  { id: 'account', label: 'My Account' },
]

type Priority = 'low' | 'medium' | 'high' | 'critical'

interface SettingRead { key: string; value: string | null; is_secret: boolean; group_name: string }
interface CategoryRead { id: number; name: string; is_archived: boolean; created_at: string }
interface SLAPolicyRead { id: number; name: string; priority: Priority; first_response_minutes: number; resolution_minutes: number }
interface StatusRow { id: number; name: string; label: string; color: string; pauses_sla: boolean; is_default: boolean; is_resolved_state: boolean; sort_order: number; is_archived: boolean }
interface StatusForm { name: string; label: string; color: string; pauses_sla: boolean; is_default: boolean; is_resolved_state: boolean; sort_order: number }

// ── Shared styles ─────────────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  width: '100%', padding: '7px 10px',
  border: '1.5px solid #E5E5E5', borderRadius: 7,
  fontSize: 13, color: '#0A0A0A', background: '#fff',
  outline: 'none', boxSizing: 'border-box',
  fontFamily: 'Inter, system-ui, sans-serif',
  transition: 'border-color 0.15s',
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: '#fff', border: '1px solid #E5E5E5', borderRadius: 12, overflow: 'hidden', ...style }}>{children}</div>
}

function CardHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '12px 20px', borderBottom: '1px solid #F2F2F2', background: '#FAFAFA', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 12, fontWeight: 700, color: '#262626', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{children}</span>
}

function SaveBar({ dirty, pending, onSave }: { dirty: boolean; pending: boolean; onSave: () => void }) {
  if (!dirty) return null
  return (
    <div style={{ padding: '10px 20px', borderTop: '1px solid #F2F2F2', background: '#FAFAFA', display: 'flex', justifyContent: 'flex-end' }}>
      <button onClick={onSave} disabled={pending}
        style={{ height: 34, padding: '0 20px', background: 'linear-gradient(135deg, #FF4713, #AD1164)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
        {pending ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  )
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

function GeneralTab() {
  const { data, isLoading } = useSettingsQuery()
  const [tz, setTz] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const storedTz = data?.settings.find(s => s.key === 'timezone')?.value ?? 'UTC'
  const currentTz = tz ?? storedTz
  const dirty = tz !== null && tz !== storedTz
  const mutation = useSaveMutation(() => { setTz(null); setSaved(true); setTimeout(() => setSaved(false), 2000) })

  if (isLoading) return <div style={{ color: '#737373', fontSize: 13 }}>Loading…</div>
  return (
    <Card>
      <CardHeader>
        <SectionLabel>General</SectionLabel>
        {saved && <span style={{ fontSize: 12, color: '#059669', fontWeight: 600 }}>✓ Saved</span>}
      </CardHeader>
      <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#262626' }}>Timezone</div>
          <div style={{ fontSize: 11, color: '#A3A3A3', marginTop: 2 }}>All timestamps are displayed in this timezone</div>
        </div>
        <select value={currentTz} onChange={e => setTz(e.target.value)}
          style={{ ...inp, height: 34, padding: '0 10px', border: dirty ? '1.5px solid #FF4713' : '1.5px solid #E5E5E5', background: dirty ? '#FFF9F7' : '#FAFAFA', cursor: 'pointer' }}>
          {TIMEZONES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <SaveBar dirty={dirty} pending={mutation.isPending} onSave={() => mutation.mutate([{ key: 'timezone', value: currentTz }])} />
    </Card>
  )
}

// ── Slack tab ─────────────────────────────────────────────────────────────────

const SLACK_KEYS = ['slack_bot_token', 'slack_app_token', 'slack_signing_secret', 'slack_trigger_emoji', 'slack_two_way_sync'] as const
const SLACK_META: Record<string, { label: string; hint: string; placeholder?: string }> = {
  slack_bot_token:      { label: 'Bot Token',       hint: 'Starts with xoxb-',                         placeholder: 'xoxb-…'   },
  slack_app_token:      { label: 'App-Level Token', hint: 'Socket Mode — starts with xapp-',           placeholder: 'xapp-…'   },
  slack_signing_secret: { label: 'Signing Secret',  hint: 'From Basic Information → App Credentials',  placeholder: '••••••••' },
  slack_trigger_emoji:  { label: 'Trigger Emoji',   hint: 'Reaction name that creates a ticket',       placeholder: 'clipboard'},
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

  const settingMap = Object.fromEntries((data?.settings ?? []).map(s => [s.key, s]))
  const mutation = useSaveMutation(() => { setEdits({}); setRevealing({}); setSaved(true); setTimeout(() => setSaved(false), 2500) })

  function getValue(key: string) { return key in edits ? edits[key] : (settingMap[key]?.value ?? '') }
  function edit(key: string, value: string) { setEdits(e => ({ ...e, [key]: value })) }
  const dirty = SLACK_KEYS.some(k => k in edits)

  async function handleTest() {
    const bot = getValue('slack_bot_token'); const app = getValue('slack_app_token')
    if (!bot || !app) return
    setTesting(true); setTestResult(null)
    try { setTestResult((await api.post('/admin/settings/test-slack', { bot_token: bot, app_token: app })).data) }
    catch { setTestResult({ ok: false, error: 'Request failed' }) }
    finally { setTesting(false) }
  }

  if (isLoading) return <div style={{ color: '#737373', fontSize: 13 }}>Loading…</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <CardHeader>
          <SectionLabel>Slack Integration</SectionLabel>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {saved && <span style={{ fontSize: 12, color: '#059669', fontWeight: 600 }}>✓ Saved</span>}
            {testResult && <span style={{ fontSize: 12, color: testResult.ok ? '#059669' : '#DC2626' }}>{testResult.ok ? `✓ ${testResult.team_name}` : `✗ ${testResult.error}`}</span>}
            <button onClick={handleTest} disabled={testing} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 8, border: '1px solid #E5E5E5', background: '#fff', cursor: 'pointer', color: '#737373', fontWeight: 500 }}>
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
          const changed = key in edits

          return (
            <div key={key} style={{ padding: '14px 20px', borderBottom: i < SLACK_KEYS.length - 1 ? '1px solid #F9F9F9' : 'none', display: 'grid', gridTemplateColumns: '220px 1fr auto', gap: 16, alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#262626' }}>{meta.label}</div>
                <div style={{ fontSize: 11, color: '#A3A3A3', marginTop: 2 }}>{meta.hint}</div>
              </div>
              <div>
                {isToggle ? (
                  <div onClick={() => edit(key, val === 'false' ? 'true' : 'false')}
                    style={{ width: 44, height: 24, borderRadius: 12, cursor: 'pointer', background: val !== 'false' ? 'linear-gradient(135deg, #FF4713, #AD1164)' : '#E5E5E5', position: 'relative', transition: 'background 0.2s' }}>
                    <div style={{ position: 'absolute', top: 3, left: val !== 'false' ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                  </div>
                ) : row?.is_secret && !isRevealing ? (
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: '#A3A3A3' }}>{val || '—'}</span>
                ) : (
                  <input value={val} type={row?.is_secret ? 'password' : 'text'}
                    onChange={e => edit(key, e.target.value)}
                    placeholder={meta.placeholder ?? ''}
                    style={{ ...inp, height: 34, padding: '0 10px', border: changed ? '1.5px solid #FF4713' : '1.5px solid #E5E5E5', background: changed ? '#FFF9F7' : '#FAFAFA', fontFamily: row?.is_secret ? 'JetBrains Mono, monospace' : 'inherit', boxShadow: changed ? '0 0 0 3px rgba(255,71,19,0.08)' : 'none' }}
                    onFocus={() => { if (row?.is_secret && !isRevealing) { setRevealing(r => ({ ...r, [key]: true })); edit(key, '') } }}
                  />
                )}
              </div>
              <div style={{ width: 60, textAlign: 'right' }}>
                {row?.is_secret && !isRevealing && (
                  <button onClick={() => { setRevealing(r => ({ ...r, [key]: true })); edit(key, '') }}
                    style={{ fontSize: 12, color: '#FF4713', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: '4px 8px' }}>
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
        <button onClick={() => setShowGuide(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#737373', padding: '4px 0' }}>
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
  display_information: {
    name: "SimpleTickets",
    description: "Self-hosted IT helpdesk — submit and track support tickets without leaving Slack.",
    background_color: "#111111",
  },
  features: {
    bot_user: { display_name: "SimpleTickets", always_online: true },
    slash_commands: [{ command: "/ticket", description: "Submit a support ticket", usage_hint: "[describe your issue]", should_escape: false }],
    app_home: { home_tab_enabled: true, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
    shortcuts: [{ name: "Create ticket", type: "message", callback_id: "create_ticket_from_message", description: "Turn any Slack message into a support ticket" }],
  },
  oauth_config: {
    scopes: {
      bot: ["chat:write", "chat:write.public", "im:write", "im:history", "channels:history", "groups:history", "reactions:read", "files:read", "files:write", "users:read"],
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
    <button onClick={() => { navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) }) }}
      style={{ background: copied ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.06)', border: `1px solid ${copied ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.1)'}`, borderRadius: 5, padding: '2px 8px', cursor: 'pointer', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: copied ? '#10B981' : 'rgba(255,255,255,0.7)', display: 'inline-flex', alignItems: 'center', gap: 4, transition: 'all 0.15s', flexShrink: 0 }}>
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  )
}

function SlackGuide() {
  return (
    <div style={{ marginTop: 12, maxWidth: 720 }}>
      <p style={{ fontSize: 13, color: '#737373', marginBottom: 20, lineHeight: 1.6 }}>
        SimpleTickets uses a <strong>private Slack app</strong> installed in your workspace.
        Instead of configuring it manually, use the manifest below — Slack will set everything up automatically.
      </p>

      {/* Step 1 */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 16 }}>
        <div style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, background: 'linear-gradient(135deg, #FF4713, #AD1164)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', marginTop: 1 }}>1</div>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#fff', margin: '0 0 8px' }}>Copy the manifest and open the Slack App Console</p>
          <div style={{ background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>slack-manifest.json</span>
              <CopyBtn value={SLACK_MANIFEST} />
            </div>
            <pre style={{ margin: 0, padding: '14px 16px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'rgba(255,255,255,0.5)', overflowX: 'auto', lineHeight: 1.6, maxHeight: 220, overflowY: 'auto' }}>{SLACK_MANIFEST}</pre>
          </div>
          <div style={{ marginTop: 10 }}>
            <a href="https://api.slack.com/apps?new_app=1" target="_blank" rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: 'rgba(255,71,19,0.1)', border: '1px solid rgba(255,71,19,0.3)', borderRadius: 7, fontSize: 13, fontWeight: 600, color: '#FF4713', textDecoration: 'none', transition: 'all 0.15s' }}>
              Open Slack App Console →
            </a>
          </div>
        </div>
      </div>

      {/* Step 2 */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 16 }}>
        <div style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, background: 'linear-gradient(135deg, #FF4713, #AD1164)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', marginTop: 1 }}>2</div>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#fff', margin: '0 0 6px' }}>Create the app from the manifest</p>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', margin: 0, lineHeight: 1.6 }}>
            In the Slack App Console: <strong style={{ color: 'rgba(255,255,255,0.7)' }}>Create New App</strong> → <strong style={{ color: 'rgba(255,255,255,0.7)' }}>From a manifest</strong> → select your workspace → paste the manifest → click <strong style={{ color: 'rgba(255,255,255,0.7)' }}>Next</strong> → <strong style={{ color: 'rgba(255,255,255,0.7)' }}>Create</strong> → <strong style={{ color: 'rgba(255,255,255,0.7)' }}>Install to Workspace</strong>.
          </p>
        </div>
      </div>

      {/* Step 3 */}
      <div style={{ display: 'flex', gap: 14 }}>
        <div style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, background: 'linear-gradient(135deg, #FF4713, #AD1164)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', marginTop: 1 }}>3</div>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#fff', margin: '0 0 6px' }}>Copy your three tokens into the fields above</p>
          <div style={{ display: 'grid', gap: 6, fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>
            <span><strong style={{ color: 'rgba(255,255,255,0.7)', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>Bot Token</strong> — OAuth & Permissions → Bot User OAuth Token (starts with <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#FF4713' }}>xoxb-</code>)</span>
            <span><strong style={{ color: 'rgba(255,255,255,0.7)', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>App-Level Token</strong> — Basic Information → App-Level Tokens (starts with <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#FF4713' }}>xapp-</code>)</span>
            <span><strong style={{ color: 'rgba(255,255,255,0.7)', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>Signing Secret</strong> — Basic Information → App Credentials → Signing Secret</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Categories tab ────────────────────────────────────────────────────────────

function timeAgo(d: string) {
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(d).toLocaleDateString()
}

function CategoriesTab() {
  const qc = useQueryClient()
  const [showArchived, setShowArchived] = useState(false)
  const [newName, setNewName] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
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
    onError: (err: any) => setAddError(err?.response?.data?.detail ?? 'Failed to create category.'),
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Add form */}
      <Card>
        <CardHeader><SectionLabel>Add Category</SectionLabel></CardHeader>
        <div style={{ padding: '16px 20px' }}>
          <form onSubmit={e => { e.preventDefault(); if (newName.trim()) createMutation.mutate(newName.trim()) }} style={{ display: 'flex', gap: 10 }}>
            <input value={newName} onChange={e => { setNewName(e.target.value); setAddError(null) }}
              placeholder="e.g. Billing, Infrastructure, HR…"
              onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
              style={{ ...inp, flex: 1, border: `1.5px solid ${focused ? '#FF4713' : '#E5E5E5'}`, boxShadow: focused ? '0 0 0 3px rgba(255,71,19,0.07)' : 'none' }} />
            <button type="submit" disabled={!newName.trim() || createMutation.isPending}
              style={{ padding: '7px 18px', borderRadius: 8, border: 'none', flexShrink: 0, background: newName.trim() ? 'linear-gradient(135deg, #FF4713, #AD1164)' : '#E5E5E5', color: newName.trim() ? '#fff' : '#A3A3A3', fontSize: 13, fontWeight: 600, cursor: newName.trim() ? 'pointer' : 'not-allowed' }}>
              {createMutation.isPending ? 'Adding…' : 'Add'}
            </button>
          </form>
          {addError && <p style={{ fontSize: 12, color: '#EF4444', margin: '6px 0 0' }}>{addError}</p>}
        </div>
      </Card>

      {/* List */}
      <Card>
        <CardHeader>
          <SectionLabel>{shown.length} {showArchived ? 'total' : 'active'} — {active.length} active{archived.length > 0 ? `, ${archived.length} archived` : ''}</SectionLabel>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: '#737373' }}>
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} style={{ accentColor: '#FF4713' }} />
            Show archived
          </label>
        </CardHeader>
        {isLoading ? (
          <div style={{ padding: '24px' }}>{[1, 2, 3].map(i => <div key={i} style={{ height: 50, borderRadius: 8, background: '#F2F2F2', marginBottom: 8, animation: 'shimmer 1.5s ease-in-out infinite' }} />)}</div>
        ) : shown.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#A3A3A3', fontSize: 13 }}>{showArchived ? 'No categories yet.' : 'No active categories.'}</div>
        ) : (
          shown.map((cat, i) => (
            <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: i < shown.length - 1 ? '1px solid #F9F9F9' : 'none', opacity: cat.is_archived ? 0.65 : 1 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: cat.is_archived ? '#D4D4D4' : 'linear-gradient(135deg, #FF4713, #AD1164)', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                {editingId === cat.id ? (
                  <input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)}
                    onBlur={() => { if (editValue.trim() && editValue !== cat.name) patchMutation.mutate({ id: cat.id, name: editValue.trim() }); else setEditingId(null) }}
                    onKeyDown={e => { if (e.key === 'Enter') { if (editValue.trim() && editValue !== cat.name) patchMutation.mutate({ id: cat.id, name: editValue.trim() }); else setEditingId(null) } if (e.key === 'Escape') setEditingId(null) }}
                    style={{ ...inp, width: 'auto', maxWidth: 260, border: '1.5px solid #FF4713', boxShadow: '0 0 0 3px rgba(255,71,19,0.08)' }} />
                ) : (
                  <span onClick={() => { setEditingId(cat.id); setEditValue(cat.name) }} title="Click to rename"
                    style={{ fontSize: 13, fontWeight: 500, color: cat.is_archived ? '#A3A3A3' : '#0A0A0A', cursor: 'pointer', textDecoration: cat.is_archived ? 'line-through' : 'none', borderBottom: '1px dashed transparent' }}
                    onMouseEnter={e => (e.currentTarget.style.borderBottomColor = '#D4D4D4')}
                    onMouseLeave={e => (e.currentTarget.style.borderBottomColor = 'transparent')}>
                    {cat.name}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 11, color: '#C0C0C0', whiteSpace: 'nowrap' }}>{timeAgo(cat.created_at)}</span>
              <button onClick={() => patchMutation.mutate({ id: cat.id, is_archived: !cat.is_archived })}
                style={{ padding: '3px 9px', borderRadius: 6, border: '1px solid #E5E5E5', background: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: cat.is_archived ? '#10B981' : '#EF4444', whiteSpace: 'nowrap' }}>
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

const PRIORITY_COLORS: Record<Priority, string> = { critical: '#AD1164', high: '#FF4713', medium: '#F59E0B', low: '#3B82F6' }
const PRIORITY_LABELS: Record<Priority, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }
const PRIORITY_ORDER: Priority[] = ['critical', 'high', 'medium', 'low']

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
    onError: (err: any) => { alert(err?.response?.data?.detail ?? 'Cannot delete'); setConfirm(false) },
  })

  const color = PRIORITY_COLORS[policy.priority]
  const badge = <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, color, background: `${color}15`, border: `1px solid ${color}25` }}>{PRIORITY_LABELS[policy.priority]}</span>

  if (confirm) return (
    <tr style={{ background: '#FEF2F2' }}>
      <td colSpan={4} style={{ padding: '10px 16px', fontSize: 13, color: '#DC2626', fontWeight: 500 }}>Delete "{policy.name}"?</td>
      <td style={{ padding: '10px 16px' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => del.mutate()} disabled={del.isPending} style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: '#EF4444', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{del.isPending ? '…' : 'Delete'}</button>
          <button onClick={() => setConfirm(false)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #E5E5E5', background: '#fff', color: '#737373', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
        </div>
      </td>
    </tr>
  )

  if (editing) return (
    <tr style={{ background: '#FFFBF0' }}>
      <td style={{ padding: '10px 16px' }}>{badge}</td>
      <td style={{ padding: '10px 16px' }}><input value={name} onChange={e => setName(e.target.value)} style={{ ...inp, minWidth: 140 }} /></td>
      <td style={{ padding: '10px 16px' }}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="number" min="1" value={resp} onChange={e => setResp(e.target.value)} style={{ ...inp, width: 70 }} /><span style={{ fontSize: 12, color: '#737373' }}>min</span></div></td>
      <td style={{ padding: '10px 16px' }}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="number" min="1" value={res} onChange={e => setRes(e.target.value)} style={{ ...inp, width: 70 }} /><span style={{ fontSize: 12, color: '#737373' }}>min</span></div></td>
      <td style={{ padding: '10px 16px' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => patch.mutate()} disabled={patch.isPending} style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: '#10B981', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{patch.isPending ? '…' : 'Save'}</button>
          <button onClick={() => setEditing(false)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #E5E5E5', background: '#fff', color: '#737373', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
        </div>
      </td>
    </tr>
  )

  return (
    <tr onMouseEnter={e => (e.currentTarget.style.background = '#FAFAFA')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
      <td style={{ padding: '12px 16px' }}>{badge}</td>
      <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 500, color: '#0A0A0A' }}>{policy.name}</td>
      <td style={{ padding: '12px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{formatMinutes(policy.first_response_minutes)}</td>
      <td style={{ padding: '12px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{formatMinutes(policy.resolution_minutes)}</td>
      <td style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setEditing(true)} style={{ padding: '3px 9px', borderRadius: 6, border: '1px solid #E5E5E5', background: '#fff', fontSize: 11, fontWeight: 600, color: '#262626', cursor: 'pointer' }}>Edit</button>
          <button onClick={() => setConfirm(true)} style={{ padding: '3px 9px', borderRadius: 6, border: '1px solid #E5E5E5', background: '#fff', fontSize: 11, color: '#EF4444', cursor: 'pointer' }}>Delete</button>
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
    onError: (err: any) => setAddError(err?.response?.data?.detail ?? 'Failed.'),
  })

  function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setAddError(null)
    if (!newName.trim() || !newResp || !newRes) { setAddError('All fields are required.'); return }
    if (Number(newResp) <= 0 || Number(newRes) <= 0) { setAddError('Minutes must be positive.'); return }
    createMutation.mutate()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontSize: 13, color: '#737373', margin: 0 }}>One policy per priority. Times in minutes.</p>
        {available.length > 0 && (
          <button onClick={() => { setShowAdd(v => !v); if (available.length) setNewPriority(available[0]) }}
            style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: showAdd ? '#F2F2F2' : 'linear-gradient(135deg, #FF4713, #AD1164)', color: showAdd ? '#737373' : '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            {showAdd ? 'Cancel' : '+ Add Policy'}
          </button>
        )}
      </div>

      {showAdd && (
        <Card style={{ borderTop: '3px solid #FF4713' }}>
          <div style={{ padding: '18px 20px' }}>
            <form onSubmit={handleCreate}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
                {[
                  { lbl: 'Priority', node: <select value={newPriority} onChange={e => setNewPriority(e.target.value as Priority)} style={{ ...inp, cursor: 'pointer', fontWeight: 700, color: PRIORITY_COLORS[newPriority] }}>{available.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}</select> },
                  { lbl: 'Name', node: <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. High Priority SLA" style={inp} /> },
                  { lbl: 'First Response (min)', node: <input type="number" min="1" value={newResp} onChange={e => setNewResp(e.target.value)} placeholder="60" style={inp} /> },
                  { lbl: 'Resolution (min)', node: <input type="number" min="1" value={newRes} onChange={e => setNewRes(e.target.value)} placeholder="480" style={inp} /> },
                ].map(({ lbl, node }) => (
                  <div key={lbl}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#737373', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{lbl}</label>
                    {node}
                  </div>
                ))}
              </div>
              {addError && <p style={{ fontSize: 12, color: '#EF4444', marginTop: 8 }}>{addError}</p>}
              <button type="submit" disabled={createMutation.isPending} style={{ marginTop: 14, padding: '7px 18px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg, #FF4713, #AD1164)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {createMutation.isPending ? 'Creating…' : 'Create Policy'}
              </button>
            </form>
          </div>
        </Card>
      )}

      <Card>
        {isLoading ? (
          <div style={{ padding: '24px' }}>{[1, 2, 3, 4].map(i => <div key={i} style={{ height: 42, borderRadius: 7, background: '#F2F2F2', marginBottom: 8, animation: 'shimmer 1.5s ease-in-out infinite' }} />)}</div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#A3A3A3', fontSize: 13 }}>No SLA policies configured.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #F2F2F2' }}>
                {['Priority', 'Name', 'First Response', 'Resolution', ''].map(h => (
                  <th key={h} style={{ padding: '8px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#A3A3A3', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(p => <SLARow key={p.id} policy={p} onDelete={() => qc.invalidateQueries({ queryKey: ['sla-policies'] })} />)}
            </tbody>
          </table>
        )}
        {existing.size === 4 && <p style={{ fontSize: 12, color: '#A3A3A3', textAlign: 'center', padding: '8px 0 12px' }}>All four priority levels configured.</p>}
      </Card>
    </div>
  )
}

// ── Statuses tab ──────────────────────────────────────────────────────────────

const BLANK_STATUS: StatusForm = { name: '', label: '', color: '#737373', pauses_sla: false, is_default: false, is_resolved_state: false, sort_order: 0 }
const PRESET_COLORS = ['#3B82F6', '#FF4713', '#F59E0B', '#10B981', '#737373', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1']

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} style={{ width: 32, height: 18, borderRadius: 9, border: 'none', cursor: 'pointer', background: checked ? '#10B981' : '#E5E5E5', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
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
    onError: (err: any) => setError(err?.response?.data?.detail ?? 'Save failed'),
  })

  const archiveMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/ticket-statuses/${id}`),
    onSuccess: invalidate,
    onError: (err: any) => setError(err?.response?.data?.detail ?? 'Failed'),
  })

  const patchMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: object }) => api.patch(`/admin/ticket-statuses/${id}`, patch),
    onSuccess: invalidate,
  })

  const active = statuses.filter(s => !s.is_archived)
  const archived = statuses.filter(s => s.is_archived)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Table */}
      <Card>
        <CardHeader><SectionLabel>Active Statuses</SectionLabel></CardHeader>
        {isLoading ? (
          <div style={{ padding: '24px' }}>{[1,2,3].map(i => <div key={i} style={{ height: 42, borderRadius: 7, background: '#F2F2F2', marginBottom: 8, animation: 'shimmer 1.5s ease-in-out infinite' }} />)}</div>
        ) : active.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#A3A3A3', fontSize: 13 }}>No statuses yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #F2F2F2' }}>
                {['Colour', 'Slug', 'Label', 'Pauses SLA', 'Default', 'Resolved', 'Order', ''].map(h => (
                  <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#A3A3A3', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {active.map(s => (
                <tr key={s.id} onMouseOver={e => (e.currentTarget.style.background = '#FAFAFA')} onMouseOut={e => (e.currentTarget.style.background = 'transparent')} style={{ borderBottom: '1px solid #F9F9F9' }}>
                  <td style={{ padding: '10px 14px' }}><span style={{ display: 'inline-block', width: 22, height: 22, borderRadius: 5, background: s.color, border: '1px solid rgba(0,0,0,0.08)' }} /></td>
                  <td style={{ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#737373' }}>{s.name}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: s.color }}>{s.label}</td>
                  <td style={{ padding: '10px 14px' }}><Toggle checked={s.pauses_sla} onChange={v => patchMutation.mutate({ id: s.id, patch: { pauses_sla: v } })} /></td>
                  <td style={{ padding: '10px 14px' }}><Toggle checked={s.is_default} onChange={v => patchMutation.mutate({ id: s.id, patch: { is_default: v } })} /></td>
                  <td style={{ padding: '10px 14px' }}><Toggle checked={s.is_resolved_state} onChange={v => patchMutation.mutate({ id: s.id, patch: { is_resolved_state: v } })} /></td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: '#737373' }}>{s.sort_order}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => { setEditId(s.id); setForm({ name: s.name, label: s.label, color: s.color, pauses_sla: s.pauses_sla, is_default: s.is_default, is_resolved_state: s.is_resolved_state, sort_order: s.sort_order }); setError(null) }}
                        style={{ padding: '3px 9px', borderRadius: 5, border: '1px solid rgba(0,0,0,0.12)', background: 'none', fontSize: 11, fontWeight: 600, color: '#0A0A0A', cursor: 'pointer' }}>Edit</button>
                      {!s.is_default && (
                        <button onClick={() => archiveMutation.mutate(s.id)}
                          style={{ padding: '3px 9px', borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'none', fontSize: 11, fontWeight: 600, color: '#EF4444', cursor: 'pointer' }}>Archive</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Create / edit form */}
      <Card>
        <CardHeader><SectionLabel>{editId !== null ? 'Edit Status' : 'New Status'}</SectionLabel></CardHeader>
        <div style={{ padding: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            {[
              { lbl: 'Slug', hint: 'Lowercase + underscores. Cannot change after creation.', node: <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))} disabled={editId !== null} placeholder="e.g. waiting_vendor" style={{ ...inp, opacity: editId !== null ? 0.5 : 1 }} /> },
              { lbl: 'Display Label', node: <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Waiting on Vendor" style={inp} /> },
              { lbl: 'Colour', node: (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} style={{ width: 36, height: 32, padding: 2, border: '1px solid #E5E5E5', borderRadius: 6, cursor: 'pointer' }} />
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {PRESET_COLORS.map(c => <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))} style={{ width: 20, height: 20, borderRadius: 4, background: c, border: 'none', cursor: 'pointer', outline: form.color === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }} />)}
                  </div>
                </div>
              )},
              { lbl: 'Sort Order', node: <input type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))} style={{ ...inp, width: 80 }} /> },
            ].map(({ lbl, hint, node }: any) => (
              <div key={lbl}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#737373', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{lbl}</label>
                {node}
                {hint && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#A3A3A3' }}>{hint}</p>}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
            {[
              { key: 'pauses_sla', title: 'Pauses SLA', hint: 'SLA clock stops while in this status' },
              { key: 'is_default', title: 'Default status', hint: 'Applied to newly created tickets' },
              { key: 'is_resolved_state', title: 'Resolved state', hint: 'Tickets re-open on new Slack reply' },
            ].map(({ key, title, hint }) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))} style={{ accentColor: '#FF4713' }} />
                <div><div style={{ fontWeight: 600 }}>{title}</div><div style={{ fontSize: 11, color: '#737373' }}>{hint}</div></div>
              </label>
            ))}
          </div>

          {error && <div style={{ marginBottom: 12, fontSize: 13, color: '#EF4444' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => saveMutation.mutate()} disabled={!form.label || (!editId && !form.name) || saveMutation.isPending}
              style={{ background: saveMutation.isPending ? '#F2F2F2' : '#0A0A0A', color: saveMutation.isPending ? '#A3A3A3' : '#fff', border: 'none', borderRadius: 7, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {saveMutation.isPending ? 'Saving…' : editId !== null ? 'Save changes' : 'Create status'}
            </button>
            {editId !== null && (
              <button onClick={() => { setEditId(null); setForm(BLANK_STATUS); setError(null) }}
                style={{ background: 'none', border: '1px solid #E5E5E5', borderRadius: 7, padding: '8px 14px', fontSize: 13, cursor: 'pointer', color: '#737373' }}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Archived */}
      {archived.length > 0 && (
        <Card>
          <CardHeader><SectionLabel>Archived Statuses</SectionLabel></CardHeader>
          <div style={{ padding: '12px 20px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {archived.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#F9F9F9', border: '1px solid #E5E5E5', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, display: 'inline-block' }} />
                <span style={{ color: '#737373' }}>{s.label}</span>
                <button onClick={() => patchMutation.mutate({ id: s.id, patch: { is_archived: false } })}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#3B82F6', padding: 0, marginLeft: 4 }}>
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
      setRestoreError(err?.response?.data?.detail ?? 'Restore failed.')
    } finally { setRestoring(false) }
  }

  function pickFile(f: File | undefined) {
    if (f) { setFile(f); setRestoreResult(null); setRestoreError(null) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 680 }}>
      {/* Export */}
      <Card>
        <CardHeader><SectionLabel>Export Backup</SectionLabel></CardHeader>
        <div style={{ padding: '20px' }}>
          <p style={{ fontSize: 13, color: '#737373', margin: '0 0 16px', lineHeight: 1.6 }}>
            Downloads a <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, background: '#F2F2F2', padding: '1px 5px', borderRadius: 4 }}>.zip</code> with all tickets, replies, users, categories, SLA policies, settings, and attachments. Slack credentials and JWT secret are excluded.
          </p>
          <button onClick={handleDownload} disabled={downloading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: 8, border: 'none', background: downloading ? '#F2F2F2' : '#0A0A0A', color: downloading ? '#A3A3A3' : '#fff', fontSize: 13, fontWeight: 600, cursor: downloading ? 'not-allowed' : 'pointer' }}
            onMouseOver={e => { if (!downloading) e.currentTarget.style.background = '#1F1F1F' }}
            onMouseOut={e => { if (!downloading) e.currentTarget.style.background = '#0A0A0A' }}>
            {downloading ? <><Spin />&nbsp;Preparing…</> : <>↓ Download backup</>}
          </button>
          {downloadError && <p style={{ margin: '8px 0 0', fontSize: 13, color: '#EF4444' }}>{downloadError}</p>}
        </div>
      </Card>

      {/* Restore */}
      <Card>
        <CardHeader><SectionLabel>Restore from Backup</SectionLabel></CardHeader>
        <div style={{ padding: '20px' }}>
          <div style={{ background: '#FEF2F2', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 18, fontSize: 13, color: '#991B1B', lineHeight: 1.6 }}>
            ⚠ <strong>This permanently overwrites all data.</strong> Slack credentials and the JWT secret are not affected — re-enter them after restore.
          </div>
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f?.name.endsWith('.zip')) pickFile(f) }}
            onClick={() => fileInputRef.current?.click()}
            style={{ border: `2px dashed ${dragOver ? '#FF4713' : file ? '#22C55E' : '#E5E5E5'}`, borderRadius: 10, padding: '28px 20px', textAlign: 'center', cursor: 'pointer', background: dragOver ? 'rgba(255,71,19,0.02)' : file ? 'rgba(34,197,94,0.02)' : '#FAFAFA', transition: 'all 0.15s', marginBottom: 16 }}>
            <input ref={fileInputRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={e => pickFile(e.target.files?.[0])} />
            {file ? (
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0A0A0A' }}>📦 {file.name} <span style={{ fontWeight: 400, color: '#737373' }}>({(file.size / 1024 / 1024).toFixed(2)} MB) — click to change</span></div>
            ) : (
              <div style={{ fontSize: 13, color: '#737373' }}>Drop a <strong>.zip</strong> backup here or click to browse</div>
            )}
          </div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginBottom: 16 }}>
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} style={{ marginTop: 2, accentColor: '#FF4713' }} />
            <span style={{ fontSize: 13, color: '#0A0A0A', lineHeight: 1.5 }}>I understand all current data will be permanently overwritten and cannot be recovered.</span>
          </label>
          <button onClick={handleRestore} disabled={!file || !confirmed || restoring}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: 8, border: 'none', background: (!file || !confirmed || restoring) ? '#F2F2F2' : '#DC2626', color: (!file || !confirmed || restoring) ? '#A3A3A3' : '#fff', fontSize: 13, fontWeight: 600, cursor: (!file || !confirmed || restoring) ? 'not-allowed' : 'pointer' }}
            onMouseOver={e => { if (file && confirmed && !restoring) e.currentTarget.style.background = '#B91C1C' }}
            onMouseOut={e => { if (file && confirmed && !restoring) e.currentTarget.style.background = '#DC2626' }}>
            {restoring ? <><Spin color="#A3A3A3" />&nbsp;Restoring…</> : 'Restore from backup'}
          </button>
          {restoreResult && <div style={{ marginTop: 14, background: '#F0FDF4', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#166534' }}>Restore complete. {restoreResult.restored_files} attachment file{restoreResult.restored_files !== 1 ? 's' : ''} restored. Reload to see updated data.</div>}
          {restoreError && <div style={{ marginTop: 14, background: '#FEF2F2', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#991B1B' }}>{restoreError}</div>}
        </div>
      </Card>
    </div>
  )
}

function Spin({ color = '#fff' }: { color?: string }) {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 0.8s linear infinite' }}><path d="M7 1a6 6 0 1 1-4.24 1.76" /></svg>
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
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Something went wrong'
      setErrorMsg(msg)
      setStatus('error')
    }
  }

  const eyeIcon = (visible: boolean) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {visible
        ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>
        : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
      }
    </svg>
  )

  return (
    <div style={{ maxWidth: 420 }}>
      <Card>
        <CardHeader><SectionLabel>Change Password</SectionLabel></CardHeader>
        <form onSubmit={handleSubmit}>
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#737373' }}>Current password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showCurrent ? 'text' : 'password'}
                  value={current}
                  onChange={e => setCurrent(e.target.value)}
                  autoComplete="current-password"
                  style={{ ...inp, paddingRight: 36 }}
                />
                <button type="button" onClick={() => setShowCurrent(v => !v)}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#A3A3A3', padding: 2, display: 'flex' }}>
                  {eyeIcon(showCurrent)}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#737373' }}>New password <span style={{ fontWeight: 400, color: '#A3A3A3' }}>(min 8 characters)</span></label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showNext ? 'text' : 'password'}
                  value={next}
                  onChange={e => setNext(e.target.value)}
                  autoComplete="new-password"
                  style={{ ...inp, paddingRight: 36 }}
                />
                <button type="button" onClick={() => setShowNext(v => !v)}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#A3A3A3', padding: 2, display: 'flex' }}>
                  {eyeIcon(showNext)}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#737373' }}>Confirm new password</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                autoComplete="new-password"
                style={{ ...inp, borderColor: mismatch ? '#EF4444' : undefined }}
              />
              {mismatch && <span style={{ fontSize: 12, color: '#EF4444' }}>Passwords don't match</span>}
            </div>

            {status === 'error' && (
              <div style={{ background: '#FEF2F2', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 7, padding: '8px 12px', fontSize: 13, color: '#991B1B' }}>
                {errorMsg}
              </div>
            )}
            {status === 'ok' && (
              <div style={{ background: '#F0FDF4', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 7, padding: '8px 12px', fontSize: 13, color: '#166534' }}>
                Password updated successfully.
              </div>
            )}

            <button type="submit" disabled={!canSubmit}
              style={{
                padding: '9px 20px', borderRadius: 8, border: 'none', alignSelf: 'flex-start',
                background: canSubmit ? 'linear-gradient(135deg, #FF4713, #AD1164)' : '#F2F2F2',
                color: canSubmit ? '#fff' : '#A3A3A3',
                fontSize: 13, fontWeight: 600, cursor: canSubmit ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', gap: 7,
              }}>
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
  const tab = (searchParams.get('tab') as Tab) ?? defaultTab
  function setTab(t: Tab) { setSearchParams({ tab: t }, { replace: true }) }

  return (
    <AppShell title="Settings">
      <div style={{ maxWidth: 1100, padding: '28px 32px' }}>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #E5E5E5', marginBottom: 24 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: '8px 16px', borderRadius: '6px 6px 0 0', border: 'none',
                background: 'none',
                borderBottom: tab === t.id ? '2px solid #FF4713' : '2px solid transparent',
                fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
                color: tab === t.id ? '#FF4713' : '#737373',
                cursor: 'pointer', transition: 'color 0.15s', marginBottom: -1,
              }}>
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
      <style>{`@keyframes shimmer{0%,100%{opacity:1}50%{opacity:.4}} @keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </AppShell>
  )
}
