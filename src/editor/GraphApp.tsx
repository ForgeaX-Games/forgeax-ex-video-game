import { t as translateUi, useLocale } from '../i18n'
/**
 * GraphApp —— 新引擎的唯一应用外壳（graph-only）。NewSidebar 的每个 tab
 * 都对应 GraphMain 的真实视图：蓝图/视频/资产/界面/规则/试玩。
 *
 * Page layout 把 sidebar/workspace 两个 Panel 放成左右布局，宿主给两个 iframe
 * 分别传 `?pane=left` / `?pane=center`。两个 iframe 通过 graphViewStore /
 * graphUiTreeSync / graphBlueprintSync 同步 tab、界面树与蓝图库意图。
 * 无 pane 时仍按侧栏 + 主区独立运行。
 *
 * 进程内挂载（mount()）可经 props 显式传入 pane / gameId，避免改宿主 URL。
 */
import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { GraphStudio } from './shell/GraphStudio'
import { VideoGenerationPage } from './shell/VideoGenerationPage'
import { ImageGenerationPage } from './shell/ImageGenerationPage'
import { GraphAssetView } from './shell/GraphAssetView'
import { GraphCharacterView } from './shell/GraphCharacterView'
import { GraphSceneView } from './shell/GraphSceneView'
import { GraphConfigView } from './shell/GraphConfigView'
import { GraphPlaySurface } from './shell/GraphPlaySurface'
import { NewSidebar } from './shell/NewSidebar'
import { DocumentLibraryView } from './documents/DocumentLibraryView'
import { useGraphScenario } from './persist/graphScenarioStore'
import { useGraphView, installGraphViewSync } from './persist/graphViewStore'
import { installGraphUiTreeSync } from './persist/graphUiTreeSync'
import { installGraphBlueprintSync } from './persist/graphBlueprintSync'
import { installCatalogNavSync } from './persist/catalogNavStore'
import { installDocumentNavSync } from './persist/documentNavStore'
import { installRuleSelectionSync } from './persist/ruleSelectionStore'
import {
  hasSelectableProductionContent,
  useProductionProjection,
} from './persist/productionProjectionStore'
import { setSyncGameId } from './persist/gameScope'
import { injectStyleOnce } from './styles/injectStyle'
import { GameBootstrap } from './bootstrap/GameBootstrap'
import { useGlobalVideoGenerationTracker } from './assets/generation/videoGenerationStore'
import { useVideoGenerationPanel } from './persist/videoGenerationPanelStore'
import { getInspectorMountOptions } from './host-init'
import { installKinoVideoCacheSync } from './assets/kinoVideoCacheStore'
import { installTipSyncPolling } from './persist/tipSyncPolling'
import { getExtensionHost } from '../lib/extension-host'
import { statusOf } from './bootstrap/packageStatus'
import {
  refreshGameComponents,
  subscribeGameComponents,
} from '@/runtime/react/component-host'
import { RenderErrorBoundary } from './diagnostics'

/** Poll cadence for the standalone fallback (no sibling pane to seed the package). */
const LEFT_PANE_STATUS_POLL_MS = 1500
const LEFT_PANE_STATUS_POLL_MAX = 20

export type GraphAppPane = 'left' | 'center' | null

export type GraphAppProps = {
  /** Host-supplied pane for in-process mounts; URL query wins only when omitted. */
  pane?: GraphAppPane
  /** Host-supplied game id (slug) for in-process mounts. */
  gameId?: string
  /** When true, an uninitialized package is seeded silently (skips the guide). */
  autoInitialize?: boolean
}

function readPane(): GraphAppPane {
  try {
    const pane = new URLSearchParams(location.search).get('pane')
    return pane === 'left' || pane === 'center' ? pane : null
  } catch {
    return null
  }
}

