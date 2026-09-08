import { t as translateUi } from '@/i18n'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { refreshGameComponentsFromUrl } from '@/runtime/react/component-host'
import { GamePlayer } from '@/runtime/react/play'
import { createAssetResolver } from './assets'
import { createStandaloneRuntimeHost } from './host'
import { GamePackageError } from './package'
import type { RuntimeSdkHost, RuntimeSdkSession } from './runtime-host'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; session: RuntimeSdkSession }
  | { status: 'error'; message: string }

function errorMessage(error: unknown): string {
  if (error instanceof GamePackageError) return error.message
  if (error instanceof Error) return error.message
  return 'Unable to start game'
}

export function RuntimeGameApp({ host }: { host?: RuntimeSdkHost }): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  // Sound-on playback needs a user gesture; without it video.play() rejects with NotAllowedError.
  const [started, setStarted] = useState(false)
  // Remount key: a fresh GamePlayer instance rebuilds the GraphSession, so a restart
  // resets nodes, HUD, overlays, BGM and the session seed in one move.
  const [runId, setRunId] = useState(0)
  const [ended, setEnded] = useState(false)
  const runtimeHost = useMemo(() => host ?? createStandaloneRuntimeHost(), [host])

  const restart = useCallback(() => {
    setEnded(false)
    setRunId((id) => id + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const session = await runtimeHost.ready(controller.signal)
        await refreshGameComponentsFromUrl(session.gameId, session.componentModuleUrl)
        if (!controller.signal.aborted) setState({ status: 'ready', session })
      } catch (error) {
        if (!controller.signal.aborted) setState({ status: 'error', message: errorMessage(error) })
      }
    })()
    return () => {
      controller.abort()
      runtimeHost.close?.()
    }
  }, [runtimeHost])

  const resolveAsset = useMemo(
    () => state.status === 'ready'
      ? createAssetResolver(state.session.gamePackage.assetsManifest)
      : undefined,
    [state],
  )

  if (state.status === 'loading') {
    return <main className="sdk-status" aria-live="polite">{translateUi('ui.copy.0a6bbb82359a')}</main>
  }
  if (state.status === 'error') {
    return <main className="sdk-status sdk-status--error" role="alert">{state.message}</main>
  }

  return (
    <main className="sdk-player">
      <GamePlayer
        key={runId}
        scenario={state.session.gamePackage.blueprint}
        game={state.session.gameId}
        resolveAsset={resolveAsset!}
        onEnded={() => setEnded(true)}
        paused={!started}
      />
      {!started ? (
        <div className="sdk-scrim">
          <button type="button" className="sdk-start-button" onClick={() => setStarted(true)}>
            <span className="sdk-start-icon" aria-hidden="true" />
            {translateUi('player.start')}
          </button>
        </div>
      ) : null}
      {ended ? (
        <div className="sdk-scrim">
          <div className="sdk-end-panel">
            <p className="sdk-end-title">{translateUi('player.ended')}</p>
            <button type="button" className="sdk-restart-button" onClick={restart}>
              {translateUi('player.restart')}
            </button>
          </div>
        </div>
      ) : null}
    </main>
  )
}
