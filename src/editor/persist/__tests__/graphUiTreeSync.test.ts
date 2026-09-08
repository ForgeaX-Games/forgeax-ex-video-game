import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueprintDoc, GameGraph } from '@/runtime/core/schema/graph-schema'
import { useGraphScenario } from '../graphScenarioStore'
import { findUiTreeNode } from '../ui-tree'
import { CUSTOM_UI_FOLDER_ID } from '../ui-tree'
import { useUiSelection } from '../uiSelectionStore'
import {
  broadcastUiTreeIntent,
  installGraphUiTreeSync,
  resetGraphUiTreeSyncForTests,
} from '../graphUiTreeSync'

/**
 * 模拟 BroadcastChannel：postMessage 同步投递给同名 peer 的 onmessage，并记录自身发出。
 *
 * 真实分屏：两个 iframe 各有独立的模块副本 + 各自的 channel 实例，经同名 BroadcastChannel 相连。
 * 测试里只有一个模块副本、一个模块级 channel。因此：
 *  - 「发起方广播」：装一个 channel，store action 调用 broadcastUiTreeIntent → channel.postMessage →
 *    记录在 channel.posted，可断言广播了什么。
 *  - 「对侧落地」：把一条意图消息直接喂回 channel.onmessage（模拟「从远端收到」），触发 applyRemote，
 *    断言本地 store 被正确改写；applyingRemote 置位期间不应再回环 postMessage。
 */
class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = []
  readonly posted: unknown[] = []
  onmessage: ((event: MessageEvent) => void) | null = null

  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this)
  }

  postMessage(data: unknown): void {
    this.posted.push(data)
    for (const peer of FakeBroadcastChannel.instances) {
      if (peer !== this && peer.name === this.name) {
        peer.onmessage?.({ data } as MessageEvent)
      }
    }
  }

  close(): void {
    FakeBroadcastChannel.instances = FakeBroadcastChannel.instances.filter((entry) => entry !== this)
  }
}

const initialState = useGraphScenario.getState()
const graph: GameGraph = {
  nodes: [{
    id: 'node',
    type: 'perf',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [],
    data: { name: 'node', overlayNodes: [{ overlay: 'hud' }] },
  }],
  edges: [],
}
const main: BlueprintDoc = { id: 'main', title: '主蓝图', entry: 'node', graph }
const disposers: Array<() => void> = []

beforeEach(() => {
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  FakeBroadcastChannel.instances = []
  resetGraphUiTreeSyncForTests()
  useUiSelection.getState().clearUiSelection()
  useGraphScenario.setState({
    booted: true,
    blueprints: { main },
    mainBlueprintId: 'main',
    activeBlueprintId: 'main',
    graph,
    meta: {
      ui: { overlays: { hud: { id: 'hud', title: '战斗 HUD', children: [] } } },
      uiTree: {
        root: [{
          kind: 'folder',
          id: CUSTOM_UI_FOLDER_ID,
          name: '自定义界面',
          children: [{ kind: 'scheme', id: 'hud-node', overlayId: 'hud' }],
        }],
      },
    },
  })
})

afterEach(() => {
  while (disposers.length) disposers.pop?.()
  useGraphScenario.setState(initialState, true)
  useUiSelection.getState().clearUiSelection()
  resetGraphUiTreeSyncForTests()
  vi.unstubAllGlobals()
})

/** 装一个 pane 的 sync，返回它的频道实例（模块级 channel 即此实例）。 */
function installOne(): FakeBroadcastChannel {
  disposers.push(installGraphUiTreeSync())
  return FakeBroadcastChannel.instances.at(-1)!
}

