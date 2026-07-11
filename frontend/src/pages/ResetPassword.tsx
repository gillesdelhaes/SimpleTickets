import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import api, { apiErrorMessage } from '../lib/api'

export default function ResetPassword() {
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [email, setEmail] = useState(params.get('email') ?? '')
  const [code, setCode] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const mismatch = next.length > 0 && confirm.length > 0 && next !== confirm
  const canSubmit = email.length > 0 && code.trim().length > 0 && next.length >= 8 && next === confirm && !loading

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setError('')
    setLoading(true)
    try {
      await api.post('/auth/reset-password', {
        email,
        code: code.trim(),
        new_password: next,
      })
      navigate('/login', { replace: true, state: { passwordReset: true } })
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Invalid or expired reset code'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="split">
      <section className="brand-side">
        <div className="wordmark-xl">
          <span className="lite">Simple</span>
          <span className="brand">Tickets</span>
        </div>
        <p className="tag">
          A simple ticketing system for admins with no time to waste. Tickets in
          from Slack, SLAs tracked, nothing else in the way.
        </p>
      </section>

      <section className="form-side">
        <form className="login-card" onSubmit={handleSubmit}>
          <h1>Enter your code</h1>
          <p className="sub">Enter the code we DMed you along with a new password.</p>

          <div className="fieldrow">
            <label htmlFor="email">Email</label>
            <input
              className="input"
              id="email"
              type="email"
              autoComplete="email"
              required
              autoFocus={!email}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </div>

          <div className="fieldrow">
            <label htmlFor="code">Reset code</label>
            <input
              className="input font-mono"
              id="code"
              type="text"
              autoComplete="one-time-code"
              required
              autoFocus={!!email}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="XXXXXXXX"
              style={{ letterSpacing: '0.1em' }}
            />
          </div>

          <div className="fieldrow">
            <label htmlFor="next">New password <span className="font-normal text-ink-3">(min 8 characters)</span></label>
            <input
              className="input"
              id="next"
              type="password"
              autoComplete="new-password"
              required
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder="••••••••••"
            />
          </div>

          <div className="fieldrow">
            <label htmlFor="confirm">Confirm new password</label>
            <input
              className="input"
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••••"
              style={mismatch ? { borderColor: 'var(--danger-ink)' } : undefined}
            />
            {mismatch && <span className="text-[12px] text-danger-ink">Passwords don't match</span>}
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-control px-4 py-3 mb-4 text-[13px] leading-relaxed text-danger-ink"
              style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-bg)' }}
            >
              {error}
            </div>
          )}

          <button className="btn" type="submit" disabled={!canSubmit} style={!canSubmit ? { opacity: 0.7, cursor: loading ? 'wait' : 'not-allowed' } : undefined}>
            {loading ? 'Resetting…' : 'Reset password'}
          </button>

          <p className="sub" style={{ marginTop: 18 }}>
            <Link to="/login">Back to sign in</Link>
            {' · '}
            <Link to="/forgot-password">Request a new code</Link>
          </p>
        </form>
      </section>
    </div>
  )
}
