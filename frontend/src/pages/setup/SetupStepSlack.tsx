import { useState } from 'react'
import api from '../../lib/api'

interface Props {
  onNext: (configured: boolean, teamName: string) => void
}

export default function SetupStepSlack({ onNext }: Props) {
  const [botToken, setBotToken] = useState('')
  const [appToken, setAppToken] = useState('')
  const [signingSecret, setSigningSecret] = useState('')
  const [triggerEmoji, setTriggerEmoji] = useState('ticket')
  const [monitoredChannels, setMonitoredChannels] = useState('')
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
        trigger_emoji: triggerEmoji || 'ticket',
        monitored_channels: monitoredChannels,
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
          Slack is how your team submits tickets. Create a Slack app at{' '}
          <span style={{ color: '#FF4713', fontFamily: 'monospace', fontSize: 12 }}>api.slack.com/apps</span>{' '}
          with Socket Mode enabled.
        </p>
      </div>

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
                placeholder="ticket"
                style={{ ...inputStyle, maxWidth: 180 }}
                onFocus={focusStyle} onBlur={blurStyle}
              />
            </Field>
            <Field label="Monitored channels" hint="Comma-separated channel IDs. Leave empty to watch all channels.">
              <input
                value={monitoredChannels} onChange={e => setMonitoredChannels(e.target.value)}
                placeholder="C01234567, C09876543"
                style={inputStyle}
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
