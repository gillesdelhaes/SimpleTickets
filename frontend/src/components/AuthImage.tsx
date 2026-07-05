import { useEffect, useState } from 'react'
import api from '../lib/api'

interface AuthImageProps {
  attachmentId: number
  alt?: string
  style?: React.CSSProperties
  onClick?: () => void
}

/**
 * Fetches an attachment image using the authenticated API client and renders
 * it via a Blob URL — avoids exposing the JWT token as a query parameter.
 */
export default function AuthImage({ attachmentId, alt, style, onClick }: AuthImageProps) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let objectUrl: string | null = null
    api
      .get(`/attachments/${attachmentId}/download`, { responseType: 'blob' })
      .then(r => {
        objectUrl = URL.createObjectURL(r.data)
        setSrc(objectUrl)
      })
      .catch(() => setSrc(null))
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attachmentId])

  if (!src) {
    return (
      <div style={{
        width: 120, height: 80, borderRadius: 10,
        background: 'var(--track)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        fontSize: 11, color: 'var(--ink-3)',
        ...(style ?? {}),
      }}>
        Loading…
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt ?? 'attachment'}
      onClick={onClick}
      style={{
        maxWidth: 320, maxHeight: 240,
        borderRadius: 10, objectFit: 'contain',
        cursor: onClick ? 'zoom-in' : undefined,
        border: '1px solid var(--edge)',
        display: 'block',
        ...(style ?? {}),
      }}
    />
  )
}
