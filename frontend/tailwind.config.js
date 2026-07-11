/** @type {import('tailwindcss').Config} */
// Colors and radii bridge to the Glasshouse tokens (src/glasshouse.css) so
// utilities re-theme with [data-theme]/[data-app]. Never hard-code brand hexes.
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        b1: 'var(--b1)',
        b2: 'var(--b2)',
        ink: { DEFAULT: 'var(--ink)', 2: 'var(--ink-2)', 3: 'var(--ink-3)' },
        field: 'var(--field)',
        edge: { DEFAULT: 'var(--edge)', hi: 'var(--edge-hi)' },
        track: 'var(--track)',
        'row-hover': 'var(--row-hover)',
        'brand-ink': 'var(--brand-ink)',
        'warn-ink': 'var(--warn-ink)',
        'danger-ink': 'var(--danger-ink)',
        'ok-ink': 'var(--ok-ink)', // app token (index.css), not a glasshouse one
        'brand-tint': 'var(--brand-tint)',
        'warn-tint': 'var(--warn-bg)',
        'danger-tint': 'var(--danger-bg)',
        'ok-tint': 'var(--ok-bg)',
      },
      borderRadius: {
        panel: '22px',
        overlay: '26px',
        block: '16px',
        control: '12px',
      },
      fontFamily: {
        sans: ['Onest', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
