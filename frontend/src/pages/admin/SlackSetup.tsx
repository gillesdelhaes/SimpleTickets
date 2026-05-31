import { useState } from 'react'
import AppShell from '../../components/layout/AppShell'

// ── Copy button ────────────────────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }
  return (
    <button
      onClick={handleCopy}
      style={{
        background: copied ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.06)',
        border: `1px solid ${copied ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.1)'}`,
        borderRadius: 5, padding: '2px 8px', cursor: 'pointer',
        fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
        color: copied ? '#10B981' : 'rgba(255,255,255,0.7)',
        display: 'inline-flex', alignItems: 'center', gap: 4,
        transition: 'all 0.15s', flexShrink: 0,
      }}
    >
      {copied ? (
        <>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 6l3 3 5-5" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="7" height="7" rx="1" />
            <path d="M2 8V2h6" />
          </svg>
          Copy
        </>
      )}
    </button>
  )
}

// ── Scope / event row ──────────────────────────────────────────────────────────

function ScopeRow({ name, description }: { name: string; description: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)',
      gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <code style={{
          fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
          color: '#FF4713', background: 'rgba(255,71,19,0.08)',
          border: '1px solid rgba(255,71,19,0.15)',
          borderRadius: 4, padding: '2px 7px', flexShrink: 0,
        }}>
          {name}
        </code>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', minWidth: 0 }}>
          {description}
        </span>
      </div>
      <CopyButton value={name} />
    </div>
  )
}

// ── Step card ──────────────────────────────────────────────────────────────────

function Step({
  number,
  title,
  children,
}: {
  number: number
  title: string
  children: React.ReactNode
}) {
  return (
    <div style={{
      background: '#111', border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 12, overflow: 'hidden', marginBottom: 16,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '16px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
          background: 'linear-gradient(135deg, #FF4713, #AD1164)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, color: '#fff',
        }}>
          {number}
        </div>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: '#fff', margin: 0, letterSpacing: '-0.01em' }}>
          {title}
        </h3>
      </div>
      {/* Body */}
      <div style={{ padding: '16px 20px' }}>
        {children}
      </div>
    </div>
  )
}

// ── Callout ────────────────────────────────────────────────────────────────────

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'rgba(255,71,19,0.06)', border: '1px solid rgba(255,71,19,0.18)',
      borderLeft: '3px solid #FF4713', borderRadius: '0 8px 8px 0',
      padding: '10px 14px', fontSize: 13, color: 'rgba(255,255,255,0.6)',
      lineHeight: 1.6, marginTop: 12,
    }}>
      {children}
    </div>
  )
}

// ── Nav path display ───────────────────────────────────────────────────────────

function NavPath({ steps }: { steps: string[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, margin: '10px 0' }}>
      {steps.map((step, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{
            fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.75)',
            background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 5, padding: '2px 9px',
          }}>
            {step}
          </span>
          {i < steps.length - 1 && (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 2l4 3-4 3" />
            </svg>
          )}
        </span>
      ))}
    </div>
  )
}

// ── Body text helpers ──────────────────────────────────────────────────────────

const p: React.CSSProperties = { fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.7, margin: '6px 0' }
const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.3)', marginTop: 14, marginBottom: 6, display: 'block' }

// ── Page ───────────────────────────────────────────────────────────────────────

