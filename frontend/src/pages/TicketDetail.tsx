import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import AppShell from '../components/layout/AppShell'
import AuthImage from '../components/AuthImage'
import RichText from '../components/RichText'
import SLABadge from '../components/tickets/SLABadge'
import DeleteTicketsDialog from '../components/tickets/DeleteTicketsDialog'
import ResolveUnansweredDialog from '../components/tickets/ResolveUnansweredDialog'
import RequesterTickets from '../components/tickets/RequesterTickets'
import RequesterSlackLink from '../components/tickets/RequesterSlackLink'
import { isResolvedStatus, parseSLABar, parseSLABarRaw, parseSLAPaused } from '../types/ticket'
import { useMarkDuplicate, useUnmarkDuplicate } from '../hooks/useDuplicate'
import { useTicket } from '../hooks/useTicket'
import { useReplies, useAddReply, type ReplyRead } from '../hooks/useReplies'
import { useTicketHistory, type HistoryEvent } from '../hooks/useTicketHistory'
import { useAttachments, type AttachmentRead, isImage, formatBytes } from '../hooks/useAttachments'
import { useCategories } from '../hooks/useCategories'
import { useAgents } from '../hooks/useAgents'
import { useAuth } from '../contexts/AuthContext'
import { useMarkTicketRead } from '../hooks/useUnreadReplies'
import api, { apiErrorMessage } from '../lib/api'
import { useAppConfig } from '../hooks/useAppConfig'
import { ThumbUp, ThumbDown } from '../components/ThumbIcon'
import {
  getAllStatuses,
  statusColor,
  statusLabel,
  PRIORITY_LABELS,
  timeAgo,
  type TicketRead,
  type Priority,
} from '../types/ticket'

// Priority text wears the reserved semantic tokens (matches PriorityBadge)
const PRIORITY_INK: Record<Priority, string> = {
  critical: 'var(--danger-ink)',
  high: 'var(--warn-ink)',
  medium: 'var(--ink)',
  low: 'var(--ink-2)',
}

// ── Avatar ─────────────────────────────────────────────────────────────────────

function initials(name: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

interface AvatarProps {
  name: string | null
  size?: number
}

function Avatar({ name, size = 32 }: AvatarProps) {
  return (
    <div
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.36, borderRadius: size * 0.32 }}
    >
      {initials(name)}
    </div>
  )
}

// ── Attachment list ────────────────────────────────────────────────────────────

function AttachmentList({ attachments }: { attachments: AttachmentRead[] }) {
  const [lightbox, setLightbox] = useState<number | null>(null)
  if (attachments.length === 0) return null

  return (
    <>
      <div className="flex flex-wrap gap-2 mt-2.5">
        {attachments.map(att => (
          isImage(att.mime_type) ? (
            <AuthImage
              key={att.id}
              attachmentId={att.id}
              alt={att.filename}
              onClick={() => setLightbox(att.id)}
            />
          ) : (
            <button
              key={att.id}
              type="button"
              onClick={() => {
                api.get(`/attachments/${att.id}/download`, { responseType: 'blob' }).then(r => {
                  const url = URL.createObjectURL(r.data)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = att.filename
                  a.click()
                  URL.revokeObjectURL(url)
                })
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[10px] border border-edge bg-field text-[12px] text-ink cursor-pointer hover:bg-row-hover"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-ink-2">
                <path d="M9 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6L9 2z" />
                <path d="M9 2v4h4" />
              </svg>
              <span className="max-w-[160px] truncate">{att.filename}</span>
              <span className="font-mono text-[10.5px] text-ink-3 flex-shrink-0">{formatBytes(att.size_bytes)}</span>
            </button>
          )
        ))}
      </div>

      {/* Lightbox */}
      {lightbox !== null && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed', inset: 0, background: 'var(--scrim)',
            backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
            zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'zoom-out',
          }}
        >
          <AuthImage
            attachmentId={lightbox}
            style={{ maxWidth: '90vw', maxHeight: '90vh', border: 'none', borderRadius: 12 }}
          />
        </div>
      )}
    </>
  )
}

// ── Reply bubble ───────────────────────────────────────────────────────────────

interface ReplyBubbleProps {
  reply: ReplyRead
  isOwn: boolean
  isTech: boolean
  attachments: AttachmentRead[]
}

function ReplyBubble({ reply, isOwn, isTech, attachments }: ReplyBubbleProps) {
  const isInternal = reply.is_internal

  if (isInternal) {
    return (
      <div className="flex gap-2.5 animate-fade-up">
        <Avatar name={reply.author_name} size={30} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[12px] font-semibold text-ink">{reply.author_name ?? 'Unknown'}</span>
            {reply.ai_generated && (
              <span
                className="text-[10px] font-bold uppercase tracking-[0.06em] rounded-md px-1.5 py-px text-brand-ink"
                style={{ background: 'var(--brand-tint)' }}
                title="Written by the AI Assistant — suggestions only, nothing was changed"
              >
                AI
              </span>
            )}
            <span
              className="text-[10px] font-bold uppercase tracking-[0.06em] rounded-md px-1.5 py-px text-warn-ink"
              style={{ background: 'var(--warn-bg)' }}
            >
              Internal
            </span>
            <span className="font-mono text-[10.5px] text-ink-3">{timeAgo(reply.created_at)}</span>
          </div>
          <div
            className="rounded-r-[12px] px-3.5 py-2.5 text-[13.5px] text-ink leading-relaxed whitespace-pre-wrap break-words"
            style={{ borderLeft: '3px solid var(--warn-ink)', background: 'var(--warn-bg)' }}
          >
            <RichText text={reply.body} />
            <AttachmentList attachments={attachments} />
          </div>
        </div>
      </div>
    )
  }

  if (isOwn) {
    return (
      <div className="flex gap-2.5 justify-end animate-fade-up">
        <div style={{ maxWidth: '72%' }}>
          <div className="flex items-center gap-2 mb-1.5 justify-end">
            <span className="font-mono text-[10.5px] text-ink-3">{timeAgo(reply.created_at)}</span>
            <span className="text-[12px] font-semibold text-ink">You</span>
          </div>
          <div
            className="px-3.5 py-2.5 text-[13.5px] text-ink leading-relaxed whitespace-pre-wrap break-words"
            style={{
              background: 'var(--brand-tint)',
              border: '1px solid color-mix(in oklab, var(--b1) 25%, transparent)',
              borderRadius: '14px 5px 14px 14px',
            }}
          >
            <RichText text={reply.body} />
            <AttachmentList attachments={attachments} />
          </div>
        </div>
        <Avatar name={reply.author_name} size={30} />
      </div>
    )
  }

  return (
    <div className="flex gap-2.5 animate-fade-up">
      <Avatar name={reply.author_name} size={30} />
      <div style={{ maxWidth: '72%' }}>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[12px] font-semibold text-ink">{reply.author_name ?? 'Support'}</span>
          {isTech && (
            <span className="text-[10px] font-semibold text-ink-3 rounded-md px-1.5 py-px bg-field border border-edge">
              Team
            </span>
          )}
          <span className="font-mono text-[10.5px] text-ink-3">{timeAgo(reply.created_at)}</span>
        </div>
        <div
          className="px-3.5 py-2.5 text-[13.5px] text-ink leading-relaxed whitespace-pre-wrap break-words bg-field border border-edge"
          style={{ borderRadius: '5px 14px 14px 14px', boxShadow: 'inset 0 1px 0 var(--specular)' }}
        >
          <RichText text={reply.body} />
          <AttachmentList attachments={attachments} />
        </div>
      </div>
    </div>
  )
}

