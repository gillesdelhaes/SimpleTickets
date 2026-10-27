import { useState, useRef } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AppShell from '../../components/layout/AppShell'
import { useAuth } from '../../contexts/AuthContext'
import api, { apiErrorMessage } from '../../lib/api'
import { parseUTC } from '../../types/ticket'
import { useAgents, type UserRead } from '../../hooks/useAgents'
import RichText from '../../components/RichText'

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'general' | 'tickets' | 'slack' | 'google' | 'ai' | 'backup' | 'health'

const ADMIN_TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'tickets', label: 'Tickets' },
  { id: 'slack', label: 'Slack' },
  { id: 'google', label: 'Google Workspace' },
  { id: 'ai', label: 'AI assistant' },
  { id: 'backup', label: 'Backup & restore' },
  { id: 'health', label: 'Data health' },
]

type Priority = 'low' | 'medium' | 'high' | 'critical'

interface SettingRead { key: string; value: string | null; is_secret: boolean; group_name: string }
interface CategoryRead { id: number; name: string; is_archived: boolean; created_at: string }
interface SLAPolicyRead { id: number; name: string; priority: Priority; first_response_minutes: number; resolution_minutes: number }
interface StatusRow { id: number; name: string; label: string; color: string; pauses_sla: boolean; is_default: boolean; is_resolved_state: boolean; sends_csat: boolean; sort_order: number; is_archived: boolean }
interface StatusForm { name: string; label: string; color: string; pauses_sla: boolean; is_default: boolean; is_resolved_state: boolean; sends_csat: boolean; sort_order: number }

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
  const csatDays = get('csat_auto_close_days', '7')

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

// Only the SLA clock uses business hours, so they sit with the SLA policies
function BusinessHoursCard() {
  const { data, isLoading } = useSettingsQuery()
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const mutation = useSaveMutation(() => { setEdits({}); setSaved(true); setTimeout(() => setSaved(false), 2000) })

  if (isLoading) return <div className="text-[13px] text-ink-3">Loading…</div>

  const sm = Object.fromEntries((data?.settings ?? []).map(s => [s.key, s.value ?? '']))
  function get(key: string, def: string) { return key in edits ? edits[key] : (sm[key] || def) }
  function set(key: string, val: string) { setEdits(e => ({ ...e, [key]: val })) }

  const bizEnabled = get('business_hours_enabled', 'false') === 'true'
  const bizStart = get('business_hours_start', '09:00')
  const bizEnd = get('business_hours_end', '17:00')
  const bizDaysStr = get('business_days', '0,1,2,3,4')
  const bizDays = new Set(bizDaysStr.split(',').map(d => d.trim()).filter(Boolean).map(Number))

  function toggleDay(d: number) {
    const next = new Set(bizDays)
    if (next.has(d)) next.delete(d); else next.add(d)
    set('business_days', [...next].sort((a, b) => a - b).join(',') || '')
  }

  const dirty = Object.keys(edits).length > 0

  return (
    <Card>
      <CardHeader>
        <SectionLabel>Business hours</SectionLabel>
        {saved && <span className="ml-auto"><Saved /></span>}
      </CardHeader>

      <SettingRow label="Count business hours only" hint="When on, SLA deadlines only count time within working hours, in the timezone set under General" last={!bizEnabled}>
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

      <SaveBar dirty={dirty} pending={mutation.isPending} onSave={() => mutation.mutate(Object.entries(edits).map(([key, value]) => ({ key, value })))} />
    </Card>
  )
}

// ── Slack tab ────────────────────────────────────────────────────────────────
// One deployment can connect several Slack workspaces at once — each ticket
// carries the workspace it came from, and replies/DMs route back through
// that workspace's own bot automatically.

interface WorkspaceRead {
  id: number
  name: string
  team_id: string | null
  team_name: string | null
  bot_token: string | null
  app_token: string | null
  signing_secret: string | null
  trigger_emoji: string
  two_way_sync: boolean
  sla_escalation_target: string | null
  ticket_created_target: string | null
  is_active: boolean
  online: boolean
}

function useWorkspacesQuery() {
  return useQuery<WorkspaceRead[]>({
    queryKey: ['admin-slack-workspaces'],
    queryFn: async () => (await api.get<WorkspaceRead[]>('/admin/slack-workspaces')).data,
    refetchInterval: 15_000, // connection status changes in the background
  })
}

function SlackTab() {
  const { data: workspaces, isLoading } = useWorkspacesQuery()
  const { data: agents } = useAgents()
  const [showAdd, setShowAdd] = useState(false)
  const [showGuide, setShowGuide] = useState(false)

  if (isLoading) return <div className="text-[13px] text-ink-3">Loading…</div>

  const list = workspaces ?? []

  return (
    <div className="flex flex-col gap-4">
      {list.map(ws => (
        <WorkspaceCard key={ws.id} workspace={ws} agents={agents ?? []} />
      ))}

      {list.length === 0 && !showAdd && (
        <Card>
          <div className="px-6 py-10 text-center">
            <p className="text-[13px] text-ink-2 m-0 mb-4">No Slack workspaces connected yet.</p>
            <button className="btn" onClick={() => setShowAdd(true)}>Connect a workspace</button>
          </div>
        </Card>
      )}

      {showAdd ? (
        <AddWorkspaceForm onDone={() => setShowAdd(false)} onCancel={() => setShowAdd(false)} />
      ) : list.length > 0 && (
        <button
          className="btn ghost sm"
          style={{ alignSelf: 'flex-start', color: 'var(--brand-ink)' }}
          onClick={() => setShowAdd(true)}
        >
          + Add workspace
        </button>
      )}

      {/* Setup guide */}
      <Card>
        <button
          onClick={() => setShowGuide(v => !v)}
          className="flex items-center gap-2 w-full bg-transparent border-0 cursor-pointer text-[13px] font-medium text-ink-2 hover:text-ink"
          style={{ padding: '14px 22px', textAlign: 'left' }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transition: 'transform 0.2s', transform: showGuide ? 'rotate(90deg)' : 'none' }}>
            <path d="M4 2l4 4-4 4" />
          </svg>
          {showGuide ? 'Hide' : 'Show'} Slack app setup guide
        </button>
        {showGuide && (
          <div style={{ padding: '2px 22px 20px', borderTop: '1px solid var(--track)' }}>
            <p className="text-[12px] text-ink-3 mt-3 mb-0 leading-relaxed">
              Each workspace connection is its own Slack app — repeat these steps once per workspace you connect.
            </p>
            <SlackGuide />
          </div>
        )}
      </Card>
    </div>
  )
}

const WORKSPACE_TOKEN_FIELDS: { key: 'bot_token' | 'app_token' | 'signing_secret'; label: string; hint: string; placeholder: string }[] = [
  { key: 'bot_token',      label: 'Bot token',       hint: 'Starts with xoxb-',                        placeholder: 'xoxb-…'   },
  { key: 'app_token',      label: 'App-level token', hint: 'Socket Mode — starts with xapp-',          placeholder: 'xapp-…'   },
  { key: 'signing_secret', label: 'Signing secret',  hint: 'From Basic Information → App Credentials', placeholder: '••••••••' },
]

