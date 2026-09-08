import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VideoGenerationPage } from '../VideoGenerationPage'
import type { VideoGenerationWorkspaceProps } from '../../assets/generation/VideoGenerationWorkspace'

const testState = vi.hoisted(() => ({
  nodeTarget: undefined as { gameId: string; blueprintId: string; nodeId: string } | undefined,
  workspaceProps: null as VideoGenerationWorkspaceProps | null,
  registerGenerated: vi.fn<(input: unknown) => Promise<void>>(async () => {}),
  apply: vi.fn<(input: unknown) => Promise<void>>(async () => {}),
}))

vi.mock('../../persist/graphScenarioStore', () => ({
  useGraphScenario: Object.assign(
    (selector: (state: { game: string }) => unknown) => selector({ game: 'demo-game' }),
    { getState: () => ({ isDraft: false, syncTipIfClean: vi.fn(async () => 'applied') }) },
  ),
}))
vi.mock('../../assets/asset-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../assets/asset-catalog')>()
  return {
    ...actual,
    useAssetCatalog: () => ({ catalog: actual.EMPTY_ASSET_CATALOG }),
    resolveCatalogItemLocation: () => undefined,
  }
})
vi.mock('../../persist/catalogNavStore', () => ({
  useCatalogNav: (selector: (state: { location: { kind: 'catalog-root'; target: string }; setLocation: () => void }) => unknown) => selector({ location: { kind: 'catalog-root', target: 'root:video' }, setLocation: vi.fn() }),
}))
vi.mock('../../persist/graphViewStore', () => ({
  useGraphView: (selector: (state: { setView: () => void }) => unknown) => selector({ setView: vi.fn() }),
}))
vi.mock('../../assets/generation/videoGenerationNavigation', () => ({
  consumeNodeGenerationTarget: () => testState.nodeTarget,
  consumeCatalogVideoGenerationTarget: () => undefined,
  resolveVideoGenerationCatalogTarget: () => undefined,
  nodeVideoGenerationScope: (target: { blueprintId: string; nodeId: string }) => ({
    mediaType: 'video', owner: 'node', blueprintId: target.blueprintId, nodeId: target.nodeId,
  }),
  catalogVideoGenerationScope: (target: { entityId?: string; assetId?: string }) => target.entityId || target.assetId
    ? { mediaType: 'video', owner: 'entity', ...target }
    : { mediaType: 'video', owner: 'root' },
  nodeVideoEntityId: () => 'node:demo',
  nodeVideoTargetFromEntityId: () => undefined,
}))
vi.mock('../../assets/generation/VideoGenerationWorkspace', () => ({
  VideoGenerationWorkspace: (props: VideoGenerationWorkspaceProps) => {
    testState.workspaceProps = props
    return <div data-testid="video-generation-workspace" />
  },
}))
vi.mock('../../assets/generation/catalogGenerationRecovery', () => ({
  withCatalogGenerationTracking: (value: { asset: Record<string, unknown> }, task: { generationId: string }, mediaType: string, scope: unknown) => ({
    ...value,
    asset: {
      ...value.asset,
      meta: {
        ...(value.asset.meta as Record<string, unknown> | undefined),
        kinoGenerationId: task.generationId,
        catalogGeneration: { version: 3, generationId: task.generationId, mediaType, scope },
      },
    },
  }),
}))
vi.mock('../../assets/generation/video-generation-naming', () => ({
  generatedVideoDisplayName: (input: { nodeName?: string; existingName?: string; newVideoName?: string; fallback: string }) => (
    input.nodeName ?? input.existingName ?? input.newVideoName ?? input.fallback
  ),
}))
vi.mock('../../assets/generation/generation-naming', () => ({ nextGeneratedName: () => '新视频 1' }))
vi.mock('../../assets/asset-catalog-client', () => ({
  assetCatalogClient: { registerGenerated: testState.registerGenerated, apply: testState.apply },
}))
vi.mock('../../assets/host-media-client', () => ({ createHostMediaClient: vi.fn() }))
vi.mock('../../assets/image-assets', () => ({ uploadReferenceImage: vi.fn() }))
vi.mock('../../lib/plugin-http', () => ({ pluginFetch: vi.fn() }))
vi.mock('../../lib/extension-host', () => ({ getExtensionHost: () => ({}) }))

