import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import { PlayerBootstrap } from '../PlayerBootstrap'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { loadStore, saveProject } from '../../persist/persist-client'
import { setLocale } from '../../../i18n'

const client = vi.hoisted(() => ({
  ready: vi.fn(),
  gamePackage: {
    status: vi.fn(),
  },
  versions: {
    supported: vi.fn(() => false),
  },
}))

vi.mock('../../../lib/extension-host', () => ({
  getExtensionHost: () => client,
}))

vi.mock('../../persist/persist-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../persist/persist-client')>()
  return {
    ...actual,
    loadStore: vi.fn(),
    saveProject: vi.fn(async () => ({ ok: true })),
    currentVersion: vi.fn(async () => ({ tag: null, commitHash: null, dirty: false })),
    listVersions: vi.fn(async () => []),
  }
})

vi.mock('@/runtime/react/component-host', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/runtime/react/component-host')>()
  return { ...actual, bootComponents: vi.fn(async () => {}) }
})

vi.mock('../../shell/GraphPlayer', () => ({
  GraphPlayer: ({ scenario }: { scenario: GraphLibraryDocument }) => (
    <div data-testid="player-document">{scenario.graph.nodes[0]?.id}</div>
  ),
}))

const document: GraphLibraryDocument = {
  version: 'game-video.graph.v1',
  graph: { nodes: [{ id: 'loaded-from-package', type: 'perf', position: { x: 20, y: 20 }, inputs: [], outputs: [], data: { name: 'Loaded' } }], edges: [] },
  manifest: {
    version: 'game-video.blueprint-manifest.v1',
    mainPackId: 'main',
    packs: {
      main: {
        id: 'main',
        title: 'Loaded package',
        entry: 'loaded-from-package',
        graph: { nodes: [{ id: 'loaded-from-package', type: 'perf', position: { x: 20, y: 20 }, inputs: [], outputs: [], data: { name: 'Loaded' } }], edges: [] },
      },
    },
  },
}

beforeEach(() => {
  setLocale('en')
  vi.clearAllMocks()
  client.ready.mockResolvedValue({ gameId: 'handshake-game' })
  client.gamePackage.status.mockResolvedValue({ state: 'initialized' })
  vi.mocked(loadStore).mockResolvedValue({ project: document, revision: null, versions: [] })
  useGraphScenario.setState({
    game: '',
    demo: null,
    blueprints: {},
    mainBlueprintId: '',
    activeBlueprintId: '',
    graph: { nodes: [], edges: [] },
    meta: {},
    booted: false,
    isDraft: false,
    loadEpoch: 0,
  } as never)
})

test('waits for the handshake and package document before rendering the player', async () => {
  render(<PlayerBootstrap />)

  expect(screen.queryByTestId('player-document')).toBeNull()
  expect((await screen.findByTestId('player-document')).textContent).toContain('loaded-from-package')
  expect(client.ready).toHaveBeenCalledTimes(1)
  expect(client.gamePackage.status).toHaveBeenCalledTimes(1)
  expect(loadStore).toHaveBeenCalledWith('handshake-game')
})

test('keeps the player unmounted after a package load failure and retries without saving an empty document', async () => {
  vi.mocked(loadStore)
    .mockRejectedValueOnce(new Error('temporary package read failure'))
    .mockResolvedValueOnce({ project: document, revision: null, versions: [] })

  render(<PlayerBootstrap />)

  expect(await screen.findByText('Initialization failed')).toBeTruthy()
  expect(screen.queryByTestId('player-document')).toBeNull()
  expect(saveProject).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

  await waitFor(() => expect(screen.getByTestId('player-document').textContent).toContain('loaded-from-package'))
  expect(loadStore).toHaveBeenCalledTimes(2)
  expect(saveProject).not.toHaveBeenCalled()
})
