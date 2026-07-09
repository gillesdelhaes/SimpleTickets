export default function SetupStepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="text-center w-full" style={{ maxWidth: 560 }}>
      {/* Icon tile */}
      <div
        className="flex items-center justify-center mx-auto mb-8 text-white"
        style={{
          width: 72, height: 72, borderRadius: 22,
          background: 'var(--brand-grad)',
          boxShadow: '0 12px 32px var(--brand-glow)',
        }}
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
          <rect x="9" y="3" width="6" height="4" rx="1" />
          <path d="M9 12h6M9 16h4" />
        </svg>
      </div>

      <h1 className="text-ink" style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 12px', lineHeight: 1.2 }}>
        Welcome to SimpleTickets
      </h1>
      <p className="text-[14.5px] text-ink-2 leading-relaxed" style={{ maxWidth: 420, margin: '0 auto 40px' }}>
        Your Slack-native IT ticketing system. Setup takes about 2 minutes — just a few things to configure.
      </p>

      <div className="flex flex-col gap-2.5" style={{ maxWidth: 360, margin: '0 auto 40px' }}>
        {[
          { step: '1', label: 'Create your admin account' },
          { step: '2', label: 'Connect your Slack workspace' },
          { step: '3', label: 'Start receiving tickets' },
        ].map(({ step, label }) => (
          <div key={step} className="panel flex items-center gap-3.5 text-left" style={{ padding: '14px 20px' }}>
            <div
              className="flex items-center justify-center flex-shrink-0 text-[12px] font-bold text-white"
              style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--brand-grad)' }}
            >
              {step}
            </div>
            <span className="text-[14px] text-ink font-medium">{label}</span>
          </div>
        ))}
      </div>

      <button className="btn" onClick={onNext} style={{ padding: '13px 40px', fontSize: 14.5 }}>
        Get started
      </button>
    </div>
  )
}
