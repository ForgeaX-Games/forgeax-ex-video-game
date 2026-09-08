/**
 * 画布节点的「生成视频」入口:记下目标节点并切到视频生成页。
 *
 * 目标写 sessionStorage 而不是随路由传参,是因为视频生成页也可能被独立打开;
 * `consumeNodeGenerationTarget` 读一次即删,避免后续独立生成继承过期节点。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useGraphView } from '../../../persist/graphViewStore'
import {
  bindVideoResourceToNode,
  nodeVideoEntityId,
  nodeVideoTargetFromEntityId,
  consumeNodeGenerationTarget,
  consumeCatalogVideoGenerationTarget,
  catalogVideoGenerationScope,
  nodeVideoGenerationScope,
  openNodeVideoGeneration,
  requestCatalogVideoGenerationTarget,
  requestNodeGenerationTarget,
  resolveVideoGenerationCatalogTarget,
} from '../videoGenerationNavigation'
import { useCatalogNav } from '../../../persist/catalogNavStore'
import { useVideoGenerationPanel } from '../../../persist/videoGenerationPanelStore'
import { applyHostInit, resetHostInjectionForTests } from '../../../host-init'
import { useVideoGenerationStore } from '../videoGenerationStore'
import { videoGenerationStoreKey } from '../videoGenerationStore'
import { generationScopeKey } from '../catalogGenerationRecovery'

it('scopes video catalog identity by blueprint and node', () => {
  expect(nodeVideoEntityId({ blueprintId: 'bp-a', nodeId: 'entry' })).toBe('node:bp-a:entry')
  expect(nodeVideoEntityId({ blueprintId: 'bp-b', nodeId: 'entry' })).toBe('node:bp-b:entry')
  expect(nodeVideoEntityId({ blueprintId: 'bp:a', nodeId: 'entry' }))
    .not.toBe(nodeVideoEntityId({ blueprintId: 'bp', nodeId: 'a:entry' }))
})

it('keeps same node ids distinct across nested graph paths', () => {
  expect(nodeVideoEntityId({ blueprintId: 'bp-main', nodeId: 'entry', graphPath: ['outer'] }))
    .toBe('node:bp-main:outer:entry')
  expect(nodeVideoEntityId({ blueprintId: 'bp-main', nodeId: 'entry', graphPath: ['other'] }))
    .not.toBe(nodeVideoEntityId({ blueprintId: 'bp-main', nodeId: 'entry', graphPath: ['outer'] }))
})

it('keeps generation scope keys canonical for graph paths and entity current-asset changes', () => {
  expect(generationScopeKey(nodeVideoGenerationScope({ blueprintId: 'bp-main', nodeId: 'entry', graphPath: ['a', 'b'] })))
    .not.toBe(generationScopeKey(nodeVideoGenerationScope({ blueprintId: 'bp-main', nodeId: 'entry', graphPath: ['a/b'] })))
  expect(generationScopeKey(catalogVideoGenerationScope({ entityId: 'video-a', assetId: 'asset-1' })))
    .toBe(generationScopeKey(catalogVideoGenerationScope({ entityId: 'video-a', assetId: 'asset-2' })))
  expect(generationScopeKey(catalogVideoGenerationScope({})))
    .not.toBe(generationScopeKey(catalogVideoGenerationScope({ entityId: 'root' })))
})

it('recovers a node target from a video entity id', () => {
  const target = { blueprintId: 'bp:main', graphPath: ['outer:flow'], nodeId: 'entry:video' }
  expect(nodeVideoTargetFromEntityId(nodeVideoEntityId(target))).toEqual(target)
  expect(nodeVideoTargetFromEntityId('video:standalone')).toBeUndefined()
  expect(nodeVideoTargetFromEntityId('node:broken')).toBeUndefined()
})

const TARGET = { gameId: 'game-wukong', blueprintId: 'bp-main', nodeId: 'heaven-gate' }

describe('openNodeVideoGeneration', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    useGraphView.getState().setView('graph')
    useVideoGenerationPanel.getState().close()
    resetHostInjectionForTests()
    useCatalogNav.setState({ location: { kind: 'catalog-root', target: 'root:catalog' } })
    useVideoGenerationStore.setState({ byScope: {} })
  })

  afterEach(() => {
    resetHostInjectionForTests()
  })

  it('记下目标节点并切到视频生成页', () => {
    useVideoGenerationStore.getState().select(TARGET.gameId, nodeVideoGenerationScope(TARGET), 'stale-generation')
    openNodeVideoGeneration(TARGET)

    expect(useGraphView.getState().view).toBe('video-generate')
    expect(consumeNodeGenerationTarget(TARGET.gameId)).toEqual(TARGET)
    expect(useVideoGenerationStore.getState().byScope[videoGenerationStoreKey(TARGET.gameId, nodeVideoGenerationScope(TARGET))]?.selectedTask).toBeUndefined()
    expect(useVideoGenerationStore.getState().byScope[videoGenerationStoreKey(TARGET.gameId, nodeVideoGenerationScope(TARGET))]?.selectedGenerationId).toBeUndefined()
  })

  it('宿主提供节点视频区域内的生成插槽时保持蓝图视图并打开视频生成 Tab', () => {
    const videoGenerationEl = document.createElement('div')
    applyHostInit({ videoGenerationEl })

    openNodeVideoGeneration(TARGET)

    expect(useGraphView.getState().view).toBe('graph')
    expect(useVideoGenerationPanel.getState().open).toBe(true)
    expect(useVideoGenerationPanel.getState().nodeTarget).toEqual(TARGET)
    expect(consumeNodeGenerationTarget(TARGET.gameId)).toEqual(TARGET)
  })

  it('重复点击同一节点的生成按钮也发出新的 Tab 激活请求', () => {
    const videoGenerationEl = document.createElement('div')
    applyHostInit({ videoGenerationEl })

    openNodeVideoGeneration(TARGET)
    const firstRevision = (useVideoGenerationPanel.getState() as { activationRevision?: number })
      .activationRevision
    openNodeVideoGeneration(TARGET)

    expect(firstRevision).toBeTypeOf('number')
    expect((useVideoGenerationPanel.getState() as { activationRevision?: number }).activationRevision)
      .toBe((firstRevision ?? 0) + 1)
  })

  it('目标只被消费一次,后续独立生成不继承过期节点', () => {
    openNodeVideoGeneration(TARGET)

    expect(consumeNodeGenerationTarget(TARGET.gameId)).toEqual(TARGET)
    expect(consumeNodeGenerationTarget(TARGET.gameId)).toBeUndefined()
  })

  it('游戏不匹配时忽略残留目标', () => {
    openNodeVideoGeneration(TARGET)

    expect(consumeNodeGenerationTarget('another-game')).toBeUndefined()
  })

  it('缺少节点标识时不切页,避免打开一个没有上下文的生成页', () => {
    openNodeVideoGeneration({ ...TARGET, nodeId: '  ' })

    expect(useGraphView.getState().view).toBe('graph')
    expect(consumeNodeGenerationTarget(TARGET.gameId)).toBeUndefined()
  })
})

it('captures a Catalog video folder even when no entity exists yet', () => {
  useCatalogNav.setState({ location: { kind: 'folder', tabKind: 'video', folderId: 'folder-clips', target: 'folder-clips' } })
  requestCatalogVideoGenerationTarget({ gameId: 'game-wukong' })

  expect(consumeCatalogVideoGenerationTarget('game-wukong')).toEqual({
    gameId: 'game-wukong',
    catalogLocation: { kind: 'folder', tabKind: 'video', folderId: 'folder-clips', target: 'folder-clips' },
  })
})

it('preserves the clicked manifest asset id for video prompt restoration', () => {
  useVideoGenerationStore.getState().select('game-wukong', catalogVideoGenerationScope({ entityId: 'video-entity-1' }), 'stale-generation')
  requestCatalogVideoGenerationTarget({
    gameId: 'game-wukong',
    entityId: 'video-entity-1',
    assetId: 'manifest-video-1',
  })

  expect(consumeCatalogVideoGenerationTarget('game-wukong')).toMatchObject({
    entityId: 'video-entity-1',
    assetId: 'manifest-video-1',
  })
  expect(useVideoGenerationStore.getState().byScope[videoGenerationStoreKey('game-wukong', catalogVideoGenerationScope({ entityId: 'video-entity-1' }))]?.selectedGenerationId).toBeUndefined()
})

it('lets the latest Catalog entry replace a stale node navigation target', () => {
  requestNodeGenerationTarget(TARGET)
  requestCatalogVideoGenerationTarget({
    gameId: TARGET.gameId,
    entityId: 'video-entity-1',
    assetId: 'manifest-video-1',
  })

  expect(consumeNodeGenerationTarget(TARGET.gameId)).toBeUndefined()
  expect(consumeCatalogVideoGenerationTarget(TARGET.gameId)).toMatchObject({
    entityId: 'video-entity-1',
    assetId: 'manifest-video-1',
  })
})

it('lets the latest node entry replace a stale Catalog navigation target', () => {
  requestCatalogVideoGenerationTarget({
    gameId: TARGET.gameId,
    entityId: 'video-entity-1',
    assetId: 'manifest-video-1',
  })
  requestNodeGenerationTarget(TARGET)

  expect(consumeCatalogVideoGenerationTarget(TARGET.gameId)).toBeUndefined()
  expect(consumeNodeGenerationTarget(TARGET.gameId)).toEqual(TARGET)
})

it('ignores stale Catalog video location when entering from a blueprint node', () => {
  const staleCatalogTarget = {
    gameId: TARGET.gameId,
    entityId: 'previous-video',
    assetId: 'previous-video-asset',
  }
  const staleLocation = {
    kind: 'item' as const,
    tabKind: 'video' as const,
    itemId: 'previous-video',
    placementKey: 'video:previous-video',
    target: 'root:video',
  }

  expect(resolveVideoGenerationCatalogTarget(
    TARGET.gameId,
    TARGET,
    staleCatalogTarget,
    staleLocation,
  )).toBeUndefined()
})

it('keeps Catalog restoration when the page was not opened from a node', () => {
  const location = {
    kind: 'item' as const,
    tabKind: 'video' as const,
    itemId: 'video-entity-1',
    placementKey: 'video:video-entity-1',
    target: 'root:video',
  }

  expect(resolveVideoGenerationCatalogTarget('game-wukong', undefined, undefined, location)).toEqual({
    gameId: 'game-wukong',
    entityId: 'video-entity-1',
    catalogLocation: location,
  })
})

describe('bindVideoResourceToNode', () => {
  it('preserves the node prompt and generation preset while binding the result', () => {
    const graph = {
      nodes: [{
        id: 'heaven-gate',
        type: 'perf' as const,
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        data: {
          name: '闯入南天门',
          media: {
            kind: 'video' as const,
            prompt: '悟空闯入南天门',
            generation: { schemaVersion: 1 as const, durationSeconds: 8, generateAudio: false, mode: 'ref' as const },
          },
        },
      }],
      edges: [],
    }

    expect(bindVideoResourceToNode(graph, 'heaven-gate', 'kino-video-1').nodes[0]?.data.media)
      .toEqual({
        kind: 'video',
        ref: 'kino-video-1',
        prompt: '悟空闯入南天门',
        generation: { schemaVersion: 1, durationSeconds: 8, generateAudio: false, mode: 'ref' },
      })
  })

  it('does not bind a result to a different node', () => {
    const graph = { nodes: [], edges: [] }
    expect(bindVideoResourceToNode(graph, 'missing', 'kino-video-1')).toBe(graph)
  })
})
