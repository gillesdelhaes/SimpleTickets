import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import api from '../../lib/api'
import { useCategories } from '../../hooks/useCategories'
import { useSlackUsers } from '../../hooks/useSlackUsers'
import type { Priority } from '../../types/ticket'

interface Props {
  open: boolean
  onClose: () => void
}

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]

export default function CreateTicketModal({ open, onClose }: Props) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: categories = [] } = useCategories()
  const { data: slackUsers = [] } = useSlackUsers()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [reporterSearch, setReporterSearch] = useState('')
  const [selectedReporter, setSelectedReporter] = useState<{ id: string; name: string } | null>(null)
  const [reporterOpen, setReporterOpen] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reporterRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setTitle('')
      setDescription('')
      setPriority('medium')
      setCategoryId(null)
      setReporterSearch('')
      setSelectedReporter(null)
      setReporterOpen(false)
      setFiles([])
      setError(null)
      setTimeout(() => titleRef.current?.focus(), 50)
    }
  }, [open])

  // Close reporter dropdown on outside click
  useEffect(() => {
    if (!reporterOpen) return
    function handle(e: MouseEvent) {
      if (reporterRef.current && !reporterRef.current.contains(e.target as Node)) {
        setReporterOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [reporterOpen])

  // Close modal on Escape
  useEffect(() => {
    if (!open) return
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [open, onClose])

  const filteredUsers = slackUsers.filter(u =>
    u.name.toLowerCase().includes(reporterSearch.toLowerCase())
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('Title is required'); return }
    if (!description.trim()) { setError('Description is required'); return }

    setSubmitting(true)
    setError(null)
    try {
      // Reporter is optional: without one, the backend files the ticket under
      // the current user. Only send the Slack identity when a reporter is picked.
      const { data } = await api.post('/tickets', {
        title: title.trim(),
        description: description.trim(),
        priority,
        category_id: categoryId,
        ...(selectedReporter
          ? { slack_reporter_id: selectedReporter.id, slack_reporter_name: selectedReporter.name }
          : {}),
      })

      // Upload attachments sequentially — failures are non-fatal
      for (const file of files) {
        const form = new FormData()
        form.append('file', file)
        await api.post(`/tickets/${data.id}/attachments`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        }).catch(() => {/* non-fatal */})
      }

      await qc.invalidateQueries({ queryKey: ['tickets'] })
      onClose()
      navigate(`/tickets/${data.id}`)
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to create ticket')
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <>
      <div className="scrim open" style={{ zIndex: 200 }} onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="New ticket"
        className="modal open"
        style={{ zIndex: 201, width: 'min(540px, 94vw)', maxHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', padding: 0 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
          <div>
            <h2>New ticket</h2>
            <p className="sub" style={{ margin: '2px 0 0' }}>Create a ticket on behalf of a colleague</p>
          </div>
          <button className="so-close" onClick={onClose} aria-label="Close">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 pb-6 overflow-y-auto flex-1">
          {/* Reporter picker */}
          <div className="fieldrow">
            <label>Reporter <span className="font-normal text-ink-3">(optional — defaults to you)</span></label>
            <div ref={reporterRef} className="relative">
              <div
                onClick={() => setReporterOpen(o => !o)}
                className="input flex items-center justify-between cursor-pointer select-none"
                style={{ color: selectedReporter ? 'var(--ink)' : 'var(--ink-3)' }}
              >
                <span className="text-[13px]">
                  {selectedReporter ? selectedReporter.name : 'Search Slack users…'}
                </span>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-ink-3">
                  <path d="M3 5l4 4 4-4" />
                </svg>
              </div>

              {reporterOpen && (
                <div
                  className="overlay-surface absolute left-0 right-0 z-10 flex flex-col"
                  style={{ top: 'calc(100% + 6px)', maxHeight: 240, borderRadius: 16 }}
                >
                  <div className="px-3 py-2 border-b border-track">
                    <input
                      autoFocus
                      value={reporterSearch}
                      onChange={e => setReporterSearch(e.target.value)}
                      placeholder="Type to filter…"
                      className="w-full border-0 outline-none text-[13px] text-ink bg-transparent p-0 placeholder:text-ink-3"
                      style={{ font: 'inherit' }}
                    />
                  </div>
                  <div className="overflow-y-auto flex-1">
                    {filteredUsers.length === 0 ? (
                      <div className="px-3 py-3 text-[12px] text-ink-3 text-center">
                        {slackUsers.length === 0 ? 'Slack not configured' : 'No users found'}
                      </div>
                    ) : filteredUsers.map(u => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => {
                          setSelectedReporter(u)
                          setReporterSearch('')
                          setReporterOpen(false)
                        }}
                        className="block w-full text-left px-3 py-2 border-0 bg-transparent text-[13px] text-ink cursor-pointer hover:bg-row-hover"
                      >
                        {u.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {slackUsers.length === 0 && (
              <p className="m-0 text-[11px] text-warn-ink">
                Slack is not configured — reporter DM will be skipped
              </p>
            )}
          </div>

          {/* Title */}
          <div className="fieldrow">
            <label htmlFor="ticket-title">Title</label>
            <input
              id="ticket-title"
              ref={titleRef}
              className="input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Brief description of the issue"
              maxLength={255}
            />
          </div>

          {/* Description */}
          <div className="fieldrow">
            <label htmlFor="ticket-description">Description</label>
            <textarea
              id="ticket-description"
              className="input"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Provide full details…"
              rows={4}
              style={{ resize: 'vertical', minHeight: 90 }}
            />
          </div>

          {/* Priority + Category row */}
          <div className="formgrid" style={{ marginBottom: 16 }}>
            <div className="fieldrow">
              <label htmlFor="ticket-priority">Priority</label>
              <div className="selectwrap">
                <select
                  id="ticket-priority"
                  className="select"
                  value={priority}
                  onChange={e => setPriority(e.target.value as Priority)}
                >
                  {PRIORITIES.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="fieldrow">
              <label htmlFor="ticket-category">Category</label>
              <div className="selectwrap">
                <select
                  id="ticket-category"
                  className="select"
                  value={categoryId ?? ''}
                  onChange={e => setCategoryId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">No category</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Attachments — dashed drop affordance */}
          <div className="fieldrow" style={{ marginBottom: 20 }}>
            <label>Attachments <span className="font-normal text-ink-3">(optional)</span></label>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.zip"
              style={{ display: 'none' }}
              onChange={e => {
                const picked = Array.from(e.target.files ?? [])
                setFiles(prev => {
                  const existing = new Set(prev.map(f => f.name + f.size))
                  return [...prev, ...picked.filter(f => !existing.has(f.name + f.size))]
                })
                e.target.value = ''
              }}
            />
            <div
              className="rounded-block px-4 py-3 cursor-pointer bg-field border border-edge hover:bg-row-hover text-[12.5px] text-ink-2"
              style={{ boxShadow: 'inset 0 1px 0 var(--specular)' }}
              onClick={() => fileInputRef.current?.click()}
            >
              {files.length === 0 ? (
                <div className="flex items-center gap-2">
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-ink-3">
                    <path d="M8 2v8M5 5l3-3 3 3" />
                    <path d="M2 12h12" />
                    <path d="M2 14h12" />
                  </svg>
                  <span>Click to attach files — images, PDF, Word, Excel, CSV</span>
                </div>
              ) : (
                <div className="flex flex-col gap-1 w-full">
                  {files.map((f, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="text-[12px] text-ink truncate" style={{ maxWidth: 360 }}>
                        {f.name} <span className="text-ink-3 font-mono text-[10.5px]">({(f.size / 1024).toFixed(0)} KB)</span>
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${f.name}`}
                        onClick={e => { e.stopPropagation(); setFiles(prev => prev.filter((_, j) => j !== i)) }}
                        className="bg-transparent border-0 cursor-pointer text-ink-3 hover:text-danger-ink px-0.5 flex-shrink-0"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                          <path d="M2 2l8 8M10 2l-8 8" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  <span className="text-[11px] text-ink-3 mt-0.5">Click to add more</span>
                </div>
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div
              className="px-3 py-2.5 rounded-control mb-4 text-[13px] text-danger-ink"
              style={{ background: 'var(--danger-bg)' }}
            >
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="modal-actions" style={{ marginTop: 0 }}>
            <button type="button" className="btn ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn"
              disabled={submitting}
              style={submitting ? { opacity: 0.6, cursor: 'wait' } : undefined}
            >
              {submitting ? 'Creating…' : 'Create ticket'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
