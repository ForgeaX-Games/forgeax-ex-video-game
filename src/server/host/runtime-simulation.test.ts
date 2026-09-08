import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { simulatePassA } from './runtime-simulation'

const encoder = new TextEncoder()

function playableProject() {
  const graph = {
    nodes: [
      {
        id: 'choice', type: 'perf', position: { x: 0, y: 0 },
        data: { name: '选择', media: { kind: 'VIDEO', ref: 'choice.mp4' }, overlayNodes: [{ overlay: 'base:TextOption' }] },
      },
      { id: 'end-a', type: 'perf', position: { x: 300, y: -100 }, data: { name: '结局 A', media: { kind: 'VIDEO', ref: 'a.mp4' }, overlayNodes: [] } },
      { id: 'end-b', type: 'perf', position: { x: 300, y: 100 }, data: { name: '结局 B', media: { kind: 'VIDEO', ref: 'b.mp4' }, overlayNodes: [] } },
    ],
    edges: [
      { id: 'choose-a', source: 'choice', target: 'end-a', sourceHandle: 'A', targetHandle: 'in', data: {} },
      { id: 'choose-b', source: 'choice', target: 'end-b', sourceHandle: 'B', targetHandle: 'in', data: {} },
    ],
  }
  return {
    version: 'game-video.graph.v1',
    graph,
    manifest: { mainPackId: 'bp-main', packs: { 'bp-main': { id: 'bp-main', title: '主蓝图', entry: 'choice', graph } } },
    variables: {}, entities: {}, formulas: {}, ui: { overlays: {} },
  }
}

function context(project: unknown): ExtensionContext {
  const entries = new Map<string, Uint8Array>([['blueprint.json', encoder.encode(JSON.stringify(project))]])
  return {
    gameId: 'pass-a-simulation-test',
    files: {
      async read(path: string) { return entries.get(path) ?? null },
      async write(path: string, bytes: Uint8Array) { entries.set(path, new Uint8Array(bytes)) },
      async delete(path: string) { entries.delete(path) },
      async list() { return [] },
      async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>) { return operation() },
    },
  } as unknown as ExtensionContext
}

describe('minimum-playable runtime simulation', () => {
  it('drives complete entry-to-terminal paths through GraphSession', async () => {
    const result = await simulatePassA(context(playableProject()), 7)
    expect(result.ok).toBe(true)
    expect(result.evidence).toMatchObject({
      activityRevision: 7,
      checkId: 'playtest.all-required-paths-reach-terminal',
      status: 'pass',
      details: { engine: 'GraphSession' },
    })
    expect(result.simulations[0]!.sampledEdgePaths.length).toBeGreaterThan(1)
    expect(result.simulations[0]!.runtimeTraversedEdgeIds.length).toBeGreaterThan(0)
  })

  it('simulates blueprint logic without requiring node media refs', async () => {
    const project = playableProject()
    for (const node of project.graph.nodes) {
      delete (node.data.media as { ref?: string }).ref
    }

    const result = await simulatePassA(context(project), 9)

    expect(result.ok, JSON.stringify(result.evidence.issues)).toBe(true)
    expect(result.evidence.details).toMatchObject({
      engine: 'GraphSession',
      mode: 'blueprint-logic-only',
      mediaRequired: false,
    })
  })

  it('accepts event-driven replay loops that always stop for player input', async () => {
    const project = playableProject()
    for (const node of project.graph.nodes.filter((candidate) => candidate.id.startsWith('end-'))) {
      node.data.overlayNodes = [{ overlay: 'base:TextOption' }]
    }
    project.graph.edges.push(
      { id: 'replay-a', source: 'end-a', target: 'choice', sourceHandle: 'replay', targetHandle: 'in', data: {} },
      { id: 'replay-b', source: 'end-b', target: 'choice', sourceHandle: 'replay', targetHandle: 'in', data: {} },
    )

    const result = await simulatePassA(context(project), 10)

    expect(result.ok, JSON.stringify(result.evidence.issues)).toBe(true)
    expect(result.simulations[0]!.terminalNodeIds).toEqual([])
    expect(result.simulations[0]!.restNodeIds).toEqual(expect.arrayContaining(['choice', 'end-a', 'end-b']))
    expect(result.evidence.details).toMatchObject({ restPointCount: 3 })
  })

  it('reports a choice edge that cannot receive a real runtime input as a non-blocking diagnostic', async () => {
    const broken = playableProject()
    const pack = broken.manifest.packs['bp-main']
    const node = pack.graph.nodes.find((candidate) => candidate.id === 'choice')!
    node.data.overlayNodes = []

    const result = await simulatePassA(context(broken), 8)
    expect(result.ok).toBe(true)
    expect(result.evidence.status).toBe('pass')
    expect(result.evidence.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'playtest.runtime.error' }),
    ]))
  })
})

