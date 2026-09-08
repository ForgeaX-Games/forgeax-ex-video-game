import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { tf, useT } from '@/i18n'
import {
  dismissErrorReport,
  formatErrorReportForAi,
  getErrorReports,
  subscribeErrorReports,
} from '@/lib/diagnostics/error-report'
import { copyText } from './copy-to-clipboard'

export function ErrorToastHost(): JSX.Element | null {
  const t = useT()
  const reports = useSyncExternalStore(
    subscribeErrorReports,
    getErrorReports,
    getErrorReports,
  )
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copyTimer = useRef<number>()

  useEffect(() => () => {
    if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current)
  }, [])

  if (typeof document === 'undefined' || reports.length === 0) return null

  return createPortal(
    <aside
      aria-label={t('diagnostics.listLabel')}
      style={{
        position: 'fixed',
        right: 16,
        top: 16,
        zIndex: 2147483647,
        display: 'flex',
        width: 'min(440px, calc(100vw - 32px))',
        maxHeight: 'calc(100vh - 32px)',
        flexDirection: 'column',
        gap: 8,
        overflow: 'auto',
        pointerEvents: 'none',
      }}
    >
      {reports.map((report) => {
        const expanded = expandedIds.has(report.id)
        return (
          <section
            key={report.id}
            role="status"
            style={{
              border: '1px solid #ef4444',
              borderRadius: 10,
              background: '#2a1114',
              color: '#fff7ed',
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.42)',
              padding: 12,
              pointerEvents: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong style={{ display: 'block', color: '#fca5a5' }}>
                  {t('diagnostics.toast.title')}
                </strong>
                <span style={{ display: 'block', marginTop: 3, fontSize: 12, opacity: 0.72 }}>
                  {report.region}
                  {report.count > 1 ? ` · ${tf('diagnostics.occurrences', { count: report.count })}` : ''}
                </span>
                <span
                  style={{
                    display: 'block',
                    marginTop: 6,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: expanded ? 'normal' : 'nowrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {report.message}
                </span>
              </div>
              <button
                type="button"
                aria-label={t('diagnostics.dismiss')}
                title={t('diagnostics.dismiss')}
                onClick={() => dismissErrorReport(report.id)}
                style={iconButtonStyle}
              >
                ×
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                type="button"
                aria-label={expanded ? t('diagnostics.collapse') : t('diagnostics.expand')}
                onClick={() => {
                  setExpandedIds((current) => {
                    const next = new Set(current)
                    if (expanded) next.delete(report.id)
                    else next.add(report.id)
                    return next
                  })
                }}
                style={actionButtonStyle}
              >
                {expanded ? t('diagnostics.collapse') : t('diagnostics.expand')}
              </button>
              <button
                type="button"
                aria-label={t('diagnostics.copy')}
                onClick={() => {
                  void copyText(formatErrorReportForAi(report)).then((copied) => {
                    if (!copied) return
                    setCopiedId(report.id)
                    if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current)
                    copyTimer.current = window.setTimeout(() => setCopiedId(null), 1800)
                  })
                }}
                style={actionButtonStyle}
              >
                {copiedId === report.id ? t('diagnostics.copied') : t('diagnostics.copy')}
              </button>
            </div>
            {expanded && (
              <pre
                style={{
                  maxHeight: 240,
                  margin: '10px 0 0',
                  overflow: 'auto',
                  borderRadius: 6,
                  background: '#14090b',
                  padding: 10,
                  fontSize: 11,
                  lineHeight: 1.45,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {formatErrorReportForAi(report)}
              </pre>
            )}
          </section>
        )
      })}
    </aside>,
    document.body,
  )
}

const iconButtonStyle = {
  width: 26,
  height: 26,
  border: 0,
  borderRadius: 5,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 20,
  lineHeight: 1,
} as const

const actionButtonStyle = {
  border: '1px solid rgba(252, 165, 165, 0.55)',
  borderRadius: 5,
  background: 'rgba(255, 255, 255, 0.06)',
  color: 'inherit',
  cursor: 'pointer',
  padding: '4px 9px',
  fontSize: 12,
} as const
