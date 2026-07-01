import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const { login, user } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Already authenticated — go home
  useEffect(() => {
    if (user) {
      navigate('/dashboard', { replace: true })
    }
  }, [user, navigate])

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 40)
    return () => clearTimeout(t)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api.post<{ access_token: string }>('/auth/login', { email, password })
      login(res.data.access_token)
      // AuthContext will update user; the useEffect above handles redirect
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Something went wrong — please try again'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex overflow-hidden bg-[#F9F9F9]">
      {/* ── Left brand panel ────────────────────────────────────── */}
      <div
        className="hidden lg:flex lg:w-[58%] relative flex-col justify-between overflow-hidden"
        style={{ background: '#0A0A0A' }}
      >
        {/* Top gradient rule */}
        <div
          className="absolute top-0 left-0 right-0 h-[2px] z-10"
          style={{ background: 'linear-gradient(90deg, #FF4713 0%, #AD1164 100%)' }}
        />

        {/* Dot-grid texture (same as Splash) */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(255,255,255,0.035) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />

        {/* Ambient glow — primary */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: '-180px',
            left: '-180px',
            width: '600px',
            height: '600px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, #FF4713 0%, transparent 70%)',
            opacity: 0.07,
            filter: 'blur(50px)',
          }}
        />

        {/* Ambient glow — secondary */}
        <div
          className="absolute pointer-events-none"
          style={{
            bottom: '-120px',
            right: '-120px',
            width: '560px',
            height: '560px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, #AD1164 0%, transparent 70%)',
            opacity: 0.08,
            filter: 'blur(50px)',
          }}
        />

        {/* Large decorative geometric ticket shape */}
        <div
          className="absolute pointer-events-none"
          style={{
            bottom: '80px',
            right: '-60px',
            width: '480px',
            height: '320px',
            borderRadius: '24px',
            background: 'linear-gradient(135deg, rgba(255,71,19,0.08) 0%, rgba(173,17,100,0.06) 100%)',
            border: '1px solid rgba(255,71,19,0.12)',
            transform: 'rotate(-12deg)',
          }}
        />
        <div
          className="absolute pointer-events-none"
          style={{
            bottom: '140px',
            right: '20px',
            width: '320px',
            height: '220px',
            borderRadius: '18px',
            background: 'linear-gradient(135deg, rgba(255,71,19,0.05) 0%, rgba(173,17,100,0.04) 100%)',
            border: '1px solid rgba(173,17,100,0.10)',
            transform: 'rotate(-6deg)',
          }}
        />
        {/* Notch circles (ticket perforation detail) */}
        {[0.15, 0.3, 0.45, 0.6, 0.75].map((_pos, i) => (
          <div
            key={i}
            className="absolute pointer-events-none"
            style={{
              bottom: `${200 + i * 22}px`,
              right: '278px',
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: 'rgba(255,71,19,0.18)',
              transform: 'rotate(-12deg)',
            }}
          />
        ))}

        {/* Main content */}
        <div
          className="relative z-10 flex flex-col justify-center flex-1 px-16 py-20"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(20px)',
            transition: 'opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1), transform 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {/* Wordmark */}
          <div className="mb-16">
            <h1
              className="leading-none select-none"
              style={{ fontSize: 'clamp(48px, 5.5vw, 78px)', letterSpacing: '-0.04em' }}
            >
              <span style={{ fontWeight: 200, color: 'rgba(255,255,255,0.90)' }}>
                Simple
              </span>
              <span
                style={{
                  fontWeight: 800,
                  background: 'linear-gradient(135deg, #FF4713 0%, #C41070 60%, #AD1164 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                Tickets
              </span>
            </h1>
            <p
              className="mt-[18px]"
              style={{
                color: 'rgba(115,115,115,0.60)',
                fontFamily: 'monospace',
                fontSize: '11px',
                fontWeight: 400,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
              }}
            >
              A simple ticketing system for admins with no time to waste
            </p>
          </div>

          {/* Feature callouts */}
          <div className="flex flex-col gap-[18px]">
            {[
              {
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                ),
                label: 'Slack-first ticket creation',
              },
              {
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                ),
                label: 'IT team portal — VPN access only',
              },
              {
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="20" x2="18" y2="10"/>
                    <line x1="12" y1="20" x2="12" y2="4"/>
                    <line x1="6" y1="20" x2="6" y2="14"/>
                  </svg>
                ),
                label: 'SLA tracking & reporting',
              },
              {
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/>
                    <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
                  </svg>
                ),
                label: 'CSAT feedback on every resolution',
              },
            ].map(({ icon, label }) => (
              <div key={label} className="flex items-center gap-[14px]">
                <div
                  className="flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0"
                  style={{
                    background: 'rgba(255,71,19,0.08)',
                    border: '1px solid rgba(255,71,19,0.15)',
                    color: 'rgba(255,71,19,0.7)',
                  }}
                >
                  {icon}
                </div>
                <span
                  style={{
                    color: 'rgba(242,242,242,0.55)',
                    fontSize: '14px',
                    fontWeight: 400,
                    letterSpacing: '0.01em',
                  }}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom version label */}
        <div className="relative z-10 px-16 pb-8">
          <span
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '10px',
              color: 'rgba(115,115,115,0.4)',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
            }}
          >
            v0.1.0 · Phase 1
          </span>
        </div>
      </div>

      {/* ── Right form panel ────────────────────────────────────── */}
      <div
        className="flex-1 flex flex-col justify-center px-8 py-10 sm:px-12 lg:px-12"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateX(0)' : 'translateX(16px)',
          transition:
            'opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.1s, transform 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.1s',
        }}
      >
        {/* Mobile wordmark — only shown on small screens */}
        <div className="lg:hidden mb-10 text-center">
          <h1
            className="leading-none select-none"
            style={{ fontSize: '40px', letterSpacing: '-0.04em' }}
          >
            <span style={{ fontWeight: 200, color: '#0A0A0A' }}>Simple</span>
            <span
              style={{
                fontWeight: 800,
                background: 'linear-gradient(135deg, #FF4713 0%, #AD1164 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Tickets
            </span>
          </h1>
        </div>

        <div className="w-full max-w-[400px] mx-auto">
          {/* Heading */}
          <div className="mb-7">
            <h2
              className="text-[#0A0A0A] mb-1.5"
              style={{ fontSize: '26px', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.25 }}
            >
              Sign in
            </h2>
            <p style={{ fontSize: '14px', color: '#737373', fontWeight: 400 }}>
              Welcome back to your ticketing workspace
            </p>
          </div>

          {/* Email/password form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Email */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="email"
                style={{ fontSize: '13px', fontWeight: 500, color: '#262626', letterSpacing: '0.01em' }}
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-xl border border-[#E5E5E5] bg-white transition-all duration-150"
                style={{
                  height: '46px',
                  fontSize: '14px',
                  color: '#0A0A0A',
                  outline: 'none',
                  paddingLeft: '14px',
                  paddingRight: '14px',
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = '#FF4713'
                  e.target.style.boxShadow = '0 0 0 3px rgba(255,71,19,0.10)'
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = '#E5E5E5'
                  e.target.style.boxShadow = 'none'
                }}
              />
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="password"
                style={{ fontSize: '13px', fontWeight: 500, color: '#262626', letterSpacing: '0.01em' }}
              >
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="password"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-[#E5E5E5] bg-white transition-all duration-150"
                  style={{
                    height: '46px',
                    fontSize: '14px',
                    color: '#0A0A0A',
                    outline: 'none',
                    padding: '0 44px 0 14px',
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#FF4713'
                    e.target.style.boxShadow = '0 0 0 3px rgba(255,71,19,0.10)'
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#E5E5E5'
                    e.target.style.boxShadow = 'none'
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  style={{
                    position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#A3A3A3', padding: 0, display: 'flex', alignItems: 'center',
                  }}
                >
                  {showPw ? (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div
                className="rounded-xl px-4 py-3"
                style={{
                  background: 'rgba(239,68,68,0.06)',
                  border: '1px solid rgba(239,68,68,0.2)',
                  fontSize: '13px',
                  color: '#DC2626',
                  lineHeight: 1.5,
                }}
              >
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl text-white font-semibold transition-all duration-150 active:scale-[0.99]"
              style={{
                height: '48px',
                marginTop: '4px',
                fontSize: '14px',
                letterSpacing: '0.01em',
                background: loading
                  ? 'linear-gradient(135deg, rgba(255,71,19,0.6) 0%, rgba(173,17,100,0.6) 100%)'
                  : 'linear-gradient(135deg, #FF4713 0%, #AD1164 100%)',
                boxShadow: loading ? 'none' : '0 4px 16px rgba(255,71,19,0.25)',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="animate-spin"
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <circle cx="8" cy="8" r="6" stroke="rgba(255,255,255,0.3)" strokeWidth="2" />
                    <path
                      d="M8 2a6 6 0 0 1 6 6"
                      stroke="white"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                  Signing in…
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
