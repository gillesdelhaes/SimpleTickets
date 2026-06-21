import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import AppShell from '../components/layout/AppShell'
import AuthImage from '../components/AuthImage'
import SLABadge from '../components/tickets/SLABadge'
import { parseSLABarRaw } from '../types/ticket'
import { useMarkDuplicate, useUnmarkDuplicate } from '../hooks/useDuplicate'
import { useTicket } from '../hooks/useTicket'
import { useReplies, useAddReply, type ReplyRead } from '../hooks/useReplies'
import { useTicketHistory, type HistoryEvent } from '../hooks/useTicketHistory'
import { useAttachments, type AttachmentRead, isImage, formatBytes } from '../hooks/useAttachments'
import { useCategories } from '../hooks/useCategories'
import { useAgents } from '../hooks/useAgents'
import { useAuth } from '../contexts/AuthContext'
import { useMarkTicketRead } from '../hooks/useUnreadReplies'
import api from '../lib/api'
import { useAppConfig } from '../hooks/useAppConfig'
import {
  getAllStatuses,
  statusColor,
  statusLabel,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  timeAgo,
  type TicketRead,
  type Priority,
} from '../types/ticket'

// ── Avatar ─────────────────────────────────────────────────────────────────────

const AVATAR_GRADIENTS = [
  ['#FF4713', '#AD1164'],
  ['#3B82F6', '#6366F1'],
  ['#10B981', '#059669'],
  ['#F59E0B', '#EF4444'],
  ['#8B5CF6', '#EC4899'],
  ['#0EA5E9', '#06B6D4'],
]

