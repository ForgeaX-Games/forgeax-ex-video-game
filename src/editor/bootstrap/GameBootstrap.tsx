import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ExtensionClientError } from '@forgeax/extension-host/extension'
import { useT } from '../../i18n'
import { getExtensionHost } from '../../lib/extension-host'
import { statusOf } from './packageStatus'

type PackageError = { code?: string; target?: string; hint?: string; retryable?: boolean }

export interface GameBootstrapProps {
  gameId?: string
  onBoot: (gameId: string) => void | Promise<void>
  /**
   * When true, an `uninitialized` package keeps the workflow shell mounted
   * instead of showing the template guide. The workflow creates the package
   * files when its first blueprint artifact is ready.
   */
  autoInitialize?: boolean
  children: ReactNode
}

type BootstrapState =
  | { kind: 'loading' }
  | { kind: 'deferred' }
  | { kind: 'guide' }
  | { kind: 'dismissed' }
  | { kind: 'ready' }
  | { kind: 'inconsistent'; missing: string[] }
  | { kind: 'error'; error: PackageError; retry: 'status' | 'initialize' }

const PACKAGE_INCONSISTENT_RETRY_MAX = 8
const PACKAGE_INCONSISTENT_RETRY_DELAY_MS = 250
const PACKAGE_STATUS_INCONSISTENT_RETRY_MAX = 3
const PACKAGE_STATUS_INCONSISTENT_RETRY_DELAY_MS = 100

function isTransientPackageInconsistent(cause: unknown): boolean {
  if (cause instanceof ExtensionClientError) return cause.code === 'package_inconsistent'
  if (!cause || typeof cause !== 'object') return false
  return (cause as { code?: unknown }).code === 'package_inconsistent'
}

function packageError(cause: unknown, target: string): PackageError {
  if (isExtensionBoundaryError(cause)) {
    return {
      code: 'host_required',
      target: 'extension host',
      retryable: false,
    }
  }
  if (cause instanceof ExtensionClientError) {
    return {
      code: cause.code,
      target: cause.target,
      hint: cause.message,
      retryable: cause.retryable,
    }
  }
  return {
    target,
    hint: cause instanceof Error ? cause.message : String(cause),
    retryable: true,
  }
}

function isExtensionBoundaryError(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false
  return /hostOrigin is required|document\.referrer is unavailable|Extension handshake/i.test(cause.message)
}

