import { t as translateUi } from '@/i18n'
import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ExtensionFrame } from '@forgeax/extension-host/react'
import type { ExtensionSessionContext } from '@forgeax/extension-host/contracts'
import {
  createDevSessionContext,
  DEFAULT_DEV_GAME_ID,
  DEV_EXTENSION_BASE,
  normalizeDevGameId,
  selectDevRuntime,
} from './dev-host-session'
import './dev-host-shell.css'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; context: ExtensionSessionContext }
  | { kind: 'error'; message: string }

function initialGameId(): string {
  try {
    return normalizeDevGameId(new URLSearchParams(location.search).get('gameId') ?? DEFAULT_DEV_GAME_ID)
  } catch {
    return DEFAULT_DEV_GAME_ID
  }
}

function preferredTheme(): 'light' | 'dark' {
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

async function loadContext(gameId: string, signal: AbortSignal): Promise<ExtensionSessionContext> {
  const response = await fetch(`${DEV_EXTENSION_BASE}/catalog?gameId=${encodeURIComponent(gameId)}`, { signal })
  if (!response.ok) throw new Error(`Development host catalog failed (${response.status})`)
  const entry = selectDevRuntime(await response.json())
  return createDevSessionContext(entry, gameId, {
    locale: navigator.language,
    theme: preferredTheme(),
  })
}

function DevHostShell(): JSX.Element {
  const [draftGameId, setDraftGameId] = useState(initialGameId)
  const [gameId, setGameId] = useState(initialGameId)
  const [frameEpoch, setFrameEpoch] = useState(0)
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const runtimeUrl = useMemo(() => '/?devRuntime=1', [])

  useEffect(() => {
    const controller = new AbortController()
    setState({ kind: 'loading' })
    void loadContext(gameId, controller.signal).then(
      (context) => setState({ kind: 'ready', context }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
        }
      },
    )
    return () => controller.abort()
  }, [gameId, frameEpoch])

  const openGame = () => {
    try {
      const nextGameId = normalizeDevGameId(draftGameId)
      const url = new URL(location.href)
      url.searchParams.set('gameId', nextGameId)
      history.replaceState(null, '', url)
      setDraftGameId(nextGameId)
      if (nextGameId === gameId) setFrameEpoch((value) => value + 1)
      else setGameId(nextGameId)
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <main className="dev-host-shell">
      <header className="dev-host-toolbar">
        <strong className="dev-host-brand">{translateUi('ui.copy.88fb3f018f00')}</strong>
        <span className="dev-host-separator" aria-hidden="true" />
        <div className="dev-host-game-form">
          <label htmlFor="dev-host-game-id">{translateUi('ui.copy.e3e82846c325')}</label>
          <input
            id="dev-host-game-id"
            value={draftGameId}
            onChange={(event) => setDraftGameId(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                openGame()
              }
            }}
          />
          <button type="button" onClick={openGame}>{translateUi('ui.copy.cf9b77061f7b')}</button>
        </div>
        <span className="dev-host-mode">{translateUi('ui.copy.6addcbd123d7')}</span>
      </header>
      <section className="dev-host-runtime" aria-live="polite">
        {state.kind === 'loading' && <p className="dev-host-status">{translateUi('ui.copy.b04ba49f8486')}</p>}
        {state.kind === 'error' && <p className="dev-host-status is-error" role="alert">{state.message}</p>}
        {state.kind === 'ready' && (
          <ExtensionFrame
            key={`${state.context.runtimeId}:${state.context.gameId}:${frameEpoch}`}
            className="dev-host-frame"
            title={`${translateUi('ui.template.a2ca569d75f1')}${state.context.gameId}`}
            runtimeUrl={runtimeUrl}
            context={state.context}
            sandbox="allow-scripts allow-same-origin allow-modals allow-downloads"
            allow="autoplay; clipboard-read; clipboard-write; fullscreen"
          />
        )}
      </section>
    </main>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root mount point')
createRoot(root).render(<DevHostShell />)
