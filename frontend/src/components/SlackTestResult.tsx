export interface SlackTestResultData {
  ok: boolean
  team_name?: string
  error?: string
  missing_scopes?: string[]
}

/** Outcome of a Slack "Test connection": connected, connected but missing
 *  bot permissions (the token still works, some features won't), or failed. */
export default function SlackTestResult({ result, size = 13 }: { result: SlackTestResultData; size?: number }) {
  if (!result.ok) return <span className="text-danger-ink" style={{ fontSize: size }}>✗ {result.error}</span>
  const missing = result.missing_scopes ?? []
  if (!missing.length) return <span className="text-ok-ink" style={{ fontSize: size }}>✓ Connected to {result.team_name}</span>
  return (
    <span className="text-warn-ink" style={{ fontSize: size }}>
      ⚠ Connected to {result.team_name}, but the app is missing{' '}
      {missing.map((s, i) => <span key={s}>{i > 0 && ', '}<code className="font-mono">{s}</code></span>)}.
      {' '}Add {missing.length > 1 ? 'them' : 'it'} under OAuth &amp; Permissions in the Slack app, then Reinstall to Workspace.
    </span>
  )
}
