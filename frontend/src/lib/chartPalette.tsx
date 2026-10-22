import { useEffect, useState } from 'react'

// ── Chart palette helpers (Reports) ────────────────────────────────────────────
//
// Category palette: Jewel, Sunset and the brand arc merged, plus a few cool
// hues, with near-duplicates dropped (amethyst ≈ violet, indigo ≈ sapphire…).
// Ordered greedily: each slot is the color farthest from every earlier slot
// (worst of both themes, normal vision and protan/deutan), so a team with a
// handful of categories gets the crispest set and later ones still get a real
// color. Past slot 11 the remaining candidates were near-twins of existing
// ones, so further categories fall back to gray (still labeled).

export const CATEGORY_PALETTE: { name: string; dark: string; light: string }[] = [
  { name: 'sapphire', dark: '#4d94fb', light: '#5c9eff' },
  { name: 'rust', dark: '#9c5301', light: '#9c5301' },
  { name: 'emerald', dark: '#29af77', light: '#02bb7b' },
  { name: 'violet', dark: '#803fc6', light: '#9253da' },
  { name: 'topaz', dark: '#c78707', light: '#d28f09' },
  { name: 'berry', dark: '#a24071', light: '#a24071' },
  { name: 'ocean', dark: '#00729b', light: '#00729b' },
  { name: 'plum', dark: '#a279ce', light: '#6c329f' },
  { name: 'crimson', dark: '#d14a5f', light: '#9d1135' },
  { name: 'aqua', dark: '#00a8a2', light: '#0ba19b' },
  { name: 'magenta', dark: '#c841a5', light: '#eb63c5' },
]

export type Theme = 'dark' | 'light'

/** Current <html data-theme>, re-rendering when the user toggles it. */
export function useThemeAttr(): Theme {
  const read = (): Theme => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  const [theme, setTheme] = useState<Theme>(read)
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(read()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return theme
}

// ── OKLCH re-toning ────────────────────────────────────────────────────────────

function hexToLinear(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = m[1]
  return [0, 2, 4].map(i => {
    const s = parseInt(n.slice(i, i + 2), 16) / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
}

function linearToOklab([r, g, b]: [number, number, number]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ]
}

/** OKLCH → sRGB hex, reducing chroma until the color fits the sRGB gamut. */
function oklchToHex(L: number, C: number, h: number): string {
  for (let c = C; ; c -= 0.002) {
    const a = c * Math.cos((h * Math.PI) / 180)
    const b = c * Math.sin((h * Math.PI) / 180)
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b
    const [l, m, s] = [l_ ** 3, m_ ** 3, s_ ** 3]
    const rgb = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ]
    if (c <= 0 || rgb.every(v => v >= -1e-4 && v <= 1.0001)) {
      return '#' + rgb.map(v => {
        const x = Math.min(1, Math.max(0, v))
        const e = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
        return Math.round(e * 255).toString(16).padStart(2, '0')
      }).join('')
    }
  }
}

/** OKLab ΔE×100 between two hex colors (Infinity if either isn't a hex). */
export function colorDistance(a: string, b: string): number {
  const la = hexToLinear(a), lb = hexToLinear(b)
  if (!la || !lb) return Infinity
  const [L1, a1, b1] = linearToOklab(la), [L2, a2, b2] = linearToOklab(lb)
  return Math.hypot(L1 - L2, a1 - a2, b1 - b2) * 100
}

/** True for grays (and anything too desaturated to carry a hue). */
export function isNeutral(hex: string): boolean {
  const lin = hexToLinear(hex)
  if (!lin) return false
  const [, a, b] = linearToOklab(lin)
  return Math.hypot(a, b) < 0.04
}

/**
 * Keep a configured color's hue but give it the palette's lightness and
 * chroma, so admin-picked status colors sit in the same family as the
 * category hues instead of shouting next to them. Grays stay gray.
 */
export function harmonize(hex: string, theme: Theme): string {
  const lin = hexToLinear(hex)
  if (!lin) return hex
  const [, a, b] = linearToOklab(lin)
  const C = Math.hypot(a, b)
  if (C < 0.04) return theme === 'dark' ? '#6b7280' : '#8a909b'
  const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
  return oklchToHex(theme === 'dark' ? 0.62 : 0.56, theme === 'dark' ? 0.125 : 0.13, h)
}

// ── Hue-gradient bars ──────────────────────────────────────────────────────────
//
// The original brand gradient, rebuilt per color: each bar runs from its color
// at the value end to the same hue rotated 25° toward the brand's magenta end
// and deepened at the base. A bar never leaves its own color family, so it
// still reads as one category at a glance.

/** A `var(--token)` resolved to its value for the current theme. */
function resolveColor(color: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(color)
  if (!m) return color
  return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || color
}

/** Same hue family, rotated 25° and deepened. */
function driftColor(color: string, theme: Theme): string {
  const lin = hexToLinear(resolveColor(color))
  if (!lin) return color
  const [L, a, b] = linearToOklab(lin)
  const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
  return oklchToHex(Math.max(0.3, L - (theme === 'dark' ? 0.12 : 0.1)), Math.hypot(a, b), (h - 25 + 360) % 360)
}

const gradientId = (color: string, horizontal: boolean) =>
  `hue-${horizontal ? 'h' : 'v'}-${color.replace(/[^a-z0-9]/gi, '')}`

/** Gradient definitions for every color a chart uses, recomputed per theme. */
export function HueGradientDefs({ colors, theme }: { colors: string[]; theme: Theme }) {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        {[...new Set(colors)].flatMap(c => [
          <linearGradient key={gradientId(c, false)} id={gradientId(c, false)} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c} />
            <stop offset="100%" stopColor={driftColor(c, theme)} />
          </linearGradient>,
          <linearGradient key={gradientId(c, true)} id={gradientId(c, true)} x1="1" y1="0" x2="0" y2="0">
            <stop offset="0%" stopColor={c} />
            <stop offset="100%" stopColor={driftColor(c, theme)} />
          </linearGradient>,
        ])}
      </defs>
    </svg>
  )
}

interface BarShapeProps {
  x?: number
  y?: number
  width?: number
  height?: number
  fill?: string
}

/** Recharts `shape` for a hue-gradient bar; the Cell's fill is the bar's color. */
export function hueGradientBar(horizontal: boolean) {
  return function HueGradientBar({ x = 0, y = 0, width = 0, height = 0, fill = 'var(--ink-3)' }: BarShapeProps) {
    if (width <= 0 || height <= 0) return <g />
    return <rect x={x} y={y} width={width} height={height} rx={4} fill={`url(#${gradientId(fill, horizontal)})`} />
  }
}
