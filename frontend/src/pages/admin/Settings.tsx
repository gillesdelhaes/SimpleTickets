import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import AdminPageShell from '../../components/admin/AdminPageShell'
import api from '../../lib/api'

interface SettingRead {
  key: string
  value: string | null
  is_secret: boolean
  group_name: string
}

const GROUPS: { name: string; label: string; keys: string[] }[] = [
  {
    name: 'general',
    label: 'General',
    keys: ['timezone'],
  },
  {
    name: 'slack',
    label: 'Slack Integration',
    keys: ['slack_bot_token', 'slack_app_token', 'slack_signing_secret', 'slack_trigger_emoji', 'slack_two_way_sync'],
  },
]

// Common IANA timezones grouped by region
const TIMEZONES = [
  { label: 'UTC', value: 'UTC' },
  // Europe
  { label: 'Europe/London', value: 'Europe/London' },
  { label: 'Europe/Paris', value: 'Europe/Paris' },
  { label: 'Europe/Brussels', value: 'Europe/Brussels' },
  { label: 'Europe/Amsterdam', value: 'Europe/Amsterdam' },
  { label: 'Europe/Berlin', value: 'Europe/Berlin' },
  { label: 'Europe/Rome', value: 'Europe/Rome' },
  { label: 'Europe/Madrid', value: 'Europe/Madrid' },
  { label: 'Europe/Zurich', value: 'Europe/Zurich' },
  { label: 'Europe/Stockholm', value: 'Europe/Stockholm' },
  { label: 'Europe/Helsinki', value: 'Europe/Helsinki' },
  { label: 'Europe/Warsaw', value: 'Europe/Warsaw' },
  { label: 'Europe/Bucharest', value: 'Europe/Bucharest' },
  { label: 'Europe/Moscow', value: 'Europe/Moscow' },
  // Americas
  { label: 'America/New_York', value: 'America/New_York' },
  { label: 'America/Chicago', value: 'America/Chicago' },
  { label: 'America/Denver', value: 'America/Denver' },
  { label: 'America/Los_Angeles', value: 'America/Los_Angeles' },
  { label: 'America/Toronto', value: 'America/Toronto' },
  { label: 'America/Vancouver', value: 'America/Vancouver' },
  { label: 'America/Mexico_City', value: 'America/Mexico_City' },
  { label: 'America/Sao_Paulo', value: 'America/Sao_Paulo' },
  // Asia / Pacific
  { label: 'Asia/Dubai', value: 'Asia/Dubai' },
  { label: 'Asia/Kolkata', value: 'Asia/Kolkata' },
  { label: 'Asia/Singapore', value: 'Asia/Singapore' },
  { label: 'Asia/Tokyo', value: 'Asia/Tokyo' },
  { label: 'Asia/Shanghai', value: 'Asia/Shanghai' },
  { label: 'Asia/Seoul', value: 'Asia/Seoul' },
  { label: 'Australia/Sydney', value: 'Australia/Sydney' },
  { label: 'Pacific/Auckland', value: 'Pacific/Auckland' },
]

const KEY_META: Record<string, { label: string; hint: string; placeholder?: string; type?: string }> = {
  timezone:             { label: 'Timezone', hint: 'All timestamps are displayed in this timezone', type: 'timezone' },
  slack_bot_token:      { label: 'Bot Token', hint: 'Starts with xoxb-', placeholder: 'xoxb-…' },
  slack_app_token:      { label: 'App-Level Token', hint: 'Socket Mode — starts with xapp-', placeholder: 'xapp-…' },
  slack_signing_secret: { label: 'Signing Secret', hint: 'From Basic Information', placeholder: '••••••••' },
  slack_trigger_emoji:  { label: 'Trigger Emoji', hint: 'Reaction that creates a ticket', placeholder: 'clipboard' },
  slack_two_way_sync:   { label: 'Two-way sync', hint: 'Sync web replies to Slack threads and vice versa' },
}