/** 主区——当前 tab 对应的内容。center pane 的全部内容。 */
function GraphMain(): JSX.Element {
  const view = useGraphView((state) => state.view)
  const setView = useGraphView((state) => state.setView)
  const projection = useProductionProjection((state) => state.projection)
  const scenarioFromStore = useGraphScenario((s) => s.scn)
  const loadEpoch = useGraphScenario((s) => s.loadEpoch)
  const game = useGraphScenario((s) => s.game)
  useGlobalVideoGenerationTracker(game)
  // The host package is the only runtime source. The bundled demo remains
  // available for explicit reset/template flows, never as a live project.
  const scenario = useMemo(
    () => scenarioFromStore(),
    [loadEpoch, scenarioFromStore],
  )
  if (!hasSelectableProductionContent(projection)) {
    return <main className="ga-main" data-production-empty="true" />
  }
  return (
    <main className="ga-main">
      <RenderErrorBoundary region="active-view" variant="panel" resetKeys={[view]}>
        {view === 'documents' && <DocumentLibraryView />}
        {view === 'graph' && <GraphStudio scenario={scenario} />}
        {view === 'video-generate' && <VideoGenerationPage onBack={() => setView('assets')} />}
        {view === 'image-generate' && <ImageGenerationPage onBack={setView} />}
        {view === 'assets' && <GraphAssetView />}
        {view === 'characters' && <GraphCharacterView />}
        {view === 'scenes' && <GraphSceneView />}
        {view === 'ui' && <GraphConfigView title={translateUi('ui.copy.3c4065adbc5f')} icon="🖥" tabs={[{ section: 'overlays', label: translateUi('ui.object.abea4487d700') }]} scenario={scenario} />}
        {view === 'rule' && (
          <GraphConfigView
            title={translateUi('ui.copy.ed904c685ab0')}
            icon="📏"
            tabs={[
              { section: 'entities', label: translateUi('ui.object.eb4308300e83') },
              { section: 'variables', label: translateUi('ui.object.a772fa4ebe36') },
              { section: 'formulas', label: translateUi('ui.object.f3fccedacbce') },
            ]}
            scenario={scenario}
          />
        )}
        {view === 'play' && <GraphPlaySurface scenario={scenario} />}
      </RenderErrorBoundary>
    </main>
  )
}

/** In the host, generation shares the node preview column instead of routing the main pane. */
function VideoGenerationPreviewPortal(): JSX.Element | null {
  const { videoGenerationEl, onVideoGenerationTabChange } = getInspectorMountOptions()
  const open = useVideoGenerationPanel((state) => state.open)
  const returnView = useVideoGenerationPanel((state) => state.returnView)
  const nodeTarget = useVideoGenerationPanel((state) => state.nodeTarget)
  const activationRevision = useVideoGenerationPanel((state) => state.activationRevision)
  const close = useVideoGenerationPanel((state) => state.close)
  const setView = useGraphView((state) => state.setView)
  const selectedNodeId = useGraphScenario((state) => state.selectedNodeId)
  const label = translateUi('videoAssets.generate.nodeTab')

  useEffect(() => {
    if (!onVideoGenerationTabChange) return
    onVideoGenerationTabChange({
      label,
      selected: open,
      available: selectedNodeId !== null,
    })
  }, [activationRevision, label, nodeTarget?.blueprintId, nodeTarget?.nodeId, onVideoGenerationTabChange, open, selectedNodeId])

  useEffect(() => () => {
    onVideoGenerationTabChange?.({ label, selected: false, available: false })
  }, [label, onVideoGenerationTabChange])

  useEffect(() => {
    if (typeof window === 'undefined' || selectedNodeId === null) return
    const openGenerationTab = (): void => {
      useVideoGenerationPanel.getState().openForView(useGraphView.getState().view)
    }
    window.addEventListener('game-video:request-generation-tab', openGenerationTab)
    return () => window.removeEventListener('game-video:request-generation-tab', openGenerationTab)
  }, [selectedNodeId])

  if (!videoGenerationEl || !open) return null
  return createPortal(
    <RenderErrorBoundary region="video-generation-preview" variant="panel" resetKeys={[activationRevision]}>
      <VideoGenerationPage
        showBreadcrumb={false}
        nodeTarget={nodeTarget ?? undefined}
        onBack={() => {
          close()
          setView(returnView)
        }}
      />
    </RenderErrorBoundary>,
    videoGenerationEl,
  )
}

