import { useState } from 'react'
import api from '../../lib/api'

interface Props {
  onNext: (configured: boolean, teamName: string) => void
}

export default function SetupStepSlack({ onNext }: Props) {
  const [botToken, setBotToken] = useState('')
  const [appToken, setAppToken] = useState('')
  const [signingSecret, setSigningSecret] = useState('')
  const [triggerEmoji, setTriggerEmoji] = useState('clipboard')
  const [twoWaySync, setTwoWaySync] = useState(true)

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

  return (
    <div style={{ maxWidth: 540, width: '100%' }}>
      <div style={{ marginBottom: 36 }}>
        <h2 style={{ fontSize: 28, fontWeight: 700, color: '#fff', letterSpacing: '-0.025em', marginBottom: 8 }}>
          Connect Slack
        </h2>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>
          SimplyTickets uses a private Slack app installed in your workspace. You'll need to create one at{' '}
          <span style={{ color: '#FF4713', fontFamily: 'monospace', fontSize: 12 }}>api.slack.com/apps</span>{' '}
          before continuing.
        </p>
      </div>

      {/* Setup guide accordion */}
      <details style={{ marginBottom: 28 }}>
        <summary style={{
          cursor: 'pointer', userSelect: 'none', listStyle: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px',
          background: 'rgba(255,71,19,0.06)', border: '1px solid rgba(255,71,19,0.18)',
          borderRadius: 10, fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.75)',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FF4713" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
            </svg>
            How to create your Slack app — required scopes &amp; settings
          </span>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ flexShrink: 0 }}>
            <path d="M3 5l4 4 4-4"/>
          </svg>
        </summary>
        <div style={{
          marginTop: 8, padding: '16px 18px',
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          {[
            {
              title: 'Create & enable Socket Mode',
              body: 'Go to api.slack.com/apps → Create New App → From scratch. Then Settings → Socket Mode → Enable. Generate an App-Level Token (xapp-…) with the connections:write scope.',
            },
            {
              title: 'Add Bot Token Scopes',
              body: 'Features → OAuth & Permissions → Bot Token Scopes. Add: chat:write, files:read, files:write, reactions:read, users:read, channels:history, groups:history, im:history',
              mono: true,
            },
            {
              title: 'Subscribe to Bot Events',
              body: 'Features → Event Subscriptions → Enable Events → Subscribe to bot events. Add: message.im, message.channels, message.groups, reaction_added, app_home_opened',
              mono: true,
            },
            {
              title: 'Enable Interactivity & App Home',
              body: 'Features → Interactivity & Shortcuts → Enable. Features → App Home → enable the Home Tab.',
            },
            {
              title: 'Install & copy tokens',
              body: 'Settings → Install App → Install to Workspace. Copy the Bot Token (xoxb-…). The Signing Secret is under Basic Information → App Credentials.',
            },
          ].map(({ title, body, mono }) => (
            <div key={title}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: 4 }}>{title}</div>
              <div style={{
                fontSize: 12, lineHeight: 1.65,
                color: 'rgba(255,255,255,0.4)',
                fontFamily: mono ? 'JetBrains Mono, monospace' : undefined,
              }}>{body}</div>
            </div>
          ))}
          <div style={{ fontSize: 11, color: 'rgba(255,71,19,0.7)', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10 }}>
            Full step-by-step guide available in Admin → Slack Setup after completing setup.
          </div>
        </div>
      </details>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Field label="Bot Token" hint="Starts with xoxb-">
          <input
            value={botToken} onChange={e => setBotToken(e.target.value)}
            placeholder="xoxb-…"
            style={inputStyle}
            onFocus={focusStyle} onBlur={blurStyle}
          />
        </Field>

        <Field label="App-Level Token" hint="Socket Mode — starts with xapp-">
          <input
            value={appToken} onChange={e => setAppToken(e.target.value)}
            placeholder="xapp-…"
            style={inputStyle}
            onFocus={focusStyle} onBlur={blurStyle}
          />
        </Field>

        <Field label="Signing Secret" hint="From Basic Information in your app settings">
          <input
            value={signingSecret} onChange={e => setSigningSecret(e.target.value)}
            placeholder="••••••••"
            type="password"
            style={inputStyle}
            onFocus={focusStyle} onBlur={blurStyle}
          />
        </Field>

        {/* Test connection */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !botToken || !appToken}
            style={{
              height: 38, paddingLeft: 18, paddingRight: 18,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.15)',
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

        {/* Advanced */}
        <details style={{ marginTop: 4 }}>
          <summary style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', cursor: 'pointer', userSelect: 'none', marginBottom: 16 }}>
            Advanced options
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 4 }}>
            <Field label="Trigger emoji" hint="The reaction that creates a ticket (without colons)">
              <input
                value={triggerEmoji} onChange={e => setTriggerEmoji(e.target.value)}
                placeholder="clipboard"
                style={{ ...inputStyle, maxWidth: 180 }}
                onFocus={focusStyle} onBlur={blurStyle}
              />
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
              background: (!botToken || !appToken)
                ? 'rgba(255,71,19,0.4)' : 'linear-gradient(135deg, #FF4713 0%, #AD1164 100%)',
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