describe('<VideoGenerationPage />', () => {
  it('registers node generation with independently scoped catalog and blueprint applies', async () => {
    testState.nodeTarget = { gameId: 'demo-game', blueprintId: 'bp-main', nodeId: 'intro' }
    const task = {
      generationId: 'generation-1', mediaType: 'video' as const, status: 'succeeded' as const,
      prompt: 'A fight', resultUrl: 'https://cdn.test/video.mp4', resourceId: 'resource-1', createdAt: 1,
    }
    const request = {
      gameSlug: 'demo-game', prompt: 'A fight', durationSeconds: 5, generateAudio: false, mode: 't2v' as const,
    }

    try {
      render(<VideoGenerationPage onBack={vi.fn()} showBreadcrumb={false} />)
      expect(testState.workspaceProps?.onGenerationStarted).toBeTypeOf('function')
      expect(testState.workspaceProps?.onGenerationSucceeded).toBeTypeOf('function')

      await act(async () => {
        await testState.workspaceProps?.onGenerationStarted?.(task, request)
      })
      expect(testState.registerGenerated).toHaveBeenCalledWith(expect.objectContaining({
        placement: expect.objectContaining({ folderId: 'root:video', placementKey: 'video:node:demo' }),
        asset: expect.objectContaining({
          label: '新视频 1',
          meta: expect.objectContaining({
            catalogGeneration: expect.objectContaining({
              scope: { mediaType: 'video', owner: 'node', blueprintId: 'bp-main', nodeId: 'intro' },
            }),
          }),
        }),
        apply: expect.objectContaining({
          mode: 'catalog', entityId: 'node:demo', source: 'generate', tabKind: 'video',
        }),
        blueprintApply: {
          mode: 'blueprint',
          tabKind: 'video',
          target: { kind: 'node-video', blueprintId: 'bp-main', nodeId: 'intro' },
        },
      }))
      expect(testState.registerGenerated.mock.calls[0]?.[0]).not.toEqual(expect.objectContaining({
        apply: expect.objectContaining({ target: expect.anything() }),
      }))
      expect(testState.apply).not.toHaveBeenCalled()

      await act(async () => {
        await testState.workspaceProps?.onGenerationSucceeded?.('resource-1', task)
      })
      expect(testState.registerGenerated).toHaveBeenCalledTimes(2)
      expect(testState.registerGenerated).toHaveBeenLastCalledWith(expect.objectContaining({
        placement: expect.objectContaining({ folderId: 'root:video', placementKey: 'video:node:demo' }),
        apply: expect.objectContaining({ mode: 'catalog', entityId: 'node:demo', source: 'generate', tabKind: 'video' }),
        blueprintApply: expect.objectContaining({
          mode: 'blueprint',
          target: { kind: 'node-video', blueprintId: 'bp-main', nodeId: 'intro' },
        }),
      }))
      expect(testState.registerGenerated.mock.calls[0]?.[0]).not.toEqual(expect.objectContaining({
        apply: expect.objectContaining({ createEntity: expect.anything() }),
      }))
      expect(testState.registerGenerated.mock.calls[1]?.[0]).not.toEqual(expect.objectContaining({
        apply: expect.objectContaining({ createEntity: expect.anything() }),
      }))
      expect(testState.apply).not.toHaveBeenCalled()
    } finally {
      testState.nodeTarget = undefined
      testState.workspaceProps = null
      testState.registerGenerated.mockClear()
      testState.apply.mockClear()
    }
  })

  it('can hide route breadcrumb when rendered inside the node video tab', () => {
    const { rerender } = render(<VideoGenerationPage onBack={vi.fn()} />)
    expect(screen.getByLabelText('生成页路径')).toBeTruthy()

    rerender(<VideoGenerationPage onBack={vi.fn()} showBreadcrumb={false} />)
    expect(screen.queryByLabelText('生成页路径')).toBeNull()
    expect(screen.getByTestId('video-generation-workspace')).toBeTruthy()
  })
})
