import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { GraphApp } from '../GraphApp'
import { installTipSyncPolling } from '@/editor/persist/tipSyncPolling'
import { useProductionProjection } from '@/editor/persist/productionProjectionStore'
import { setLocale } from '@/i18n'
import type { ProductionProjection } from '@/workflow/contracts'

const { ensureBoot, bootstrapProps, ready, status, graphView, graphSetView, graphStudioFailure, injectedStyles } = vi.hoisted(() => ({
  ensureBoot: vi.fn(),
  bootstrapProps: vi.fn(),
  ready: vi.fn(async () => ({ gameId: 'handshake-game' })),
  status: vi.fn(),
  graphView: { value: 'graph' },
  graphSetView: vi.fn(),
  graphStudioFailure: { error: null as Error | null },
  injectedStyles: new Map<string, string>(),
}))

const mockScenarioState = vi.hoisted(() => {
  const blueprints = {
    'bp-main': { id: 'bp-main', title: '主蓝图' },
    'bp-sub': { id: 'bp-sub', title: '子蓝图' },
  }
  return {
    graph: { nodes: [] as never[] },
    game: 'demo-game',
    ensureBoot,
    blueprints,
    mainBlueprintId: 'bp-main',
    activeBlueprintId: 'bp-main',
    selectBlueprint: vi.fn(),
    createBlueprint: () => ({ ok: true as const, id: 'bp-new' }),
    renameBlueprint: () => ({ ok: true as const }),
    deleteBlueprint: () => ({ ok: true as const }),
    setMainBlueprint: vi.fn(),
    authoringProject: () => ({ manifest: { packs: {} } }),
    meta: { ui: { overlays: {} }, uiTree: { root: [] } },
    scn: () => ({ graph: { nodes: [] as never[] } }),
    loadEpoch: 0,
    booted: true,
    syncTipIfClean: vi.fn(async () => 'unchanged' as const),
  }
})

function briefProjection(): ProductionProjection {
  return {
    schemaVersion: 1,
    gameId: 'demo-game',
    workflowRevision: 2,
    phase: 'requirements-collection',
    phaseRevision: 1,
    phaseStatus: 'working',
    activity: 'brief.collecting',
    activityRevision: 1,
    activityStatus: 'working',
    activeActivities: ['brief.collecting'],
    group: { id: 'brief', status: 'working', revision: 1 },
    phases: {
      'requirements-collection': { revision: 1, status: 'working' },
      'planning-design': { revision: 0, status: 'not-started' },
      'feature-development': { revision: 0, status: 'not-started' },
      'asset-generation': { revision: 0, status: 'not-started' },
    },
    modules: {
      documents: { availability: 'working' },
      'document.core': { availability: 'hidden' },
      'document.pillar': { availability: 'hidden' },
      blueprint: { availability: 'hidden' },
      rules: { availability: 'hidden' },
      ui: { availability: 'hidden' },
      assets: { availability: 'hidden' },
    },
    gates: {},
    artifacts: [],
  }
}