// ── Composer ───────────────────────────────────────────────────────────────────

// Mirrors the server's allowlist (routers/attachments.py), which is what
// actually enforces it: images except SVG, PDF, text/CSV, Office, zip.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const ATTACHMENT_EXTENSIONS = ['.pdf', '.txt', '.csv', '.doc', '.docx', '.xls', '.xlsx', '.zip']
const ATTACHMENT_ACCEPT = ['image/*', ...ATTACHMENT_EXTENSIONS].join(',')

function isAllowedAttachment(file: File): boolean {
  const name = file.name.toLowerCase()
  if (file.type === 'image/svg+xml' || name.endsWith('.svg')) return false
  if (file.type.startsWith('image/')) return true
  return ATTACHMENT_EXTENSIONS.some(ext => name.endsWith(ext))
}

/** Clipboard images arrive as "image.png" — give them a findable name. */
function nameScreenshot(file: File): File {
  if (!file.type.startsWith('image/') || !/^image\.\w+$/i.test(file.name)) return file
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
  const ext = file.name.split('.').pop()
  return new File([file], `screenshot-${stamp}.${ext}`, { type: file.type })
}

interface ComposerProps {
  ticketId: number
  isTech: boolean
  disabled?: boolean
}

function Composer({ ticketId, isTech, disabled }: ComposerProps) {
  const [body, setBody] = useState('')
  const [mode, setMode] = useState<'reply' | 'internal'>('reply')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const addReply = useAddReply(ticketId)
  const queryClient = useQueryClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() || uploading || addReply.isPending) return
    try {
      setUploading(true)
      setAttachError(null)
      const reply = await addReply.mutateAsync({ body: body.trim(), is_internal: mode === 'internal' })
      setBody('')
      if (pendingFiles.length > 0) {
        // The reply already posted; upload each file and report any that fail
        // instead of swallowing the error (which would silently lose files).
        const failed: File[] = []
        for (const file of pendingFiles) {
          try {
            const form = new FormData()
            form.append('file', file)
            await api.post(
              `/tickets/${ticketId}/attachments?reply_id=${reply.id}`,
              form,
              { headers: { 'Content-Type': 'multipart/form-data' } },
            )
          } catch {
            failed.push(file)
          }
        }
        setPendingFiles(failed)  // keep only the ones that failed, so they can be retried
        if (failed.length > 0) {
          setAttachError(
            `Reply posted, but ${failed.length} attachment${failed.length > 1 ? 's' : ''} failed to upload: ${failed.map(f => f.name).join(', ')}`,
          )
        }
        queryClient.invalidateQueries({ queryKey: ['attachments', ticketId] })
      }
    } catch {
      // Reply itself failed — surfaced via addReply.isError below.
    } finally {
      setUploading(false)
    }
  }

  // Picked, pasted and dropped files all go through the same checks. The
  // server re-checks type (from the bytes) and size; this just gives an
  // immediate answer instead of a failed upload after the reply is sent.
  function addFiles(files: File[]) {
    const accepted: File[] = []
    const rejected: string[] = []
    for (const file of files) {
      if (!isAllowedAttachment(file)) rejected.push(`${file.name} (type not allowed)`)
      else if (file.size > MAX_ATTACHMENT_BYTES) rejected.push(`${file.name} (over 10 MB)`)
      else accepted.push(file)
    }
    if (accepted.length > 0) setPendingFiles(prev => [...prev, ...accepted])
    setAttachError(rejected.length > 0 ? `Not attached: ${rejected.join(', ')}` : null)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(e.target.files ?? []))
    e.target.value = ''
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files)
    if (files.length === 0) return  // plain text paste — leave it alone
    e.preventDefault()
    addFiles(files.map(nameScreenshot))
  }

  function handleDragOver(e: React.DragEvent) {
    if (disabled || !e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }

  function handleDrop(e: React.DragEvent) {
    setDragging(false)
    if (disabled || e.dataTransfer.files.length === 0) return
    e.preventDefault()
    addFiles(Array.from(e.dataTransfer.files))
  }

  function removeFile(idx: number) {
    setPendingFiles(prev => prev.filter((_, i) => i !== idx))
  }

  const isInternal = mode === 'internal'
  const isBusy = addReply.isPending || uploading
  const canSubmit = body.trim().length > 0 && !isBusy && !disabled

  return (
    <form
      onSubmit={handleSubmit}
      onDragOver={handleDragOver}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }}
      onDrop={handleDrop}
    >
      {/* Mode toggle for technicians */}
      {isTech && (
        <div className="flex gap-1.5 mb-2.5">
          <button
            type="button"
            onClick={() => setMode('reply')}
            className={`chip${mode === 'reply' ? ' on' : ''}`}
          >
            Reply to user
          </button>
          <button
            type="button"
            onClick={() => setMode('internal')}
            className={`chip${mode === 'internal' ? ' on' : ''}`}
            style={mode === 'internal' ? { borderColor: 'var(--warn-ink)', color: 'var(--warn-ink)' } : undefined}
          >
            Internal note
          </button>
        </div>
      )}

      <textarea
        id="reply-composer"
        ref={textareaRef}
        className="input"
        value={body}
        onChange={e => setBody(e.target.value)}
        onPaste={handlePaste}
        placeholder={
          dragging
            ? 'Drop files to attach them'
            : isInternal
              ? 'Add an internal note — only visible to your team…'
              : 'Write a reply to the user… Paste or drop files to attach them.'
        }
        rows={4}
        disabled={disabled}
        style={{
          resize: 'vertical',
          minHeight: 100,
          lineHeight: 1.6,
          ...(isInternal ? { borderLeft: '3px solid var(--warn-ink)' } : {}),
          ...(dragging ? { outline: '2px dashed var(--b1)', outlineOffset: 2 } : {}),
        }}
      />

      {/* File previews */}
      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {pendingFiles.map((file, idx) => (
            <div key={idx} className="inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-[10px] bg-field border border-edge text-[12px] text-ink max-w-[220px]">
              <span className="truncate flex-1">{file.name}</span>
              <button
                type="button"
                onClick={() => removeFile(idx)}
                aria-label={`Remove ${file.name}`}
                className="bg-transparent border-0 cursor-pointer p-0 text-ink-3 hover:text-ink flex items-center flex-shrink-0"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M2 2l8 8M10 2l-8 8" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between items-center mt-2.5">
        <div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="btn ghost sm"
            style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 8.5v3a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-3" />
              <path d="M8 1v8M5.5 3.5L8 1l2.5 2.5" />
            </svg>
            Attach
          </button>
        </div>

        <button
          type="submit"
          className="btn"
          disabled={!canSubmit}
          style={!canSubmit ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
        >
          {isBusy && (
            <span
              className="animate-spin inline-block rounded-full"
              style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.35)', borderTopColor: '#fff' }}
            />
          )}
          {isInternal ? 'Add note' : 'Send reply'}
        </button>
      </div>
      {attachError && (
        <p className="mt-2 mb-0 text-[12px] text-danger-ink">{attachError}</p>
      )}
    </form>
  )
}

// ── Metadata field row ─────────────────────────────────────────────────────────

interface MetaRowProps {
  label: string
  children: React.ReactNode
}

function MetaRow({ label, children }: MetaRowProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-3">
        {label}
      </span>
      {children}
    </div>
  )
}

