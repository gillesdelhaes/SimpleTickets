import { useState } from 'react'
import api from '../../lib/api'

interface Props {
  onNext: (name: string, email: string) => void
}

export default function SetupStepAdmin({ onNext }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    try {
      await api.post('/setup/admin', { name, email, password })
      onNext(name, email)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 480, width: '100%' }}>
      <div style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 28, fontWeight: 700, color: '#fff', letterSpacing: '-0.025em', marginBottom: 8 }}>
          Create admin account
        </h2>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>
          This will be the primary administrator. You can add more IT staff later.
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Field label="Full name">
          <input
            required value={name} onChange={e => setName(e.target.value)}
            placeholder="Jane Smith"
            style={inputStyle}
            onFocus={focusStyle} onBlur={blurStyle}
          />
        </Field>

        <Field label="Email address">
          <input
            type="email" required value={email} onChange={e => setEmail(e.target.value)}
            placeholder="jane@company.com"
            autoComplete="email"
            style={inputStyle}
            onFocus={focusStyle} onBlur={blurStyle}
          />
        </Field>

        <Field label="Password">
          <div style={{ position: 'relative' }}>
            <input
              type={showPw ? 'text' : 'password'}
              required value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              autoComplete="new-password"
              style={{ ...inputStyle, paddingRight: 44 }}
              onFocus={focusStyle} onBlur={blurStyle}
            />
            <button
              type="button" onClick={() => setShowPw(v => !v)}
              style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.35)', padding: 0 }}
            >
              {showPw ? '🙈' : '👁'}
            </button>
          </div>
        </Field>

        <Field label="Confirm password">
          <input
            type={showPw ? 'text' : 'password'}
            required value={confirm} onChange={e => setConfirm(e.target.value)}
            placeholder="Repeat password"
            autoComplete="new-password"
            style={inputStyle}
            onFocus={focusStyle} onBlur={blurStyle}
          />
        </Field>

        {error && (
          <div style={{ padding: '12px 16px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, fontSize: 13, color: '#FCA5A5' }}>
            {error}
          </div>
        )}

        <button
          type="submit" disabled={loading || !name || !email || !password || !confirm}
          style={{
            height: 52, borderRadius: 14, border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
            background: (loading || !name || !email || !password || !confirm)
              ? 'rgba(255,71,19,0.4)' : 'linear-gradient(135deg, #FF4713 0%, #AD1164 100%)',
            fontSize: 15, fontWeight: 700, color: '#fff', letterSpacing: '0.01em',
            boxShadow: loading ? 'none' : '0 4px 20px rgba(255,71,19,0.3)',
          }}
        >
          {loading ? 'Creating account…' : 'Create account →'}
        </button>
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.01em' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 48, borderRadius: 12,
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.12)',
  color: '#fff', fontSize: 14, padding: '0 16px',
  outline: 'none', boxSizing: 'border-box',
}

function focusStyle(e: React.FocusEvent<HTMLInputElement>) {
  e.target.style.borderColor = '#FF4713'
  e.target.style.boxShadow = '0 0 0 3px rgba(255,71,19,0.15)'
}

function blurStyle(e: React.FocusEvent<HTMLInputElement>) {
  e.target.style.borderColor = 'rgba(255,255,255,0.12)'
  e.target.style.boxShadow = 'none'
}
