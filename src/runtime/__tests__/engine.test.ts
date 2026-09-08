import { afterEach, describe, expect, it } from 'vitest'
import { GraphRuntime } from '../core/engine/engine'
import { registerComponent, unregisterComponent } from '../core/registry/component-registry'
import { isRenderOverlay } from '../core/engine/directives'
import type { GameGraph, GameNode, GameScenario } from '../core/schema/graph-schema'
import { node, scnOf, rid } from './test-fixtures'

const COMPONENT_IDS = ['floatT', 'qteT']
afterEach(() => COMPONENT_IDS.forEach(unregisterComponent))

function registerCore() {
  registerComponent('floatT', {})
  registerComponent('qteT', {
    events: [{ id: 'pass' }, { id: 'good' }, { id: 'fail' }],
  })
}


describe('GraphRuntime advance', () => {
  it('auto edge advance on performanceEnd', () => {
    const graph: GameGraph = {
      nodes: [node('a', { durationMs: 100 }), node('b', { })],
      edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    expect(rt.state.currentNodeId).toBe('a')
    rt.onPerformanceEnd()
    expect(rt.state.currentNodeId).toBe('b')
    expect(rt.state.traversedEdgeIds.has('e')).toBe(true)
  })

  it('performanceEnd 先冲刷 trigger.at=durationMs（video_end 选项才会挂上）', () => {
    registerComponent('choice', {
      events: [{ id: 'ying' }, { id: 'mo' }],
    })
    const graph: GameGraph = {
      nodes: [
        node('river', {
          durationMs: 1500,
          media: { kind: 'VIDEO', ref: 'clip' },
          overlayNodes: [{ overlay: 'ov-river' }],
        }),
        node('next', {}),
      ],
      edges: [
        { id: 'e-ying', source: 'river', target: 'next', sourceHandle: 'ying', targetHandle: 'in' },
        { id: 'e-mo', source: 'river', target: 'next', sourceHandle: 'mo', targetHandle: 'in' },
      ],
    }
    const scn = scnOf(graph, {
      ui: {
        overlays: {
          'ov-river': {
            id: 'ov-river',
            children: [
              {
                id: 'ym',
                component: 'choice',
                trigger: { when: 'at', ms: 1500 },
                inputs: {
                  events: [
                    { id: 'ying', label: '應' },
                    { id: 'mo', label: '默' },
                  ],
                  timeoutMs: 8000,
                  defaultEvent: 'mo',
                },
              },
            ],
          },
        },
      },
    })
    const rt = new GraphRuntime(scn.graph, scn)
    const dirsStart = rt.start()
    // 进节点时 at=1500 尚未触发
    expect(dirsStart.filter(isRenderOverlay).some((d) => d.elementId === 'ov-river/ym' || d.elementId === 'ym')).toBe(false)
    // 模拟视频 onEnded：不经过 tick(1500)，直接 performanceEnd
    const dirsEnd = rt.onPerformanceEnd()
    expect(rt.state.currentNodeId).toBe('river') // 仅有 event 边 → 停住等待
    expect(dirsEnd.filter(isRenderOverlay).some((d) => d.elementId.endsWith('/ym') || d.elementId === 'ym')).toBe(true)
    unregisterComponent('choice')
  })

  it('conditional gateway routes by hp (instant node)', () => {
    const bothAlive = { all: [
      { type: 'attrRatio' as const, entityId: 'ent-player', attr: 'hp', op: 'gt' as const, value: 0 },
      { type: 'attrRatio' as const, entityId: 'ent-boss', attr: 'hp', op: 'gt' as const, value: 0 },
    ] }
    const mk = (): GameGraph => ({
      nodes: [node('round'), node('init', { }), node('settle', { })],
      edges: [
        { id: 'r-next', source: 'round', target: 'init', sourceHandle: 'default', targetHandle: 'in', data: { condition: bothAlive } },
        { id: 'r-over', source: 'round', target: 'settle', sourceHandle: 'default', targetHandle: 'in' },
      ],
    })
    // both alive → init
    const g1 = mk()
    const scn1 = scnOf(g1)
    const rt1 = new GraphRuntime(scn1.graph, scn1)
    rt1.start()
    expect(rt1.state.currentNodeId).toBe('init')
    // boss dead → settle
    const g2 = mk()
    const scn2 = scnOf(g2, {
      entities: {
        'ent-player': { id: 'ent-player', kind: 'player', attrs: { hp: 300 }, attrMeta: { hp: { max: 300 } } },
        'ent-boss': { id: 'ent-boss', kind: 'boss', attrs: { hp: 0 }, attrMeta: { hp: { max: 700 } } },
      },
    })
    const rt2 = new GraphRuntime(scn2.graph, scn2)
    rt2.start()
    expect(rt2.state.currentNodeId).toBe('settle')
  })

  it('tick fires at-reaction effect + at-element in time order', () => {
    registerCore()
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 2000,
          reactions: [
            { when: { type: 'at', ms: 500 }, do: [{ kind: 'effect', effects: [{ id: 'q', kind: 'var', varId: 'qi', op: 'add', value: 1 }] }] },
          ],
          timeline: [
            { id: 'f', kind: 'floatT', trigger: { when: 'at', ms: 1000 }, inputs: { text: '+1' } },
          ],
        }),
      ],
      edges: [],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    const d1 = rt.tick(600)
    expect(rt.state.vars.qi).toBe(1) // at:500 reaction fired
    expect(d1.some(isRenderOverlay)).toBe(false) // float not yet
    const d2 = rt.tick(1100)
    expect(d2.some((d) => isRenderOverlay(d) && d.component === 'floatT')).toBe(true)
  })

  it('interaction resolve routes by outcome handle', () => {
    registerCore()
    const graph: GameGraph = {
      nodes: [
        node('a', { timeline: [{ id: 'q', kind: 'qteT', trigger: { when: 'enter' }, inputs: {} }] }),
        node('win', { }),
        node('lose', { }),
      ],
      edges: [
        { id: 'e-pass', source: 'a', target: 'win', sourceHandle: 'pass', targetHandle: 'in' },
        { id: 'e-fail', source: 'a', target: 'lose', sourceHandle: 'fail', targetHandle: 'in' },
      ],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
    const dirs = rt.start()
    expect(dirs.some((d) => isRenderOverlay(d) && d.component === 'qteT')).toBe(true)
    expect(rt.state.phase).toBe('playing')
    rt.emitComponentEvent(rid('a', 'q'), 'pass')
    expect(rt.state.currentNodeId).toBe('win')
  })

  it('onSettlement event waits for performance end and overrides the default edge', () => {
    registerCore()
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 1000,
          timeline: [{ id: 'q', kind: 'qteT', trigger: { when: 'enter' }, inputs: {} }],
        }),
        node('picked', {}),
        node('fallback', {}),
      ],
      edges: [
        { id: 'e-picked', source: 'a', target: 'picked', sourceHandle: 'pass', targetHandle: 'in', data: { transition: 'onSettlement' } },
        { id: 'e-default', source: 'a', target: 'fallback', sourceHandle: 'default', targetHandle: 'in' },
      ],
    }
    const scn = scnOf(graph)
    scn.graph.nodes[0]!.data.overlayNodes![0]!.reactions = [{
      when: { type: 'event', id: 'pass' },
      do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'qi', op: 'add', value: 2 }] }],
    }]
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    rt.emitComponentEvent(rid('a', 'q'), 'pass')
    expect(rt.state.currentNodeId).toBe('a')
    expect(rt.state.vars.qi).toBe(2)
    expect(rt.state.traversedEdgeIds.has('e-picked')).toBe(false)

    rt.onPerformanceEnd()
    expect(rt.state.currentNodeId).toBe('picked')
    expect(rt.state.traversedEdgeIds.has('e-default')).toBe(false)
  })

  it('at settlement commits the selected edge when the node clock reaches the configured time', () => {
    registerCore()
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 2000,
          routingSettlement: { type: 'at', ms: 500 },
          timeline: [{ id: 'q', kind: 'qteT', trigger: { when: 'enter' }, inputs: {} }],
        }),
        node('picked', {}),
        node('fallback', {}),
      ],
      edges: [
        { id: 'e-picked', source: 'a', target: 'picked', sourceHandle: 'pass', targetHandle: 'in', data: { transition: 'onSettlement' } },
        { id: 'e-default', source: 'a', target: 'fallback', sourceHandle: 'default', targetHandle: 'in' },
      ],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    rt.emitComponentEvent(rid('a', 'q'), 'pass')
    rt.tick(499)
    expect(rt.state.currentNodeId).toBe('a')
    rt.tick(500)
    expect(rt.state.currentNodeId).toBe('picked')
  })

  it('at settlement takes the default edge when no event was selected', () => {
    registerCore()
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 2000,
          routingSettlement: { type: 'at', ms: 500 },
          timeline: [{ id: 'q', kind: 'qteT', trigger: { when: 'enter' }, inputs: {} }],
        }),
        node('picked', {}),
        node('fallback', {}),
      ],
      edges: [
        { id: 'e-picked', source: 'a', target: 'picked', sourceHandle: 'pass', targetHandle: 'in', data: { transition: 'onSettlement' } },
        { id: 'e-default', source: 'a', target: 'fallback', sourceHandle: 'default', targetHandle: 'in' },
      ],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    rt.tick(500)
    expect(rt.state.currentNodeId).toBe('fallback')
  })

  it('performance end crossing an at settlement does not advance the entered target again', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', { durationMs: 2000, routingSettlement: { type: 'at', ms: 500 } }),
        node('fallback', { durationMs: 1000 }),
        node('after', { durationMs: 1000 }),
      ],
      edges: [
        { id: 'e-default', source: 'a', target: 'fallback', sourceHandle: 'default', targetHandle: 'in' },
        { id: 'e-after', source: 'fallback', target: 'after', sourceHandle: 'default', targetHandle: 'in' },
      ],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    rt.onPerformanceEnd()
    expect(rt.state.currentNodeId).toBe('fallback')
  })

  it('jumpToNode seeks preserving globals by default', () => {
    registerCore()
    const graph: GameGraph = {
      nodes: [node('a', { durationMs: 100 }), node('b', { durationMs: 100 }), node('c', { durationMs: 100 })],
      edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    rt.state.vars.qi = 4
    rt.jumpToNode('c')
    expect(rt.state.currentNodeId).toBe('c')
    expect(rt.state.vars.qi).toBe(4) // preserved
  })
})