/**
 * 入口自动推进导致的重放错位（真跑回归）。
 *
 * `GraphSession.start()` 会沿默认出口一路推进（entry → n1 → n2），而采样路径是从
 * 入口逐边枚举的。旧实现把这种错位判成 `playtest.runtime.error`，还报「预期进入 entry」，
 * 于是整装 peer 照着错误提示反复改同样的 4 条边，试玩永远过不了。
 */
describe('入口自动推进不应判成运行时失败', () => {
  function autoAdvancingProject() {
    const graph = {
      nodes: [
        { id: 'entry', type: 'perf', position: { x: 0, y: 0 }, data: { name: '起点', media: { kind: 'VIDEO', ref: 'entry.mp4' }, overlayNodes: [] } },
        { id: 'n1', type: 'perf', position: { x: 150, y: 0 }, data: { name: '第二幕', media: { kind: 'VIDEO', ref: 'n1.mp4' }, overlayNodes: [] } },
        {
          id: 'choice', type: 'perf', position: { x: 300, y: 0 },
          data: { name: '抉择', media: { kind: 'VIDEO', ref: 'choice.mp4' }, overlayNodes: [{ overlay: 'base:TextOption' }] },
        },
        { id: 'end-a', type: 'perf', position: { x: 450, y: -80 }, data: { name: '结局 A', media: { kind: 'VIDEO', ref: 'a.mp4' }, overlayNodes: [] } },
        { id: 'end-b', type: 'perf', position: { x: 450, y: 80 }, data: { name: '结局 B', media: { kind: 'VIDEO', ref: 'b.mp4' }, overlayNodes: [] } },
      ],
      edges: [
        { id: 'e-entry-n1', source: 'entry', target: 'n1', sourceHandle: 'default', targetHandle: 'in', data: {} },
        { id: 'e-n1-choice', source: 'n1', target: 'choice', sourceHandle: 'default', targetHandle: 'in', data: {} },
        { id: 'choose-a', source: 'choice', target: 'end-a', sourceHandle: 'A', targetHandle: 'in', data: {} },
        { id: 'choose-b', source: 'choice', target: 'end-b', sourceHandle: 'B', targetHandle: 'in', data: {} },
      ],
    }
    return {
      version: 'game-video.graph.v1',
      graph,
      manifest: { mainPackId: 'bp-main', packs: { 'bp-main': { id: 'bp-main', title: '主蓝图', entry: 'entry', graph } } },
      variables: {}, entities: {}, formulas: {}, ui: { overlays: {} },
    }
  }

  it('默认出口串起来的开头不会报「预期进入 entry」', async () => {
    const result = await simulatePassA(context(autoAdvancingProject()), 1)
    const issues = result.simulations[0]!.issues

    expect(
      issues.filter((issue) => issue.code === 'playtest.runtime.error'),
      JSON.stringify(issues),
    ).toEqual([])
    expect(result.ok, JSON.stringify(issues)).toBe(true)
  })

  it('真正偏离路径时报错要说清「下一条边要求从哪出发」', async () => {
    const broken = autoAdvancingProject()
    // 把抉择出口指向一个不可达节点，制造真实偏离。
    broken.graph.edges.push({
      id: 'dangling', source: 'end-a', target: 'entry', sourceHandle: 'default', targetHandle: 'in', data: {},
    })
    const result = await simulatePassA(context(broken), 1)
    const messages = result.simulations[0]!.issues.map((issue) => issue.message).join(' ')

    if (messages.includes('运行时停在')) {
      expect(messages).toContain('要求从')
      expect(messages).not.toContain('预期进入')
    }
  })
})
