import { useState } from 'react'
import api, { apiErrorMessage } from '../../lib/api'

interface Props {
  onNext: (configured: boolean, teamName: string) => void
}

const MANIFEST = JSON.stringify({
  _metadata: { major_version: 1, minor_version: 1 },
  display_information: {
    name: 'SimpleTickets',
    description: 'Self-hosted IT helpdesk — submit and track support tickets without leaving Slack.',
    background_color: '#111111',
  },
  features: {
    bot_user: { display_name: 'SimpleTickets', always_online: true },
    slash_commands: [{ command: '/ticket', description: 'Submit a support ticket', should_escape: false }],
    app_home: { home_tab_enabled: true, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
    shortcuts: [{ name: 'Create ticket', type: 'message', callback_id: 'create_ticket_from_message', description: 'Turn any Slack message into a support ticket' }],
  },
  oauth_config: {
    scopes: {
      bot: ['chat:write', 'chat:write.public', 'im:write', 'im:history', 'channels:history', 'groups:history', 'reactions:read', 'files:read', 'files:write', 'users:read', 'commands'],
    },
  },
  settings: {
    event_subscriptions: { bot_events: ['app_home_opened', 'message.channels', 'message.groups', 'message.im', 'reaction_added'] },
    interactivity: { is_enabled: true },
    org_deploy_enabled: false,
    socket_mode_enabled: true,
    token_rotation_enabled: false,
  },
}, null, 2)

function StepCard({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="so-block" style={{ marginBottom: 0 }}>
      <div className="bl">Step {n}</div>
      {children}
    </div>
  )
}

export default function SetupStepSlack({ onNext }: Props) {
  const [botToken, setBotToken] = useState('')
  const [appToken, setAppToken] = useState('')
  const [signingSecret, setSigningSecret] = useState('')
  const [triggerEmoji, setTriggerEmoji] = useState('clipboard')
  const [twoWaySync, setTwoWaySync] = useState(true)
  const [copied, setCopied] = useState(false)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; team_name?: string; error?: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleTest() {
    if (!botToken || !appToken) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await api.post('/setup/test-slack', { bot_token: botToken, app_token: appToken })
      setTestResult(res.data)
    } catch {
      setTestResult({ ok: false, error: 'Request failed' })
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    setError('')
    setSaving(true)
    try {
      await api.post('/setup/slack', {
        bot_token: botToken,
        app_token: appToken,
        signing_secret: signingSecret,
        trigger_emoji: triggerEmoji || 'clipboard',
        two_way_sync: twoWaySync,
      })
      onNext(true, testResult?.team_name || '')
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Failed to save Slack settings'))
    } finally {
      setSaving(false)
    }
  }

  function copyManifest() {
    navigator.clipboard.writeText(MANIFEST)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="login-card w-full" style={{ maxWidth: 560 }}>
      <h1>Connect Slack</h1>
      <p className="sub">Create your Slack app in 3 steps using the manifest below — no manual configuration needed.</p>

      {/* 3-step manifest guide */}
      <div className="flex flex-col gap-3 mb-6">
        <StepCard n={1}>
          <p className="text-[13px] text-ink-2 m-0 mb-2.5">Copy the manifest and open the Slack App Console.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={copyManifest}
              className="btn ghost sm"
              style={copied ? { color: 'var(--brand-ink)' } : undefined}
            >
              {copied ? '✓ Copied' : 'Copy manifest'}
            </button>
            <a href="https://api.slack.com/apps?new_app=1" target="_blank" rel="noreferrer" className="btn sm" style={{ textDecoration: 'none' }}>
              Open Slack App Console
            </a>
          </div>
        </StepCard>

        <StepCard n={2}>
          <p className="text-[13px] text-ink-2 m-0 mb-2 leading-relaxed">
            Click <strong className="text-ink">Create New App</strong> → <strong className="text-ink">From a manifest</strong> → select your workspace → paste the manifest → <strong className="text-ink">Next</strong> → <strong className="text-ink">Create</strong>. Then in the left sidebar go to <strong className="text-ink">Settings → Install App</strong> → <strong className="text-ink">Install to Workspace</strong> → Allow.
          </p>
          <p className="text-[13px] text-ink-2 m-0 leading-relaxed">
            Then go to <strong className="text-ink">Basic Information</strong> → <strong className="text-ink">App-Level Tokens</strong> → <strong className="text-ink">Generate Token and Scopes</strong> → name it anything → add scope <strong className="text-ink font-mono text-[12px]">connections:write</strong> → <strong className="text-ink">Generate</strong>. Copy the <strong className="text-ink font-mono text-[12px]">xapp-…</strong> token.
          </p>
        </StepCard>

        <StepCard n={3}>
          <p className="text-[13px] text-ink-2 m-0 mb-1.5 leading-relaxed">Copy your tokens into the fields below:</p>
          <ul className="m-0 pl-4 flex flex-col gap-1">
            {[
              'Bot token (xoxb-…) — OAuth & Permissions → OAuth Tokens',
              'App-level token (xapp-…) — Basic Information → App-Level Tokens',
              'Signing secret — Basic Information → App Credentials',
            ].map(t => (
              <li key={t} className="font-mono text-[11px] text-ink-3">{t}</li>
            ))}
          </ul>
        </StepCard>
      </div>

      {/* Token fields */}
      <div className="fieldrow">
        <label htmlFor="slack-bot">Bot token <span className="font-normal text-ink-3">starts with xoxb-</span></label>
        <input id="slack-bot" className="input font-mono" value={botToken} onChange={e => setBotToken(e.target.value)} placeholder="xoxb-…" />
      </div>

      <div className="fieldrow">
        <label htmlFor="slack-app">App-level token <span className="font-normal text-ink-3">Socket Mode — starts with xapp-</span></label>
        <input id="slack-app" className="input font-mono" value={appToken} onChange={e => setAppToken(e.target.value)} placeholder="xapp-…" />
      </div>

      <div className="fieldrow">
        <label htmlFor="slack-secret">Signing secret <span className="font-normal text-ink-3">Basic Information → App Credentials</span></label>
        <input id="slack-secret" className="input font-mono" value={signingSecret} onChange={e => setSigningSecret(e.target.value)} placeholder="••••••••" type="password" />
      </div>

      <div className="flex items-center gap-3 mb-4">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing || !botToken || !appToken}
          className="btn ghost sm"
          style={(!botToken || !appToken) ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
        >
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        {testResult && (
          <span className={`text-[13px] ${testResult.ok ? 'text-brand-ink' : 'text-danger-ink'}`}>
            {testResult.ok ? `✓ Connected to ${testResult.team_name}` : `✗ ${testResult.error}`}
          </span>
        )}
      </div>

      <details className="mb-4">
        <summary className="text-[13px] text-ink-2 cursor-pointer select-none mb-3">Advanced options</summary>
        <div className="flex flex-col gap-1 pt-1">
          <div className="fieldrow">
            <label htmlFor="slack-emoji">Trigger emoji <span className="font-normal text-ink-3">reaction that creates a ticket, without colons</span></label>
            <input id="slack-emoji" className="input font-mono" value={triggerEmoji} onChange={e => setTriggerEmoji(e.target.value)} placeholder="clipboard" style={{ maxWidth: 180 }} />
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <div
              onClick={() => setTwoWaySync(v => !v)}
              role="switch"
              aria-checked={twoWaySync}
              style={{
                width: 44, height: 24, borderRadius: 12, cursor: 'pointer', flexShrink: 0,
                background: twoWaySync ? 'var(--brand-grad)' : 'var(--track)',
                position: 'relative', transition: 'background 0.2s',
              }}
            >
              <div style={{
                position: 'absolute', top: 3, left: twoWaySync ? 23 : 3,
                width: 18, height: 18, borderRadius: '50%', background: '#fff',
                transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
              }} />
            </div>
            <span className="text-[13px] text-ink-2">
              Two-way sync (web replies → Slack threads, and vice versa)
            </span>
          </label>
        </div>
      </details>

      {error && (
        <div
          role="alert"
          className="rounded-control px-4 py-3 mb-4 text-[13px] text-danger-ink"
          style={{ background: 'var(--danger-bg)' }}
        >
          {error}
        </div>
      )}

      <div className="flex gap-3 mt-2">
        <button type="button" className="btn ghost" style={{ flex: 1 }} onClick={() => onNext(false, '')}>
          Skip for now
        </button>
        <button
          type="button"
          className="btn"
          style={{ flex: 2, ...((saving || !botToken || !appToken) ? { opacity: 0.6, cursor: 'not-allowed' } : {}) }}
          onClick={handleSave}
          disabled={saving || !botToken || !appToken}
        >
          {saving ? 'Saving…' : 'Save & continue'}
        </button>
      </div>
    </div>
  )
}