export default function Settings() {
  const queryClient = useQueryClient()
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<Record<string, boolean>>({})
  const [testResult, setTestResult] = useState<{ ok: boolean; team_name?: string; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const { data, isLoading } = useQuery<{ settings: SettingRead[] }>({
    queryKey: ['admin-settings'],
    queryFn: async () => (await api.get('/admin/settings')).data,
  })

  const settingMap = Object.fromEntries((data?.settings ?? []).map(s => [s.key, s]))

  const mutation = useMutation({
    mutationFn: async (updates: { key: string; value: string }[]) => {
      await api.patch('/admin/settings', { settings: updates })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] })
      setEdits({})
      setEditing({})
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    },
  })

  function getValue(key: string): string {
    if (key in edits) return edits[key]
    return settingMap[key]?.value ?? ''
  }

  function handleEdit(key: string, value: string) {
    setEdits(e => ({ ...e, [key]: value }))
  }

  function handleSaveGroup(keys: string[]) {
    const changed = keys
      .filter(k => k in edits)
      .map(k => ({ key: k, value: edits[k] }))
    if (changed.length > 0) mutation.mutate(changed)
  }

  function hasChanges(keys: string[]) {
    return keys.some(k => k in edits)
  }

  async function handleTestSlack() {
    const botToken = getValue('slack_bot_token')
    const appToken = getValue('slack_app_token')
    if (!botToken || !appToken || botToken === '••••••••') return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await api.post('/admin/settings/test-slack', { bot_token: botToken, app_token: appToken })
      setTestResult(res.data)
    } catch {
      setTestResult({ ok: false, error: 'Request failed' })
    } finally {
      setTesting(false)
    }
  }

  if (isLoading) return (
    <AdminPageShell title="Settings">
      <div style={{ color: '#737373', fontSize: 14 }}>Loading…</div>
    </AdminPageShell>
  )

  return (
    <AdminPageShell title="Settings">
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0A0A0A', letterSpacing: '-0.02em', margin: 0 }}>Settings</h1>
          <p style={{ fontSize: 13, color: '#737373', marginTop: 3 }}>
            Changes take effect immediately. Slack reconnects automatically when credentials change.
          </p>
        </div>
        {saveSuccess && (
          <span style={{ fontSize: 13, color: '#059669', fontWeight: 600, background: '#D1FAE5', border: '1px solid #6EE7B7', padding: '6px 14px', borderRadius: 999 }}>
            ✓ Saved
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {GROUPS.map(group => (
          <div key={group.name} style={{ background: '#fff', border: '1px solid #E5E5E5', borderRadius: 12, overflow: 'hidden' }}>
            {/* Group header */}
            <div style={{
              padding: '12px 20px', borderBottom: '1px solid #F2F2F2',
              background: '#FAFAFA', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#262626', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                {group.label}
              </span>
              {group.name === 'slack' && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {testResult && (
                    <span style={{ fontSize: 12, color: testResult.ok ? '#059669' : '#DC2626' }}>
                      {testResult.ok ? `✓ ${testResult.team_name}` : `✗ ${testResult.error}`}
                    </span>
                  )}
                  <button
                    onClick={handleTestSlack}
                    disabled={testing}
                    style={{ fontSize: 12, padding: '4px 12px', borderRadius: 8, border: '1px solid #E5E5E5', background: '#fff', cursor: 'pointer', color: '#737373', fontWeight: 500 }}
                  >
                    {testing ? 'Testing…' : 'Test connection'}
                  </button>
                </div>
              )}
            </div>

            {/* Fields */}
            <div>
              {group.keys.map((key, i) => {
                const meta = KEY_META[key]
                const row = settingMap[key]
                const isTimezone = meta?.type === 'timezone'
                const isToggle = key === 'slack_two_way_sync'
                const isEditing = editing[key] || false
                const val = getValue(key)

                return (
                  <div
                    key={key}
                    style={{
                      padding: '14px 20px',
                      borderBottom: i < group.keys.length - 1 ? '1px solid #F9F9F9' : 'none',
                      display: 'grid',
                      gridTemplateColumns: '220px 1fr auto',
                      gap: 16,
                      alignItems: 'center',
                    }}
                  >
                    {/* Label */}
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#262626' }}>{meta?.label ?? key}</div>
                      {meta?.hint && <div style={{ fontSize: 11, color: '#A3A3A3', marginTop: 2 }}>{meta.hint}</div>}
                    </div>

                    {/* Value / input */}
                    <div>
                      {isTimezone ? (
                        <select
                          value={val || 'UTC'}
                          onChange={e => handleEdit(key, e.target.value)}
                          style={{
                            width: '100%', height: 34, borderRadius: 8,
                            border: key in edits ? '1px solid #FF4713' : '1px solid #E5E5E5',
                            background: key in edits ? '#FFF9F7' : '#FAFAFA',
                            padding: '0 10px', fontSize: 13, color: '#0A0A0A', outline: 'none',
                            boxShadow: key in edits ? '0 0 0 3px rgba(255,71,19,0.08)' : 'none',
                            cursor: 'pointer',
                          }}
                        >
                          {TIMEZONES.map(tz => (
                            <option key={tz.value} value={tz.value}>{tz.label}</option>
                          ))}
                        </select>
                      ) : isToggle ? (
                        <div
                          onClick={() => handleEdit(key, val === 'false' ? 'true' : 'false')}
                          style={{
                            width: 44, height: 24, borderRadius: 12, cursor: 'pointer',
                            background: val !== 'false' ? 'linear-gradient(135deg, #FF4713 0%, #AD1164 100%)' : '#E5E5E5',
                            position: 'relative', transition: 'background 0.2s',
                          }}
                        >
                          <div style={{
                            position: 'absolute', top: 3,
                            left: val !== 'false' ? 23 : 3,
                            width: 18, height: 18, borderRadius: '50%', background: '#fff',
                            transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                          }} />
                        </div>
                      ) : row?.is_secret && !isEditing ? (
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: '#A3A3A3' }}>
                          {val || '—'}
                        </span>
                      ) : (
                        <input
                          value={val}
                          type={row?.is_secret ? 'password' : 'text'}
                          onChange={e => handleEdit(key, e.target.value)}
                          placeholder={meta?.placeholder ?? ''}
                          style={{
                            width: '100%', height: 34, borderRadius: 8,
                            border: key in edits ? '1px solid #FF4713' : '1px solid #E5E5E5',
                            background: key in edits ? '#FFF9F7' : '#FAFAFA',
                            padding: '0 10px', fontSize: 13, color: '#0A0A0A', outline: 'none',
                            fontFamily: row?.is_secret ? 'JetBrains Mono, monospace' : 'inherit',
                            boxShadow: key in edits ? '0 0 0 3px rgba(255,71,19,0.08)' : 'none',
                            boxSizing: 'border-box',
                          }}
                          onFocus={() => {
                            if (row?.is_secret && !isEditing) {
                              setEditing(e => ({ ...e, [key]: true }))
                              setEdits(e => ({ ...e, [key]: '' }))
                            }
                          }}
                        />
                      )}
                    </div>

                    {/* Edit button for secrets */}
                    <div style={{ width: 60, textAlign: 'right' }}>
                      {row?.is_secret && !isEditing && (
                        <button
                          onClick={() => {
                            setEditing(e => ({ ...e, [key]: true }))
                            setEdits(e => ({ ...e, [key]: '' }))
                          }}
                          style={{ fontSize: 12, color: '#FF4713', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: '4px 8px' }}
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Save button */}
            {hasChanges(group.keys) && (
              <div style={{ padding: '12px 20px', borderTop: '1px solid #F2F2F2', background: '#FAFAFA', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => handleSaveGroup(group.keys)}
                  disabled={mutation.isPending}
                  style={{
                    height: 36, paddingLeft: 20, paddingRight: 20,
                    background: 'linear-gradient(135deg, #FF4713 0%, #AD1164 100%)',
                    border: 'none', borderRadius: 8, cursor: 'pointer',
                    fontSize: 13, fontWeight: 600, color: '#fff',
                    boxShadow: '0 2px 8px rgba(255,71,19,0.2)',
                  }}
                >
                  {mutation.isPending ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <p style={{ fontSize: 11, color: '#D4D4D4', marginTop: 20, textAlign: 'center' }}>
        DATABASE_URL is set via environment variable and cannot be changed here.
      </p>
    </AdminPageShell>
  )
}
