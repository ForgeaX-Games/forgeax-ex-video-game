import { Component, Fragment, type CSSProperties, type ErrorInfo, type ReactNode } from 'react'
import { t } from '@/i18n'
import {
  formatErrorReportForAi,
  reportRenderError,
  type DiagnosticContext,
  type ErrorReport,
} from '@/lib/diagnostics/error-report'
import { copyText } from './copy-to-clipboard'

export type ErrorBoundaryVariant = 'root' | 'panel' | 'inline' | 'silent'

export interface RenderErrorBoundaryProps {
  children: ReactNode
  region: string
  variant?: ErrorBoundaryVariant
  resetKeys?: readonly unknown[]
  context?: DiagnosticContext
  fallback?: ReactNode
  onReload?: () => void
}

interface RenderErrorBoundaryState {
  error: Error | null
  report: ErrorReport | null
  copied: boolean
  resetToken: number
}

function resetKeysChanged(previous?: readonly unknown[], next?: readonly unknown[]): boolean {
  if (previous === next) return false
  if (!previous || !next || previous.length !== next.length) return true
  return previous.some((value, index) => !Object.is(value, next[index]))
}

export class RenderErrorBoundary extends Component<
  RenderErrorBoundaryProps,
  RenderErrorBoundaryState
> {
  private copyTimer: number | undefined

  override state: RenderErrorBoundaryState = {
    error: null,
    report: null,
    copied: false,
    resetToken: 0,
  }

  static getDerivedStateFromError(error: Error): Partial<RenderErrorBoundaryState> {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const report = reportRenderError({
      error,
      reactStack: info.componentStack,
      region: this.props.region,
      context: this.props.context,
    })
    console.error(`[wb-game-video:${this.props.region}] render failed`, error, info.componentStack)
    this.setState({ report })
  }

  override componentDidUpdate(previousProps: RenderErrorBoundaryProps): void {
    if (this.state.error && resetKeysChanged(previousProps.resetKeys, this.props.resetKeys)) {
      this.retry()
    }
  }

  override componentWillUnmount(): void {
    if (this.copyTimer !== undefined) window.clearTimeout(this.copyTimer)
  }

  private retry = (): void => {
    this.setState((state) => ({
      error: null,
      report: null,
      copied: false,
      resetToken: state.resetToken + 1,
    }))
  }

  private copy = async (): Promise<void> => {
    if (!this.state.report) return
    const copied = await copyText(formatErrorReportForAi(this.state.report))
    if (!copied) return
    this.setState({ copied: true })
    if (this.copyTimer !== undefined) window.clearTimeout(this.copyTimer)
    this.copyTimer = window.setTimeout(() => this.setState({ copied: false }), 1800)
  }

  override render(): ReactNode {
    if (!this.state.error) {
      return <Fragment key={this.state.resetToken}>{this.props.children}</Fragment>
    }
    if (this.props.fallback !== undefined) return this.props.fallback
    const variant = this.props.variant ?? 'panel'
    if (variant === 'silent') return null
    const isRoot = variant === 'root'

    return (
      <section
        className={`render-error-fallback is-${variant}`}
        role="alert"
        data-error-region={this.props.region}
        style={isRoot ? rootStyle : regionStyle}
      >
        <strong style={{ fontSize: isRoot ? 16 : 13 }}>
          {t(isRoot ? 'diagnostics.root.title' : 'diagnostics.regionFailed')}
        </strong>
        <p style={descriptionStyle}>
          {t(isRoot ? 'diagnostics.root.message' : 'diagnostics.region.message')}
        </p>
        <p className="render-error-message" style={messageStyle}>{this.state.error.message}</p>
        <div className="render-error-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" onClick={this.retry} style={buttonStyle}>
            {t(isRoot ? 'diagnostics.retryWorkbench' : 'diagnostics.retryRegion')}
          </button>
          <button type="button" onClick={() => void this.copy()} style={buttonStyle}>
            {this.state.copied ? t('diagnostics.copied') : t('diagnostics.copy')}
          </button>
          {this.props.onReload && (
            <button type="button" onClick={this.props.onReload} style={buttonStyle}>
              {t('diagnostics.reload')}
            </button>
          )}
        </div>
      </section>
    )
  }
}

// Inline styles keep the fallback readable even when a host page never loaded
// the editor stylesheet; design tokens still win wherever they are defined.
const surfaceStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 10,
  overflow: 'auto',
  border: '1px solid var(--color-border-default, #404040)',
  background: 'var(--color-background-elevated, #242424)',
  color: 'var(--color-text-primary, #ffffff)',
}

const rootStyle: CSSProperties = {
  ...surfaceStyle,
  position: 'absolute',
  inset: 16,
  zIndex: 99999,
  borderRadius: 'var(--radius-lg, 12px)',
  padding: 24,
  boxShadow: '0 12px 40px rgba(0, 0, 0, 0.42)',
}

const regionStyle: CSSProperties = {
  ...surfaceStyle,
  minWidth: 0,
  minHeight: 96,
  flex: 1,
  justifyContent: 'center',
  borderRadius: 'var(--radius-md, 8px)',
  padding: 16,
}

const descriptionStyle: CSSProperties = {
  margin: 0,
  color: 'var(--color-text-secondary, rgba(255, 255, 255, 0.6))',
  fontSize: 12,
}

const messageStyle: CSSProperties = {
  maxWidth: '100%',
  margin: 0,
  overflowWrap: 'anywhere',
  borderRadius: 'var(--radius-sm, 4px)',
  background: 'var(--color-background-canvas, #0d0d0d)',
  color: 'var(--color-text-secondary, rgba(255, 255, 255, 0.6))',
  padding: '6px 8px',
  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
  fontSize: 12,
}

const buttonStyle: CSSProperties = {
  border: '1px solid var(--color-border-default, #404040)',
  borderRadius: 'var(--radius-sm, 4px)',
  background: 'var(--color-interaction-hover, rgba(255, 255, 255, 0.05))',
  color: 'inherit',
  cursor: 'pointer',
  padding: '6px 10px',
  fontSize: 12,
}
