import { describe, expect, it } from 'vitest'
import type { GameNode, GameScenario } from '@/runtime/core/schema/graph-schema'
import { buildNodeContextReference, buildNodeReferencePill } from '../node-agent-context'

describe('buildNodeReferencePill', () => {
  it('把节点、关联路由、挂载界面及状态目录放进同一个可理解引用', () => {
    const scenario: GameScenario = {
      version: 'game-video.graph.v1',
      graph: {
        nodes: [
          { id: 'before', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: '前置' } },
          {
            id: 'fight',
            type: 'perf',
            position: { x: 200, y: 0 },
            inputs: [],
            outputs: [],
            data: {
              name: '首领战',
              durationMs: 8_000,
              media: { kind: 'VIDEO', ref: 'boss-clip', prompt: '巨兽冲锋' },
              overlayNodes: [{ id: 'mount-hud', overlay: 'hud' }],
              reactions: [{ when: { type: 'at', ms: 2_000 }, do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'rage', op: 'add', value: 1 }] }] }],
            },
          },
          { id: 'after', type: 'perf', position: { x: 400, y: 0 }, inputs: [], outputs: [], data: { name: '胜利' } },
          { id: 'unrelated', type: 'perf', position: { x: 0, y: 200 }, inputs: [], outputs: [], data: { name: '无关' } },
        ],
        edges: [
          { id: 'in', source: 'before', target: 'fight', sourceHandle: 'default', targetHandle: 'in' },
          { id: 'out', source: 'fight', target: 'after', sourceHandle: 'win', targetHandle: 'in' },
          { id: 'other', source: 'before', target: 'unrelated', sourceHandle: 'other', targetHandle: 'in' },
        ],
      },
      ui: {
        overlays: {
          hud: { id: 'hud', title: '战斗 HUD', children: [{ id: 'hp', component: 'Bar', inputs: { value: 'boss.hp' } }] },
          unused: { id: 'unused', title: '未挂载界面', children: [] },
        },
      },
      entities: { boss: { id: 'boss', attrs: { hp: 100 } } },
      variables: { rage: { id: 'rage', initial: 0 } },
    }
    const pill = buildNodeReferencePill({
      gameId: 'game-nodia-fighting',
      blueprintId: 'bp-main',
      blueprintTitle: '主线',
      graphPath: [{ id: 'phase-2', name: '第二阶段' }],
      graph: scenario.graph,
      node: scenario.graph.nodes[1]!,
      scenario,
    })

    expect(pill).toMatchObject({ kind: 'blueprint-node', display: '首领战', icon: '🔷' })
    expect(pill.tooltip.lines).toContain('位置：第二阶段')
    expect(pill.detail).toContain('结合用户在引用旁输入的要求理解或调整该节点')
    expect(pill.detail).toContain('game-video.blueprint-node-reference.v1')
    expect(pill.detail).toContain('"id": "fight"')
    expect(pill.detail).toContain('"id": "in"')
    expect(pill.detail).toContain('"id": "out"')
    expect(pill.detail).not.toContain('"id": "other"')
    expect(pill.detail).toContain('"name": "前置"')
    expect(pill.detail).toContain('"name": "胜利"')
    expect(pill.detail).toContain('战斗 HUD')
    expect(pill.detail).not.toContain('未挂载界面')
    expect(pill.detail).toContain('"boss"')
    expect(pill.detail).toContain('"rage"')
  })
})

describe('buildNodeContextReference', () => {
  const scenario: GameScenario = {
    version: 'game-video.graph.v1',
    graph: {
      nodes: [
        {
          id: 'fight',
          type: 'perf',
          position: { x: 200, y: 0 },
          inputs: [],
          outputs: [],
          data: { name: '首领战', durationMs: 8_000, media: { kind: 'VIDEO', ref: 'boss-clip', prompt: '巨兽冲锋' } },
        },
      ],
      edges: [],
    },
  }
  const node = scenario.graph.nodes[0]!

  it('把节点投影成带 tools 写回提示的通用 ContextReference 信封', () => {
    const reference = buildNodeContextReference({
      gameId: 'game-nodia-fighting',
      blueprintId: 'bp-main',
      blueprintTitle: '主线',
      graphPath: [{ id: 'phase-2', name: '第二阶段' }],
      graph: scenario.graph,
      node,
      scenario,
    })

    expect(reference.refKind).toBe('game-video.blueprint-node.v1')
    expect(reference.sourceExtensionId).toBe('@forgeax-extension/game-video')
    expect(reference.display).toEqual({ title: '首领战', icon: '🔷', subtitle: '第二阶段' })
    expect(reference.action).toEqual({
      protocol: 'tools',
      toolHints: ['game-video:get-graph', 'game-video:save-graph'],
    })
    const payload = reference.payload as Record<string, unknown>
    expect(payload.kind).toBe('game-video.blueprint-node-reference.v1')
    expect(payload.gameId).toBe('game-nodia-fighting')
    expect((payload.node as GameNode).id).toBe('fight')
  })

  it('无 graphPath 时 subtitle 回退为「根图」', () => {
    const reference = buildNodeContextReference({
      gameId: 'game-nodia-fighting',
      blueprintId: 'bp-main',
      graphPath: [],
      graph: scenario.graph,
      node,
      scenario,
    })
    expect(reference.display.subtitle).toBe('根图')
  })

  it('payload 超 30KB 时降级为身份字段 + 截断快照，不再是权威数据', () => {
    const bigOverlayId = 'hud'
    const bigScenario: GameScenario = {
      ...scenario,
      ui: {
        overlays: {
          [bigOverlayId]: {
            id: bigOverlayId,
            title: '大界面',
            children: Array.from({ length: 4_000 }, (_, index) => ({
              id: `child-${index}`,
              component: 'Bar',
              inputs: { value: `padding-to-exceed-thirty-kilobytes-${index}` },
            })),
          },
        },
      },
    }
    const bigNode: GameNode = {
      ...node,
      data: { ...node.data, overlayNodes: [{ id: 'mount-hud', overlay: bigOverlayId }] },
    }

    const reference = buildNodeContextReference({
      gameId: 'game-nodia-fighting',
      blueprintId: 'bp-main',
      graphPath: [],
      graph: { nodes: [bigNode], edges: [] },
      node: bigNode,
      scenario: bigScenario,
    })

    const json = JSON.stringify(reference.payload)
    expect(json.length).toBeLessThanOrEqual(30_000)
    const payload = reference.payload as Record<string, unknown>
    expect(payload.truncated).toBe(true)
    expect(payload.gameId).toBe('game-nodia-fighting')
    expect((payload.node as { id: string }).id).toBe('fight')
    expect(typeof payload.snapshot).toBe('string')
  })
})
