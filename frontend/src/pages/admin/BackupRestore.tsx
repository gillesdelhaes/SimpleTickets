import { useRef, useState } from 'react'
import AdminPageShell from '../../components/admin/AdminPageShell'
import api from '../../lib/api'

export default function BackupRestore() {
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const [dragOver, setDragOver] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreResult, setRestoreResult] = useState<{ ok: boolean; restored_files: number } | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleDownload() {
    setDownloading(true)
    setDownloadError(null)
    try {
      const res = await api.get('/admin/backup', { responseType: 'blob' })
      const disposition: string = res.headers['content-disposition'] ?? ''
      const match = disposition.match(/filename="([^"]+)"/)
      const filename = match ? match[1] : 'simpletickets_backup.zip'
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/zip' }))
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setDownloadError('Download failed. Check the backend logs.')
    } finally {
      setDownloading(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped?.name.endsWith('.zip')) {
      setFile(dropped)
      setRestoreResult(null)
      setRestoreError(null)
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    if (picked) {
      setFile(picked)
      setRestoreResult(null)
      setRestoreError(null)
    }
  }

  async function handleRestore() {
    if (!file || !confirmed) return
    setRestoring(true)
    setRestoreError(null)
    setRestoreResult(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await api.post<{ ok: boolean; restored_files: number }>('/admin/restore', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setRestoreResult(res.data)
      setFile(null)
      setConfirmed(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err: any) {
      const detail = err?.response?.data?.detail ?? 'Restore failed. Check the backend logs.'
      setRestoreError(detail)
    } finally {
      setRestoring(false)
    }
  }

  return (
    <AdminPageShell title="Backup & Restore">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 720 }}>

        {/* ── Export section ── */}
        <section style={{
          background: '#fff',
          border: '1px solid #E5E5E5',
          borderRadius: 12,
          padding: '28px 32px',
        }}>
          <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: '#0A0A0A', letterSpacing: '-0.02em' }}>
            Export backup
          </h2>
          <p style={{ margin: '0 0 24px', fontSize: 13, color: '#737373', lineHeight: 1.6 }}>
            Downloads a <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, background: '#F2F2F2', padding: '1px 5px', borderRadius: 4 }}>.zip</code> archive
            containing all tickets, replies, users, categories, SLA policies, settings,
            and attachment files. Slack credentials and the JWT secret are excluded.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{
              background: '#FFF8F6',
              border: '1px solid rgba(255,71,19,0.12)',
              borderRadius: 8,
              padding: '12px 16px',
              fontSize: 13,
              color: '#737373',
              lineHeight: 1.6,
            }}>
              <strong style={{ color: '#0A0A0A' }}>What's included:</strong> all tickets and their full history,
              replies, attachments, users (with hashed passwords), categories, SLA policies,
              non-secret app settings, audit log, read markers, and Slack thread anchors.
            </div>

            <button
              onClick={handleDownload}
              disabled={downloading}
              style={{
                alignSelf: 'flex-start',
                background: downloading ? '#F2F2F2' : '#0A0A0A',
                color: downloading ? '#A3A3A3' : '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '10px 20px',
                fontSize: 13,
                fontWeight: 600,
                cursor: downloading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                transition: 'background 0.15s',
              }}
              onMouseOver={e => { if (!downloading) e.currentTarget.style.background = '#1F1F1F' }}
              onMouseOut={e => { if (!downloading) e.currentTarget.style.background = '#0A0A0A' }}
            >
              {downloading ? (
                <>
                  <Spinner />
                  Preparing…
                </>
              ) : (
                <>
                  <IconDownload />
                  Download backup
                </>
              )}
            </button>

            {downloadError && (
              <p style={{ margin: 0, fontSize: 13, color: '#EF4444' }}>{downloadError}</p>
            )}
          </div>
        </section>

        {/* ── Restore section ── */}
        <section style={{
          background: '#fff',
          border: '1px solid #E5E5E5',
          borderRadius: 12,
          padding: '28px 32px',
        }}>
          <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: '#0A0A0A', letterSpacing: '-0.02em' }}>
            Restore from backup
          </h2>
          <p style={{ margin: '0 0 24px', fontSize: 13, color: '#737373', lineHeight: 1.6 }}>
            Upload a backup zip to restore all data. This is intended for disaster recovery or
            migrating to a new instance. All current data will be permanently overwritten.
          </p>

          {/* Warning banner */}
          <div style={{
            background: '#FEF2F2',
            border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 24,
            fontSize: 13,
            color: '#991B1B',
            lineHeight: 1.6,
            display: 'flex',
            gap: 10,
          }}>
            <span style={{ flexShrink: 0, marginTop: 1 }}>
              <IconWarning />
            </span>
            <div>
              <strong>This will permanently overwrite all existing data.</strong> All current
              tickets, users, and settings will be replaced with the contents of the backup.
              Slack credentials and the JWT secret are not affected — they must be re-entered
              after the restore if this is a fresh instance.
            </div>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? '#FF4713' : file ? '#22C55E' : '#E5E5E5'}`,
              borderRadius: 10,
              padding: '32px 24px',
              textAlign: 'center',
              cursor: 'pointer',
              background: dragOver ? 'rgba(255,71,19,0.02)' : file ? 'rgba(34,197,94,0.02)' : '#FAFAFA',
              transition: 'border-color 0.15s, background 0.15s',
              marginBottom: 20,
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            {file ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 24 }}>
                  <IconFile />
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#0A0A0A' }}>{file.name}</span>
                <span style={{ fontSize: 12, color: '#737373' }}>
                  {(file.size / 1024 / 1024).toFixed(2)} MB — click to change
                </span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#A3A3A3' }}>
                  <IconUpload />
                </span>
                <span style={{ fontSize: 13, color: '#737373' }}>
                  Drop a <strong>.zip</strong> backup here or click to browse
                </span>
              </div>
            )}
          </div>

          {/* Confirmation checkbox */}
          <label style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            cursor: 'pointer',
            marginBottom: 20,
          }}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              style={{ marginTop: 2, accentColor: '#FF4713', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 13, color: '#0A0A0A', lineHeight: 1.5 }}>
              I understand that all current tickets, users, and settings will be permanently
              overwritten and cannot be recovered.
            </span>
          </label>

          {/* Restore button */}
          <button
            onClick={handleRestore}
            disabled={!file || !confirmed || restoring}
            style={{
              background: (!file || !confirmed || restoring) ? '#F2F2F2' : '#DC2626',
              color: (!file || !confirmed || restoring) ? '#A3A3A3' : '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '10px 20px',
              fontSize: 13,
              fontWeight: 600,
              cursor: (!file || !confirmed || restoring) ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'background 0.15s',
            }}
            onMouseOver={e => { if (file && confirmed && !restoring) e.currentTarget.style.background = '#B91C1C' }}
            onMouseOut={e => { if (file && confirmed && !restoring) e.currentTarget.style.background = '#DC2626' }}
          >
            {restoring ? (
              <>
                <Spinner color="#A3A3A3" />
                Restoring…
              </>
            ) : (
              'Restore from backup'
            )}
          </button>

          {/* Result / error */}
          {restoreResult && (
            <div style={{
              marginTop: 16,
              background: '#F0FDF4',
              border: '1px solid rgba(34,197,94,0.25)',
              borderRadius: 8,
              padding: '12px 16px',
              fontSize: 13,
              color: '#166534',
            }}>
              Restore complete. {restoreResult.restored_files} attachment file{restoreResult.restored_files !== 1 ? 's' : ''} restored.
              Reload the page to see the updated data.
            </div>
          )}
          {restoreError && (
            <div style={{
              marginTop: 16,
              background: '#FEF2F2',
              border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 8,
              padding: '12px 16px',
              fontSize: 13,
              color: '#991B1B',
            }}>
              {restoreError}
            </div>
          )}
        </section>
      </div>
    </AdminPageShell>
  )
}

// ── Inline icons ──────────────────────────────────────────────────────────────

function IconDownload() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.5 1v9M4 7l3.5 3.5L11 7" />
      <path d="M1.5 11.5v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1" />
    </svg>
  )
}

function IconUpload() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 22v-12M11 15l5-5 5 5" />
      <path d="M5 24v1a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2v-1" />
    </svg>
  )
}

function IconFile() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="#22C55E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 2H7a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V10z" />
      <path d="M16 2v8h8" />
    </svg>
  )
}

function IconWarning() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2L14.5 13H1.5L8 2z" />
      <path d="M8 6v3.5M8 11.5v.5" />
    </svg>
  )
}

function Spinner({ color = '#fff' }: { color?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 0.8s linear infinite' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <path d="M7 1a6 6 0 1 1-4.24 1.76" />
    </svg>
  )
}
