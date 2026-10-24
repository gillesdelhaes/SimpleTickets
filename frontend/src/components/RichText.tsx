import type { ReactNode } from 'react'

// ── Rich text for ticket descriptions and replies ──────────────────────────────
//
// Renders the small Slack-style subset people actually type: links (bare or
// Slack's <url|label>), ```code blocks```, `inline code`, *bold* and _italic_.
// Everything becomes React elements — never HTML strings — so text can't
// inject markup. Links only ever point at http(s) or mailto, and a link whose
// label differs from where it goes shows the real host next to it, so a
// message can't dress one site up as another.

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** The URL if it's safe to link to, else null. */
function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw)
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

/** Slack stores text with &, < and > escaped. */
function unescapeSlack(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

function Anchor({ href, label }: { href: string; label: string }) {
  let host = ''
  try {
    host = new URL(href).host
  } catch { /* mailto has no host */ }
  // The label is just the address itself (as typed or normalized) — nothing to disclose
  const labelIsUrl = safeHref(label) === href || label === href.replace(/^mailto:/, '')
  return (
    <>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        title={href}
        className="text-brand-ink underline underline-offset-2 break-all"
      >
        {label}
      </a>
      {!labelIsUrl && host && <span className="text-ink-3 text-[0.85em]"> ({host})</span>}
    </>
  )
}

// Slack angle-bracket tokens, bare URLs, inline code, bold, italic — in that
// order of precedence. Bold/italic need a word boundary so snake_case and
// 2*3*4 stay as typed.
const INLINE = new RegExp(
  [
    /<([^<>\s|]+)(?:\|([^<>]*))?>/.source,                 // 1,2  <target|label>
    /((?:https?:\/\/|mailto:)[^\s<>"]*[^\s<>".,;:!?)\]'])/.source, // 3  bare URL
    /`([^`\n]+)`/.source,                                   // 4    `code`
    /(?<![\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\w*])/.source, // 5    *bold*
    /(?<![\w_])_(?=\S)([^_\n]+?)(?<=\S)_(?![\w_])/.source,   // 6    _italic_
  ].join('|'),
  'g',
)

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0
    if (start > last) out.push(unescapeSlack(text.slice(last, start)))
    const key = `${keyBase}-${i++}`
    if (m[1] !== undefined) {
      const target = unescapeSlack(m[1])
      const label = m[2] !== undefined ? unescapeSlack(m[2]) : undefined
      if (target.startsWith('@')) {
        out.push(<span key={key} className="font-semibold">@{label || target.slice(1)}</span>)
      } else if (target.startsWith('#')) {
        out.push(<span key={key} className="font-semibold">#{label || target.slice(1)}</span>)
      } else if (target.startsWith('!')) {
        out.push(<span key={key} className="font-semibold">@{label || target.slice(1)}</span>)
      } else {
        const href = safeHref(target)
        const shown = label || target.replace(/^mailto:/, '')
        out.push(href ? <Anchor key={key} href={href} label={shown} /> : shown)
      }
    } else if (m[3] !== undefined) {
      const raw = unescapeSlack(m[3])
      const href = safeHref(raw)
      out.push(href ? <Anchor key={key} href={href} label={raw} /> : raw)
    } else if (m[4] !== undefined) {
      out.push(
        <code key={key} className="font-mono text-[0.9em] px-1 py-px rounded-md bg-field border border-edge">
          {unescapeSlack(m[4])}
        </code>,
      )
    } else if (m[5] !== undefined) {
      out.push(<strong key={key}>{renderInline(m[5], key)}</strong>)
    } else if (m[6] !== undefined) {
      out.push(<em key={key}>{renderInline(m[6], key)}</em>)
    }
    last = start + m[0].length
  }
  if (last < text.length) out.push(unescapeSlack(text.slice(last)))
  return out
}

/**
 * Formatted message text. The parent keeps `whitespace-pre-wrap`, so line
 * breaks and indentation survive as typed.
 */
export default function RichText({ text }: { text: string }) {
  const parts = text.split(/```/)
  // An odd count of fences leaves the last one unclosed — show it literally.
  const closed = parts.length % 2 === 1
  return (
    <>
      {parts.map((part, idx) => {
        const isCode = idx % 2 === 1 && (closed || idx < parts.length - 1)
        if (isCode) {
          return (
            <pre
              key={idx}
              className="font-mono text-[12.5px] my-1.5 px-3 py-2 rounded-[10px] bg-field border border-edge overflow-x-auto whitespace-pre"
            >
              {unescapeSlack(part.replace(/^\n/, '').replace(/\n$/, ''))}
            </pre>
          )
        }
        const prefix = idx % 2 === 1 ? '```' : ''
        return <span key={idx}>{renderInline(prefix + part, String(idx))}</span>
      })}
    </>
  )
}
