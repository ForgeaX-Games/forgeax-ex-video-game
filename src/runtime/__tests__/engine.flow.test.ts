import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GraphRuntime } from '../core/engine/engine'
import { registerComponent, unregisterComponent } from '../core/registry/component-registry'
import { isRenderOverlay } from '../core/engine/directives'
import type { GameGraph, GameNode, GameScenario, Reaction, SubFlowPackDef } from '../core/schema/graph-schema'
import { node, scnOf, rid } from './test-fixtures'

const callers = (rt: GraphRuntime) => rt.state.callStack.map((f) => f.callerNodeId)

// Minimal components: a presentation "float", a choice-like（副作用改由 node.data.reactions 承载）。
const COMPONENT_IDS = ['floatT', 'choiceX']
beforeEach(() => {
  registerComponent('floatT', {})
  registerComponent('choiceX', {})
})
afterEach(() => COMPONENT_IDS.forEach(unregisterComponent))


describe('exit reaction', () => {
  it('applies exit-phase reaction effects before traversing to the next node', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 100,
          reactions: [
            { when: { type: 'exit' }, do: [{ kind: 'effect', effects: [{ id: 'm', kind: 'var', varId: 'mark', op: 'add', value: 1 }] }] },
          ],
        }),
        node('b', { }),
      ],
      edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const scn = scnOf(graph, { variables: { mark: { id: 'mark', initial: 0 } } })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    expect(rt.state.vars.mark).toBe(0) // not yet — still on a
    rt.onPerformanceEnd()
    expect(rt.state.currentNodeId).toBe('b')
    expect(rt.state.vars.mark).toBe(1) // exit ran while leaving a
  })
})

describe('timed settlement advance', () => {
  it('follows the configured edge when an at settlement reaches its timestamp', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 5000,
          reactions: [{ when: { type: 'at', ms: 1200 }, do: [{ kind: 'advance', edgeId: 'e-next' }] }],
        }),
        node('b', { durationMs: 5000 }),
      ],
      edges: [{ id: 'e-next', source: 'a', target: 'b', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const rt = new GraphRuntime(graph, scnOf(graph))
    rt.start()

    rt.tick(1199)
    expect(rt.state.currentNodeId).toBe('a')
    rt.tick(1200)
    expect(rt.state.currentNodeId).toBe('b')
    expect(rt.state.traversedEdgeIds.has('e-next')).toBe(true)
  })

  it('does not advance when the configured edge has been deleted', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 5000,
          reactions: [{ when: { type: 'at', ms: 1200 }, do: [{ kind: 'advance', edgeId: 'deleted-edge' }] }],
        }),
        node('b', { durationMs: 5000 }),
      ],
      edges: [],
    }
    const rt = new GraphRuntime(graph, scnOf(graph))
    rt.start()

    rt.tick(1200)
    expect(rt.state.currentNodeId).toBe('a')
  })

  it('holds a settlement-selected edge until the configured jump timing', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 5000,
          routingSettlement: { type: 'complete' },
          reactions: [{ when: { type: 'at', ms: 1200 }, do: [{ kind: 'advance', edgeId: 'e-next' }] }],
        }),
        node('b', { durationMs: 5000 }),
      ],
      edges: [{
        id: 'e-next',
        source: 'a',
        target: 'b',
        sourceHandle: 'settlement-advance:e-next',
        targetHandle: 'in',
        data: { transition: 'onSettlement' },
      }],
    }
    const rt = new GraphRuntime(graph, scnOf(graph))
    rt.start()

    rt.tick(1200)
    expect(rt.state.currentNodeId).toBe('a')
    rt.onPerformanceEnd()
    expect(rt.state.currentNodeId).toBe('b')
  })
})

