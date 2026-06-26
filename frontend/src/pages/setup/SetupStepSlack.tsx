import { useState } from 'react'
import api from '../../lib/api'

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
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || 'Failed to save Slack settings')
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
    <div style={{ maxWidth: 540, width: '100%' }}>
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 28, fontWeight: 700, color: '#fff', letterSpacing: '-0.025em', marginBottom: 8 }}>
          Connect Slack
        </h2>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>
          Create your Slack app in 3 steps using the manifest below — no manual configuration needed.
        </p>
      </div>

      {/* 3-step manifest guide */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>

        {/* Step 1 */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#FF4713', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Step 1</div>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', margin: '0 0 10px' }}>
            Copy the manifest and open the Slack App Console.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={copyManifest}
              style={{
                height: 34, padding: '0 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
                background: copied ? 'rgba(74,222,128,0.1)' : 'rgba(255,255,255,0.06)',
                color: copied ? '#4ADE80' : 'rgba(255,255,255,0.7)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {copied ? '✓ Copied' : 'Copy manifest'}
            </button>
            <a
              href="https://api.slack.com/apps?new_app=1"
              target="_blank"
              rel="noreferrer"
              style={{
                height: 34, padding: '0 14px', borderRadius: 8,
                background: 'linear-gradient(135deg, #FF4713 0%, #AD1164 100%)',
                color: '#fff', fontSize: 12, fontWeight: 600,
                display: 'inline-flex', alignItems: 'center', textDecoration: 'none',
              }}
            >
              Open Slack App Console →
            </a>
          </div>
        </div>

        {/* Step 2 */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#FF4713', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Step 2</div>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', margin: '0 0 10px', lineHeight: 1.6 }}>
            Click <strong style={{ color: '#fff' }}>Create New App</strong> → <strong style={{ color: '#fff' }}>From a manifest</strong> → select your workspace → paste the manifest → <strong style={{ color: '#fff' }}>Next</strong> → <strong style={{ color: '#fff' }}>Create</strong>. Then in the left sidebar go to <strong style={{ color: '#fff' }}>Settings → Install App</strong> → <strong style={{ color: '#fff' }}>Install to Workspace</strong> → Allow.
          </p>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', margin: 0, lineHeight: 1.6 }}>
            Then go to <strong style={{ color: '#fff' }}>Basic Information</strong> → <strong style={{ color: '#fff' }}>App-Level Tokens</strong> → <strong style={{ color: '#fff' }}>Generate Token and Scopes</strong> → name it anything → add scope <strong style={{ color: '#fff', fontFamily: 'monospace' }}>connections:write</strong> → <strong style={{ color: '#fff' }}>Generate</strong>. Copy the <strong style={{ color: '#fff' }}>xapp-…</strong> token.
          </p>
        </div>

        {/* Step 3 */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#FF4713', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Step 3</div>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', margin: '0 0 6px', lineHeight: 1.6 }}>
            Copy your tokens into the fields below:
          </p>
          <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {[
              'Bot Token (xoxb-…) — OAuth & Permissions → OAuth Tokens',
              'App-Level Token (xapp-…) — Basic Information → App-Level Tokens',
              'Signing Secret — Basic Information → App Credentials',
            ].map(t => (
              <li key={t} style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', fontFamily: 'JetBrains Mono, monospace' }}>{t}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* Token fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Field label="Bot Token" hint="Starts with xoxb-">
          <input value={botToken} onChange={e => setBotToken(e.target.value)} placeholder="xoxb-…" style={inputStyle} onFocus={focusStyle} onBlur={blurStyle} />
        </Field>

        <Field label="App-Level Token" hint="Socket Mode — starts with xapp-">
          <input value={appToken} onChange={e => setAppToken(e.target.value)} placeholder="xapp-…" style={inputStyle} onFocus={focusStyle} onBlur={blurStyle} />
        </Field>

        <Field label="Signing Secret" hint="From Basic Information → App Credentials">
          <input value={signingSecret} onChange={e => setSigningSecret(e.target.value)} placeholder="••••••••" type="password" style={inputStyle} onFocus={focusStyle} onBlur={blurStyle} />
        </Field>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !botToken || !appToken}
            style={{
              height: 38, paddingLeft: 18, paddingRight: 18,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 10, cursor: testing || !botToken ? 'not-allowed' : 'pointer',
              fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)',
              opacity: !botToken || !appToken ? 0.5 : 1,
            }}
          >
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          {testResult && (
            <span style={{ fontSize: 13, color: testResult.ok ? '#4ADE80' : '#FCA5A5' }}>
              {testResult.ok ? `✓ Connected to ${testResult.team_name}` : `✗ ${testResult.error}`}
            </span>
          )}
        </div>

        <details style={{ marginTop: 4 }}>
          <summary style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', cursor: 'pointer', userSelect: 'none', marginBottom: 16 }}>
            Advanced options
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 4 }}>
            <Field label="Trigger emoji" hint="The reaction that creates a ticket (without colons)">
              <input value={triggerEmoji} onChange={e => setTriggerEmoji(e.target.value)} placeholder="clipboard" style={{ ...inputStyle, maxWidth: 180 }} onFocus={focusStyle} onBlur={blurStyle} />
            </Field>
            <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
              <div
                onClick={() => setTwoWaySync(v => !v)}
                style={{
                  width: 44, height: 24, borderRadius: 12, cursor: 'pointer', flexShrink: 0,
                  background: twoWaySync ? 'linear-gradient(135deg, #FF4713 0%, #AD1164 100%)' : 'rgba(255,255,255,0.1)',
                  position: 'relative', transition: 'background 0.2s',
                }}
              >
                <div style={{
                  position: 'absolute', top: 3, left: twoWaySync ? 23 : 3,
                  width: 18, height: 18, borderRadius: '50%', background: '#fff',
                  transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                }} />
              </div>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
                Two-way sync (web replies → Slack threads, and vice versa)
              </span>
            </label>
          </div>
        </details>

        {error && (
          <div style={{ padding: '12px 16px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, fontSize: 13, color: '#FCA5A5' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button
            type="button"
            onClick={() => onNext(false, '')}
            style={{
              flex: 1, height: 52, borderRadius: 14, border: '1px solid rgba(255,255,255,0.12)',
              background: 'transparent', cursor: 'pointer',
              fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.5)',
            }}
          >
            Skip for now
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !botToken || !appToken}
            style={{
              flex: 2, height: 52, borderRadius: 14, border: 'none',
              cursor: saving || !botToken || !appToken ? 'not-allowed' : 'pointer',
              background: (!botToken || !appToken) ? 'rgba(255,71,19,0.4)' : 'linear-gradient(135deg, #FF4713 0%, #AD1164 100%)',
              fontSize: 15, fontWeight: 700, color: '#fff',
              boxShadow: saving ? 'none' : '0 4px 20px rgba(255,71,19,0.3)',
            }}
          >
            {saving ? 'Saving…' : 'Save & continue →'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.6)' }}>{label}</label>
        {hint && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 46, borderRadius: 12,
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.12)',
  color: '#fff', fontSize: 13, padding: '0 14px',
  outline: 'none', boxSizing: 'border-box',
  fontFamily: 'JetBrains Mono, monospace',
}

function focusStyle(e: React.FocusEvent<HTMLInputElement>) {
  e.target.style.borderColor = '#FF4713'
  e.target.style.boxShadow = '0 0 0 3px rgba(255,71,19,0.15)'
}

function blurStyle(e: React.FocusEvent<HTMLInputElement>) {
  e.target.style.borderColor = 'rgba(255,255,255,0.12)'
  e.target.style.boxShadow = 'none'
}