function nameToGradient(name: string | null): string {
  if (!name) return `linear-gradient(135deg, #E5E5E5, #D4D4D4)`
  const idx = name.charCodeAt(0) % AVATAR_GRADIENTS.length
  const [a, b] = AVATAR_GRADIENTS[idx]
  return `linear-gradient(135deg, ${a}, ${b})`
}

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
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: nameToGradient(name),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: size * 0.38,
        fontWeight: 700,
        color: '#fff',
        letterSpacing: '0.01em',
      }}
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
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
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '5px 10px', borderRadius: 6,
                border: '1px solid #E5E5E5', background: '#FAFAFA',
                fontSize: 12, color: '#262626', cursor: 'pointer',
                transition: 'background 0.12s',
              }}
              onMouseOver={e => (e.currentTarget.style.background = '#F2F2F2')}
              onMouseOut={e => (e.currentTarget.style.background = '#FAFAFA')}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6L9 2z"/>
                <path d="M9 2v4h4"/>
              </svg>
              <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {att.filename}
              </span>
              <span style={{ color: '#A3A3A3', flexShrink: 0 }}>{formatBytes(att.size_bytes)}</span>
            </button>
          )
        ))}
      </div>

      {/* Lightbox */}
      {lightbox !== null && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
            zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'zoom-out',
          }}
        >
          <AuthImage
            attachmentId={lightbox}
            style={{ maxWidth: '90vw', maxHeight: '90vh', border: 'none', borderRadius: 8 }}
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
      <div style={{ display: 'flex', gap: 10, animation: 'fadeUp 0.2s ease' }}>
        <Avatar name={reply.author_name} size={30} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#262626' }}>
              {reply.author_name ?? 'Unknown'}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 4, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Internal
            </span>
            <span style={{ fontSize: 11, color: '#A3A3A3' }}>{timeAgo(reply.created_at)}</span>
          </div>
          <div style={{ borderLeft: '3px solid #F59E0B', background: '#FFFBEB', borderRadius: '0 8px 8px 0', padding: '10px 14px', fontSize: 14, color: '#451A03', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {reply.body}
            <AttachmentList attachments={attachments} />
          </div>
        </div>
      </div>
    )
  }

  if (isOwn) {
    return (
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', animation: 'fadeUp 0.2s ease' }}>
        <div style={{ maxWidth: '72%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 11, color: '#A3A3A3' }}>{timeAgo(reply.created_at)}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#262626' }}>You</span>
          </div>
          <div style={{ background: 'linear-gradient(135deg, rgba(255,71,19,0.08), rgba(173,17,100,0.06))', border: '1px solid rgba(255,71,19,0.15)', borderRadius: '12px 4px 12px 12px', padding: '10px 14px', fontSize: 14, color: '#262626', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {reply.body}
            <AttachmentList attachments={attachments} />
          </div>
        </div>
        <Avatar name={reply.author_name} size={30} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 10, animation: 'fadeUp 0.2s ease' }}>
      <Avatar name={reply.author_name} size={30} />
      <div style={{ maxWidth: '72%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#262626' }}>
            {reply.author_name ?? 'Support'}
          </span>
          {isTech && (
            <span style={{ fontSize: 10, fontWeight: 600, color: '#737373', background: '#F2F2F2', borderRadius: 4, padding: '1px 5px' }}>
              Team
            </span>
          )}
          <span style={{ fontSize: 11, color: '#A3A3A3' }}>{timeAgo(reply.created_at)}</span>
        </div>
        <div style={{ background: '#fff', border: '1px solid #E5E5E5', borderRadius: '4px 12px 12px 12px', padding: '10px 14px', fontSize: 14, color: '#262626', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          {reply.body}
          <AttachmentList attachments={attachments} />
        </div>
      </div>
    </div>
  )
}

// ── Composer ───────────────────────────────────────────────────────────────────

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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const addReply = useAddReply(ticketId)
  const queryClient = useQueryClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() || uploading || addReply.isPending) return
    try {
      setUploading(true)
      const reply = await addReply.mutateAsync({ body: body.trim(), is_internal: mode === 'internal' })
      setBody('')
      if (pendingFiles.length > 0) {
        for (const file of pendingFiles) {
          const form = new FormData()
          form.append('file', file)
          await api.post(
            `/tickets/${ticketId}/attachments?reply_id=${reply.id}`,
            form,
            { headers: { 'Content-Type': 'multipart/form-data' } },
          )
        }
        setPendingFiles([])
        queryClient.invalidateQueries({ queryKey: ['attachments', ticketId] })
      }
    } catch {
      // error shown by addReply.isError
    } finally {
      setUploading(false)
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    setPendingFiles(prev => [...prev, ...files])
    e.target.value = ''
  }

  function removeFile(idx: number) {
    setPendingFiles(prev => prev.filter((_, i) => i !== idx))
  }

  const isInternal = mode === 'internal'
  const isBusy = addReply.isPending || uploading
  const canSubmit = body.trim().length > 0 && !isBusy && !disabled

  return (
    <form onSubmit={handleSubmit}>
      {/* Tab toggle for technicians */}
      {isTech && (
        <div
          style={{
            display: 'flex',
            gap: 0,
            marginBottom: 10,
            background: '#F2F2F2',
            borderRadius: 8,
            padding: 3,
            width: 'fit-content',
          }}
        >
          {(['reply', 'internal'] as const).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              style={{
                padding: '5px 14px',
                borderRadius: 6,
                border: 'none',
                fontSize: 12,
                fontWeight: mode === m ? 600 : 500,
                color: mode === m ? (m === 'internal' ? '#92400E' : '#0A0A0A') : '#737373',
                background: mode === m ? '#fff' : 'transparent',
                cursor: 'pointer',
                transition: 'all 0.12s',
                boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              {m === 'reply' ? 'Reply to user' : '🔒 Internal note'}
            </button>
          ))}
        </div>
      )}

      <div style={{ position: 'relative' }}>
        <textarea
          ref={textareaRef}
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder={
            isInternal
              ? 'Add an internal note — only visible to your team…'
              : 'Write a reply to the user…'
          }
          rows={4}
          disabled={disabled}
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 8,
            border: isInternal ? '1.5px solid #F59E0B' : '1.5px solid #E5E5E5',
            borderLeft: isInternal ? '4px solid #F59E0B' : '1.5px solid #E5E5E5',
            background: isInternal ? '#FFFDF5' : '#fff',
            fontSize: 14,
            color: '#262626',
            lineHeight: 1.6,
            resize: 'vertical',
            minHeight: 100,
            fontFamily: 'Inter, system-ui, sans-serif',
            outline: 'none',
            transition: 'border-color 0.15s',
            boxSizing: 'border-box',
          }}
          onFocus={e => {
            if (!isInternal) e.currentTarget.style.borderColor = '#FF4713'
          }}
          onBlur={e => {
            if (!isInternal) e.currentTarget.style.borderColor = '#E5E5E5'
          }}
        />
      </div>

      {/* File previews */}
      {pendingFiles.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {pendingFiles.map((file, idx) => (
            <div key={idx} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 8px 4px 10px', borderRadius: 6,
              background: '#F2F2F2', border: '1px solid #E5E5E5',
              fontSize: 12, color: '#262626', maxWidth: 220,
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {file.name}
              </span>
              <button
                type="button"
                onClick={() => removeFile(idx)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#A3A3A3', display: 'flex', alignItems: 'center', flexShrink: 0 }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M2 2l8 8M10 2l-8 8"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        {/* File attach button */}
        <div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            title="Attach files"
            style={{
              background: 'none', border: '1px solid #E5E5E5', borderRadius: 7,
              cursor: disabled ? 'not-allowed' : 'pointer', padding: '5px 8px',
              color: '#737373', display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 12, transition: 'background 0.12s, color 0.12s',
            }}
            onMouseOver={e => { if (!disabled) { e.currentTarget.style.background = '#F2F2F2'; e.currentTarget.style.color = '#262626' } }}
            onMouseOut={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#737373' }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 8.5v3a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-3"/>
              <path d="M8 1v8M5.5 3.5L8 1l2.5 2.5"/>
            </svg>
            Attach
          </button>
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            padding: '9px 22px', borderRadius: 8, border: 'none',
            background: canSubmit
              ? isInternal ? 'linear-gradient(135deg, #F59E0B, #D97706)' : 'linear-gradient(135deg, #FF4713, #AD1164)'
              : '#E5E5E5',
            color: canSubmit ? '#fff' : '#A3A3A3',
            fontSize: 13, fontWeight: 600,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            transition: 'opacity 0.15s',
            display: 'flex', alignItems: 'center', gap: 7,
          }}
          onMouseEnter={e => { if (canSubmit) e.currentTarget.style.opacity = '0.9' }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
        >
          {isBusy && (
            <span style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.35)', borderTopColor: '#fff', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
          )}
          {isInternal ? 'Add Note' : 'Send Reply'}
        </button>
      </div>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: '#A3A3A3',
        }}
      >
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
      style={{
        fontSize: 11,
        color: '#10B981',
        fontWeight: 600,
        opacity: show ? 1 : 0,
        transition: 'opacity 0.3s ease',
        marginLeft: 6,
      }}
    >
      ✓ Saved
    </span>
  )
}

// ── Duplicate picker ───────────────────────────────────────────────────────────

function DuplicatePickerRow({ ticket }: { ticket: TicketRead }) {
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
        const res = await api.get<{ items: TicketRead[] }>('/tickets', {
          params: { q: val, limit: 8 },
        })
        const filtered = res.data.items.filter(t => t.id !== ticket.id)
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

  if (ticket.duplicate_of_id) {
    const displayId = `TKT-${String(ticket.duplicate_of_id).padStart(4, '0')}`
    return (
      <MetaRow label="Duplicate of">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <button
            onClick={() => navigate(`/tickets/${ticket.duplicate_of_id}`)}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              textAlign: 'left', flex: 1,
            }}
          >
            <span style={{
              fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
              fontWeight: 700, color: '#F59E0B',
            }}>
              {displayId}
            </span>
            {ticket.duplicate_of_title && (
              <span style={{ display: 'block', fontSize: 12, color: '#737373', marginTop: 2, lineHeight: 1.4 }}>
                {ticket.duplicate_of_title}
              </span>
            )}
          </button>
          <button
            onClick={() => unmarkDuplicate.mutate()}
            disabled={unmarkDuplicate.isPending}
            title="Unlink duplicate"
            style={{
              background: 'none', border: '1px solid #E5E5E5', borderRadius: 5,
              padding: '2px 7px', fontSize: 11, color: '#A3A3A3',
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#EF4444'; e.currentTarget.style.borderColor = '#EF4444' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#A3A3A3'; e.currentTarget.style.borderColor = '#E5E5E5' }}
          >
            Unlink
          </button>
        </div>
      </MetaRow>
    )
  }

  return (
    <MetaRow label="Duplicate of">
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          value={query}
          onChange={handleQueryChange}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search by ID or title…"
          style={{
            width: '100%', padding: '6px 10px', borderRadius: 6,
            border: '1px solid #E5E5E5', fontSize: 12, color: '#262626',
            background: '#fff', outline: 'none', boxSizing: 'border-box',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        />
        {markDuplicate.isPending && (
          <span style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            width: 10, height: 10, borderRadius: '50%',
            border: '2px solid #E5E5E5', borderTopColor: '#FF4713',
            display: 'inline-block', animation: 'spin 0.7s linear infinite',
          }} />
        )}
        {open && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
            background: '#fff', border: '1px solid #E5E5E5', borderRadius: 8,
            marginTop: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
            overflow: 'hidden',
          }}>
            {results.map(t => (
              <button
                key={t.id}
                onMouseDown={() => selectResult(t)}
                style={{
                  display: 'block', width: '100%', padding: '8px 12px',
                  background: 'none', border: 'none', textAlign: 'left',
                  cursor: 'pointer', borderBottom: '1px solid #F2F2F2',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#F9F9F9')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                <span style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
                  color: '#A3A3A3', marginRight: 6,
                }}>
                  {t.display_id}
                </span>
                <span style={{ fontSize: 12, color: '#262626' }}>{t.title}</span>
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

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  borderRadius: 6,
  border: '1px solid #E5E5E5',
  fontSize: 13,
  color: '#262626',
  background: '#fff',
  cursor: 'pointer',
  outline: 'none',
  fontFamily: 'Inter, system-ui, sans-serif',
  appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none'%3E%3Cpath d='M6 9l6 6 6-6' stroke='%23737373' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 8px center',
  paddingRight: 28,
}

function MetaSidebar({ ticket, isAdmin, currentUserId }: MetaSidebarProps) {
  const queryClient = useQueryClient()
  const { data: categories } = useCategories()
  const { data: agents } = useAgents()
  const [savedField, setSavedField] = useState<string | null>(null)

  const patchMutation = useMutation({
    mutationFn: (update: Partial<TicketRead>) =>
      api.patch<TicketRead>(`/tickets/${ticket.id}`, update).then(r => r.data),
    onSuccess: (updated, variables) => {
      queryClient.setQueryData(['ticket', ticket.id], updated)
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      const field = Object.keys(variables)[0]
      setSavedField(field)
      setTimeout(() => setSavedField(null), 1800)
    },
  })

  function patch(field: string, value: unknown) {
    patchMutation.mutate({ [field]: value })
  }

  const channelColors: Record<string, string> = {
    web: '#3B82F6',
    slack: '#10B981',
    email: '#F59E0B',
  }

  const channelLabels: Record<string, string> = {
    web: 'Web',
    slack: 'Slack',
    email: 'Email',
  }

  return (
    <div
      style={{
        background: '#FAFAFA',
        border: '1px solid #E5E5E5',
        borderRadius: 12,
        overflow: 'hidden',
        position: 'sticky',
        top: 80,
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #E5E5E5',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: '#262626', letterSpacing: '0.01em' }}>
          Details
        </span>
        {patchMutation.isPending && (
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              border: '2px solid #E5E5E5',
              borderTopColor: '#FF4713',
              display: 'inline-block',
              animation: 'spin 0.7s linear infinite',
            }}
          />
        )}
      </div>

      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Status */}
        <MetaRow label="Status">
          <div style={{ position: 'relative' }}>
            <StatusDropdown ticket={ticket} patch={patch} />
            {/* StatusDropdown is defined below — uses dynamic statuses */}
            <SavedFlash show={savedField === 'status'} />
          </div>
        </MetaRow>

        {/* Priority */}
        <MetaRow label="Priority">
          <div style={{ position: 'relative' }}>
            <select
              value={ticket.priority}
              onChange={e => patch('priority', e.target.value)}
              style={{
                ...selectStyle,
                fontWeight: 600,
                color: PRIORITY_COLORS[ticket.priority as Priority],
              }}
            >
              {(Object.entries(PRIORITY_LABELS) as [Priority, string][]).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <SavedFlash show={savedField === 'priority'} />
          </div>
        </MetaRow>

        {/* Assignee */}
        <MetaRow label="Assignee">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {isAdmin && agents && agents.length > 0 ? (
              <select
                value={ticket.assignee_id ?? ''}
                onChange={e => patch('assignee_id', e.target.value ? Number(e.target.value) : null)}
                style={selectStyle}
              >
                <option value="">Unassigned</option>
                {agents.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            ) : (
              <span style={{ fontSize: 13, color: ticket.assignee_name ? '#262626' : '#A3A3A3', fontStyle: ticket.assignee_name ? 'normal' : 'italic' }}>
                {ticket.assignee_name ?? 'Unassigned'}
              </span>
            )}
            {ticket.assignee_id !== currentUserId && (
              <button
                type="button"
                onClick={() => patch('assignee_id', currentUserId)}
                style={{
                  padding: '5px 10px',
                  borderRadius: 6,
                  border: '1px solid #E5E5E5',
                  background: '#fff',
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#FF4713',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#FFF5F0')}
                onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
              >
                → Assign to me
              </button>
            )}
            <SavedFlash show={savedField === 'assignee_id'} />
          </div>
        </MetaRow>

        {/* Category */}
        <MetaRow label="Category">
          <div style={{ position: 'relative' }}>
            <select
              value={ticket.category_id ?? ''}
              onChange={e => patch('category_id', e.target.value ? Number(e.target.value) : null)}
              style={selectStyle}
            >
              <option value="">No category</option>
              {categories?.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <SavedFlash show={savedField === 'category_id'} />
          </div>
        </MetaRow>

        {/* SLA — context-aware: first-response until replied, resolution after */}
        {(ticket.first_response_deadline || ticket.sla_deadline) && (() => {
          const awaitingFirstResponse = !ticket.first_responded_at && ticket.first_response_deadline
          const slaResult = awaitingFirstResponse
            ? parseSLABarRaw(ticket.first_response_deadline, ticket.created_at)
            : parseSLABarRaw(ticket.sla_deadline, ticket.created_at, ticket.sla_breached)
          const label = awaitingFirstResponse ? '1st response' : 'SLA'
          return (
            <MetaRow label={label}>
              <SLABadge slaResult={slaResult} variant="pill" />
            </MetaRow>
          )
        })()}

        {/* Channel */}
        <MetaRow label="Channel">
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 12,
              fontWeight: 600,
              color: channelColors[ticket.channel] ?? '#737373',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: channelColors[ticket.channel] ?? '#737373',
                flexShrink: 0,
              }}
            />
            {channelLabels[ticket.channel] ?? ticket.channel}
          </span>
        </MetaRow>

        {/* Duplicate link */}
        <DuplicatePickerRow ticket={ticket} />

        {/* Submitter */}
        {ticket.submitter_name && (
          <MetaRow label="Submitted by">
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Avatar name={ticket.submitter_name} size={22} />
              <span style={{ fontSize: 13, color: '#262626' }}>{ticket.submitter_name}</span>
            </div>
          </MetaRow>
        )}

        {/* Timestamps */}
        <div
          style={{
            borderTop: '1px solid #E5E5E5',
            paddingTop: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#A3A3A3' }}>Created</span>
            <span style={{ fontSize: 11, color: '#737373', fontFamily: 'JetBrains Mono, monospace' }}>
              {timeAgo(ticket.created_at)}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#A3A3A3' }}>Updated</span>
            <span style={{ fontSize: 11, color: '#737373', fontFamily: 'JetBrains Mono, monospace' }}>
              {timeAgo(ticket.updated_at)}
            </span>
          </div>
          {ticket.resolved_at && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: '#A3A3A3' }}>Resolved</span>
              <span style={{ fontSize: 11, color: '#10B981', fontFamily: 'JetBrains Mono, monospace' }}>
                {timeAgo(ticket.resolved_at)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── History event row ──────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  status: 'status',
  priority: 'priority',
  assignee_id: 'assignee',
  category_id: 'category',
  duplicate_of: 'duplicate link',
}

function formatHistoryValue(field: string, value: string | null): React.ReactNode {
  if (value == null) return <em style={{ color: '#A3A3A3' }}>none</em>
  if (field === 'status') {
    const color = statusColor(value)
    return (
      <span style={{
        display: 'inline-block', padding: '1px 7px', borderRadius: 999,
        fontSize: 11, fontWeight: 600,
        background: `${color}18`, color, border: `1px solid ${color}40`,
      }}>
        {statusLabel(value)}
      </span>
    )
  }
  if (field === 'duplicate_of') {
    return (
      <strong style={{ color: '#F59E0B', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
        {value}
      </strong>
    )
  }
  return <strong style={{ color: '#262626' }}>{value}</strong>
}

function StatusDropdown({ ticket, patch }: { ticket: TicketRead; patch: (field: string, value: string) => void }) {
  const { data: appConfig } = useAppConfig()
  const statuses = appConfig?.statuses ?? getAllStatuses()
  return (
    <select
      value={ticket.status}
      onChange={e => patch('status', e.target.value)}
      style={{ ...selectStyle, fontWeight: 600, color: statusColor(ticket.status) }}
    >
      {statuses.map(s => (
        <option key={s.name} value={s.name}>{s.label}</option>
      ))}
      {/* If ticket has a status not in the current list (e.g. archived), show it anyway */}
      {!statuses.find(s => s.name === ticket.status) && (
        <option value={ticket.status}>{statusLabel(ticket.status)}</option>
      )}
    </select>
  )
}

function HistoryEventRow({ event }: { event: HistoryEvent }) {
  const label = FIELD_LABELS[event.field] ?? event.field
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 0', justifyContent: 'center',
    }}>
      <div style={{ flex: 1, height: 1, background: '#F2F2F2' }} />
      <div style={{ fontSize: 11, color: '#A3A3A3', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ fontWeight: 500, color: '#737373' }}>{event.actor_name ?? 'System'}</span>
        <span>changed {label}</span>
        {event.old_value != null && (
          <>{' '}from {formatHistoryValue(event.field, event.old_value)}</>
        )}
        <span>to</span>
        {formatHistoryValue(event.field, event.new_value)}
        <span style={{ color: '#C0C0C0' }}>·</span>
        <span>{timeAgo(event.created_at)}</span>
      </div>
      <div style={{ flex: 1, height: 1, background: '#F2F2F2' }} />
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Description bubble — the "first message" */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #E5E5E5',
          borderRadius: 12,
          padding: '20px 24px',
          marginBottom: 8,
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <Avatar name={ticket.submitter_name} size={36} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#262626' }}>
              {ticket.submitter_name ?? 'Unknown'}
            </div>
            <div style={{ fontSize: 11, color: '#A3A3A3' }}>
              {timeAgo(ticket.created_at)} · Original request
            </div>
          </div>
        </div>
        <p
          style={{
            fontSize: 14,
            color: '#262626',
            lineHeight: 1.7,
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {ticket.description}
        </p>
        <AttachmentList attachments={attachmentsByReply['__ticket__'] ?? []} />
      </div>

      {/* Reply thread */}
      {isLoading ? (
        <div style={{ padding: '24px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1, 2].map(i => (
            <div key={i} style={{ display: 'flex', gap: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#F2F2F2', flexShrink: 0 }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ width: 80, height: 12, borderRadius: 4, background: '#F2F2F2', animation: 'shimmer 1.5s ease-in-out infinite' }} />
                <div style={{ width: '60%', height: 60, borderRadius: 8, background: '#F2F2F2', animation: 'shimmer 1.5s ease-in-out infinite' }} />
              </div>
            </div>
          ))}
        </div>
      ) : timeline.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 0' }}>
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
        <div style={{ padding: '28px 0 16px', textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: '#A3A3A3' }}>No replies yet.</p>
        </div>
      )}

      {/* Composer */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #E5E5E5',
          borderRadius: 12,
          padding: '16px 20px',
          marginTop: 8,
        }}
      >
        {isClosed ? (
          <p style={{ fontSize: 13, color: '#A3A3A3', margin: 0, textAlign: 'center' }}>
            This ticket is {ticket.status}. Reopen it to reply.
          </p>
        ) : (
          <Composer ticketId={ticket.id} isTech={isTech} />
        )}
      </div>
    </div>
  )
}

// ── End-user metadata strip ────────────────────────────────────────────────────

// ── Breadcrumb ─────────────────────────────────────────────────────────────────

interface BreadcrumbProps {
  ticket: TicketRead
}

function Breadcrumb({ ticket }: BreadcrumbProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 20,
        fontSize: 13,
        color: '#A3A3A3',
      }}
    >
      <Link
        to="/queue"
        style={{ color: '#737373', textDecoration: 'none', fontWeight: 500 }}
        onMouseEnter={e => (e.currentTarget.style.color = '#FF4713')}
        onMouseLeave={e => (e.currentTarget.style.color = '#737373')}
      >
        Queue
      </Link>
      <span style={{ color: '#D4D4D4' }}>/</span>
      <span
        style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 12,
          color: '#737373',
          letterSpacing: '0.03em',
        }}
      >
        {ticket.display_id}
      </span>
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

  if (isLoading) {
    return (
      <AppShell title="Loading…">
        <div style={{ padding: '28px 32px' }}>
          <div style={{ height: 24, width: 200, borderRadius: 6, background: '#F2F2F2', animation: 'shimmer 1.5s ease-in-out infinite', marginBottom: 20 }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24 }}>
            <div style={{ height: 400, borderRadius: 12, background: '#F2F2F2', animation: 'shimmer 1.5s ease-in-out infinite' }} />
            <div style={{ height: 400, borderRadius: 12, background: '#F2F2F2', animation: 'shimmer 1.5s ease-in-out infinite' }} />
          </div>
        </div>
      </AppShell>
    )
  }

  if (error || !ticket) {
    return (
      <AppShell title="Not Found">
        <div style={{ padding: '28px 32px', textAlign: 'center' }}>
          <p style={{ color: '#737373' }}>Ticket not found or you don&apos;t have permission to view it.</p>
          <button onClick={() => navigate('/queue')} style={{ marginTop: 16, color: '#FF4713', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>
            ← Back to queue
          </button>
        </div>
      </AppShell>
    )
  }

  return (
      <AppShell title={ticket.display_id}>
        <div style={{ padding: '24px 32px', maxWidth: 1200 }}>
          <Breadcrumb ticket={ticket} />

          {/* Title */}
          <h1
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: '#0A0A0A',
              letterSpacing: '-0.02em',
              marginBottom: 20,
              lineHeight: 1.3,
            }}
          >
            {ticket.title}
          </h1>

          {/* Slack sync notice — shown for any ticket with an active Slack thread */}
          {ticket.slack_channel_id && ticket.slack_message_ts && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 14px',
                marginBottom: 20,
                background: '#F0FFF4',
                border: '1px solid #BBF7D0',
                borderLeft: '3px solid #10B981',
                borderRadius: '0 8px 8px 0',
                fontSize: 12,
                color: '#065F46',
              }}
            >
              {/* Slack icon */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                <path d="M14.5 10c-.83 0-1.5-.67-1.5-1.5v-5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5z" fill="#10B981"/>
                <path d="M20.5 10H19V8.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" fill="#10B981"/>
                <path d="M9.5 14c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5S8 21.33 8 20.5v-5c0-.83.67-1.5 1.5-1.5z" fill="#10B981"/>
                <path d="M3.5 14H5v1.5c0 .83-.67 1.5-1.5 1.5S2 16.33 2 15.5 2.67 14 3.5 14z" fill="#10B981"/>
                <path d="M14 14.5c0-.83.67-1.5 1.5-1.5h5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-5c-.83 0-1.5-.67-1.5-1.5z" fill="#10B981"/>
                <path d="M15.5 19H14v1.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5-.67-1.5-1.5-1.5z" fill="#10B981"/>
                <path d="M10 9.5C10 8.67 9.33 8 8.5 8h-5C2.67 8 2 8.67 2 9.5S2.67 11 3.5 11h5c.83 0 1.5-.67 1.5-1.5z" fill="#10B981"/>
                <path d="M8.5 5H10V3.5C10 2.67 9.33 2 8.5 2S7 2.67 7 3.5 7.67 5 8.5 5z" fill="#10B981"/>
              </svg>
              <span>
                {ticket.channel === 'slack'
                  ? 'This ticket was created from Slack. Replies sync automatically.'
                  : <>
                      Replies are synced to Slack
                      {ticket.submitter_name && (
                        <> via DM to <strong>{ticket.submitter_name}</strong></>
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
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 14px',
                marginBottom: 20,
                background: '#FFFBEB',
                border: '1px solid #FDE68A',
                borderLeft: '3px solid #F59E0B',
                borderRadius: '0 8px 8px 0',
                fontSize: 12,
                color: '#78350F',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
              <span>
                This ticket is a duplicate of{' '}
                <Link
                  to={`/tickets/${ticket.duplicate_of_id}`}
                  style={{ color: '#B45309', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}
                >
                  TKT-{String(ticket.duplicate_of_id).padStart(4, '0')}
                </Link>
                {ticket.duplicate_of_title && (
                  <> — {ticket.duplicate_of_title}</>
                )}
              </span>
            </div>
          )}

          {/* Two-column layout */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 24, alignItems: 'start' }}>
            <ThreadColumn ticket={ticket} isTech currentUserId={user?.id} />
            <MetaSidebar
              ticket={ticket}
              isAdmin={isAdmin}
              currentUserId={user?.id ?? 0}
            />
          </div>
        </div>

        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          @keyframes shimmer { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
          @keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        `}</style>
      </AppShell>
  )
}