function CombinedWorkspace({
  gameId,
  ensureBoot,
  autoInitialize,
}: {
  gameId?: string
  ensureBoot: (gameId: string) => Promise<void>
  autoInitialize?: boolean
}): JSX.Element {
  return (
    <div className="ga-root">
      <RenderErrorBoundary region="sidebar" variant="panel">
        <NewSidebar />
      </RenderErrorBoundary>
      <GameBootstrap gameId={gameId} autoInitialize={autoInitialize} onBoot={(bootGameId) => ensureBoot(bootGameId)}>
        <GraphMain />
        <VideoGenerationPreviewPortal />
      </GameBootstrap>
    </div>
  )
}

function LeftPane({ gameId }: { gameId?: string }): JSX.Element {
  const ensureBoot = useGraphScenario((state) => state.ensureBoot)
  // The store is shared in-process across panes: once the center pane finishes
  // `initialize` + boot, `booted`/`game` flip here too, so this pane can ride
  // that boot instead of reading the package itself.
  const booted = useGraphScenario((state) => state.booted)
  const storeGame = useGraphScenario((state) => state.game)
  const [bootReady, setBootReady] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)
  const [resolvedGame, setResolvedGame] = useState<string | null>(gameId ?? null)
  const [retryToken, setRetryToken] = useState(0)

  const sharedReady = booted && resolvedGame !== null && storeGame === resolvedGame
  // Mirror the shared-boot signal for the async poll loop below, which cannot
  // read React state captured in a stale closure.
  const sharedReadyRef = useRef(sharedReady)
  sharedReadyRef.current = sharedReady

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const host = getExtensionHost()

    // Never read/write an uninitialized package: the host rejects `load`/`save`
    // with `package_uninitialized` until it is seeded, and that rejection is
    // the "工作台连接失败：Game package has not been initialized" banner. Boot
    // only once the package is `initialized` — either already, or after the
    // center pane (Arrival split) or a bounded poll (standalone) seeds it.
    const bootOnce = async (targetGameId: string): Promise<void> => {
      await ensureBoot(targetGameId)
      if (!disposed) setBootReady(true)
    }

    const pollUntilInitialized = (targetGameId: string, attempt: number): void => {
      if (disposed || sharedReadyRef.current) return
      if (attempt >= LEFT_PANE_STATUS_POLL_MAX) {
        setBootError('Game package has not been initialized')
        return
      }
      timer = setTimeout(() => {
        void (async () => {
          if (disposed || sharedReadyRef.current) return
          try {
            const status = statusOf(await host.gamePackage.status())
            if (disposed || sharedReadyRef.current) return
            if (status?.state === 'initialized') await bootOnce(targetGameId)
            else pollUntilInitialized(targetGameId, attempt + 1)
          } catch (cause) {
            if (!disposed) setBootError(cause instanceof Error ? cause.message : String(cause))
          }
        })()
      }, LEFT_PANE_STATUS_POLL_MS)
    }

    const connect = async (): Promise<void> => {
      try {
        // Split panes must derive their channel scope from the same host
        // handshake. Falling back to a URL/default game makes the left and
        // center panes join different BroadcastChannels.
        const targetGameId = gameId ?? (await host.ready()).gameId
        if (disposed) return
        setResolvedGame(targetGameId)
        // A sibling pane already booted this game — ride the shared store.
        if (booted && storeGame === targetGameId) return
        const status = statusOf(await host.gamePackage.status())
        if (disposed || sharedReadyRef.current) return
        if (status?.state === 'initialized') await bootOnce(targetGameId)
        else pollUntilInitialized(targetGameId, 0)
      } catch (cause) {
        if (!disposed) setBootError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    void connect()
    return () => {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [ensureBoot, gameId, retryToken])

  if (bootReady || sharedReady) {
    return (
      <div className="ga-root is-pane-left">
        <RenderErrorBoundary region="sidebar" variant="panel">
          <NewSidebar uiNavMode="left" />
        </RenderErrorBoundary>
      </div>
    )
  }
  if (bootError) {
    return (
      <section className="ga-bootstrap" role="alert">
        <p>{translateUi('ui.copy.109bfbb6719d')}{bootError}</p>
        <div className="ga-bootstrap-actions">
          <button type="button" onClick={() => { setBootError(null); setRetryToken((n) => n + 1) }}>{translateUi('bootstrap.retry')}</button>
        </div>
      </section>
    )
  }
  return <section className="ga-bootstrap" aria-live="polite"><p>{translateUi('ui.copy.a006bc8b9c03')}</p></section>
}

export function GraphApp({ pane: explicitPane, gameId, autoInitialize }: GraphAppProps = {}): JSX.Element {
  useLocale()
  injectStyleOnce('graph-app-shell', CSS)
  const [pane] = useState(() => (explicitPane === undefined ? readPane() : explicitPane))
  const ensureBoot = useGraphScenario((state) => state.ensureBoot)
  const booted = useGraphScenario((state) => state.booted)
  // 权威 game 来源：boot 后由 store 写入（center 来自宿主握手的 context.gameId，
  // left 来自 ensureBoot）。频道命名必须等它到位，否则同源多 tab 会共用空后缀串台。
  const activeGame = useGraphScenario((state) => state.game)
  const refreshComponentSchemes = useGraphScenario((state) => state.refreshComponentSchemes)

  useEffect(() => {
    if (!activeGame) return
    const unsubscribe = subscribeGameComponents((changedGame) => {
      if (changedGame === activeGame) refreshComponentSchemes()
    })
    const poll = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void refreshGameComponents(activeGame)
    }, 2_500)
    return () => {
      window.clearInterval(poll)
      unsubscribe()
    }
  }, [activeGame, refreshComponentSchemes])

  useEffect(() => {
    if (pane === null || !activeGame) return
    // 用真实 game 作为跨 tab 同步频道的作用域，再安装，保证不同 game 的 tab 互不收听。
    setSyncGameId(activeGame)
    const disposeView = installGraphViewSync()
    const disposeUiTree = installGraphUiTreeSync()
    const disposeBp = installGraphBlueprintSync()
    const disposeCatalogNav = installCatalogNavSync()
    const disposeDocumentNav = installDocumentNavSync()
    const disposeRuleSelection = installRuleSelectionSync()
    return () => {
      disposeRuleSelection()
      disposeDocumentNav()
      disposeCatalogNav()
      disposeBp()
      disposeUiTree()
      disposeView()
    }
  }, [pane, activeGame])

  useEffect(() => installKinoVideoCacheSync(), [])

  useEffect(() => {
    if (!booted) return
    return installTipSyncPolling()
  }, [booted])

  if (pane === 'left') {
    return <LeftPane gameId={gameId} />
  }
  if (pane === 'center') {
    return (
      <div className="ga-root is-pane-center">
        <GameBootstrap gameId={gameId} autoInitialize={autoInitialize} onBoot={(bootGameId) => ensureBoot(bootGameId)}>
          <GraphMain />
          <VideoGenerationPreviewPortal />
        </GameBootstrap>
      </div>
    )
  }
  return <CombinedWorkspace gameId={gameId} ensureBoot={ensureBoot} autoInitialize={autoInitialize} />
}

