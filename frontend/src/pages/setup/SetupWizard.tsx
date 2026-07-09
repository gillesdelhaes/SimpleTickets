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

const STEPS = ['Welcome', 'Admin account', 'Slack', 'Finish']

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
    <>
      <div className="aura" aria-hidden="true" />
      <div className="relative flex flex-col min-h-screen" style={{ zIndex: 1 }}>
        {/* Header */}
        <div className="flex items-center justify-between flex-shrink-0" style={{ padding: '28px 40px' }}>
          <div className="wordmark" style={{ padding: 0, fontSize: 20 }}>
            <span className="lite">Simple</span>
            <span className="brand">Tickets</span>
          </div>

          {/* Step indicator */}
          {step > 0 && (
            <div className="flex items-center gap-2">
              {STEPS.slice(1).map((label, i) => {
                const idx = i + 1
                const done = step > idx
                const active = step === idx
                return (
                  <div key={label} className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5" style={{ opacity: done || active ? 1 : 0.4 }}>
                      <div
                        className="flex items-center justify-center text-[11px] font-bold"
                        style={{
                          width: 22, height: 22, borderRadius: '50%',
                          background: done ? 'var(--brand-grad)' : active ? 'var(--brand-tint)' : 'transparent',
                          border: done ? 'none' : `1.5px solid ${active ? 'var(--b1)' : 'var(--edge-hi)'}`,
                          color: done ? '#fff' : active ? 'var(--brand-ink)' : 'var(--ink-3)',
                        }}
                      >
                        {done ? '✓' : idx}
                      </div>
                      <span className={`text-[12px] ${active ? 'font-semibold text-ink' : 'text-ink-3'}`}>
                        {label}
                      </span>
                    </div>
                    {i < STEPS.length - 2 && (
                      <div style={{ width: 24, height: 1, background: step > idx + 1 ? 'var(--b1)' : 'var(--track)' }} />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 flex items-center justify-center" style={{ padding: '20px 40px 60px' }}>
          {step === 0 && <SetupStepWelcome onNext={() => next()} />}
          {step === 1 && <SetupStepAdmin onNext={(name, email) => next({ adminName: name, adminEmail: email })} />}
          {step === 2 && <SetupStepSlack onNext={(configured, teamName) => next({ slackConfigured: configured, slackTeamName: teamName })} />}
          {step === 3 && <SetupStepReview data={data} />}
        </div>
      </div>
    </>
  )
}
