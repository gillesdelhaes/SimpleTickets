import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import api from '../../lib/api'
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
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 480, width: '100%' }}>
      <div style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 28, fontWeight: 700, color: '#fff', letterSpacing: '-0.025em', marginBottom: 8 }}>
          You're all set
        </h2>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>
          Review your configuration and finish setup.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 40 }}>
        {/* Admin account */}
        <ReviewCard
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="8" r="4" stroke="#4ADE80" strokeWidth="1.5"/>
              <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="#4ADE80" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          }
          title="Admin account"
          status="configured"
        >
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
            {data.adminEmail}
          </span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>{data.adminName}</span>
        </ReviewCard>

        {/* Slack */}
        <ReviewCard
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M14.5 10c-.83 0-1.5-.67-1.5-1.5v-5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5z" fill={data.slackConfigured ? '#4ADE80' : '#737373'}/>
              <path d="M20.5 10H19V8.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" fill={data.slackConfigured ? '#4ADE80' : '#737373'}/>
              <path d="M9.5 14c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5S8 21.33 8 20.5v-5c0-.83.67-1.5 1.5-1.5z" fill={data.slackConfigured ? '#4ADE80' : '#737373'}/>
              <path d="M3.5 14H5v1.5c0 .83-.67 1.5-1.5 1.5S2 16.33 2 15.5 2.67 14 3.5 14z" fill={data.slackConfigured ? '#4ADE80' : '#737373'}/>
              <path d="M14 14.5c0-.83.67-1.5 1.5-1.5h5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-5c-.83 0-1.5-.67-1.5-1.5z" fill={data.slackConfigured ? '#4ADE80' : '#737373'}/>
              <path d="M15.5 19H14v1.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5-.67-1.5-1.5-1.5z" fill={data.slackConfigured ? '#4ADE80' : '#737373'}/>
              <path d="M10 9.5C10 8.67 9.33 8 8.5 8h-5C2.67 8 2 8.67 2 9.5S2.67 11 3.5 11h5c.83 0 1.5-.67 1.5-1.5z" fill={data.slackConfigured ? '#4ADE80' : '#737373'}/>
              <path d="M8.5 5H10V3.5C10 2.67 9.33 2 8.5 2S7 2.67 7 3.5 7.67 5 8.5 5z" fill={data.slackConfigured ? '#4ADE80' : '#737373'}/>
            </svg>
          }
          title="Slack integration"
          status={data.slackConfigured ? 'configured' : 'skipped'}
        >
          {data.slackConfigured ? (
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
              Connected to <strong style={{ color: 'rgba(255,255,255,0.8)' }}>{data.slackTeamName || 'your workspace'}</strong>
            </span>
          ) : (
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
              Skipped — configure later in Admin → Settings
            </span>
          )}
        </ReviewCard>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, fontSize: 13, color: '#FCA5A5', marginBottom: 20 }}>
          {error}
        </div>
      )}

      <button
        onClick={handleFinish}
        disabled={loading}
        style={{
          width: '100%', height: 52, borderRadius: 14, border: 'none',
          cursor: loading ? 'not-allowed' : 'pointer',
          background: loading ? 'rgba(255,71,19,0.4)' : 'linear-gradient(135deg, #FF4713 0%, #AD1164 100%)',
          fontSize: 15, fontWeight: 700, color: '#fff',
          boxShadow: loading ? 'none' : '0 4px 20px rgba(255,71,19,0.3)',
        }}
      >
        {loading ? 'Finishing setup…' : 'Finish setup & sign in →'}
      </button>

      <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', textAlign: 'center', marginTop: 16 }}>
        You can change all settings anytime from Admin → Settings
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
    <div style={{
      padding: '16px 20px',
      background: 'rgba(255,255,255,0.04)',
      border: `1px solid ${status === 'configured' ? 'rgba(74,222,128,0.2)' : 'rgba(255,255,255,0.08)'}`,
      borderRadius: 14,
      display: 'flex', gap: 16, alignItems: 'flex-start',
    }}>
      <div style={{ marginTop: 2, flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{title}</span>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
            padding: '2px 8px', borderRadius: 999,
            background: status === 'configured' ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.06)',
            color: status === 'configured' ? '#4ADE80' : 'rgba(255,255,255,0.35)',
            border: `1px solid ${status === 'configured' ? 'rgba(74,222,128,0.3)' : 'rgba(255,255,255,0.1)'}`,
          }}>
            {status}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</div>
      </div>
    </div>
  )
}