describe('graphUiTreeSync split-pane intent sync', () => {
  it('broadcasts a scheme-added intent on createUiScheme', () => {
    const ch = installOne()

    const created = useGraphScenario.getState().createUiScheme(CUSTOM_UI_FOLDER_ID, '战斗结算')
    expect(created).not.toBeNull()

    const schemeAdded = ch.posted.filter((m) => (m as { type?: string }).type === 'scheme-added')
    expect(schemeAdded).toHaveLength(1)
    expect(schemeAdded[0]).toMatchObject({ parentId: CUSTOM_UI_FOLDER_ID, overlayId: created!.overlayId, title: '战斗结算' })
  })

  it('applyRemote lands a scheme-added intent (tree + overlay + selection)', () => {
    const ch = installOne()
    // 模拟从远端收到一条 scheme-added 意图。
    ch.onmessage?.({ data: {
      type: 'scheme-added',
      parentId: CUSTOM_UI_FOLDER_ID,
      nodeId: 'ui-scheme:remote-1',
      overlayId: 'scheme-remote',
      title: '远端方案',
    } } as MessageEvent)

    const meta = useGraphScenario.getState().meta
    expect(meta.ui?.overlays?.['scheme-remote']).toMatchObject({ title: '远端方案' })
    expect(findUiTreeNode(meta.uiTree!, 'ui-scheme:remote-1')).toMatchObject({
      kind: 'scheme',
      overlayId: 'scheme-remote',
    })
    expect(useUiSelection.getState()).toMatchObject({
      selectedTreeNodeId: 'ui-scheme:remote-1',
      selectedOverlayId: 'scheme-remote',
    })
  })

  it('broadcasts and lands rename / remove intents', () => {
    const ch = installOne()
    const created = useGraphScenario.getState().createUiScheme(CUSTOM_UI_FOLDER_ID, '战斗结算')!
    ch.posted.length = 0

    expect(useGraphScenario.getState().renameUiNode(created.nodeId, '结算界面')).toBe(true)
    expect(ch.posted.some((m) => (m as { type?: string }).type === 'overlay-renamed')).toBe(true)

    ch.posted.length = 0
    expect(useGraphScenario.getState().removeUiNode(created.nodeId)).toBe(true)
    expect(ch.posted.some((m) => (m as { type?: string }).type === 'removed')).toBe(true)
    expect(useGraphScenario.getState().meta.ui?.overlays?.[created.overlayId]).toBeUndefined()
  })

  it('applyRemote does not re-broadcast (no loop)', () => {
    const ch = installOne()
    ch.posted.length = 0
    // 远端收到一条 select 意图 → applyRemote 落地 select，期间 applyingRemote 置位，不再 postMessage。
    ch.onmessage?.({ data: { type: 'select', treeNodeId: 'hud-node', overlayId: 'hud' } } as MessageEvent)
    expect(useUiSelection.getState().selectedTreeNodeId).toBe('hud-node')
    expect(ch.posted).toHaveLength(0)
  })

  it('does not broadcast a stale-selection intermediate when creating a scheme (no flicker)', () => {
    // 回归：旧 uiNavSync 一次命令内 setMeta + selectUiNode 两次写入 → 两次 snapshot，
    // 左栏先收到「选中仍是旧值」的中间态 → 高亮先跳旧方案再回新方案（闪烁）。
    // 新架构：createUiScheme 单次 set 原子写 + 一次 selectUiNode + 一次 scheme-added 广播，
    // 不产生任何 select 中间态广播。
    const ch = installOne()
    useUiSelection.getState().selectUiNode('hud-node', 'hud') // 旧选中态基线
    ch.posted.length = 0

    useGraphScenario.getState().createUiScheme(CUSTOM_UI_FOLDER_ID, '战斗结算')

    const selectIntents = ch.posted.filter((m) => (m as { type?: string }).type === 'select')
    expect(selectIntents).toHaveLength(0)
    const schemeAdded = ch.posted.filter((m) => (m as { type?: string }).type === 'scheme-added')
    expect(schemeAdded).toHaveLength(1)
  })

  it('ignores malformed messages', () => {
    const ch = installOne()
    const before = useGraphScenario.getState().meta

    ch.onmessage?.({ data: { type: 'nonsense' } } as MessageEvent)
    ch.onmessage?.({ data: null } as MessageEvent)

    expect(useGraphScenario.getState().meta).toBe(before)
  })

  it('is a no-op without BroadcastChannel (standalone)', () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('BroadcastChannel', undefined as unknown)
    const dispose = installGraphUiTreeSync()
    expect(typeof dispose).toBe('function')
    const created = useGraphScenario.getState().createUiScheme(CUSTOM_UI_FOLDER_ID, '独立方案')
    expect(created).not.toBeNull()
    expect(useGraphScenario.getState().meta.ui?.overlays?.[created!.overlayId]).toMatchObject({ title: '独立方案' })
    dispose()
  })
})
