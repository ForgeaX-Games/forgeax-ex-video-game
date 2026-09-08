import packageJson from '../../../package.json'

export type DiagnosticContextValue = string | number | boolean | null | undefined
export type DiagnosticContext = Readonly<Record<string, DiagnosticContextValue>>

export interface RenderErrorInput {
  error: unknown
  region: string
  reactStack?: string | null
  context?: DiagnosticContext
}

export interface ErrorReport {
  id: string
  key: string
  region: string
  message: string
  stack: string
  reactStack: string
  context: Readonly<Record<string, string | number | boolean | null>>
  url: string
  firstSeenAt: string
  lastSeenAt: string
  count: number
}

type Listener = () => void
type ContextProvider = () => DiagnosticContext

let reports: readonly ErrorReport[] = []
let nextId = 1
const listeners = new Set<Listener>()
const contextProviders = new Set<ContextProvider>()

function notify(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // A diagnostics subscriber must not escape an active error boundary.
    }
  }
}

function normalizeError(error: unknown): { message: string; stack: string } {
  if (error instanceof Error) {
    return {
      message: error.message || error.name || 'Unknown render error',
      stack: error.stack ?? `${error.name}: ${error.message}`,
    }
  }
  return { message: String(error), stack: String(error) }
}

function firstStackFrame(stack: string): string {
  const lines = stack
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return lines.find((line) => line.startsWith('at '))
    ?? lines[1]
    ?? ''
}

function collectContext(local?: DiagnosticContext): ErrorReport['context'] {
  const collected: Record<string, string | number | boolean | null> = {}
  for (const provider of contextProviders) {
    try {
      Object.assign(collected, provider())
    } catch {
      // Diagnostics must never become a second failure source.
    }
  }
  Object.assign(collected, local)
  return Object.fromEntries(
    Object.entries(collected).filter(
      (entry): entry is [string, string | number | boolean | null] => entry[1] !== undefined,
    ),
  )
}

function currentUrl(): string {
  return typeof window === 'undefined' ? '' : window.location.href
}

export function reportRenderError(input: RenderErrorInput): ErrorReport {
  const normalized = normalizeError(input.error)
  const reactStack = input.reactStack?.trim() ?? ''
  const frame = firstStackFrame(reactStack) || firstStackFrame(normalized.stack)
  const key = `${input.region}\u0000${normalized.message}\u0000${frame}`
  const timestamp = new Date().toISOString()
  const existing = reports.find((report) => report.key === key)
  if (existing) {
    const updated: ErrorReport = {
      ...existing,
      context: { ...existing.context, ...collectContext(input.context) },
      lastSeenAt: timestamp,
      count: existing.count + 1,
    }
    reports = reports.map((report) => (report.id === existing.id ? updated : report))
    notify()
    return updated
  }

  const report: ErrorReport = {
    id: `render-error-${nextId++}`,
    key,
    region: input.region,
    message: normalized.message,
    stack: normalized.stack,
    reactStack,
    context: collectContext(input.context),
    url: currentUrl(),
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    count: 1,
  }
  reports = [...reports, report]
  notify()
  return report
}

export function subscribeErrorReports(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getErrorReports(): readonly ErrorReport[] {
  return reports
}

export function dismissErrorReport(id: string): void {
  const next = reports.filter((report) => report.id !== id)
  if (next.length === reports.length) return
  reports = next
  notify()
}

export function clearErrorReports(): void {
  if (reports.length === 0) return
  reports = []
  notify()
}

export function registerDiagnosticContext(provider: ContextProvider): () => void {
  contextProviders.add(provider)
  return () => contextProviders.delete(provider)
}

export function formatErrorReportForAi(report: ErrorReport): string {
  const context = Object.entries(report.context)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join('\n')
  return [
    'Please repair this React render failure in @forgeax-extension/wb-game-video.',
    '',
    `Extension version: ${packageJson.version}`,
    `Region: ${report.region}`,
    `Message: ${report.message}`,
    `Occurrences: ${report.count}`,
    `First seen: ${report.firstSeenAt}`,
    `Last seen: ${report.lastSeenAt}`,
    report.url ? `URL: ${report.url}` : '',
    context ? `\nSafe editor context:\n${context}` : '',
    `\nJS stack:\n${report.stack || '(none)'}`,
    `\nReact component stack:\n${report.reactStack || '(none)'}`,
  ]
    .filter(Boolean)
    .join('\n')
}
