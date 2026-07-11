import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import api, { apiErrorMessage } from '../../lib/api'
import type { WizardData } from './SetupWizard'

export default function SetupStepReview({ data }: { data: WizardData }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleFinish() {
    setError('')
    setLoading(true)
    try {
      await api.post('/setup/complete', {})
      // Invalidate the setup status cache so SetupGuard re-checks
      queryClient.invalidateQueries({ queryKey: ['setup-status'] })
      navigate('/login', { replace: true })
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Something went wrong'))
      setLoading(false)
    }
  }

  return (
    <div className="login-card w-full" style={{ maxWidth: 480 }}>
      <h1>You're all set</h1>
      <p className="sub">Review your configuration and finish setup.</p>

      <div className="flex flex-col gap-3 mb-6">
        {/* Admin account */}
        <ReviewCard
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
            </svg>
          }
          title="Admin account"
          status="configured"
        >
          <span className="font-mono text-[12px] text-ink-2">{data.adminEmail}</span>
          <span className="text-[12px] text-ink-3">{data.adminName}</span>
        </ReviewCard>

        {/* Slack */}
        <ReviewCard
          icon={
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15.5 11.5a1.5 1.5 0 0 1-1.5 1.5H5l-3 3V4a1.5 1.5 0 0 1 1.5-1.5h10.5A1.5 1.5 0 0 1 15.5 4z" />
            </svg>
          }
          title="Slack integration"
          status={data.slackConfigured ? 'configured' : 'skipped'}
        >
          {data.slackConfigured ? (
            <span className="text-[12px] text-ink-2">
              Connected to <strong className="text-ink">{data.slackTeamName || 'your workspace'}</strong>
            </span>
          ) : (
            <span className="text-[12px] text-ink-3">
              Skipped — configure later in Settings → Slack
            </span>
          )}
        </ReviewCard>
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
        className="btn"
        onClick={handleFinish}
        disabled={loading}
        style={loading ? { opacity: 0.6, cursor: 'wait' } : undefined}
      >
        {loading ? 'Finishing setup…' : 'Finish setup & sign in'}
      </button>

      <p className="text-[12px] text-ink-3 text-center mt-4 mb-0">
        You can change all settings anytime from Settings.
      </p>
    </div>
  )
}

function ReviewCard({
  icon, title, status, children,
}: {
  icon: React.ReactNode
  title: string
  status: 'configured' | 'skipped'
  children: React.ReactNode
}) {
  return (
    <div className="so-block flex gap-4 items-start" style={{ marginBottom: 0 }}>
      <div className="mt-0.5 flex-shrink-0" style={{ color: status === 'configured' ? 'var(--brand-ink)' : 'var(--ink-3)' }}>
        {icon}
      </div>
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[14px] font-semibold text-ink">{title}</span>
          <span className={`pill ${status === 'configured' ? 'use' : 'retired'}`}>{status}</span>
        </div>
        <div className="flex flex-col gap-0.5">{children}</div>
      </div>
    </div>
  )
}