const CSS = `
.ga-root { position: fixed; inset: 0; display: flex; background: var(--color-background-base, #0e0c09); color: var(--color-text-primary, #f6f1e9); }
/* pane 嵌入态 / 宿主进程内挂载：填满宿主容器，不用 fixed 视口 */
.ga-root.is-pane-left, .ga-root.is-pane-center { position: absolute; inset: 0; }
.ks-app-host .ga-root { position: absolute; inset: 0; }
.ga-root.is-pane-left .ns-sidebar { width: 100%; min-width: 0; }
.ga-root.is-pane-center:has(.ga-main[data-production-empty]) { background:transparent; color:inherit; }

.ga-main { flex: 1; min-width: 0; min-height: 0; position: relative; display: flex; flex-direction: column; overflow: hidden; }
.ga-bootstrap { flex: 1; display: grid; place-content: center; gap: 12px; padding: 32px; color: var(--color-text-primary, #f6f1e9); text-align: center; }
.ga-bootstrap h1, .ga-bootstrap p { margin: 0; }
.ga-bootstrap-actions { display: flex; justify-content: center; gap: 12px; margin-top: 8px; }
.ga-bootstrap button { padding: 8px 16px; border: 1px solid var(--color-border-default, #2e2924); border-radius: 6px; background: var(--color-background-elevated, #161310); color: inherit; cursor: pointer; }
.ga-bootstrap button:first-child { background: var(--color-brand-primary, #f08840); color: #17120d; border-color: transparent; }
`
