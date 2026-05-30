export default function SetupStepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div style={{ maxWidth: 560, width: '100%', textAlign: 'center' }}>
      {/* Icon */}
      <div style={{
        width: 80, height: 80, borderRadius: 24, margin: '0 auto 32px',
        background: 'linear-gradient(135deg, rgba(255,71,19,0.15) 0%, rgba(173,17,100,0.15) 100%)',
        border: '1px solid rgba(255,71,19,0.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" stroke="#FF4713" strokeWidth="1.5" strokeLinecap="round"/>
          <rect x="9" y="3" width="6" height="4" rx="1" stroke="#FF4713" strokeWidth="1.5"/>
          <path d="M9 12h6M9 16h4" stroke="#FF4713" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>

      <h1 style={{
        fontSize: 36, fontWeight: 700, color: '#fff',
        letterSpacing: '-0.03em', marginBottom: 16, lineHeight: 1.2,
      }}>
        Welcome to SimplyTickets
      </h1>
      <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', lineHeight: 1.7, marginBottom: 48, maxWidth: 420, margin: '0 auto 48px' }}>
        Your Slack-native IT ticketing system. We'll get you set up in about 2 minutes — just a few things to configure.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 360, margin: '0 auto 48px' }}>
        {[
          { step: '1', label: 'Create your admin account' },
          { step: '2', label: 'Connect your Slack workspace' },
          { step: '3', label: 'Start receiving tickets' },
        ].map(({ step, label }) => (
          <div key={step} style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '14px 20px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 12,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, #FF4713 0%, #AD1164 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, color: '#fff',
            }}>{step}</div>
            <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>{label}</span>
          </div>
        ))}
      </div>

      <button
        onClick={onNext}
        style={{
          height: 52, paddingLeft: 40, paddingRight: 40,
          background: 'linear-gradient(135deg, #FF4713 0%, #AD1164 100%)',
          border: 'none', borderRadius: 14, cursor: 'pointer',
          fontSize: 15, fontWeight: 700, color: '#fff',
          letterSpacing: '0.01em',
          boxShadow: '0 8px 32px rgba(255,71,19,0.35)',
        }}
      >
        Get started →
      </button>
    </div>
  )
}
