import { useState } from 'react'
import api, { apiErrorMessage } from '../../lib/api'

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
      setError(apiErrorMessage(err, 'Something went wrong'))
    } finally {
      setLoading(false)
    }
  }

  const canSubmit = !loading && name && email && password && confirm

  return (
    <form className="login-card w-full" style={{ maxWidth: 480 }} onSubmit={handleSubmit}>
      <h1>Create admin account</h1>
      <p className="sub">This will be the primary administrator. You can add more IT staff later.</p>

      <div className="fieldrow">
        <label htmlFor="setup-name">Full name</label>
        <input
          id="setup-name"
          className="input"
          required
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Jane Smith"
        />
      </div>

      <div className="fieldrow">
        <label htmlFor="setup-email">Email address</label>
        <input
          id="setup-email"
          className="input"
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="jane@company.com"
          autoComplete="email"
        />
      </div>

      <div className="fieldrow">
        <label htmlFor="setup-password">Password</label>
        <div className="relative">
          <input
            id="setup-password"
            className="input"
            type={showPw ? 'text' : 'password'}
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Min. 8 characters"
            autoComplete="new-password"
            style={{ paddingRight: 44 }}
          />
          <button
            type="button"
            onClick={() => setShowPw(v => !v)}
            aria-label={showPw ? 'Hide password' : 'Show password'}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 bg-transparent border-0 cursor-pointer text-ink-3 hover:text-ink flex items-center p-0"
          >
            {showPw ? (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <div className="fieldrow">
        <label htmlFor="setup-confirm">Confirm password</label>
        <input
          id="setup-confirm"
          className="input"
          type={showPw ? 'text' : 'password'}
          required
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          placeholder="Repeat password"
          autoComplete="new-password"
        />
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-control px-4 py-3 mb-4 text-[13px] text-danger-ink"
          style={{ background: 'var(--danger-bg)' }}
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        className="btn"
        disabled={!canSubmit}
        style={!canSubmit ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
      >
        {loading ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  )
}