// Sends a real test message to a channel/person ID so a typo or a private
// channel the bot hasn't been invited to is caught immediately, instead of
// failing silently in the logs the next time it's actually needed.
function TestTargetButton({ workspaceId, target }: { workspaceId: number; target: string }) {
  const [state, setState] = useState<{ ok: boolean; error?: string } | null>(null)
  const [pending, setPending] = useState(false)

  async function run() {
    setPending(true); setState(null)
    try {
      const result = (await api.post(`/admin/slack-workspaces/${workspaceId}/test-target`, { target })).data
      setState(result)
    }
    catch { setState({ ok: false, error: 'Request failed' }) }
    finally { setPending(false) }
  }

  return (
    <div className="flex items-center gap-2">
      <button type="button" className="btn ghost sm" disabled={!target.trim() || pending} onClick={run}>
        {pending ? 'Sending…' : 'Send test message'}
      </button>
      {state && (
        <span className={`text-[12px] ${state.ok ? 'text-ok-ink' : 'text-danger-ink'}`}>
          {state.ok ? '✓ Delivered' : `✗ ${state.error}`}
        </span>
      )}
    </div>
  )
}

function WorkspaceCard({ workspace, agents }: { workspace: WorkspaceRead; agents: UserRead[] }) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [revealing, setRevealing] = useState<Record<string, boolean>>({})
  const [renaming, setRenaming] = useState(false)
  const [nameValue, setNameValue] = useState(workspace.name)
  const [testResult, setTestResult] = useState<{ ok: boolean; team_name?: string; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [escalationModeOverride, setEscalationModeOverride] = useState<'all' | 'person' | 'channel' | null>(null)
  const [notifyModeOverride, setNotifyModeOverride] = useState<'off' | 'channel' | null>(null)

  const patchMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch<WorkspaceRead>(`/admin/slack-workspaces/${workspace.id}`, body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-slack-workspaces'] })
      qc.invalidateQueries({ queryKey: ['slack-workspace-options'] })
      setEdits({}); setRevealing({}); setEscalationModeOverride(null); setNotifyModeOverride(null)
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    },
  })

  function getValue(key: string, fallback: string) { return key in edits ? edits[key] : fallback }
  function edit(key: string, value: string) { setEdits(e => ({ ...e, [key]: value })) }
  const dirty = Object.keys(edits).length > 0

  // Slack IDs are workspace-specific — only agents linked *in this workspace*
  // are eligible for its escalation-target picker.
  const eligibleAgents = agents.filter(a => a.slack_identities.some(i => i.workspace_id === workspace.id))
  function slackIdFor(a: UserRead) { return a.slack_identities.find(i => i.workspace_id === workspace.id)?.slack_user_id ?? '' }

  const escalationValue = getValue('sla_escalation_target', workspace.sla_escalation_target ?? '')
  const serverEscalationMode: 'all' | 'person' | 'channel' =
    !escalationValue ? 'all' : eligibleAgents.some(a => slackIdFor(a) === escalationValue) ? 'person' : 'channel'
  const escalationMode = escalationModeOverride ?? serverEscalationMode

  const notifyValue = getValue('ticket_created_target', workspace.ticket_created_target ?? '')
  const notifyMode = notifyModeOverride ?? (notifyValue ? 'channel' : 'off')

  function setNotifyMode(mode: 'off' | 'channel') {
    setNotifyModeOverride(mode)
    if (mode === 'off') edit('ticket_created_target', '')
  }

  function setEscalationMode(mode: 'all' | 'person' | 'channel') {
    setEscalationModeOverride(mode)
    if (mode === 'all') edit('sla_escalation_target', '')
  }

  async function handleTest() {
    setTesting(true); setTestResult(null)
    try {
      const result = (await api.post(`/admin/slack-workspaces/${workspace.id}/test`)).data
      setTestResult(result)
    }
    catch { setTestResult({ ok: false, error: 'Request failed' }) }
    finally { setTesting(false) }
  }

  function commitRename() {
    const v = nameValue.trim()
    setRenaming(false)
    if (v && v !== workspace.name) patchMutation.mutate({ name: v })
    else setNameValue(workspace.name)
  }

  return (
    <Card>
      <CardHeader>
        <button
          onClick={() => setExpanded(v => !v)}
          className="bg-transparent border-0 cursor-pointer p-0 flex-shrink-0"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="text-ink-3" style={{ transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'none' }}>
            <path d="M4 2l4 4-4 4" />
          </svg>
        </button>
        {renaming ? (
          <input
            autoFocus
            className="input"
            style={{ width: 'auto', maxWidth: 220, padding: '5px 10px', fontSize: 14.5, fontWeight: 650 }}
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') { setNameValue(workspace.name); setRenaming(false) }
            }}
          />
        ) : (
          <h2
            onClick={() => setRenaming(true)}
            title="Click to rename"
            style={{ margin: 0, fontSize: 14.5, fontWeight: 650, cursor: 'pointer' }}
            className="hover:text-brand-ink"
          >
            {workspace.name}
          </h2>
        )}
        {workspace.team_name && <span className="pill avail">{workspace.team_name}</span>}
        <span className={`pill ${!workspace.is_active ? 'retired' : workspace.online ? 'use' : 'danger'}`}>
          {!workspace.is_active ? 'Inactive' : workspace.online ? 'Connected' : 'Disconnected'}
        </span>
        <div className="flex gap-2 items-center ml-auto">
          {saved && <Saved />}
          <SettingSwitch on={workspace.is_active} onChange={v => patchMutation.mutate({ is_active: v })} />
        </div>
      </CardHeader>

      {expanded && (
        <>
          <div className="flex gap-2 items-center" style={{ padding: '10px 22px', borderBottom: '1px solid var(--track)' }}>
            <button className="btn ghost sm" onClick={handleTest} disabled={testing}>
              {testing ? 'Testing…' : 'Test connection'}
            </button>
            {testResult && (
              <span className={`text-[12px] ${testResult.ok ? 'text-ok-ink' : 'text-danger-ink'}`}>
                {testResult.ok ? `✓ Connected to ${testResult.team_name}` : `✗ ${testResult.error}`}
              </span>
            )}
          </div>

          {WORKSPACE_TOKEN_FIELDS.map(({ key, label, hint, placeholder }) => {
            const isRevealing = revealing[key] ?? false
            const hasValue = Boolean(workspace[key])
            const val = getValue(key, '')

            return (
              <div
                key={key}
                className="border-b border-track"
                style={{ padding: '14px 22px', display: 'grid', gridTemplateColumns: '220px 1fr auto', gap: 16, alignItems: 'center' }}
              >
                <div>
                  <div className="text-[13.5px] font-semibold text-ink">{label}</div>
                  <div className="text-[12px] text-ink-3 mt-0.5">{hint}</div>
                </div>
                <div>
                  {hasValue && !isRevealing ? (
                    <span className="font-mono text-[13px] text-ink-3">{workspace[key]}</span>
                  ) : (
                    <input
                      className="input font-mono"
                      value={val}
                      type="password"
                      onChange={e => edit(key, e.target.value)}
                      placeholder={placeholder}
                    />
                  )}
                </div>
                <div style={{ width: 60, textAlign: 'right' }}>
                  {hasValue && !isRevealing && (
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

          <div className="border-b border-track" style={{ padding: '14px 22px', display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, alignItems: 'center' }}>
            <div>
              <div className="text-[13.5px] font-semibold text-ink">Trigger emoji</div>
              <div className="text-[12px] text-ink-3 mt-0.5">Reaction name that creates a ticket</div>
            </div>
            <input
              className="input"
              style={{ maxWidth: 220 }}
              value={getValue('trigger_emoji', workspace.trigger_emoji)}
              onChange={e => edit('trigger_emoji', e.target.value)}
              placeholder="clipboard"
            />
          </div>

          <div className="border-b border-track" style={{ padding: '14px 22px', display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, alignItems: 'center' }}>
            <div>
              <div className="text-[13.5px] font-semibold text-ink">Two-way sync</div>
              <div className="text-[12px] text-ink-3 mt-0.5">Sync web replies to this workspace's Slack threads and vice versa</div>
            </div>
            <SettingSwitch
              on={getValue('two_way_sync', String(workspace.two_way_sync)) !== 'false'}
              onChange={v => edit('two_way_sync', v ? 'true' : 'false')}
            />
          </div>

          <div style={{ padding: '14px 22px', display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, alignItems: 'start' }}>
            <div>
              <div className="text-[13.5px] font-semibold text-ink">Escalate SLA breaches to</div>
              <div className="text-[12px] text-ink-3 mt-0.5">Who gets DMed when a ticket in this workspace is close to (or past) its SLA deadline</div>
            </div>
            <div className="flex flex-col gap-2.5">
              <div className="selectwrap" style={{ maxWidth: 320 }}>
                <select
                  className="select"
                  value={escalationMode}
                  onChange={e => setEscalationMode(e.target.value as 'all' | 'person' | 'channel')}
                >
                  <option value="all">All active technicians</option>
                  <option value="person">A specific person</option>
                  <option value="channel">A Slack channel</option>
                </select>
              </div>

              {escalationMode === 'person' && (
                <div className="selectwrap" style={{ maxWidth: 320 }}>
                  <select
                    className="select"
                    value={eligibleAgents.some(a => slackIdFor(a) === escalationValue) ? escalationValue : ''}
                    onChange={e => edit('sla_escalation_target', e.target.value)}
                  >
                    <option value="" disabled>Choose a person…</option>
                    {eligibleAgents.map(a => (
                      <option key={a.id} value={slackIdFor(a)}>{a.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {escalationMode === 'person' && eligibleAgents.length === 0 && (
                <p className="text-[12px] text-ink-3 m-0">
                  No technicians have a Slack ID linked in this workspace yet — add one under Admin → Users.
                </p>
              )}

              {escalationMode === 'channel' && (
                <>
                  <input
                    className="input font-mono"
                    style={{ maxWidth: 320 }}
                    value={eligibleAgents.some(a => slackIdFor(a) === escalationValue) ? '' : escalationValue}
                    onChange={e => edit('sla_escalation_target', e.target.value)}
                    placeholder="C0123456789"
                  />
                  <p className="text-[12px] text-ink-3 m-0">
                    The channel's ID (not its name) — find it in Slack via the channel name → "View channel details".
                  </p>
                </>
              )}

              {escalationMode !== 'all' && escalationValue.trim() && (
                <TestTargetButton workspaceId={workspace.id} target={escalationValue} />
              )}
            </div>
          </div>

          <div style={{ padding: '14px 22px', display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, alignItems: 'start' }}>
            <div>
              <div className="text-[13.5px] font-semibold text-ink">Announce new tickets to</div>
              <div className="text-[12px] text-ink-3 mt-0.5">Posts a message (ticket ID, priority, category — no requester name or description) whenever a ticket is created in this workspace</div>
            </div>
            <div className="flex flex-col gap-2.5">
              <div className="selectwrap" style={{ maxWidth: 320 }}>
                <select
                  className="select"
                  value={notifyMode}
                  onChange={e => setNotifyMode(e.target.value as 'off' | 'channel')}
                >
                  <option value="off">Off</option>
                  <option value="channel">A Slack channel</option>
                </select>
              </div>

              {notifyMode === 'channel' && (
                <>
                  <input
                    className="input font-mono"
                    style={{ maxWidth: 320 }}
                    value={notifyValue}
                    onChange={e => edit('ticket_created_target', e.target.value)}
                    placeholder="C0123456789"
                  />
                  <p className="text-[12px] text-ink-3 m-0">
                    The channel's ID (not its name) — the bot must be invited to it.
                  </p>
                  {notifyValue.trim() && <TestTargetButton workspaceId={workspace.id} target={notifyValue} />}
                </>
              )}
            </div>
          </div>

          <SaveBar
            dirty={dirty}
            pending={patchMutation.isPending}
            onSave={() => patchMutation.mutate(edits)}
          />
        </>
      )}
    </Card>
  )
}

function AddWorkspaceForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [botToken, setBotToken] = useState('')
  const [appToken, setAppToken] = useState('')
  const [signingSecret, setSigningSecret] = useState('')
  const [triggerEmoji, setTriggerEmoji] = useState('clipboard')
  const [twoWaySync, setTwoWaySync] = useState(true)
  const [testResult, setTestResult] = useState<{ ok: boolean; team_name?: string; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: () => api.post('/admin/slack-workspaces', {
      name: name.trim() || testResult?.team_name || 'New workspace',
      bot_token: botToken,
      app_token: appToken,
      signing_secret: signingSecret,
      trigger_emoji: triggerEmoji.trim() || 'clipboard',
      two_way_sync: twoWaySync,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-slack-workspaces'] })
      // The lightweight list (My account, Users, ticket modal) caches for 5 min.
      qc.invalidateQueries({ queryKey: ['slack-workspace-options'] })
      onDone()
    },
    onError: (err: any) => setError(apiErrorMessage(err, 'Failed to connect workspace')),
  })

  async function handleTest() {
    if (!botToken) return
    setTesting(true); setTestResult(null)
    try {
      const result = (await api.post('/admin/slack-workspaces/test', { bot_token: botToken })).data
      setTestResult(result)
      if (result.ok && !name.trim() && result.team_name) setName(result.team_name)
    }
    catch { setTestResult({ ok: false, error: 'Request failed' }) }
    finally { setTesting(false) }
  }

  return (
    <Card>
      <CardHeader><SectionLabel>Connect a workspace</SectionLabel></CardHeader>
      <div style={{ padding: '18px 22px' }}>
        <div className="fieldrow">
          <label htmlFor="ws-name">Name</label>
          <input id="ws-name" className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Acme Corp" />
        </div>
        <div className="fieldrow">
          <label htmlFor="ws-bot">Bot token <span className="font-normal text-ink-3">starts with xoxb-</span></label>
          <input id="ws-bot" className="input font-mono" value={botToken} onChange={e => setBotToken(e.target.value)} placeholder="xoxb-…" type="password" />
        </div>
        <div className="fieldrow">
          <label htmlFor="ws-app">App-level token <span className="font-normal text-ink-3">Socket Mode — starts with xapp-</span></label>
          <input id="ws-app" className="input font-mono" value={appToken} onChange={e => setAppToken(e.target.value)} placeholder="xapp-…" type="password" />
        </div>
        <div className="fieldrow">
          <label htmlFor="ws-secret">Signing secret <span className="font-normal text-ink-3">Basic Information → App Credentials</span></label>
          <input id="ws-secret" className="input font-mono" value={signingSecret} onChange={e => setSigningSecret(e.target.value)} placeholder="••••••••" type="password" />
        </div>
        <div className="fieldrow">
          <label htmlFor="ws-emoji">Trigger emoji</label>
          <input id="ws-emoji" className="input font-mono" style={{ maxWidth: 200 }} value={triggerEmoji} onChange={e => setTriggerEmoji(e.target.value)} placeholder="clipboard" />
        </div>
        <label className="flex items-center gap-3 cursor-pointer mb-4">
          <SettingSwitch on={twoWaySync} onChange={setTwoWaySync} />
          <span className="text-[13px] text-ink-2">Two-way sync (web replies → Slack threads, and vice versa)</span>
        </label>

        <div className="flex items-center gap-3 mb-4">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !botToken}
            className="btn ghost sm"
            style={!botToken ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          {testResult && (
            <span className={`text-[13px] ${testResult.ok ? 'text-ok-ink' : 'text-danger-ink'}`}>
              {testResult.ok ? `✓ Connected to ${testResult.team_name}` : `✗ ${testResult.error}`}
            </span>
          )}
        </div>

        {error && (
          <div className="rounded-control px-3 py-2 mb-4 text-[13px] text-danger-ink" style={{ background: 'var(--danger-bg)' }}>
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => createMutation.mutate()}
            disabled={!botToken || !appToken || createMutation.isPending}
            className="btn"
            style={(!botToken || !appToken) ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            {createMutation.isPending ? 'Connecting…' : 'Connect workspace'}
          </button>
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </Card>
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
      bot: ["chat:write", "chat:write.public", "im:write", "im:history", "channels:history", "groups:history", "reactions:read", "files:read", "files:write", "users:read", "users:read.email", "commands"],
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

// ── Google Workspace tab ──────────────────────────────────────────────────────
// One Google Cloud OAuth client powers both Sign in with Google and the
// support mailbox. The client ID alone turns on sign-in; the mailbox also
// needs the secret. The ID is public, so it lives in /admin/settings; the
// secret is stored encrypted and written through /admin/email.

function GoogleClientCard() {
  const qc = useQueryClient()
  const settings = useSettingsQuery()
  const email = useQuery<EmailChannel>({
    queryKey: ['admin-email'],
    queryFn: async () => (await api.get<EmailChannel>('/admin/email')).data,
  })
  const [clientId, setClientId] = useState<string | null>(null)
  const [secret, setSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (settings.isLoading || email.isLoading || !email.data) return <div className="text-[13px] text-ink-3">Loading…</div>

  const savedId = settings.data?.settings.find(s => s.key === 'google_client_id')?.value ?? ''
  const idValue = clientId ?? savedId
  const dirty = (clientId !== null && clientId !== savedId) || secret.trim() !== ''
  const signInOn = savedId.trim() !== ''
  const mail = email.data

  async function save() {
    setSaving(true); setError(null)
    try {
      if (clientId !== null && clientId !== savedId) {
        await api.patch('/admin/settings', { settings: [{ key: 'google_client_id', value: clientId }] })
      }
      if (secret.trim()) {
        await api.patch('/admin/email', { client_secret: secret.trim() })
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['admin-settings'] }),
        qc.invalidateQueries({ queryKey: ['admin-email'] }),
      ])
      setClientId(null); setSecret('')
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(apiErrorMessage(err, 'Saving failed.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <SectionLabel>Google OAuth client</SectionLabel>
        {saved && <span className="ml-auto"><Saved /></span>}
      </CardHeader>

      <SettingRow
        label="Client ID"
        hint="From Google Cloud console → Google Auth Platform → Clients (a Web application client). Public, not a secret. Clear to turn off Google."
      >
        <input
          className="input font-mono"
          style={{ maxWidth: 420, fontSize: 12 }}
          value={idValue}
          onChange={e => setClientId(e.target.value.trim())}
          placeholder="1234567890-abc123.apps.googleusercontent.com"
        />
      </SettingRow>

      <SettingRow label="Client secret" hint="From the same client. Only the Gmail mailbox needs it. Stored encrypted.">
        <input
          className="input font-mono"
          type="password"
          autoComplete="off"
          style={{ maxWidth: 420, fontSize: 12 }}
          value={secret}
          onChange={e => setSecret(e.target.value)}
          placeholder={mail.client_secret_set ? '•••••••• (saved — type to replace)' : 'GOCSPX-…'}
        />
      </SettingRow>

      <SettingRow label="Sign in with Google" hint="On whenever a client ID is set. Only accounts created with the Google sign-in method (Users) can use it." last>
        <span className={`pill ${signInOn ? 'use' : 'retired'}`} style={{ justifySelf: 'start' }}>{signInOn ? 'On — login page shows a Google button' : 'Off — needs a client ID'}</span>
      </SettingRow>

      {error && <div className="px-5 pb-3 text-[12.5px] text-danger-ink">{error}</div>}
      <SaveBar dirty={dirty} pending={saving} onSave={save} />
    </Card>
  )
}

// The support mailbox: one Workspace user (e.g. help@) that SimpleTickets
// reads every 30 s and replies from, through the OAuth client above.

interface EmailChannel {
  google_client_id_set: boolean
  client_secret_set: boolean
  connected: boolean
  address: string | null
  enabled: boolean
  sender_name: string
  last_poll_at: string | null
  last_error: string | null
  slack_lookup: 'ok' | 'missing_scope' | null
}

const GMAIL_CALLBACK_PATH = '/api/email/oauth/callback'

function secondsAgo(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - parseUTC(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  return parseUTC(iso).toLocaleString()
}

function GoogleWorkspaceTab() {
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data, isLoading } = useQuery<EmailChannel>({
    queryKey: ['admin-email'],
    queryFn: async () => (await api.get<EmailChannel>('/admin/email')).data,
    refetchInterval: 30_000,
  })
  const [senderName, setSenderName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState<boolean | null>(null)

  // Back from Google: show the outcome once, then tidy the URL
  const flash = searchParams.get('gmail') === 'connected' ? 'connected' : null
  const flashError = searchParams.get('gmail_error')
  function clearFlash() {
    const next = new URLSearchParams(searchParams)
    next.delete('gmail'); next.delete('gmail_error')
    setSearchParams(next, { replace: true })
  }

  const redirectUri = window.location.origin + GMAIL_CALLBACK_PATH

  async function run(label: string, fn: () => Promise<EmailChannel | void>) {
    setBusy(label); setError(null)
    try {
      const result = await fn()
      if (result) qc.setQueryData(['admin-email'], result)
    } catch (err) {
      setError(apiErrorMessage(err, 'Something went wrong.'))
    } finally {
      setBusy(null)
    }
  }

  function save() {
    run('save', async () => {
      const r = (await api.patch<EmailChannel>('/admin/email', { sender_name: senderName })).data
      setSenderName(null)
      return r
    })
  }

  function connect() {
    run('connect', async () => {
      const { url } = (await api.post<{ url: string }>('/admin/email/connect', { redirect_uri: redirectUri })).data
      window.location.assign(url)
    })
  }

  if (isLoading || !data) return <div className="text-[13px] text-ink-3">Loading…</div>

  const dirty = senderName !== null && senderName !== data.sender_name
  const canConnect = data.google_client_id_set && data.client_secret_set
  const guideOpen = showGuide ?? !(data.connected && data.google_client_id_set)

  return (
    <div className="flex flex-col gap-4">
      {(flash || flashError) && (
        <div
          className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-block text-[13px] ${flash ? 'text-ok-ink' : 'text-danger-ink'}`}
          style={{ background: flash ? 'var(--ok-bg)' : 'var(--danger-bg)' }}
        >
          <span>{flash ? `Mailbox connected. New mail to ${data.address ?? 'it'} now becomes tickets.` : flashError}</span>
          <button className="btn ghost sm" onClick={clearFlash}>Dismiss</button>
        </div>
      )}

      <GoogleClientCard />

      <Card>
        <CardHeader>
          <SectionLabel>Support mailbox</SectionLabel>
          {data.connected && (
            <span className={`pill ${data.enabled ? 'use' : 'retired'}`}>{data.enabled ? 'Connected' : 'Paused'}</span>
          )}
        </CardHeader>

        <SettingRow
          label="Mailbox"
          hint="Mail sent to this address becomes a ticket; replies to its emails land on that ticket. Technicians' replies are sent from it."
        >
          {data.connected ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[13px] text-ink">{data.address}</span>
              <button className="btn ghost sm" disabled={busy !== null} onClick={() => run('check', async () => (await api.post<EmailChannel>('/admin/email/check')).data)}>
                {busy === 'check' ? <Spin /> : 'Check now'}
              </button>
              <button
                className="btn ghost sm"
                disabled={busy !== null}
                onClick={() => run('pause', async () => (await api.patch<EmailChannel>('/admin/email', { enabled: !data.enabled })).data)}
              >
                {data.enabled ? 'Pause' : 'Resume'}
              </button>
              <button
                className="btn ghost sm text-danger-ink"
                disabled={busy !== null}
                onClick={() => {
                  if (window.confirm(`Disconnect ${data.address}? New mail will stop becoming tickets, and replies on email tickets won't be sent.`)) {
                    run('disconnect', async () => (await api.post<EmailChannel>('/admin/email/disconnect')).data)
                  }
                }}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <button className="btn" disabled={!canConnect || busy !== null} onClick={connect}>
                {busy === 'connect' ? 'Opening Google…' : 'Connect Gmail'}
              </button>
              {!canConnect && (
                <span className="text-[12px] text-ink-3">
                  {data.google_client_id_set ? 'Add the client secret above first.' : 'Fill in the client ID and secret above first.'}
                </span>
              )}
            </div>
          )}
        </SettingRow>

        {data.connected && (
          <SettingRow label="Last check" hint="The mailbox is checked every 30 seconds.">
            <div className="text-[13px]">
              <span className="text-ink-2">{data.last_poll_at ? secondsAgo(data.last_poll_at) : 'Not yet'}</span>
              {data.last_error && <div className="text-danger-ink mt-1">{data.last_error}</div>}
            </div>
          </SettingRow>
        )}

        <SettingRow label="Sender name" hint="Shown after the technician's name, e.g. “Sam (IT Support)”. Acknowledgements and status emails use it alone." last>
          <input
            className="input"
            style={{ maxWidth: 280 }}
            maxLength={100}
            value={senderName ?? data.sender_name}
            onChange={e => setSenderName(e.target.value)}
          />
        </SettingRow>

        {error && <div className="px-5 pb-3 text-[12.5px] text-danger-ink">{error}</div>}
        <SaveBar dirty={dirty} pending={busy === 'save'} onSave={save} />
      </Card>

      {data.slack_lookup === 'missing_scope' && (
        <div className="px-4 py-3 rounded-block text-[13px] text-warn-ink leading-relaxed" style={{ background: 'var(--warn-bg)' }}>
          <strong>Email senders can't be matched to Slack users yet.</strong>{' '}
          In the Slack App Console, open your app → <strong>OAuth &amp; Permissions</strong> → Bot Token Scopes →
          add <Code>users:read.email</Code>, then <strong>Reinstall to Workspace</strong>. Technicians can still link people by hand on each ticket.
        </div>
      )}

      <Card>
        <button
          onClick={() => setShowGuide(!guideOpen)}
          className="flex items-center gap-2 w-full bg-transparent border-0 cursor-pointer text-[13px] font-medium text-ink-2 hover:text-ink"
          style={{ padding: '14px 22px', textAlign: 'left' }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transition: 'transform 0.2s', transform: guideOpen ? 'rotate(90deg)' : 'none' }}>
            <path d="M4 2l4 4-4 4" />
          </svg>
          {guideOpen ? 'Hide' : 'Show'} Google setup guide
        </button>
        {guideOpen && (
          <div style={{ padding: '2px 22px 20px', borderTop: '1px solid var(--track)' }}>
            <GoogleGuide redirectUri={redirectUri} />
          </div>
        )}
      </Card>
    </div>
  )
}

function GuideStep({ n, title, children, last }: { n: number; title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex gap-3.5${last ? '' : ' mb-4'}`}>
      <StepDot n={n} />
      <div className="flex-1">
        <p className="text-[14px] font-semibold text-ink m-0 mb-1.5">{title}</p>
        {children}
      </div>
    </div>
  )
}

function CopyLine({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-lg" style={{ background: '#0A0C10', border: '1px solid var(--edge)' }}>
      <span className="font-mono text-[12px] flex-1 break-all" style={{ color: 'rgba(255,255,255,0.75)' }}>{value}</span>
      <CopyBtn value={value} />
    </div>
  )
}

function GoogleGuide({ redirectUri }: { redirectUri: string }) {
  const origin = window.location.origin
  return (
    <div className="mt-3" style={{ maxWidth: 720 }}>
      <p className="text-[13px] text-ink-2 mb-5 leading-relaxed">
        Everything happens in one Google Cloud project. Open this page from the address SimpleTickets is normally used at
        before copying the values below — Google matches them exactly.
      </p>

      <GuideStep n={1} title="Keep the app Internal">
        <p className="text-[13px] text-ink-2 m-0 leading-relaxed">
          <strong className="text-ink">Google Auth Platform → Audience</strong>: User type must be <strong className="text-ink">Internal</strong>.
          Only your company's accounts can sign in or connect, and Google's app review doesn't apply.
        </p>
      </GuideStep>

      <GuideStep n={2} title="Create the OAuth client">
        <p className="text-[13px] text-ink-2 m-0 mb-2 leading-relaxed">
          <strong className="text-ink">Google Auth Platform → Clients → Create client</strong>, type <strong className="text-ink">Web application</strong>.
          Under <strong className="text-ink">Authorized JavaScript origins</strong> add:
        </p>
        <CopyLine value={origin} />
        <p className="text-[13px] text-ink-2 m-0 mb-2 leading-relaxed">Under <strong className="text-ink">Authorized redirect URIs</strong> add:</p>
        <CopyLine value={redirectUri} />
        <p className="text-[13px] text-ink-2 m-0 leading-relaxed">
          Save, then copy the <strong className="text-ink">Client ID</strong> and <strong className="text-ink">Client secret</strong> into the card at the top of this page.
          Sign in with Google works from here on.
        </p>
      </GuideStep>

      <GuideStep n={3} title="Turn on the Gmail API (mailbox only)">
        <p className="text-[13px] text-ink-2 m-0 mb-2 leading-relaxed">In the same project, open the Gmail API page and click <strong className="text-ink">Enable</strong>.</p>
        <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noreferrer" className="btn ghost sm" style={{ textDecoration: 'none', color: 'var(--brand-ink)' }}>
          Open Gmail API →
        </a>
      </GuideStep>

      <GuideStep n={4} title="Connect the mailbox" last>
        <p className="text-[13px] text-ink-2 m-0 leading-relaxed">
          The mailbox is a normal Workspace user (e.g. <Code>help@</Code>) with a Gmail licence.
          Click <strong className="text-ink">Connect Gmail</strong>, sign in as that account (not your own), and allow access.
          Only mail arriving after this point becomes tickets. Handled mail gets a <Code>SimpleTickets</Code> label in Gmail; nothing is deleted.
        </p>
      </GuideStep>
    </div>
  )
}

// ── Tickets tab ───────────────────────────────────────────────────────────────
// How tickets are sorted and timed: categories, the statuses they move
// through, and the SLA targets (with the business hours those count in).

function TicketsSection({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="m-0 text-[17px] font-semibold text-ink">{title}</h2>
        <p className="m-0 mt-1 text-[13px] text-ink-3">{hint}</p>
      </div>
      {children}
    </section>
  )
}

function TicketsTab() {
  return (
    <div className="flex flex-col gap-10">
      <TicketsSection title="Categories" hint="What a ticket is about. Technicians set it; reports break down by it.">
        <CategoriesTab />
      </TicketsSection>
      <TicketsSection title="Statuses" hint="The stages a ticket moves through, and what each one does to the SLA clock and the CSAT survey.">
        <StatusesTab />
      </TicketsSection>
      <TicketsSection title="SLA" hint="Response and resolution targets per priority, and the hours they count in.">
        <BusinessHoursCard />
        <SLATab />
      </TicketsSection>
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

const BLANK_STATUS: StatusForm = { name: '', label: '', color: '#737373', pauses_sla: false, is_default: false, is_resolved_state: false, sends_csat: false, sort_order: 0 }
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
                  {['Colour', 'Slug', 'Label', 'Pauses SLA', 'Default', 'Resolved', 'Sends CSAT', 'Order', ''].map(h => (
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
                    <td><Toggle checked={s.sends_csat} onChange={v => patchMutation.mutate({ id: s.id, patch: { sends_csat: v } })} /></td>
                    <td><span className="sn">{s.sort_order}</span></td>
                    <td>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => { setEditId(s.id); setForm({ name: s.name, label: s.label, color: s.color, pauses_sla: s.pauses_sla, is_default: s.is_default, is_resolved_state: s.is_resolved_state, sends_csat: s.sends_csat, sort_order: s.sort_order }); setError(null) }}
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
              { key: 'sends_csat', title: 'Sends CSAT survey', hint: 'DMs the submitter 👍/👎 on entry (resolved states only)' },
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

// ── Data health tab ───────────────────────────────────────────────────────────
// Database checks an admin can run from the browser (no DB access needed):
// leftover rows/files, and the Reports overview broken down ticket by ticket.

interface HealthTicket {
  id: number; display_id: string; title: string; status: string; resolved: boolean
  created_at: string; resolved_at: string | null; sla_deadline: string | null
  sla: 'met' | 'missed' | 'excluded'; sla_reason: string
  csat_answers: number; csat_positive: number
  resolution_hours: number | null; closed_hours: number
}
interface HealthRead {
  db_version: string | null
  counts: Record<string, number>
  leftovers: Record<string, number>
  missing_files: number
  report: {
    from: string; to: string
    tickets: HealthTicket[]
    totals: { tickets: number; sla_counted: number; sla_met: number; sla_compliance_pct: number | null; csat_total: number; csat_positive: number; avg_resolution_hours: number | null }
  }
}

const LEFTOVER_LABELS: Record<string, string> = {
  csat_answers: 'Survey answers', history: 'History entries', replies: 'Replies', attachments: 'Attachment records',
  notifications: 'Notifications', read_markers: 'Read markers', unused_files: 'Unused files on disk',
}

function DataHealthTab() {
  const qc = useQueryClient()
  const { data, isLoading, isError, refetch, isFetching } = useQuery<HealthRead>({
    queryKey: ['admin-health'],
    queryFn: async () => (await api.get('/admin/maintenance/health')).data,
    staleTime: 0,
  })
  const [result, setResult] = useState<Record<string, number> | null>(null)
  const cleanup = useMutation({
    mutationFn: async () => (await api.post<{ removed: Record<string, number> }>('/admin/maintenance/cleanup')).data,
    onSuccess: d => {
      setResult(d.removed)
      qc.invalidateQueries({ queryKey: ['admin-health'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
    },
  })

  if (isLoading) return <p className="text-[13px] text-ink-3">Checking the database…</p>
  if (isError || !data) return <p className="text-[13px] text-danger-ink">Couldn't run the check.</p>

  const leftoverTotal = Object.values(data.leftovers).reduce((a, b) => a + b, 0)
  const t = data.report.totals
  const fmt = (d: string | null) => d ? parseUTC(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—'
  const slaPill = (r: HealthTicket) =>
    r.sla === 'met' ? 'pill ok' : r.sla === 'missed' ? 'pill danger' : 'pill retired'

  return (
    <div className="flex flex-col gap-4" style={{ maxWidth: 980 }}>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 w-full">
            <SectionLabel>Database check</SectionLabel>
            <button className="btn ghost sm" onClick={() => { setResult(null); refetch() }} disabled={isFetching}>
              {isFetching ? 'Checking…' : 'Run again'}
            </button>
          </div>
        </CardHeader>
        <div style={{ padding: '16px 22px' }} className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-ink-2">
            <span>Database version <b className="font-mono text-ink">{data.db_version ?? '—'}</b></span>
            <span>Tickets <b className="text-ink">{data.counts.tickets}</b></span>
            <span>Replies <b className="text-ink">{data.counts.replies}</b></span>
            <span>Survey answers <b className="text-ink">{data.counts.csat_answers}</b></span>
            <span>Attachments <b className="text-ink">{data.counts.attachments}</b></span>
          </div>

          {leftoverTotal === 0 ? (
            <div className="rounded-control px-3 py-2.5 text-[13px] text-ok-ink" style={{ background: 'var(--ok-bg)' }}>
              ✓ No leftovers — every row belongs to an existing ticket and every stored file is in use.
            </div>
          ) : (
            <div className="rounded-control px-3 py-2.5 text-[13px] text-warn-ink flex flex-col gap-2" style={{ background: 'var(--warn-bg)' }}>
              <span>Found data that no longer belongs to any ticket:</span>
              <ul className="m-0 pl-5">
                {Object.entries(data.leftovers).filter(([, n]) => n > 0).map(([k, n]) => (
                  <li key={k}>{LEFTOVER_LABELS[k] ?? k}: <b>{n}</b></li>
                ))}
              </ul>
              <div>
                <button className="btn sm" onClick={() => cleanup.mutate()} disabled={cleanup.isPending}>
                  {cleanup.isPending ? 'Cleaning up…' : `Clean up ${leftoverTotal} item${leftoverTotal > 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          )}
          {data.missing_files > 0 && (
            <p className="m-0 text-[12.5px] text-warn-ink">
              {data.missing_files} attachment{data.missing_files > 1 ? 's point' : ' points'} to a file that's missing on disk (can't be repaired here).
            </p>
          )}
          {result && (
            <p className="m-0 text-[12.5px] text-ok-ink font-semibold">
              ✓ Removed {Object.values(result).reduce((a, b) => a + b, 0)} item(s). Logged in the audit log.
            </p>
          )}
          {cleanup.isError && <p className="m-0 text-[12.5px] text-danger-ink">{apiErrorMessage(cleanup.error, 'Cleanup failed.')}</p>}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div className="w-full">
            <SectionLabel>Reports overview, ticket by ticket</SectionLabel>
            <p className="m-0 mt-1 text-[12.5px] text-ink-3">
              Tickets created {fmt(data.report.from)} – {fmt(data.report.to)} (the Reports page's default last 30 days).
              These totals should match the Reports overview.
            </p>
          </div>
        </CardHeader>
        <div style={{ padding: '14px 22px' }} className="flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-ink-2">
          <span>Tickets <b className="text-ink">{t.tickets}</b></span>
          <span>SLA compliance <b className="text-ink">{t.sla_compliance_pct ?? '—'}{t.sla_compliance_pct != null ? '%' : ''}</b> ({t.sla_met} met of {t.sla_counted} counted)</span>
          <span>Survey answers <b className="text-ink">{t.csat_total}</b> ({t.csat_positive} 👍)</span>
          <span>Avg time to resolve <b className="text-ink">{t.avg_resolution_hours ?? '—'}{t.avg_resolution_hours != null ? 'h' : ''}</b></span>
        </div>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>{['Ticket', 'Status', 'Created', 'Resolved', 'Time to resolve', 'SLA deadline', 'SLA', 'Survey'].map(h => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {data.report.tickets.length === 0 ? (
                <tr><td colSpan={8} className="text-ink-3 text-center" style={{ padding: 28 }}>No tickets in this period.</td></tr>
              ) : data.report.tickets.map(r => (
                <tr key={r.id}>
                  <td>
                    <span className="font-mono text-[11px] text-ink-3">{r.display_id}</span>
                    <span className="block text-[12.5px] text-ink truncate" style={{ maxWidth: 220 }}>{r.title}</span>
                  </td>
                  <td className="text-[12.5px]">{r.status}</td>
                  <td className="font-mono text-[11px] text-ink-2">{fmt(r.created_at)}</td>
                  <td className="font-mono text-[11px] text-ink-2">{fmt(r.resolved_at)}</td>
                  <td className="text-[12px] text-ink-2">
                    {r.resolution_hours != null ? `${r.resolution_hours}h` : '—'}
                    {r.closed_hours > 0 && <span className="block text-[11px] text-ink-3">excl. {r.closed_hours}h closed</span>}
                  </td>
                  <td className="font-mono text-[11px] text-ink-2">{fmt(r.sla_deadline)}</td>
                  <td>
                    <span className={slaPill(r)}>{r.sla}</span>
                    <span className="block text-[11px] text-ink-3 mt-1">{r.sla_reason}</span>
                  </td>
                  <td className="text-[12.5px]">{r.csat_answers ? `${r.csat_positive} 👍 / ${r.csat_answers - r.csat_positive} 👎` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
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

// ── AI assistant tab ──────────────────────────────────────────────────────────
// Provider-agnostic: no provider is preselected and the Assistant stays off
// until one is chosen, tested and switched on. "Load models" asks the provider
// itself, so model names are never hard-coded here.

interface AIProvider { id: string; label: string; needs_key: boolean; needs_base_url: boolean }
interface AISettings {
  enabled: boolean
  provider: string | null
  model: string | null
  base_url: string | null
  api_key_set: boolean
  daily_token_budget: number
  company_context: string
  triage_note: boolean
  configured: boolean
  providers: AIProvider[]
  tokens_today: number
  last_error: string | null
}
interface AITestResult {
  ok: boolean
  error?: string
  note?: string
  model?: string
  input_tokens?: number
  output_tokens?: number
  duration_ms?: number
}
interface AIUsage {
  days: { day: string; input_tokens: number; output_tokens: number; runs: number; failures: number }[]
  recent: { at: string; feature: string; ticket_id: number | null; model: string; tokens: number; duration_ms: number; ok: boolean; error: string | null }[]
}

type AIForm = { provider: string; model: string; base_url: string; api_key: string; company_context: string; daily_token_budget: string; triage_note: boolean }

function AITab() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<AISettings>({
    queryKey: ['admin-ai'],
    queryFn: async () => (await api.get<AISettings>('/admin/ai')).data,
    refetchInterval: 30_000,
  })
  const { data: usage } = useQuery<AIUsage>({
    queryKey: ['admin-ai-usage'],
    queryFn: async () => (await api.get<AIUsage>('/admin/ai/usage')).data,
    refetchInterval: 60_000,
  })
  const [edits, setEdits] = useState<Partial<AIForm>>({})
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [test, setTest] = useState<AITestResult | null>(null)
  const [sampleTitle, setSampleTitle] = useState('')
  const [sampleBody, setSampleBody] = useState('')

  if (isLoading || !data) return <div className="text-[13px] text-ink-3">Loading…</div>

  const form: AIForm = {
    provider: data.provider ?? '',
    model: data.model ?? '',
    base_url: data.base_url ?? '',
    api_key: '',
    company_context: data.company_context,
    daily_token_budget: String(data.daily_token_budget),
    triage_note: data.triage_note,
    ...edits,
  }
  const spec = data.providers.find(p => p.id === form.provider)
  const dirty = Object.keys(edits).length > 0
  function set<K extends keyof AIForm>(k: K, v: AIForm[K]) { setEdits(e => ({ ...e, [k]: v })); setSaved(false) }

  // The connection as currently typed — /models and /test use it unsaved
  const tryBody = {
    provider: form.provider || null,
    model: form.model,
    base_url: form.base_url,
    api_key: form.api_key,
    company_context: form.company_context,
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setError(null)
    try { await fn() } catch (err) { setError(apiErrorMessage(err, 'Something went wrong.')) } finally { setBusy(null) }
  }

  function save() {
    run('save', async () => {
      const body: Record<string, unknown> = {}
      if (edits.provider !== undefined) body.provider = edits.provider
      if (edits.model !== undefined) body.model = edits.model
      if (edits.base_url !== undefined) body.base_url = edits.base_url
      if (edits.api_key) body.api_key = edits.api_key
      if (edits.company_context !== undefined) body.company_context = edits.company_context
      if (edits.daily_token_budget !== undefined) body.daily_token_budget = Math.max(0, parseInt(edits.daily_token_budget, 10) || 0)
      if (edits.triage_note !== undefined) body.triage_note = edits.triage_note
      const r = (await api.patch<AISettings>('/admin/ai', body)).data
      qc.setQueryData(['admin-ai'], r)
      setEdits({}); setSaved(true); setTimeout(() => setSaved(false), 2000)
    })
  }

  function toggle(enabled: boolean) {
    run('toggle', async () => {
      const r = (await api.patch<AISettings>('/admin/ai', { enabled })).data
      qc.setQueryData(['admin-ai'], r)
    })
  }

  const budget = data.daily_token_budget
  const pct = budget ? Math.min(100, Math.round((data.tokens_today / budget) * 100)) : 0

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <SectionLabel>AI assistant</SectionLabel>
          <span className={`pill ${data.enabled ? 'use' : 'retired'}`}>{data.enabled ? 'On' : 'Off'}</span>
        </CardHeader>

        <div className="px-[22px] py-3 text-[12.5px] text-ink-2 leading-relaxed border-b border-track">
          The Assistant writes an internal triage note on every new ticket: a summary, what's missing, and a suggested
          priority and category. It doesn't change tickets or talk to requesters. Ticket text is sent to the provider you
          choose — use a paid plan that doesn't train on your data, or a self-hosted model.
        </div>

        <SettingRow label="Assistant" hint={data.configured ? 'Only tickets created after it is switched on are triaged.' : 'Save a provider and model first.'}>
          <div className="flex items-center gap-3">
            <SettingSwitch on={data.enabled} onChange={v => { if (data.configured || !v) toggle(v) }} />
            {!data.configured && <span className="text-[12px] text-ink-3">Not configured</span>}
          </div>
        </SettingRow>

        <SettingRow label="Provider" hint="Any of these work; there's no default.">
          <div className="selectwrap" style={{ maxWidth: 420 }}>
            <select className="select" value={form.provider} onChange={e => { set('provider', e.target.value); setModels([]) }}>
              <option value="">Choose a provider…</option>
              {data.providers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
        </SettingRow>

        {spec?.needs_base_url && (
          <SettingRow label="Base URL" hint="The server's OpenAI-compatible API, e.g. Ollama at http://ollama:11434/v1">
            <input className="input font-mono" style={{ maxWidth: 420, fontSize: 12 }} value={form.base_url}
              onChange={e => set('base_url', e.target.value.trim())} placeholder="https://…/v1" />
          </SettingRow>
        )}

        {form.provider && (
          <SettingRow label="API key" hint={spec?.needs_key ? 'Stored encrypted. Never shown again.' : 'Optional for local servers. Stored encrypted.'}>
            <div className="flex items-center gap-2 flex-wrap">
              <input className="input font-mono" type="password" autoComplete="off" style={{ maxWidth: 420, fontSize: 12 }}
                value={form.api_key} onChange={e => set('api_key', e.target.value)}
                placeholder={data.api_key_set && form.provider === data.provider ? '•••••••• (saved — type to replace)' : 'Paste the key'} />
              {data.api_key_set && form.provider === data.provider && (
                <button className="btn ghost sm" disabled={busy !== null}
                  onClick={() => run('clear', async () => { qc.setQueryData(['admin-ai'], (await api.patch<AISettings>('/admin/ai', { clear_api_key: true })).data) })}>
                  Remove key
                </button>
              )}
            </div>
          </SettingRow>
        )}

        {form.provider && (
          <SettingRow label="Model" hint="Type a model ID, or load the list your key can use. A fast, inexpensive model is enough for triage.">
            <div className="flex items-center gap-2 flex-wrap">
              <input className="input font-mono" list="ai-models" style={{ maxWidth: 320, fontSize: 12 }} value={form.model}
                onChange={e => set('model', e.target.value.trim())} placeholder="model ID" />
              <datalist id="ai-models">{models.map(m => <option key={m} value={m} />)}</datalist>
              <button className="btn ghost sm" disabled={busy !== null}
                onClick={() => run('models', async () => {
                  const r = (await api.post<{ models: string[] }>('/admin/ai/models', tryBody)).data
                  setModels(r.models)
                  if (r.models.length === 0) setError('The provider returned no models for this key.')
                })}>
                {busy === 'models' ? <Spin /> : 'Load models'}
              </button>
              {models.length > 0 && <span className="text-[12px] text-ink-3">{models.length} available — pick from the field</span>}
            </div>
          </SettingRow>
        )}

        <SettingRow label="About your IT" hint="Optional context so questions fit, e.g. “Google Workspace, Slack, MacBooks managed by Jamf, VPN is Tailscale”.">
          <textarea className="input" rows={3} maxLength={4000} style={{ maxWidth: 520, resize: 'vertical' }}
            value={form.company_context} onChange={e => set('company_context', e.target.value)} />
        </SettingRow>

        <SettingRow label="Triage note" hint="Write the internal note on each new ticket.">
          <SettingSwitch on={form.triage_note} onChange={v => set('triage_note', v)} />
        </SettingRow>

        <SettingRow label="Daily token budget" hint="The Assistant pauses for the rest of the day (UTC) once this many tokens are used. 0 = no limit." last>
          <div className="flex items-center gap-3 flex-wrap">
            <input type="number" className="input" min={0} style={{ width: 140 }} value={form.daily_token_budget}
              onChange={e => set('daily_token_budget', e.target.value)} />
            <span className="text-[12px] text-ink-3">
              Used today: <b className="text-ink-2">{data.tokens_today.toLocaleString()}</b>{budget ? ` (${pct}%)` : ''}
            </span>
          </div>
        </SettingRow>

        {(error || data.last_error) && (
          <div className="px-5 pb-3 text-[12.5px] text-danger-ink">{error ?? `Last problem: ${data.last_error}`}</div>
        )}
        <div className="px-5 py-3 border-t border-track flex items-center justify-end gap-3">
          {saved && <Saved />}
          <button className="btn" onClick={save} disabled={!dirty || busy !== null}
            style={busy === 'save' ? { opacity: 0.7, cursor: 'wait' } : undefined}>
            {busy === 'save' ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </Card>

      <Card>
        <CardHeader><SectionLabel>Try it</SectionLabel></CardHeader>
        <div className="px-[22px] py-4 flex flex-col gap-3">
          <p className="text-[12.5px] text-ink-2 m-0">
            Runs triage on a sample ticket with the settings above (saved or not) and shows the note it would write. Uses a few hundred tokens.
          </p>
          <input className="input" style={{ maxWidth: 520 }} value={sampleTitle} onChange={e => setSampleTitle(e.target.value)}
            placeholder="Title (blank: “laptop not working”)" />
          <textarea className="input" rows={3} style={{ maxWidth: 520, resize: 'vertical' }} value={sampleBody}
            onChange={e => setSampleBody(e.target.value)} placeholder="Description (blank: a deliberately vague one)" />
          <div>
            <button className="btn" disabled={!form.provider || !form.model || busy !== null}
              onClick={() => run('test', async () => {
                setTest(null)
                setTest((await api.post<AITestResult>('/admin/ai/test', { ...tryBody, title: sampleTitle, description: sampleBody })).data)
                qc.invalidateQueries({ queryKey: ['admin-ai-usage'] })
                qc.invalidateQueries({ queryKey: ['admin-ai'] })
              })}>
              {busy === 'test' ? 'Running…' : 'Run test'}
            </button>
          </div>
          {test && !test.ok && <div className="text-[13px] text-danger-ink">{test.error}</div>}
          {test?.ok && (
            <div>
              <div className="rounded-r-[12px] px-3.5 py-2.5 text-[13.5px] text-ink leading-relaxed whitespace-pre-wrap break-words"
                style={{ borderLeft: '3px solid var(--warn-ink)', background: 'var(--warn-bg)', maxWidth: 640 }}>
                <RichText text={test.note ?? ''} />
              </div>
              <div className="font-mono text-[11px] text-ink-3 mt-2">
                {test.model} · {((test.input_tokens ?? 0) + (test.output_tokens ?? 0)).toLocaleString()} tokens · {((test.duration_ms ?? 0) / 1000).toFixed(1)} s
              </div>
            </div>
          )}
        </div>
      </Card>

      {usage && usage.days.length > 0 && (
        <Card>
          <CardHeader><SectionLabel>Usage, last 14 days</SectionLabel></CardHeader>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Day</th><th>Runs</th><th>Tokens</th><th>Failed</th></tr></thead>
              <tbody>
                {[...usage.days].reverse().map(d => (
                  <tr key={d.day}>
                    <td className="font-mono text-[12px]">{d.day}</td>
                    <td>{d.runs}</td>
                    <td>{(d.input_tokens + d.output_tokens).toLocaleString()}</td>
                    <td className={d.failures ? 'text-danger-ink' : ''}>{d.failures}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

function Spin() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin"><path d="M7 1a6 6 0 1 1-4.24 1.76" /></svg>
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Settings() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  // Settings is admin-only; technicians used to reach "My account" here, and
  // a few banners still link here — send them to the account page instead.
  if (user?.role !== 'admin') return <Navigate to="/account" replace />

  // Validate the tab — a bogus or stale deep link (e.g. the old ?tab=account)
  // would otherwise render nothing.
  const rawTab = searchParams.get('tab')
  if (rawTab === 'account') return <Navigate to="/account" replace />
  const tab: Tab = ADMIN_TABS.some(t => t.id === rawTab) ? (rawTab as Tab) : 'general'
  function setTab(t: Tab) { setSearchParams({ tab: t }, { replace: true }) }

  return (
    <AppShell title="Settings">
      <div style={{ maxWidth: 1100 }}>
        {/* Tab bar */}
        <div className="flex gap-1.5 mb-5 flex-wrap">
          {ADMIN_TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`chip${tab === t.id ? ' on' : ''}`}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'general' && <GeneralTab />}
        {tab === 'tickets' && <TicketsTab />}
        {tab === 'slack'   && <SlackTab />}
        {tab === 'google'  && <GoogleWorkspaceTab />}
        {tab === 'ai'      && <AITab />}
        {tab === 'backup'  && <BackupTab />}
        {tab === 'health'     && <DataHealthTab />}
      </div>
    </AppShell>
  )
}