vi.mock('@/editor/bootstrap/GameBootstrap', () => ({
  GameBootstrap: ({ children, onBoot, gameId }: { children: ReactNode; onBoot?: (gameId: string) => void; gameId?: string }) => {
    bootstrapProps({ gameId })
    onBoot?.('猫')
    return <div data-testid="bootstrap">{children}</div>
  },
}))
vi.mock('@/lib/extension-host', () => ({
  getExtensionHost: () => ({ ready, gamePackage: { status } }),
}))
vi.mock('@/editor/assets/generation/videoGenerationStore', () => ({
  useGlobalVideoGenerationTracker: vi.fn(),
}))
vi.mock('@/editor/shell/GraphStudio', () => ({
  GraphStudio: () => {
    if (graphStudioFailure.error) throw graphStudioFailure.error
    return <div>blueprint</div>
  },
}))
vi.mock('@/editor/shell/VideoGenerationPage', () => ({
  VideoGenerationPage: ({ onBack }: { onBack: () => void }) => <button type="button" onClick={onBack}>video-generation</button>,
}))
vi.mock('@/editor/shell/ImageGenerationPage', () => ({ ImageGenerationPage: () => <div>image-generation</div> }))
vi.mock('@/editor/shell/GraphAssetView', () => ({ GraphAssetView: () => <div>assets</div> }))
vi.mock('@/editor/shell/GraphConfigView', () => ({ GraphConfigView: () => <div>config</div> }))
vi.mock('@/editor/shell/GraphPlaySurface', () => ({ GraphPlaySurface: () => <div>play</div> }))
vi.mock('@/editor/persist/graphScenarioStore', () => ({
  useGraphScenario: (selector: (state: typeof mockScenarioState) => unknown) => selector(mockScenarioState),
}))
vi.mock('@/editor/persist/graphViewStore', () => ({
  useGraphView: (selector: (state: { view: string; setView: () => void }) => unknown) => selector({ view: graphView.value, setView: graphSetView }),
  installGraphViewSync: () => vi.fn(),
}))
vi.mock('@/editor/persist/graphUiTreeSync', () => ({
  installGraphUiTreeSync: () => vi.fn(),
  broadcastUiTreeIntent: vi.fn(),
}))
vi.mock('@/editor/persist/uiSelectionStore', () => ({
  useUiSelection: (selector: (state: { selectedTreeNodeId: null; selectUiNode: () => void }) => unknown) =>
    selector({ selectedTreeNodeId: null, selectUiNode: vi.fn() }),
}))
vi.mock('@/editor/persist/graphBlueprintSync', () => ({
  installGraphBlueprintSync: () => vi.fn(),
}))
vi.mock('@/editor/persist/gameScope', () => ({
  getGameSlug: () => 'demo',
  gameKeySuffix: () => ':game:demo',
  setHostGameSlug: vi.fn(),
  setSyncGameId: vi.fn(),
}))
vi.mock('@/editor/styles/injectStyle', () => ({
  injectStyleOnce: vi.fn((id: string, css: string) => injectedStyles.set(id, css)),
}))
vi.mock('@/editor/persist/tipSyncPolling', () => ({
  installTipSyncPolling: vi.fn(() => () => {}),
}))

beforeEach(() => {
  status.mockReset()
  status.mockResolvedValue({ state: 'initialized' })
  setLocale('zh')
  graphView.value = 'graph'
  graphStudioFailure.error = null
  graphSetView.mockReset()
  useProductionProjection.setState({ projection: null, expanded: new Set(), followMode: true })
})

afterEach(() => {
  ensureBoot.mockClear()
  bootstrapProps.mockClear()
  ready.mockClear()
  vi.mocked(installTipSyncPolling).mockClear()
  window.history.replaceState({}, '', '/')
})

test('boots the left pane from the host handshake without GameBootstrap chrome and lists real blueprints', async () => {
  window.history.replaceState({}, '', '/?pane=left')
  render(<GraphApp />)
  expect(await screen.findByRole('complementary')).toBeTruthy()
  expect(screen.queryByTestId('bootstrap')).toBeNull()
  expect(ensureBoot).toHaveBeenCalledWith('handshake-game')
  fireEvent.click(screen.getByRole('button', { name: '展开 蓝图' }))
  expect(screen.getByText('主蓝图')).toBeTruthy()
  expect(screen.getByText('子蓝图')).toBeTruthy()
  expect(screen.getByRole('button', { name: '新增 蓝图 子项' })).toBeTruthy()
  expect(screen.getByText('文档')).toBeTruthy()
  expect(screen.getByText('资产库')).toBeTruthy()
  expect(injectedStyles.get('graph-app-shell')).toContain(
    '.ga-root.is-pane-left .ns-sidebar { width: 100%; min-width: 0; }',
  )
  // 行操作仅 hover 显示（display:none），用 hidden:true 校验直接图标按钮权限。
  expect(screen.getByRole('button', { name: '重命名 主蓝图', hidden: true })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '删除 主蓝图', hidden: true })).toBeNull()
  expect(screen.queryByRole('button', { name: '设为入口 主蓝图', hidden: true })).toBeNull()

  expect(screen.getByRole('button', { name: '重命名 子蓝图', hidden: true })).toBeTruthy()
  expect(screen.getByRole('button', { name: '删除 子蓝图', hidden: true })).toBeTruthy()
  expect(screen.getByRole('button', { name: '设为入口 子蓝图', hidden: true })).toBeTruthy()
})

