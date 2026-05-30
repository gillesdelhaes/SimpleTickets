import { useState } from 'react'
import SetupStepWelcome from './SetupStepWelcome'
import SetupStepAdmin from './SetupStepAdmin'
import SetupStepSlack from './SetupStepSlack'
import SetupStepReview from './SetupStepReview'

export type WizardData = {
  adminName: string
  adminEmail: string
  slackConfigured: boolean
  slackTeamName: string
}

const STEPS = ['Welcome', 'Admin Account', 'Slack', 'Finish']

export default function SetupWizard() {
  const [step, setStep] = useState(0)
  const [data, setData] = useState<WizardData>({
    adminName: '',
    adminEmail: '',
    slackConfigured: false,
    slackTeamName: '',
  })

  const next = (patch?: Partial<WizardData>) => {
    if (patch) setData(d => ({ ...d, ...patch }))
    setStep(s => s + 1)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0A0A0A', display: 'flex', flexDirection: 'column' }}>
      {/* Top gradient bar */}
      <div style={{ height: 3, background: 'linear-gradient(90deg, #FF4713 0%, #AD1164 100%)', flexShrink: 0 }} />

      {/* Header */}
      <div style={{ padding: '28px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <span style={{ fontSize: 20, fontWeight: 200, color: 'rgba(255,255,255,0.9)', letterSpacing: '-0.03em' }}>Simply</span>
          <span style={{
            fontSize: 20, fontWeight: 800, letterSpacing: '-0.03em',
            background: 'linear-gradient(135deg, #FF4713 0%, #AD1164 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>Tickets</span>
        </div>

        {/* Step indicator */}
        {step > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {STEPS.slice(1).map((label, i) => {
              const idx = i + 1
              const done = step > idx
              const active = step === idx
              return (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    opacity: done || active ? 1 : 0.35,
                  }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700,
                      background: done ? '#FF4713' : active ? 'rgba(255,71,19,0.15)' : 'transparent',
                      border: `1.5px solid ${done || active ? '#FF4713' : 'rgba(255,255,255,0.2)'}`,
                      color: done ? '#fff' : active ? '#FF4713' : 'rgba(255,255,255,0.5)',
                    }}>
                      {done ? '✓' : idx}
                    </div>
                    <span style={{ fontSize: 12, color: active ? '#fff' : 'rgba(255,255,255,0.4)', fontWeight: active ? 600 : 400 }}>
                      {label}
                    </span>
                  </div>
                  {i < STEPS.length - 2 && (
                    <div style={{ width: 24, height: 1, background: step > idx + 1 ? '#FF4713' : 'rgba(255,255,255,0.1)' }} />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 40px 60px' }}>
        {step === 0 && <SetupStepWelcome onNext={() => next()} />}
        {step === 1 && <SetupStepAdmin onNext={(name, email) => next({ adminName: name, adminEmail: email })} />}
        {step === 2 && <SetupStepSlack onNext={(configured, teamName) => next({ slackConfigured: configured, slackTeamName: teamName })} />}
        {step === 3 && <SetupStepReview data={data} />}
      </div>
    </div>
  )
}
