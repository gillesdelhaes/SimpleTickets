import { useState, useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import api, { apiErrorMessage } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'

// ── Sign in with Google (GIS) ──────────────────────────────────────────────────
// Rendered only when an admin has configured a Google client ID (fetched from
// the unauthenticated /auth/google/config endpoint — client IDs are public).
// The GIS button hands us a signed ID token; the backend verifies it and only
// admits pre-provisioned auth_provider=google accounts.

interface GisCredentialResponse { credential: string }

function GoogleSignInButton({ clientId, onCredential }: { clientId: string; onCredential: (credential: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  // Keep the callback in a ref so the GIS init effect never re-runs (a
  // re-run would render a second button into the container).
  const callbackRef = useRef(onCredential)
  callbackRef.current = onCredential

  useEffect(() => {
    let cancelled = false

    function init() {
      const gis = (window as unknown as {
        google?: { accounts?: { id?: {
          initialize: (config: object) => void
          renderButton: (el: HTMLElement, options: object) => void
        } } }
      }).google?.accounts?.id
      if (cancelled || !gis || !containerRef.current) return
      gis.initialize({
        client_id: clientId,
        callback: (resp: GisCredentialResponse) => callbackRef.current(resp.credential),
      })
      containerRef.current.innerHTML = ''
      gis.renderButton(containerRef.current, { theme: 'outline', size: 'large', width: 300, text: 'signin_with' })
    }

    const existing = document.getElementById('gsi-client-script') as HTMLScriptElement | null
    if ((window as unknown as { google?: unknown }).google) {
      init()
    } else if (existing) {
      existing.addEventListener('load', init)
    } else {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.id = 'gsi-client-script'
      script.addEventListener('load', init)
      document.head.appendChild(script)
    }
    return () => { cancelled = true }
  }, [clientId])

  return <div ref={containerRef} style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }} />
}

export default function Login() {
  const { login, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleClientId, setGoogleClientId] = useState<string | null>(null)
  const justReset = Boolean((location.state as { passwordReset?: boolean } | null)?.passwordReset)

  // Already authenticated — go home
  useEffect(() => {
    if (user) {
      navigate('/dashboard', { replace: true })
    }
  }, [user, navigate])

  useEffect(() => {
    api.get<{ client_id: string | null }>('/auth/google/config')
      .then(res => setGoogleClientId(res.data.client_id))
      .catch(() => {}) // no button on failure — password login always works
  }, [])

  async function handleGoogleCredential(credential: string) {
    setError('')
    setLoading(true)
    try {
      const res = await api.post<{ access_token: string }>('/auth/google', { credential })
      login(res.data.access_token)
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Google sign-in failed — please try again'))
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api.post<{ access_token: string }>('/auth/login', { email, password })
      login(res.data.access_token)
      // AuthContext will update user; the useEffect above handles redirect
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
        <div className="shard s1">
          <span className="ico">
            <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15.5 11.5a1.5 1.5 0 0 1-1.5 1.5H5l-3 3V4a1.5 1.5 0 0 1 1.5-1.5h10.5A1.5 1.5 0 0 1 15.5 4z" />
            </svg>
          </span>
          <span><b>Slack-first</b><br />tickets where people ask</span>
        </div>
        <div className="shard s2">
          <span className="ico">
            <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="9" r="7" />
              <path d="M9 5v4l2.5 2.5" />
            </svg>
          </span>
          <span><b>SLA tracking</b><br />response and resolution</span>
        </div>
      </section>

      <section className="form-side">
        <form className="login-card" onSubmit={handleSubmit}>
          <h1>Welcome back</h1>
          <p className="sub">Sign in to your SimpleTickets workspace.</p>

          {googleClientId && (
            <>
              <GoogleSignInButton clientId={googleClientId} onCredential={handleGoogleCredential} />
              <div className="flex items-center gap-3" style={{ margin: '18px 0' }} aria-hidden="true">
                <div style={{ flex: 1, height: 1, background: 'var(--track)' }} />
                <span className="text-[11px] font-semibold text-ink-3" style={{ letterSpacing: '0.04em' }}>
                  OR SIGN IN WITH PASSWORD
                </span>
                <div style={{ flex: 1, height: 1, background: 'var(--track)' }} />
              </div>
            </>
          )}

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

          <div className="fieldrow">
            <label htmlFor="password">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                className="input"
                id="password"
                type={showPw ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
                style={{ paddingRight: 42 }}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                className="text-ink-3 hover:text-ink"
                style={{
                  position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  display: 'flex', alignItems: 'center',
                }}
              >
                {showPw ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            <div style={{ textAlign: 'right' }}>
              <Link to="/forgot-password" style={{ fontSize: 11.5, fontWeight: 600, textDecoration: 'none', color: 'var(--brand-ink)' }}>
                Forgot password?
              </Link>
            </div>
          </div>

          {justReset && !error && (
            <div
              className="rounded-control px-4 py-3 mb-4 text-[13px] leading-relaxed text-ok-ink"
              style={{ background: 'var(--ok-bg)', border: '1px solid var(--ok-bg)' }}
            >
              Password reset — sign in with your new password.
            </div>
          )}

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
            {loading ? (
              <>
                <svg className="animate-spin" width="15" height="15" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="rgba(255,255,255,0.3)" strokeWidth="2" />
                  <path d="M8 2a6 6 0 0 1 6 6" stroke="white" strokeWidth="2" strokeLinecap="round" />
                </svg>
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>
      </section>
    </div>
  )
}