describe('looping video clock isolation', () => {
  it('finishes node calculations once when media currentTime wraps', () => {
    const graph: GameGraph = {
      nodes: [node('a', {
        durationMs: 1000,
        mediaPlayMode: 'loop',
        reactions: [{
          when: { type: 'at', ms: 950 },
          do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'mark', op: 'add', value: 1 }] }],
        }],
      })],
      edges: [],
    }
    const rt = new GraphRuntime(graph, scnOf(graph, { variables: { mark: { id: 'mark', initial: 0 } } }))
    rt.start()

    rt.tick(900)
    expect(rt.state.vars.mark).toBe(0)
    rt.tick(20) // video loop: currentTime returned to the first frame
    expect(rt.state.elapsedMs).toBe(1000)
    expect(rt.state.vars.mark).toBe(1)
    rt.tick(500)
    expect(rt.state.elapsedMs).toBe(1000)
    expect(rt.state.vars.mark).toBe(1)
  })
})

describe('element window (startMs/endMs)', () => {
  it('shows presentation at startMs and removes at endMs', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 5000,
          timeline: [
            { id: 'w', kind: 'floatT', trigger: { when: 'enter' }, window: { startMs: 2000, endMs: 4000 }, inputs: { text: 'x' } },
          ],
        }),
      ],
      edges: [],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    expect(rt.tick(1000).some(isRenderOverlay)).toBe(false) // 未到 startMs
    expect(rt.tick(2500).some((d) => isRenderOverlay(d) && d.elementId === rid('a', 'w'))).toBe(true) // 进入窗口 → 显示
    expect(rt.tick(4500).some((d) => d.type === 'removeOverlay' && d.elementId === rid('a', 'w'))).toBe(true) // 过 endMs → 移除
  })
})