// ── Saved flash ────────────────────────────────────────────────────────────────

function SavedFlash({ show }: { show: boolean }) {
  return (
    <span
      className="text-[11px] font-semibold text-ok-ink ml-1.5 transition-opacity duration-300"
      style={{ opacity: show ? 1 : 0 }}
    >
      ✓ Saved
    </span>
  )
}

// ── Editable title ─────────────────────────────────────────────────────────────
// Click to edit (Enter / blur saves, Escape cancels). Read-only on frozen
// (resolved/closed) tickets — reopen first, like every other field.

function EditableTitle({ ticket, editable }: { ticket: TicketRead; editable: boolean }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(ticket.title)
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (title: string) => api.patch<TicketRead>(`/tickets/${ticket.id}`, { title }).then(r => r.data),
    onSuccess: updated => {
      queryClient.setQueryData(['ticket', ticket.id], updated)
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      queryClient.invalidateQueries({ queryKey: ['ticket-history', ticket.id] })
      setEditing(false)
    },
    onError: err => setError(apiErrorMessage(err, 'Could not save the title.')),
  })

  function commit() {
    const t = value.trim()
    if (!t || t === ticket.title) { setEditing(false); setValue(ticket.title); return }
    save.mutate(t)
  }

  const h1Class = 'text-[20px] font-bold text-ink tracking-[-0.01em] leading-tight mt-0'

  if (editing) {
    return (
      <div className="mb-5">
        <input
          className="input"
          autoFocus
          value={value}
          maxLength={200}
          disabled={save.isPending}
          onChange={e => { setValue(e.target.value); setError(null) }}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            if (e.key === 'Escape') { setEditing(false); setValue(ticket.title); setError(null) }
          }}
          aria-label="Ticket title"
          style={{ fontSize: 18, fontWeight: 700, padding: '8px 12px' }}
        />
        {error && <span className="block mt-1 text-[12px] text-danger-ink">{error}</span>}
      </div>
    )
  }

  if (!editable) return <h1 className={`${h1Class} mb-5`}>{ticket.title}</h1>

  return (
    <h1 className={`${h1Class} mb-5 group`}>
      <button
        type="button"
        onClick={() => { setValue(ticket.title); setEditing(true) }}
        title="Edit title"
        className="bg-transparent border-0 p-0 m-0 text-left cursor-text"
        style={{ font: 'inherit', color: 'inherit', letterSpacing: 'inherit' }}
      >
        {ticket.title}
        <svg
          width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
          className="inline-block ml-2 align-middle text-ink-3 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-hidden="true"
        >
          <path d="M11 2.5l2.5 2.5L5 13.5H2.5V11L11 2.5z" />
        </svg>
      </button>
    </h1>
  )
}

// ── Reopen (the only action on a resolved/closed ticket) ──────────────────────

function useReopenTicket(ticketId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<TicketRead>(`/tickets/${ticketId}/reopen`).then(r => r.data),
    onSuccess: updated => {
      queryClient.setQueryData(['ticket', ticketId], updated)
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      queryClient.invalidateQueries({ queryKey: ['ticket-history', ticketId] })
    },
  })
}

function ReopenButton({ ticketId }: { ticketId: number }) {
  const reopen = useReopenTicket(ticketId)
  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" className="btn sm" onClick={() => reopen.mutate()} disabled={reopen.isPending}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" /><path d="M2 2.5v3h3" />
        </svg>
        {reopen.isPending ? 'Reopening…' : 'Reopen ticket'}
      </button>
      {reopen.isError && (
        <span className="text-[11.5px] text-danger-ink">{apiErrorMessage(reopen.error, 'Could not reopen the ticket.')}</span>
      )}
    </div>
  )
}

