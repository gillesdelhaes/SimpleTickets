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
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reporterRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)

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
    if (!selectedReporter) { setError('Please select a reporter'); return }

    setSubmitting(true)
    setError(null)
    try {
      const { data } = await api.post('/tickets', {
        title: title.trim(),
        description: description.trim(),
        priority,
        category_id: categoryId,
        slack_reporter_id: selectedReporter.id,
        slack_reporter_name: selectedReporter.name,
      })
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
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 200,
          backdropFilter: 'blur(2px)',
        }}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 540,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 48px)',
          background: '#fff',
          borderRadius: 14,
          boxShadow: '0 24px 64px rgba(0,0,0,0.18)',
          zIndex: 201,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid #F2F2F2',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0A0A0A', letterSpacing: '-0.02em' }}>
              New Ticket
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#A3A3A3' }}>
              Create a ticket on behalf of a colleague
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#A3A3A3', padding: 6, borderRadius: 6,
              display: 'flex', alignItems: 'center',
              transition: 'color 0.12s',
            }}
            onMouseOver={e => (e.currentTarget.style.color = '#0A0A0A')}
            onMouseOut={e => (e.currentTarget.style.color = '#A3A3A3')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '20px 24px 24px', overflowY: 'auto', flex: 1 }}>
          {/* Reporter picker */}
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Reporter (Slack user)</label>
            <div ref={reporterRef} style={{ position: 'relative' }}>
              <div
                onClick={() => setReporterOpen(o => !o)}
                style={{
                  ...inputStyle,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  color: selectedReporter ? '#0A0A0A' : '#A3A3A3',
                  userSelect: 'none',
                }}
              >
                <span style={{ fontSize: 13 }}>
                  {selectedReporter ? selectedReporter.name : 'Search Slack users…'}
                </span>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#A3A3A3" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M3 5l4 4 4-4" />
                </svg>
              </div>

              {reporterOpen && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                  background: '#fff', border: '1px solid #E5E5E5', borderRadius: 8,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
                  zIndex: 10, maxHeight: 240, display: 'flex', flexDirection: 'column',
                }}>
                  <div style={{ padding: '8px 10px', borderBottom: '1px solid #F2F2F2' }}>
                    <input
                      autoFocus
                      value={reporterSearch}
                      onChange={e => setReporterSearch(e.target.value)}
                      placeholder="Type to filter…"
                      style={{
                        width: '100%', border: 'none', outline: 'none',
                        fontSize: 13, color: '#0A0A0A', background: 'transparent',
                        padding: 0,
                      }}
                    />
                  </div>
                  <div style={{ overflowY: 'auto', flex: 1 }}>
                    {filteredUsers.length === 0 ? (
                      <div style={{ padding: '12px 12px', fontSize: 12, color: '#A3A3A3', textAlign: 'center' }}>
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
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '8px 12px', border: 'none', background: 'none',
                          fontSize: 13, color: '#0A0A0A', cursor: 'pointer',
                          transition: 'background 0.1s',
                        }}
                        onMouseOver={e => (e.currentTarget.style.background = '#F9F9F9')}
                        onMouseOut={e => (e.currentTarget.style.background = 'none')}
                      >
                        {u.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {slackUsers.length === 0 && (
              <p style={{ margin: '4px 0 0', fontSize: 11, color: '#F59E0B' }}>
                Slack is not configured — reporter DM will be skipped
              </p>
            )}
          </div>

          {/* Title */}
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Title</label>
            <input
              ref={titleRef}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Brief description of the issue"
              maxLength={255}
              style={inputStyle}
              onFocus={e => { e.target.style.borderColor = '#FF4713'; e.target.style.boxShadow = '0 0 0 3px rgba(255,71,19,0.08)' }}
              onBlur={e => { e.target.style.borderColor = '#E5E5E5'; e.target.style.boxShadow = 'none' }}
            />
          </div>

          {/* Description */}
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Provide full details…"
              rows={4}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 90 }}
              onFocus={e => { e.currentTarget.style.borderColor = '#FF4713'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(255,71,19,0.08)' }}
              onBlur={e => { e.currentTarget.style.borderColor = '#E5E5E5'; e.currentTarget.style.boxShadow = 'none' }}
            />
          </div>

          {/* Priority + Category row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            <div>
              <label style={labelStyle}>Priority</label>
              <select
                value={priority}
                onChange={e => setPriority(e.target.value as Priority)}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                {PRIORITIES.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Category</label>
              <select
                value={categoryId ?? ''}
                onChange={e => setCategoryId(e.target.value ? Number(e.target.value) : null)}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value="">No category</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              padding: '10px 12px', borderRadius: 8, marginBottom: 16,
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
              fontSize: 13, color: '#DC2626',
            }}>
              {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                border: '1px solid #E5E5E5', background: '#fff', color: '#737373',
                cursor: 'pointer', transition: 'background 0.12s',
              }}
              onMouseOver={e => (e.currentTarget.style.background = '#F9F9F9')}
              onMouseOut={e => (e.currentTarget.style.background = '#fff')}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: '8px 22px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                border: 'none',
                background: submitting ? '#FFA07A' : 'linear-gradient(135deg, #FF4713, #AD1164)',
                color: '#fff',
                cursor: submitting ? 'not-allowed' : 'pointer',
                transition: 'opacity 0.12s',
              }}
            >
              {submitting ? 'Creating…' : 'Create Ticket'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: '#525252',
  marginBottom: 6,
  letterSpacing: '0.01em',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 13,
  border: '1px solid #E5E5E5',
  borderRadius: 8,
  color: '#0A0A0A',
  background: '#fff',
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s, box-shadow 0.15s',
  fontFamily: 'inherit',
}