export default function SlackSetup() {
  return (
    <AppShell title="Slack App Setup">
      <div style={{ maxWidth: 760 }}>

        {/* Intro */}
        <div style={{ marginBottom: 28 }}>
          <p style={{ fontSize: 14, color: 'rgba(10,10,10,0.6)', lineHeight: 1.7, margin: 0 }}>
            SimplyTickets uses a <strong>private Slack app</strong> installed in your workspace.
            Each deployment needs its own app. Follow the steps below to create it and get the tokens required in Settings.
          </p>
        </div>

        <Step number={1} title="Create a new Slack app">
          <p style={p}>Go to <strong style={{ color: 'rgba(255,255,255,0.8)' }}>api.slack.com/apps</strong> and click <strong style={{ color: 'rgba(255,255,255,0.8)' }}>Create New App → From scratch</strong>.</p>
          <p style={p}>Give it a name (e.g. <em>SimplyTickets</em>) and select your workspace.</p>
        </Step>

        <Step number={2} title="Enable Socket Mode">
          <NavPath steps={['Settings', 'Socket Mode']} />
          <p style={p}>Toggle <strong style={{ color: 'rgba(255,255,255,0.8)' }}>Enable Socket Mode</strong> on.</p>
          <p style={p}>You'll be prompted to generate an <strong style={{ color: 'rgba(255,255,255,0.8)' }}>App-Level Token</strong>. Give it any name, add the <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#FF4713' }}>connections:write</code> scope, and click <strong style={{ color: 'rgba(255,255,255,0.8)' }}>Generate</strong>.</p>
          <Callout>This token starts with <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>xapp-</code> — copy it, you'll need it in Settings.</Callout>
        </Step>

        <Step number={3} title="Add Bot Token Scopes">
          <NavPath steps={['Features', 'OAuth & Permissions', 'Scopes', 'Bot Token Scopes']} />
          <p style={p}>Add each of the following scopes:</p>
          <div style={{ background: '#0A0A0A', borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)', marginTop: 10, overflow: 'hidden' }}>
            <ScopeRow name="chat:write" description="Post messages to channels and DMs" />
            <ScopeRow name="files:read" description="Download files sent by users in Slack" />
            <ScopeRow name="files:write" description="Upload web attachments to Slack threads" />
            <ScopeRow name="reactions:read" description="Detect emoji reactions that create tickets" />
            <ScopeRow name="users:read" description="Fetch display names for Slack users" />
            <ScopeRow name="channels:history" description="Read channel messages (needed for emoji reaction handler)" />
            <ScopeRow name="groups:history" description="Same for private channels" />
            <ScopeRow name="im:history" description="Read DM messages from users" />
          </div>
        </Step>

        <Step number={4} title="Subscribe to Bot Events">
          <NavPath steps={['Features', 'Event Subscriptions']} />
          <p style={p}>Toggle <strong style={{ color: 'rgba(255,255,255,0.8)' }}>Enable Events</strong> on, then open <strong style={{ color: 'rgba(255,255,255,0.8)' }}>Subscribe to bot events</strong> and add:</p>
          <div style={{ background: '#0A0A0A', borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)', marginTop: 10, overflow: 'hidden' }}>
            <ScopeRow name="message.im" description="DM messages sent to the bot" />
            <ScopeRow name="message.channels" description="Thread replies in public channels" />
            <ScopeRow name="message.groups" description="Thread replies in private channels" />
            <ScopeRow name="reaction_added" description="Emoji reactions that trigger ticket creation" />
            <ScopeRow name="app_home_opened" description="Render the App Home tab for end users" />
          </div>
          <p style={{ ...p, marginTop: 12 }}>Save changes at the bottom of the page.</p>
        </Step>

        <Step number={5} title="Enable Interactivity">
          <NavPath steps={['Features', 'Interactivity & Shortcuts']} />
          <p style={p}>Toggle <strong style={{ color: 'rgba(255,255,255,0.8)' }}>Interactivity</strong> on. This is required for modals (the <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#FF4713' }}>/ticket</code> command) and App Home buttons to work.</p>
          <p style={p}>The <strong style={{ color: 'rgba(255,255,255,0.8)' }}>Request URL</strong> field can be left blank — Socket Mode doesn't use it.</p>
        </Step>

        <Step number={6} title="Enable the App Home tab">
          <NavPath steps={['Features', 'App Home']} />
          <p style={p}>Under <strong style={{ color: 'rgba(255,255,255,0.8)' }}>Show Tabs</strong>, enable the <strong style={{ color: 'rgba(255,255,255,0.8)' }}>Home Tab</strong>. This lets end users see their open tickets from the bot's profile in Slack.</p>
          <p style={p}>Optionally enable the <strong style={{ color: 'rgba(255,255,255,0.8)' }}>Messages Tab</strong> so users can DM the bot directly.</p>
        </Step>

        <Step number={7} title="Add the /ticket slash command (optional)">
          <NavPath steps={['Features', 'Slash Commands', 'Create New Command']} />
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px 16px', marginTop: 8 }}>
            {[
              ['Command', '/ticket'],
              ['Short Description', 'Submit a support ticket'],
              ['Usage Hint', '[describe your issue]'],
            ].map(([k, v]) => (
              <>
                <span key={k} style={{ ...label, margin: 0, alignSelf: 'center' }}>{k}</span>
                <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{v}</code>
                  <CopyButton value={v} />
                </div>
              </>
            ))}
          </div>
          <p style={{ ...p, marginTop: 12 }}>The Request URL can be left blank with Socket Mode.</p>
        </Step>

        <Step number={8} title="Install the app to your workspace">
          <NavPath steps={['Settings', 'Install App', 'Install to Workspace']} />
          <p style={p}>Click <strong style={{ color: 'rgba(255,255,255,0.8)' }}>Install to Workspace</strong> and authorise.</p>
          <p style={p}>After installation, copy the <strong style={{ color: 'rgba(255,255,255,0.8)' }}>Bot User OAuth Token</strong>.</p>
          <Callout>This token starts with <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>xoxb-</code> — copy it, you'll need it in Settings alongside the App-Level Token from Step 2.</Callout>
          <Callout>Whenever you add new OAuth scopes, you must <strong>reinstall the app</strong> here to get a fresh token with the updated permissions.</Callout>
        </Step>

        <Step number={9} title="Enter your tokens in SimplyTickets Settings">
          <p style={p}>Go to <strong style={{ color: 'rgba(255,255,255,0.8)' }}>Admin → Settings → Slack</strong> and fill in:</p>
          <div style={{ background: '#0A0A0A', borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)', marginTop: 10, overflow: 'hidden' }}>
            <ScopeRow name="Bot Token" description="xoxb-… from Step 8" />
            <ScopeRow name="App-Level Token" description="xapp-… from Step 2" />
            <ScopeRow name="Signing Secret" description="From Basic Information → App Credentials" />
            <ScopeRow name="Trigger Emoji" description="Slack reaction name that creates a ticket (e.g. clipboard)" />
          </div>
          <p style={{ ...p, marginTop: 12 }}>Save — the bot connects immediately. No restart needed.</p>
        </Step>

        {/* Summary table */}
        <div style={{
          background: '#111', border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 12, overflow: 'hidden',
        }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: '#fff', margin: 0 }}>Quick reference — features and what enables them</h3>
          </div>
          <div style={{ padding: '4px 0' }}>
            {[
              ['DM to bot creates a ticket', 'message.im event + im:history scope'],
              ['Emoji reaction creates a ticket', 'reaction_added event + reactions:read + channels:history'],
              ['/ticket modal', 'Slash command + Interactivity enabled'],
              ['App Home shows open tickets', 'app_home_opened event + Home Tab enabled'],
              ['Web → Slack reply sync', 'chat:write scope'],
              ['Slack → web file attachments', 'files:read scope'],
              ['Web → Slack file attachments', 'files:write scope'],
              ['Ticket field changes posted to thread', 'chat:write scope'],
            ].map(([feature, requirement]) => (
              <div key={feature} style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr',
                padding: '8px 20px', borderBottom: '1px solid rgba(255,255,255,0.03)',
                gap: 16,
              }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>{feature}</span>
                <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'rgba(255,255,255,0.35)' }}>{requirement}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </AppShell>
  )
}
