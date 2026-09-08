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
   * When true, an `uninitialized` package is initialized silently instead of
   * showing the "从模板新建" guide. Hosts opt in per mount (e.g. Arrival's
   * in-process video-game surface); the default keeps the manual confirmation.
   */
  autoInitialize?: boolean
  children: ReactNode
}

type BootstrapState =
  | { kind: 'loading' }
  | { kind: 'guide' }
  | { kind: 'dismissed' }
  | { kind: 'ready' }
  | { kind: 'inconsistent'; missing: string[] }
  | { kind: 'error'; error: PackageError; retry: 'status' | 'initialize' }

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
  const [state, setState] = useState<BootstrapState>({ kind: 'loading' })
  const onBootRef = useRef(onBoot)
  const mountedRef = useRef(true)
  const statusRunRef = useRef(0)

  useEffect(() => {
    onBootRef.current = onBoot
  }, [onBoot])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const bootExisting = useCallback(async (
    gameId: string,
    isCurrent: () => boolean = () => mountedRef.current,
  ) => {
    await onBootRef.current(gameId)
    if (isCurrent()) setState({ kind: 'ready' })
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

  const readStatus = useCallback(async () => {
    if (!mountedRef.current) return
    const statusRun = ++statusRunRef.current
    const isCurrentRun = () => mountedRef.current && statusRunRef.current === statusRun
    setState({ kind: 'loading' })
    let errorTarget = 'package status'
    try {
      const host = getExtensionHost()
      const context = await host.ready()
      if (!isCurrentRun()) return
      const status = statusOf(await host.gamePackage.status())
      if (!isCurrentRun()) return
      if (status?.state === 'initialized') {
        errorTarget = 'package'
        await bootExisting(gameId ?? context.gameId, isCurrentRun)
      }
      else if (status?.state === 'inconsistent') setState({ kind: 'inconsistent', missing: status.missing ?? [] })
      else if (status?.state === 'uninitialized') {
        if (autoInitialize) await initialize()
        else setState({ kind: 'guide' })
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