test('left pane waits instead of erroring while the package is still uninitialized', async () => {
  window.history.replaceState({}, '', '/?pane=left')
  status.mockResolvedValue({ state: 'uninitialized' })
  render(<GraphApp />)
  await waitFor(() => expect(status).toHaveBeenCalled())
  expect(ensureBoot).not.toHaveBeenCalled()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByText('正在连接工作台…')).toBeTruthy()
})

test('left pane rides a sibling pane boot instead of touching the uninitialized package', async () => {
  status.mockResolvedValue({ state: 'uninitialized' })
  render(<GraphApp pane="left" gameId="demo-game" />)
  expect(await screen.findByRole('complementary')).toBeTruthy()
  expect(ensureBoot).not.toHaveBeenCalled()
  expect(screen.queryByRole('alert')).toBeNull()
})

test('wraps the center pane with bootstrap before rendering the main surface', () => {
  window.history.replaceState({}, '', '/?pane=center')
  render(<GraphApp />)
  expect(screen.getByTestId('bootstrap')).toBeTruthy()
  expect(screen.getByText('blueprint')).toBeTruthy()
  expect(installTipSyncPolling).toHaveBeenCalled()
})

test('isolates a failed active view while keeping the combined sidebar available', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  graphStudioFailure.error = new Error('graph view exploded')

  render(<GraphApp gameId="arrival-game" />)

  expect(screen.getByRole('complementary')).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('graph view exploded')
})

test('remounts the active view boundary after navigation', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  graphStudioFailure.error = new Error('graph view exploded')
  const view = render(<GraphApp pane="center" gameId="arrival-game" />)
  expect(screen.getByRole('alert')).toHaveTextContent('graph view exploded')

  graphStudioFailure.error = null
  graphView.value = 'assets'
  view.rerender(<GraphApp pane="center" gameId="arrival-game" />)

  expect(screen.getByText('assets')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).toBeNull()
})

test('renders an empty center workspace while brief.collecting has no selectable module', () => {
  useProductionProjection.setState({ projection: briefProjection() })

  const { container } = render(<GraphApp pane="center" gameId="arrival-game" />)

  expect(container.querySelector('main.ga-main')).toHaveAttribute('data-production-empty', 'true')
  expect(injectedStyles.get('graph-app-shell')).toContain(
    '.ga-root.is-pane-center:has(.ga-main[data-production-empty])',
  )
  expect(screen.queryByText('blueprint')).toBeNull()
})

test('passes the handshake game id to the single boot owner', () => {
  window.history.replaceState({}, '', '/?pane=center')
  ensureBoot.mockClear()
  render(<GraphApp />)
  expect(ensureBoot).toHaveBeenCalledWith('猫')
})

test('renders the image-generate GraphView route', () => {
  graphView.value = 'image-generate'

  render(<GraphApp pane="center" gameId="arrival-game" />)

  expect(screen.getByText('image-generation')).toBeTruthy()
  expect(screen.queryByText('video-generation')).toBeNull()
})

test('returns video generation to the unified asset catalog', () => {
  graphView.value = 'video-generate'

  render(<GraphApp pane="center" gameId="arrival-game" />)
  fireEvent.click(screen.getByRole('button', { name: 'video-generation' }))

  expect(graphSetView).toHaveBeenCalledWith('assets')
})

test('uses an explicit in-process game id for the left pane without a handshake', async () => {
  render(<GraphApp pane="left" gameId="arrival-game" />)

  expect(await screen.findByRole('complementary')).toBeTruthy()
  expect(ensureBoot).toHaveBeenCalledWith('arrival-game')
  expect(ready).not.toHaveBeenCalled()
})

test('uses explicit in-process pane and game id without changing the host URL', () => {
  window.history.replaceState({}, '', '/?pane=left&slug=other')
  bootstrapProps.mockClear()

  render(<GraphApp pane="center" gameId="arrival-game" />)

  expect(screen.queryByRole('complementary')).toBeNull()
  expect(screen.getByTestId('bootstrap')).toBeTruthy()
  expect(bootstrapProps).toHaveBeenCalledWith({ gameId: 'arrival-game' })
  expect(location.search).toBe('?pane=left&slug=other')
})
