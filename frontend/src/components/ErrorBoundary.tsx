import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <>
        <div className="aura" aria-hidden="true" />
        <div className="relative min-h-screen flex items-center justify-center" style={{ zIndex: 1 }}>
          <div className="panel text-center px-8 py-9" style={{ maxWidth: 440 }}>
            <div
              className="flex items-center justify-center mx-auto mb-4"
              style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--danger-bg)', color: 'var(--danger-ink)' }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <circle cx="12" cy="17" r="0.5" fill="currentColor" />
              </svg>
            </div>
            <h1 className="text-[17px] font-semibold text-ink m-0 mb-2">Something went wrong</h1>
            <p className="text-[13px] text-ink-2 m-0 mb-6 leading-normal">
              An unexpected error occurred. Try refreshing the page.
            </p>
            <button className="btn" onClick={() => window.location.reload()}>
              Reload page
            </button>
            {(import.meta as any).env?.DEV && (
              <pre className="mt-6 text-left font-mono text-[11px] text-ink-3 rounded-control p-3 overflow-auto bg-field border border-edge">
                {this.state.error.stack}
              </pre>
            )}
          </div>
        </div>
      </>
    )
  }
}