describe('subProcess', () => {
  it('descends into subflow on enter and returns to continue container out', () => {
    const graph: GameGraph = {
      nodes: [
        node('wrap', {
          subProcess: {
            entry: 'sub',
            graph: { nodes: [node('sub', { durationMs: 100 })], edges: [] },
          },
          durationMs: 100,
        }),
        node('after', { }),
      ],
      edges: [{ id: 'e', source: 'wrap', target: 'after', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    // 首次进入容器 → 下钻到 sub（压栈 wrap）
    expect(rt.state.currentNodeId).toBe('sub')
    expect(callers(rt)).toEqual(['wrap'])
    // sub 演出结束 → 无出边自动弹回 wrap → 容器不重播、直接走 out → after
    rt.onPerformanceEnd()
    expect(rt.state.currentNodeId).toBe('after')
    expect(rt.state.callStack).toEqual([])
  })
})

describe('subflow pack (subFlowPack)', () => {
  it('switches to external pack graph and returns to continue container out', () => {
    const main: GameGraph = {
      nodes: [
        node('wrap', { subFlowPack: { id: 'enemy-turn', version: '1' }, durationMs: 100 }),
        node('after', { }),
      ],
      edges: [{ id: 'e', source: 'wrap', target: 'after', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const packGraph: GameGraph = {
      nodes: [node('tele', { durationMs: 100 })],
      edges: [],
    }
    const pack: SubFlowPackDef = {
      id: 'enemy-turn',
      version: '1',
      entry: 'tele',
      graph: packGraph,
    }
    const rt = new GraphRuntime(main, scnOf(main), undefined, [pack])
    rt.start()
    expect(rt.state.currentNodeId).toBe('tele')
    expect(callers(rt)).toEqual(['wrap'])
    expect(rt.state.callStack[0]?.returnGraph).toBe(main)
    // pack 图里没有 after；弹回主图后才能走到 after
    rt.onPerformanceEnd()
    expect(rt.state.currentNodeId).toBe('after')
    expect(rt.state.callStack).toEqual([])
  })

  it('resolves subFlowPack from manifest.packs (no root packs array)', () => {
    const main: GameGraph = {
      nodes: [
        node('wrap', { subFlowPack: { id: 'enemy-turn', version: '1' }, durationMs: 100 }),
        node('after', { }),
      ],
      edges: [{ id: 'e', source: 'wrap', target: 'after', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const subGraph: GameGraph = {
      nodes: [node('tele', { durationMs: 100 })],
      edges: [],
    }
    const scn = {
      ...scnOf(main),
      manifest: {
        version: 'game-video.blueprint-manifest.v1' as const,
        mainPackId: 'bp-main',
        packs: {
          'bp-main': {
            id: 'bp-main',
            title: 'main',
            entry: 'wrap',
            graph: main,
          },
          'enemy-turn': {
            id: 'enemy-turn',
            title: 'enemy',
            version: '1',
            entry: 'tele',
            graph: subGraph,
          },
        },
      },
    }
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    expect(rt.state.currentNodeId).toBe('tele')
    rt.onPerformanceEnd()
    expect(rt.state.currentNodeId).toBe('after')
  })

  it('throws when referenced pack is not loaded', () => {
    const main: GameGraph = {
      nodes: [node('wrap', { subFlowPack: { id: 'missing' } })],
      edges: [],
    }
    const scn = scnOf(main)
    const rt = new GraphRuntime(scn.graph, scn)
    expect(() => rt.start()).toThrow(/subFlowPack 'missing' is not loaded/)
  })

  it('stale pack.entry (node deleted) falls back to graph root instead of throwing', () => {
    const main: GameGraph = {
      nodes: [node('wrap', { subFlowPack: { id: 'sub', version: '1' }, durationMs: 100 })],
      edges: [],
    }
    const packGraph: GameGraph = {
      nodes: [node('n-start', { durationMs: 100 }), node('n-end', { durationMs: 100 })],
      edges: [{ id: 'e', source: 'n-start', target: 'n-end', sourceHandle: 'default', targetHandle: 'in' }],
    }
    // 模拟新建蓝图后删掉默认 entry 节点，但 pack.entry 仍写着 'entry'
    const pack: SubFlowPackDef = {
      id: 'sub',
      version: '1',
      entry: 'entry',
      graph: packGraph,
    }
    const rt = new GraphRuntime(main, scnOf(main), undefined, [pack])
    rt.start()
    expect(rt.state.currentNodeId).toBe('n-start')
  })

  it('start follows BlueprintDoc.entry even when that node is not nodes[0]', () => {
    const graph: GameGraph = {
      nodes: [
        node('later', { durationMs: 100 }),
        node('root', { durationMs: 100 }),
      ],
      edges: [{ id: 'e', source: 'root', target: 'later', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const scn: GameScenario = {
      ...scnOf(graph),
      manifest: {
        version: 'game-video.blueprint-manifest.v1',
        mainPackId: 'bp-main',
        packs: {
          'bp-main': { id: 'bp-main', title: '主蓝图', entry: 'root', graph },
        },
      },
    } as GameScenario
    const rt = new GraphRuntime(scn.graph, scn, undefined, [], 'bp-main')
    rt.start()
    expect(rt.state.currentNodeId).toBe('root')
  })
})

describe('transition component', () => {
  it('emits a transition overlay on enter (generic renderOverlay)', () => {
    registerComponent('transition', {})
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 1000,
          timeline: [{ id: 't', kind: 'transition', trigger: { when: 'enter' }, inputs: { durationMs: 500 } }],
        }),
      ],
      edges: [],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
    const dirs = rt.start()
    expect(dirs.some((d) => isRenderOverlay(d) && d.component === 'transition')).toBe(true)
    unregisterComponent('transition')
  })
})

describe('choice timeout', () => {
  it('renderOverlay carries timeoutMs/defaultEvent; empty emit falls back to defaultEvent', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          timeline: [
            {
              id: 'c',
              kind: 'choiceX',
              trigger: { when: 'enter' },
              inputs: { events: [{ id: 'a' }, { id: 'b' }], timeoutMs: 3000, defaultEvent: 'b' },
            },
          ],
        }),
        node('win', { }),
        node('lose', { }),
      ],
      edges: [
        { id: 'e-a', source: 'a', target: 'win', sourceHandle: 'a', targetHandle: 'in' },
        { id: 'e-b', source: 'a', target: 'lose', sourceHandle: 'b', targetHandle: 'in' },
      ],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
    const dirs = rt.start()
    const overlay = dirs.find((d) => isRenderOverlay(d) && d.elementId === rid('a', 'c'))
    if (!overlay || !isRenderOverlay(overlay)) throw new Error('expected renderOverlay')
    expect(overlay.inputs.timeoutMs).toBe(3000)
    expect(overlay.inputs.defaultEvent).toBe('b')
    // 模拟到点未选：emit('') → defaultEvent 'b' → lose
    rt.emitComponentEvent(rid('a', 'c'), '')
    expect(rt.state.currentNodeId).toBe('lose')
  })

  it('renderOverlay passes windowMs when timeoutMs absent', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          timeline: [
            {
              id: 'q',
              kind: 'choiceX',
              trigger: { when: 'enter' },
              inputs: { events: [{ id: 'pass' }, { id: 'fail' }], windowMs: 200, defaultEvent: 'fail' },
            },
          ],
        }),
        node('ok', {}),
        node('miss', {}),
      ],
      edges: [
        { id: 'e-p', source: 'a', target: 'ok', sourceHandle: 'pass', targetHandle: 'in' },
        { id: 'e-f', source: 'a', target: 'miss', sourceHandle: 'fail', targetHandle: 'in' },
      ],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
    const overlay = rt.start().find((d) => isRenderOverlay(d) && d.elementId === rid('a', 'q'))
    if (!overlay || !isRenderOverlay(overlay)) throw new Error('expected renderOverlay')
    expect(overlay.inputs.windowMs).toBe(200)
    expect(overlay.inputs.defaultEvent).toBe('fail')
  })
})

describe('emitComponentEvent · event 结算只读 mount.reactions（选项/通用组件结算修复的运行时证明）', () => {
  // 复现「素材属性编辑面板统一化」修复的真实运行时后果：2026-07-16 边路由统一重构曾把
  // 选项/通用组件结算误写进 node.data.reactions，但 emitComponentEvent 从头到尾只读
  // nodeOverlayMounts(node)[...].reactions（见 engine.ts:467-470），配了但从不生效。
  function seedChoiceNode(reactionsOn: 'mount' | 'legacyNode'): { graph: GameGraph; scn: GameScenario } {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 1000,
          timeline: [
            { id: 'c', kind: 'choiceX', trigger: { when: 'enter' }, inputs: { events: [{ id: 'hit' }] } },
          ],
        }),
      ],
      edges: [],
    }
    const scn = scnOf(graph, {
      entities: { 'ent-boss': { id: 'ent-boss', kind: 'boss', attrs: { hp: 700 }, attrMeta: { hp: { max: 700 } } } },
    })
    const a = scn.graph.nodes.find((n) => n.id === 'a')!
    const effects = [{ id: 'hit-fx', kind: 'attr' as const, entityId: 'ent-boss', attr: 'hp', op: 'add' as const, value: -100 }]
    if (reactionsOn === 'mount') {
      a.data.overlayNodes = [{
        overlay: 'ov-a',
        reactions: [{ when: { type: 'event', id: 'hit' }, do: [{ kind: 'effect', effects }] }],
      }]
    } else {
      a.data.reactions = [{ when: { type: 'event', id: 'hit' }, do: [{ kind: 'effect', effects }] }]
    }
    return { graph: scn.graph, scn }
  }

  it('写在 mount.reactions（新统一写入位置）：emitComponentEvent 后 effect 真的生效', () => {
    const { graph, scn } = seedChoiceNode('mount')
    const rt = new GraphRuntime(graph, scn)
    rt.start()
    rt.emitComponentEvent(rid('a', 'c'), 'hit')
    expect(rt.state.entities['ent-boss']?.attrs.hp).toBe(600)
  })

  it('写在 node.data.reactions（历史 bug 位置）：emitComponentEvent 不读它，effect 不生效', () => {
    const { graph, scn } = seedChoiceNode('legacyNode')
    const rt = new GraphRuntime(graph, scn)
    rt.start()
    rt.emitComponentEvent(rid('a', 'c'), 'hit')
    expect(rt.state.entities['ent-boss']?.attrs.hp).toBe(700)
  })
})