// ── Duplicate picker ───────────────────────────────────────────────────────────

function DuplicatePickerRow({ ticket, locked }: { ticket: TicketRead; locked: boolean }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TicketRead[]>([])
  const [open, setOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const markDuplicate = useMarkDuplicate(ticket.id)
  const unmarkDuplicate = useUnmarkDuplicate(ticket.id)

  function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setQuery(val)
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!val.trim()) { setResults([]); setOpen(false); return }
    timerRef.current = setTimeout(async () => {
      try {
        const q = val.trim()
        // "TKT-0042" / "0042" / "42" → direct ID lookup; any text → full-text
        // search (the /tickets list endpoint has no text filter).
        const idMatch = q.match(/^(?:TKT-?)?0*(\d+)$/i)
        const [byId, byText] = await Promise.all([
          idMatch
            ? api.get<TicketRead>(`/tickets/${Number(idMatch[1])}`).then(r => r.data).catch(() => null)
            : Promise.resolve(null),
          q.length >= 2
            ? api.get<{ items: { ticket: TicketRead }[] }>('/search', { params: { q, limit: 8 } })
                .then(r => r.data.items.map(i => i.ticket)).catch(() => [] as TicketRead[])
            : Promise.resolve([] as TicketRead[]),
        ])
        const seen = new Set<number>([ticket.id])
        const filtered = [...(byId ? [byId] : []), ...byText].filter(t => {
          if (seen.has(t.id)) return false
          seen.add(t.id)
          return true
        }).slice(0, 8)
        setResults(filtered)
        setOpen(filtered.length > 0)
      } catch { /* ignore */ }
    }, 300)
  }

  function selectResult(t: TicketRead) {
    setOpen(false)
    setQuery('')
    setResults([])
    markDuplicate.mutate(t.id)
  }

  // Frozen ticket: nothing to link; an existing link is undone by reopening.
  if (locked && !ticket.duplicate_of_id) return null

  if (ticket.duplicate_of_id) {
    const displayId = `TKT-${String(ticket.duplicate_of_id).padStart(4, '0')}`
    return (
      <MetaRow label="Duplicate of">
        <div className="flex items-start justify-between gap-2">
          <button
            onClick={() => navigate(`/tickets/${ticket.duplicate_of_id}`)}
            className="bg-transparent border-0 p-0 cursor-pointer text-left flex-1"
          >
            <span className="font-mono text-[11px] font-bold text-warn-ink">{displayId}</span>
            {ticket.duplicate_of_title && (
              <span className="block text-[12px] text-ink-2 mt-0.5 leading-snug">
                {ticket.duplicate_of_title}
              </span>
            )}
          </button>
          {!locked && (
            <button
              onClick={() => unmarkDuplicate.mutate()}
              disabled={unmarkDuplicate.isPending}
              className="btn ghost sm danger"
              style={{ padding: '3px 9px', fontSize: 11 }}
            >
              Unlink
            </button>
          )}
        </div>
      </MetaRow>
    )
  }

  return (
    <MetaRow label="Duplicate of">
      <div className="relative">
        <input
          type="text"
          className="input"
          style={{ padding: '7px 11px', fontSize: 12.5 }}
          value={query}
          onChange={handleQueryChange}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search by ID or title…"
        />
        {markDuplicate.isPending && (
          <span
            className="animate-spin absolute right-2.5 top-1/2 -translate-y-1/2 inline-block rounded-full"
            style={{ width: 10, height: 10, border: '2px solid var(--track)', borderTopColor: 'var(--b1)' }}
          />
        )}
        {open && (
          <div
            className="overlay-surface absolute left-0 right-0 z-20 mt-1 overflow-hidden"
            style={{ top: '100%', borderRadius: 14 }}
          >
            {results.map(t => (
              <button
                key={t.id}
                onMouseDown={() => selectResult(t)}
                className="block w-full px-3 py-2 bg-transparent border-0 text-left cursor-pointer hover:bg-row-hover border-b border-track"
              >
                <span className="font-mono text-[10px] text-ink-3 mr-1.5">{t.display_id}</span>
                <span className="text-[12px] text-ink">{t.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </MetaRow>
  )
}

// ── Metadata sidebar ───────────────────────────────────────────────────────────

interface MetaSidebarProps {
  ticket: TicketRead
  isAdmin: boolean
  currentUserId: number
}

function MetaSidebar({ ticket, isAdmin, currentUserId }: MetaSidebarProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const { data: categories } = useCategories()
  const { data: agents } = useAgents()
  const [savedField, setSavedField] = useState<string | null>(null)
  const [patchError, setPatchError] = useState<string | null>(null)
  const { data: appConfig } = useAppConfig()
  const categoryRef = useRef<HTMLSelectElement>(null)
  const [flashCategory, setFlashCategory] = useState(false)
  // Resolved status waiting on the "no reply yet" confirmation
  const [pendingResolve, setPendingResolve] = useState<string | null>(null)
  // Resolved/closed tickets are frozen (enforced by the API too): every field
  // is read-only and the only action is Reopen.
  const locked = isResolvedStatus(ticket.status)
  // Resolving requires a category whenever any exist (enforced by the API too)
  const needsCategory = !locked && !ticket.category_id && (categories?.length ?? 0) > 0

  const patchMutation = useMutation({
    mutationFn: (update: Partial<TicketRead>) =>
      api.patch<TicketRead>(`/tickets/${ticket.id}`, update).then(r => r.data),
    onSuccess: (updated, variables) => {
      queryClient.setQueryData(['ticket', ticket.id], updated)
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      const field = Object.keys(variables)[0]
      setPatchError(null)
      setSavedField(field)
      setTimeout(() => setSavedField(null), 1800)
    },
    onError: (err: unknown) => {
      setPatchError(apiErrorMessage(err, 'Update failed — please try again.'))
    },
  })

  function patch(field: string, value: unknown) {
    const resolving = field === 'status' &&
      !!(appConfig?.statuses ?? getAllStatuses()).find(s => s.name === value)?.is_resolved_state
    if (resolving && needsCategory) {
      setPatchError('Set a category before resolving this ticket.')
      categoryRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      categoryRef.current?.focus({ preventScroll: true })
      setFlashCategory(false)
      requestAnimationFrame(() => setFlashCategory(true))
      return
    }
    // Same rule for the assignee, minus the highlight: assigning is routine,
    // and "Assign to me" sits right below, so the message is enough.
    if (resolving && ticket.assignee_id == null) {
      setPatchError('Assign this ticket before resolving it.')
      return
    }
    if (resolving && !ticket.first_responded_at) {
      setPendingResolve(value as string)
      return
    }
    if ((field === 'category_id' || field === 'assignee_id') && value) setPatchError(null)
    patchMutation.mutate({ [field]: value })
  }

  function confirmResolve() {
    if (pendingResolve) patchMutation.mutate({ status: pendingResolve })
    setPendingResolve(null)
  }

  function replyFirst() {
    setPendingResolve(null)
    const box = document.getElementById('reply-composer') as HTMLTextAreaElement | null
    box?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    box?.focus({ preventScroll: true })
  }

  const channelLabels: Record<string, string> = {
    web: 'Web',
    slack: 'Slack',
    email: 'Email',
  }

  return (
    <section className="panel" style={{ position: 'sticky', top: 14 }}>
      <div className="panel-head" style={{ paddingBottom: 4 }}>
        <h2>Details</h2>
        {patchMutation.isPending && (
          <span
            className="animate-spin inline-block rounded-full ml-auto"
            style={{ width: 12, height: 12, border: '2px solid var(--track)', borderTopColor: 'var(--b1)' }}
          />
        )}
      </div>

      <div className="px-5 pb-5 pt-3 flex flex-col gap-4">
        {locked && (
          <div className="rounded-control px-3 py-2.5 flex flex-col gap-2" style={{ background: 'var(--field)', border: '1px solid var(--edge)' }}>
            <span className="text-[12.5px] text-ink-2 leading-snug">
              This ticket is {statusLabel(ticket.status).toLowerCase()} — its details are frozen. Reopen it to make changes.
            </span>
            <ReopenButton ticketId={ticket.id} />
          </div>
        )}

        {patchError && (
          <div
            className="rounded-control px-3 py-2 text-[12px] text-danger-ink"
            style={{ background: 'var(--danger-bg)' }}
          >
            {patchError}
          </div>
        )}

        {/* Status */}
        <MetaRow label="Status">
          <div className="relative">
            <StatusDropdown ticket={ticket} patch={patch} isAdmin={isAdmin} disabled={locked} />
            <SavedFlash show={savedField === 'status'} />
            <CloseWithoutSurvey ticket={ticket} />
          </div>
        </MetaRow>

        {/* Priority */}
        <MetaRow label="Priority">
          <div className="relative">
            <div className="selectwrap">
              <select
                className="select"
                value={ticket.priority}
                disabled={locked}
                onChange={e => patch('priority', e.target.value)}
                style={{ fontWeight: 600, color: PRIORITY_INK[ticket.priority as Priority] }}
              >
                {(Object.entries(PRIORITY_LABELS) as [Priority, string][]).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <SavedFlash show={savedField === 'priority'} />
          </div>
        </MetaRow>

        {/* Assignee */}
        <MetaRow label="Assignee">
          <div className="flex flex-col gap-1.5">
            {isAdmin && agents && agents.length > 0 ? (
              <div className="selectwrap">
                <select
                  className="select"
                  value={ticket.assignee_id ?? ''}
                  disabled={locked}
                  onChange={e => patch('assignee_id', e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Unassigned</option>
                  {agents.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
            ) : (
              <span className={`text-[13px] ${ticket.assignee_name ? 'text-ink' : 'text-ink-3 italic'}`}>
                {ticket.assignee_name ?? 'Unassigned'}
              </span>
            )}
            {!locked && ticket.assignee_id !== currentUserId && (
              <button
                type="button"
                onClick={() => patch('assignee_id', currentUserId)}
                className="btn ghost sm"
                style={{ color: 'var(--brand-ink)', justifyContent: 'flex-start' }}
              >
                Assign to me
              </button>
            )}
            <SavedFlash show={savedField === 'assignee_id'} />
          </div>
        </MetaRow>

        {/* Category */}
        <MetaRow label="Category">
          <div className="relative">
            <div className="selectwrap">
              <select
                ref={categoryRef}
                className={`select${needsCategory ? ' needs-attention' : ''}${needsCategory && flashCategory ? ' flash' : ''}`}
                value={ticket.category_id ?? ''}
                disabled={locked}
                onChange={e => patch('category_id', e.target.value ? Number(e.target.value) : null)}
                onAnimationEnd={() => setFlashCategory(false)}
              >
                <option value="">{needsCategory ? '⚠ Pick a category' : 'No category'}</option>
                {categories?.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            {needsCategory && (
              <span className="block mt-1 text-[11px] text-warn-ink">Required before resolving</span>
            )}
            <SavedFlash show={savedField === 'category_id'} />
          </div>
        </MetaRow>

        {/* SLA — context-aware: first-response until replied, resolution after */}
        {(ticket.first_response_deadline || ticket.sla_deadline) && (() => {
          const awaitingFirstResponse = !ticket.first_responded_at && ticket.first_response_deadline
          // The clock stops while waiting on the requester or resolved: a
          // resolved ticket is judged where it stopped, a paused one is frozen.
          const resolved = isResolvedStatus(ticket.status)
          const slaResult = !awaitingFirstResponse
            ? parseSLABar(ticket)
            : resolved
              ? parseSLABarRaw(ticket.first_response_deadline, ticket.created_at, false, ticket.sla_paused_at ?? ticket.resolved_at)
              : ticket.sla_paused_at
                ? parseSLAPaused(ticket.first_response_deadline, ticket.created_at, ticket.sla_paused_at)
                : parseSLABarRaw(ticket.first_response_deadline, ticket.created_at)
          const label = awaitingFirstResponse ? '1st response' : 'SLA'
          return (
            <MetaRow label={label}>
              <span><SLABadge slaResult={slaResult} variant="pill" /></span>
            </MetaRow>
          )
        })()}

        {/* Channel */}
        <MetaRow label="Channel">
          <span className="pill avail">{channelLabels[ticket.channel] ?? ticket.channel}</span>
        </MetaRow>

        {/* Workspace — which connected Slack workspace this ticket came from */}
        {ticket.workspace_name && (
          <MetaRow label="Workspace">
            <span className="pill use">{ticket.workspace_name}</span>
          </MetaRow>
        )}

        {/* Duplicate link */}
        <DuplicatePickerRow ticket={ticket} locked={locked} />

        {/* Submitter */}
        {ticket.submitter_name && (
          <MetaRow label="Submitted by">
            <div className="flex items-center gap-2">
              <Avatar name={ticket.submitter_name} size={22} />
              <div className="min-w-0">
                <div className="text-[13px] text-ink">{ticket.submitter_name}</div>
                {ticket.email_requester && ticket.email_requester !== ticket.submitter_name && (
                  <div className="font-mono text-[11px] text-ink-3 truncate" title={ticket.email_requester}>{ticket.email_requester}</div>
                )}
              </div>
            </div>
          </MetaRow>
        )}

        {/* Staff-only page: every viewer is a technician or admin */}
        <RequesterSlackLink ticket={ticket} canEdit />

        <RequesterTickets ticketId={ticket.id} />

        {/* Timestamps */}
        <div className="border-t border-track pt-3 flex flex-col gap-1.5">
          <div className="flex justify-between items-center">
            <span className="text-[11px] text-ink-3">Created</span>
            <span className="font-mono text-[11px] text-ink-2">{timeAgo(ticket.created_at)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[11px] text-ink-3">Updated</span>
            <span className="font-mono text-[11px] text-ink-2">{timeAgo(ticket.updated_at)}</span>
          </div>
          {ticket.resolved_at && (
            <div className="flex justify-between items-center">
              <span className="text-[11px] text-ink-3">Resolved</span>
              <span className="font-mono text-[11px] text-brand-ink">{timeAgo(ticket.resolved_at)}</span>
            </div>
          )}
        </div>

        {/* Admin-only permanent delete (test tickets, mistakes) */}
        {isAdmin && (
          <>
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="self-start bg-transparent border-0 p-0 text-[12px] text-ink-3 hover:text-danger-ink cursor-pointer underline"
            >
              Delete ticket…
            </button>
            <DeleteTicketsDialog
              open={deleteOpen}
              onClose={() => setDeleteOpen(false)}
              tickets={[{ id: ticket.id, display_id: ticket.display_id }]}
              onDeleted={() => navigate('/queue')}
            />
          </>
        )}
        <ResolveUnansweredDialog
          open={pendingResolve !== null}
          unanswered={[{ id: ticket.id, display_id: ticket.display_id }]}
          statusLabel={pendingResolve ? statusLabel(pendingResolve) : ''}
          onCancel={() => setPendingResolve(null)}
          onConfirm={confirmResolve}
          onReplyFirst={replyFirst}
        />
      </div>
    </section>
  )
}

// ── History event row ──────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  status: 'status',
  priority: 'priority',
  assignee_id: 'assignee',
  category_id: 'category',
  duplicate_of: 'duplicate link',
  csat_response: 'CSAT feedback',
  title: 'title',
  slack_link: 'Slack account',
}

function formatHistoryValue(field: string, value: string | null): React.ReactNode {
  if (value == null) return <em className="text-ink-3">none</em>
  if (field === 'status') {
    // Status colors are admin-configured data — inline stays, pill anatomy is Glasshouse
    const color = statusColor(value)
    return (
      <span
        className="inline-block px-2 py-px rounded-full text-[11px] font-semibold"
        style={{ background: `${color}24`, color }}
      >
        {statusLabel(value)}
      </span>
    )
  }
  if (field === 'csat_response') {
    const isPositive = value === 'positive'
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-px rounded-full text-[11px] font-semibold"
        style={isPositive
          ? { background: 'var(--brand-tint)', color: 'var(--brand-ink)' }
          : { background: 'var(--danger-bg)', color: 'var(--danger-ink)' }}
      >
        {isPositive ? <ThumbUp size={11} /> : <ThumbDown size={11} />}
        {isPositive ? 'Positive' : 'Negative'}
      </span>
    )
  }
  if (field === 'duplicate_of') {
    return <strong className="font-mono text-[11px] text-warn-ink">{value}</strong>
  }
  return <strong className="text-ink font-semibold">{value}</strong>
}

function StatusDropdown({ ticket, patch, isAdmin, disabled = false }: {
  ticket: TicketRead
  patch: (field: string, value: string) => void
  isAdmin: boolean
  disabled?: boolean
}) {
  const { data: appConfig } = useAppConfig()
  const statuses = appConfig?.statuses ?? getAllStatuses()
  // Technicians can't set a terminal-close state (resolved but no survey) — that
  // skips CSAT. They use Resolved (which surveys) or "Close without survey" below.
  // Keep the ticket's current status selectable so the dropdown still shows it.
  const options = statuses.filter(s =>
    isAdmin || !(s.is_resolved_state && !s.sends_csat) || s.name === ticket.status
  )
  return (
    <div className="selectwrap">
      <select
        className="select"
        value={ticket.status}
        disabled={disabled}
        onChange={e => patch('status', e.target.value)}
        style={{ fontWeight: 600, color: statusColor(ticket.status) }}
      >
        {options.map(s => (
          <option key={s.name} value={s.name}>{s.label}</option>
        ))}
        {/* If ticket has a status not in the current list (e.g. archived), show it anyway */}
        {!statuses.find(s => s.name === ticket.status) && (
          <option value={ticket.status}>{statusLabel(ticket.status)}</option>
        )}
      </select>
    </div>
  )
}

function CloseWithoutSurvey({ ticket }: { ticket: TicketRead }) {
  const queryClient = useQueryClient()
  const { data: appConfig } = useAppConfig()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const statuses = appConfig?.statuses ?? getAllStatuses()
  const closeCfg = statuses.find(s => s.is_resolved_state && !s.sends_csat)

  const mutation = useMutation({
    mutationFn: (r: string) =>
      api.post<TicketRead>(`/tickets/${ticket.id}/close`, { reason: r }).then(res => res.data),
    onSuccess: updated => {
      queryClient.setQueryData(['ticket', ticket.id], updated)
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      setOpen(false)
      setReason('')
    },
  })

  // Nothing to do if there's no closed status, or the ticket is already there.
  if (!closeCfg || ticket.status === closeCfg.name) return null

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 bg-transparent border-0 p-0 text-[12px] text-ink-3 hover:text-ink cursor-pointer underline"
      >
        Close without survey…
      </button>
    )
  }

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <textarea
        className="input"
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Reason (required) — e.g. spam, duplicate, submitter unreachable"
        rows={2}
        autoFocus
        style={{ resize: 'vertical', fontSize: 12.5 }}
      />
      {mutation.isError && (
        <span className="text-[11px] text-danger-ink">
          {apiErrorMessage(mutation.error, 'Failed to close ticket')}
        </span>
      )}
      <div className="flex gap-1.5">
        <button
          disabled={!reason.trim() || mutation.isPending}
          onClick={() => mutation.mutate(reason.trim())}
          className="btn ghost sm danger"
          style={!reason.trim() ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
        >
          {mutation.isPending ? 'Closing…' : 'Close ticket'}
        </button>
        <button
          onClick={() => { setOpen(false); setReason('') }}
          className="btn ghost sm"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function HistoryEventRow({ event }: { event: HistoryEvent }) {
  const label = FIELD_LABELS[event.field] ?? event.field
  return (
    <div className="flex items-center gap-2 py-1 justify-center">
      <div className="flex-1 h-px bg-track" />
      <div className="text-[11px] text-ink-3 whitespace-nowrap flex items-center gap-1.5">
        <span className="font-medium text-ink-2">{event.actor_name ?? 'System'}</span>
        <span>changed {label}</span>
        {event.old_value != null && (
          <>{' '}from {formatHistoryValue(event.field, event.old_value)}</>
        )}
        <span>to</span>
        {formatHistoryValue(event.field, event.new_value)}
        <span>·</span>
        <span className="font-mono text-[10px]">{timeAgo(event.created_at)}</span>
      </div>
      <div className="flex-1 h-px bg-track" />
    </div>
  )
}

// ── Thread column ──────────────────────────────────────────────────────────────

interface ThreadColumnProps {
  ticket: TicketRead
  isTech: boolean
  currentUserId: number | undefined
}

function ThreadColumn({ ticket, isTech, currentUserId }: ThreadColumnProps) {
  const { data: replies, isLoading } = useReplies(ticket.id)
  const { data: historyEvents } = useTicketHistory(ticket.id)
  const { data: allAttachments } = useAttachments(ticket.id)
  const { data: appConfig } = useAppConfig()
  const statuses = appConfig?.statuses ?? getAllStatuses()
  const bottomRef = useRef<HTMLDivElement>(null)

  // Group attachments by reply_id; null = ticket-level (initial message)
  const attachmentsByReply = (allAttachments ?? []).reduce<Record<string, AttachmentRead[]>>((acc, att) => {
    const key = att.reply_id == null ? '__ticket__' : String(att.reply_id)
    ;(acc[key] ??= []).push(att)
    return acc
  }, {})

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [replies?.length])

  const visibleReplies = isTech
    ? (replies ?? [])
    : (replies ?? []).filter(r => !r.is_internal)

  // Merge replies and history events into a single chronological list
  type TimelineItem =
    | { kind: 'reply'; data: ReplyRead }
    | { kind: 'event'; data: HistoryEvent }

  const timeline: TimelineItem[] = [
    ...visibleReplies.map(r => ({ kind: 'reply' as const, data: r })),
    ...(historyEvents ?? []).map(e => ({ kind: 'event' as const, data: e })),
  ].sort((a, b) =>
    new Date(a.data.created_at).getTime() - new Date(b.data.created_at).getTime()
  )

  const isClosed = statuses.find(s => s.name === ticket.status)?.is_resolved_state ?? false

  return (
    <div className="flex flex-col">
      {/* Description bubble — the "first message" */}
      <div className="panel px-6 py-5 mb-2">
        <div className="flex items-center gap-2.5 mb-3.5">
          <Avatar name={ticket.submitter_name} size={36} />
          <div>
            <div className="text-[13px] font-semibold text-ink">
              {ticket.submitter_name ?? 'Unknown'}
            </div>
            <div className="font-mono text-[10.5px] text-ink-3">
              {timeAgo(ticket.created_at)} · original request
            </div>
          </div>
        </div>
        <p className="m-0 text-[14px] text-ink leading-relaxed whitespace-pre-wrap break-words">
          <RichText text={ticket.description} />
        </p>
        <AttachmentList attachments={attachmentsByReply['__ticket__'] ?? []} />
      </div>

      {/* Reply thread */}
      {isLoading ? (
        <div className="py-6 flex flex-col gap-3">
          {[1, 2].map(i => (
            <div key={i} className="flex gap-2.5">
              <div className="w-[30px] h-[30px] rounded-full bg-track flex-shrink-0" />
              <div className="flex-1 flex flex-col gap-1.5">
                <div style={{ width: 80, height: 12, borderRadius: 6, background: 'var(--track)', animation: 'shimmer 1.5s ease-in-out infinite' }} />
                <div style={{ width: '60%', height: 60, borderRadius: 12, background: 'var(--track)', animation: 'shimmer 1.5s ease-in-out infinite' }} />
              </div>
            </div>
          ))}
        </div>
      ) : timeline.length > 0 ? (
        <div className="flex flex-col gap-3 py-3">
          {timeline.map(item =>
            item.kind === 'reply' ? (
              <ReplyBubble
                key={`r-${item.data.id}`}
                reply={item.data}
                isOwn={item.data.author_id === currentUserId}
                isTech={isTech}
                attachments={attachmentsByReply[String(item.data.id)] ?? []}
              />
            ) : (
              <HistoryEventRow key={`h-${item.data.id}`} event={item.data} />
            )
          )}
          <div ref={bottomRef} />
        </div>
      ) : (
        <p className="text-center text-[13px] text-ink-3 pt-7 pb-4 m-0">No replies yet.</p>
      )}

      {/* Composer */}
      <div className="panel px-5 py-4 mt-2">
        {isClosed ? (
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <p className="text-[13px] text-ink-3 m-0">
              This ticket is {statusLabel(ticket.status).toLowerCase()}. Reopen it to reply.
            </p>
            {isTech && <ReopenButton ticketId={ticket.id} />}
          </div>
        ) : (
          <Composer ticketId={ticket.id} isTech={isTech} />
        )}
      </div>
    </div>
  )
}

// ── Breadcrumb ─────────────────────────────────────────────────────────────────

interface BreadcrumbProps {
  ticket: TicketRead
}

function Breadcrumb({ ticket }: BreadcrumbProps) {
  return (
    <div className="flex items-center gap-1.5 mb-4 text-[13px] text-ink-3">
      <Link to="/queue" className="text-ink-2 no-underline font-medium hover:text-brand-ink">
        Queue
      </Link>
      <span>/</span>
      <span className="font-mono text-[12px] text-ink-2 tracking-wide">{ticket.display_id}</span>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function TicketDetail() {
  const { id } = useParams<{ id: string }>()
  const ticketId = Number(id)
  const { user } = useAuth()
  const navigate = useNavigate()

  const { data: ticket, isLoading, error } = useTicket(ticketId)
  const { mutate: markRead } = useMarkTicketRead(ticketId)

  // Mark ticket as read when opened
  useEffect(() => {
    if (ticketId) markRead()
  }, [ticketId]) // eslint-disable-line react-hooks/exhaustive-deps

  const isAdmin = user?.role === 'admin'
  const isTech = user?.role === 'technician' || user?.role === 'admin'

  if (isLoading) {
    return (
      <AppShell title="Loading…">
        <div style={{ height: 24, width: 200, borderRadius: 8, background: 'var(--track)', animation: 'shimmer 1.5s ease-in-out infinite', marginBottom: 20 }} />
        <div className="grid grid-cols-1 md:grid-cols-[1fr_320px]" style={{ gap: 24 }}>
          <div style={{ height: 400, borderRadius: 22, background: 'var(--track)', animation: 'shimmer 1.5s ease-in-out infinite' }} />
          <div style={{ height: 400, borderRadius: 22, background: 'var(--track)', animation: 'shimmer 1.5s ease-in-out infinite' }} />
        </div>
      </AppShell>
    )
  }

  if (error || !ticket) {
    return (
      <AppShell title="Not found">
        <div className="panel text-center px-6 py-14" style={{ maxWidth: 480, margin: '40px auto' }}>
          <p className="text-[13.5px] text-ink-2 m-0">
            Ticket not found or you don&apos;t have permission to view it.
          </p>
          <button onClick={() => navigate('/queue')} className="btn ghost sm mt-4">
            Back to queue
          </button>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell title={ticket.display_id}>
      <div style={{ maxWidth: 1200 }}>
        <Breadcrumb ticket={ticket} />

        {/* Title — click to edit while the ticket is open */}
        <EditableTitle ticket={ticket} editable={isTech && !isResolvedStatus(ticket.status)} />

        {/* Email notice — public replies go to the requester by email */}
        {ticket.channel === 'email' && (
          <div
            className="flex items-center gap-2 px-3.5 py-2 mb-5 rounded-block text-[12px] text-ink-2 bg-field border border-edge"
            style={{ boxShadow: 'inset 0 1px 0 var(--specular)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-brand-ink flex-shrink-0">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M3 7l9 6 9-6" />
            </svg>
            <span>
              This ticket came in by email. Public replies are emailed to{' '}
              <strong className="text-ink">{ticket.email_requester}</strong>; internal notes are not.
            </span>
          </div>
        )}

        {/* Slack sync notice — shown for any ticket with an active Slack thread */}
        {ticket.slack_channel_id && ticket.slack_message_ts && (
          <div
            className="flex items-center gap-2 px-3.5 py-2 mb-5 rounded-block text-[12px] text-ink-2 bg-field border border-edge"
            style={{ boxShadow: 'inset 0 1px 0 var(--specular)' }}
          >
            <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand-ink flex-shrink-0">
              <path d="M15.5 11.5a1.5 1.5 0 0 1-1.5 1.5H5l-3 3V4a1.5 1.5 0 0 1 1.5-1.5h10.5A1.5 1.5 0 0 1 15.5 4z" />
            </svg>
            <span>
              {ticket.channel === 'slack'
                ? 'This ticket was created from Slack. Replies sync automatically.'
                : <>
                    Replies are synced to Slack
                    {ticket.submitter_name && (
                      <> via DM to <strong className="text-ink">{ticket.submitter_name}</strong></>
                    )}
                    .
                  </>
              }
            </span>
          </div>
        )}

        {/* Duplicate banner */}
        {ticket.duplicate_of_id && (
          <div
            className="flex items-center gap-2 px-3.5 py-2 mb-5 rounded-block text-[12px] text-warn-ink"
            style={{ background: 'var(--warn-bg)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span>
              This ticket is a duplicate of{' '}
              <Link
                to={`/tickets/${ticket.duplicate_of_id}`}
                className="font-mono text-[11px] font-bold text-warn-ink"
              >
                TKT-{String(ticket.duplicate_of_id).padStart(4, '0')}
              </Link>
              {ticket.duplicate_of_title && (
                <> — {ticket.duplicate_of_title}</>
              )}
            </span>
          </div>
        )}

        {/* Two-column layout — single column on phones */}
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_300px] items-start" style={{ gap: 14 }}>
          <ThreadColumn ticket={ticket} isTech={isTech} currentUserId={user?.id} />
          <MetaSidebar
            ticket={ticket}
            isAdmin={isAdmin}
            currentUserId={user?.id ?? 0}
          />
        </div>
      </div>
    </AppShell>
  )
}
