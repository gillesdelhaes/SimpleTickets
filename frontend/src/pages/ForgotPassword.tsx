import { useState } from 'react'
import { Link } from 'react-router-dom'
import api, { apiErrorMessage } from '../lib/api'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api.post('/auth/forgot-password', { email })
      setSent(true)
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Something went wrong — please try again'))
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
          <h1>Reset your password</h1>
          <p className="sub">
            If your account is linked to Slack, we'll DM you a one-time code.
          </p>

          {sent ? (
            <>
              <div
                className="rounded-control px-4 py-3 mb-4 text-[13px] leading-relaxed text-ok-ink"
                style={{ background: 'var(--ok-bg)', border: '1px solid var(--ok-bg)' }}
              >
                If that account exists and is linked to Slack, a reset code has been sent.
                Check your Slack DMs — the code expires in 15 minutes.
              </div>
              <Link to={`/reset-password?email=${encodeURIComponent(email)}`} className="btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                I have a code
              </Link>
            </>
          ) : (
            <>
              <div className="fieldrow">
                <label htmlFor="email">Email</label>
                <input
                  className="input"
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                />
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

              <button className="btn" type="submit" disabled={loading} style={loading ? { opacity: 0.7, cursor: 'wait' } : undefined}>
                {loading ? 'Sending…' : 'Send reset code'}
              </button>
            </>
          )}

          <p className="sub" style={{ marginTop: 18 }}>
            <Link to="/login">Back to sign in</Link>
            {' · '}
            <Link to={`/reset-password${email ? `?email=${encodeURIComponent(email)}` : ''}`}>Already have a code?</Link>
          </p>
        </form>
      </section>
    </div>
  )
}