export function GameBootstrap({ gameId, onBoot, autoInitialize = false, children }: GameBootstrapProps): JSX.Element | null {
  const t = useT()
  // Workflow-owned mounts have a usable shell before the package exists.
  // Starting in `loading` would briefly replace that shell with the status
  // probe copy on every mount/retry while the workflow is still collecting
  // requirements.
  const [state, setState] = useState<BootstrapState>(() => (
    autoInitialize ? { kind: 'deferred' } : { kind: 'loading' }
  ))
  const onBootRef = useRef(onBoot)
  const mountedRef = useRef(true)
  const statusRunRef = useRef(0)
  const inconsistentStatusRetryRef = useRef(0)
  const readinessTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>()

  useEffect(() => {
    onBootRef.current = onBoot
  }, [onBoot])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (readinessTimerRef.current !== undefined) clearTimeout(readinessTimerRef.current)
    }
  }, [])

  const bootExisting = useCallback(async (
    gameId: string,
    isCurrent: () => boolean = () => mountedRef.current,
    retry = 0,
  ) => {
    try {
      await onBootRef.current(gameId)
      if (isCurrent()) setState({ kind: 'ready' })
    } catch (cause) {
      // GamePackageService writes the three portable files sequentially under a
      // journal. A concurrent first read can observe that brief partial state;
      // retry it before presenting a permanent corruption error.
      if (isTransientPackageInconsistent(cause) && retry < PACKAGE_INCONSISTENT_RETRY_MAX) {
        await new Promise<void>((resolve) => setTimeout(resolve, PACKAGE_INCONSISTENT_RETRY_DELAY_MS))
        if (isCurrent()) return bootExisting(gameId, isCurrent, retry + 1)
      }
      throw cause
    }
  }, [])

  const initialize = useCallback(async () => {
    if (!mountedRef.current) return
    setState({ kind: 'loading' })
    try {
      const host = getExtensionHost()
      const context = await host.ready()
      const status = statusOf(await host.gamePackage.initialize())
      if (!mountedRef.current) return
      if (status?.state === 'initialized') await bootExisting(gameId ?? context.gameId)
      else if (status?.state === 'inconsistent') setState({ kind: 'inconsistent', missing: status.missing ?? [] })
      else setState({ kind: 'error', retry: 'initialize', error: { target: 'package', hint: 'Invalid package status', retryable: true } })
    } catch (cause) {
      if (!mountedRef.current) return
      setState({ kind: 'error', retry: 'initialize', error: packageError(cause, 'package') })
    }
  }, [bootExisting, gameId])

  const readStatus = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!mountedRef.current) return
    if (readinessTimerRef.current !== undefined) {
      clearTimeout(readinessTimerRef.current)
      readinessTimerRef.current = undefined
    }
    const statusRun = ++statusRunRef.current
    const isCurrentRun = () => mountedRef.current && statusRunRef.current === statusRun
    // A deferred poll runs while the workflow keeps writing: swapping the
    // shell for the checking screen every 1.5s would flicker the whole pane.
    if (!background && !autoInitialize) setState({ kind: 'loading' })
    let errorTarget = 'package status'
    try {
      const host = getExtensionHost()
      const context = await host.ready()
      if (!isCurrentRun()) return
      const status = statusOf(await host.gamePackage.status())
      if (!isCurrentRun()) return
      if (status?.state === 'initialized') {
        inconsistentStatusRetryRef.current = 0
        errorTarget = 'package'
        await bootExisting(gameId ?? context.gameId, isCurrentRun)
      }
      else if (status?.state === 'partial') {
        inconsistentStatusRetryRef.current = 0
        if (!status.missing?.includes('blueprint.json')) {
          await bootExisting(gameId ?? context.gameId, isCurrentRun)
        } else if (autoInitialize) {
          // The workflow owns the early project state. A missing blueprint is
          // expected before outline generation, so leave the shell mounted and
          // wait for the workflow writer to publish the first blueprint.
          setState({ kind: 'deferred' })
          readinessTimerRef.current = setTimeout(() => {
            readinessTimerRef.current = undefined
            if (isCurrentRun()) void readStatus({ background: true })
          }, 1500)
        } else setState({ kind: 'guide' })
      }
      else if (status?.state === 'inconsistent') {
        if (inconsistentStatusRetryRef.current < PACKAGE_STATUS_INCONSISTENT_RETRY_MAX) {
          inconsistentStatusRetryRef.current += 1
          await new Promise<void>((resolve) => setTimeout(resolve, PACKAGE_STATUS_INCONSISTENT_RETRY_DELAY_MS))
          if (isCurrentRun()) void readStatus({ background })
          return
        }
        setState({ kind: 'inconsistent', missing: status.missing ?? [] })
      }
      else if (status?.state === 'uninitialized') {
        inconsistentStatusRetryRef.current = 0
        if (autoInitialize) {
          // A new video game starts with workflow state, not a complete game
          // package. Let the workflow projection render its empty/phase view.
          setState({ kind: 'deferred' })
          readinessTimerRef.current = setTimeout(() => {
            readinessTimerRef.current = undefined
            if (isCurrentRun()) void readStatus({ background: true })
          }, 1500)
        } else setState({ kind: 'guide' })
      }
      else setState({ kind: 'error', retry: 'status', error: { target: 'package status', hint: 'Invalid package status', retryable: true } })
    } catch (cause) {
      if (!isCurrentRun()) return
      setState({ kind: 'error', retry: 'status', error: packageError(cause, errorTarget) })
    }
  }, [autoInitialize, bootExisting, gameId, initialize])

  useEffect(() => { void readStatus() }, [readStatus])

  if (state.kind === 'ready') return <>{children}</>
  if (state.kind === 'loading') return <section className="ga-bootstrap" aria-live="polite"><p>{t('bootstrap.checking')}</p></section>
  if (state.kind === 'deferred') return <>{children}</>
  if (state.kind === 'dismissed') return null
  if (state.kind === 'inconsistent') {
    return <section className="ga-bootstrap" role="alert"><h1>{t('bootstrap.inconsistent.title')}</h1><p>{t('bootstrap.inconsistent.missing')} {state.missing.join(', ') || t('bootstrap.inconsistent.requiredFiles')}</p><p>{t('bootstrap.inconsistent.fix')}</p></section>
  }
  if (state.kind === 'error') {
    const { error } = state
    if (error.code === 'host_required') {
      return <section className="ga-bootstrap" role="alert">
        <h1>{t('bootstrap.host.title')}</h1>
        <p>{t('bootstrap.host.description')}</p>
      </section>
    }
    return <section className="ga-bootstrap" role="alert"><h1>{t('bootstrap.failed.title')}</h1><p>{t('bootstrap.failed.target')} {error.target ?? t('bootstrap.failed.workspace')}</p><p>{error.hint ?? t('bootstrap.failed.noDetails')}</p>{error.retryable !== false && <button type="button" onClick={() => void (state.retry === 'status' ? readStatus() : initialize())}>{t('bootstrap.retry')}</button>}</section>
  }
  return <section className="ga-bootstrap" aria-labelledby="ga-bootstrap-title">
    <h1 id="ga-bootstrap-title">{t('bootstrap.guide.title')}</h1>
    <p>{t('bootstrap.guide.description')}</p>
    <div className="ga-bootstrap-actions">
      <button type="button" onClick={() => void initialize()}>{t('bootstrap.guide.yes')}</button>
      <button type="button" onClick={() => setState({ kind: 'dismissed' })}>{t('bootstrap.guide.no')}</button>
    </div>
  </section>
}
