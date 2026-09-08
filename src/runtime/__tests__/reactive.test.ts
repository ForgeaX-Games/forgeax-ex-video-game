import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GraphRuntime } from '../core/engine/engine'
import { registerComponent, unregisterComponent } from '../core/registry/component-registry'
import { isRenderOverlay } from '../core/engine/directives'
import type { RenderOverlayDirective } from '../core/engine/directives'
import type { GameGraph, GameNode, Overlay } from '../core/schema/graph-schema'
import { node, scnOf } from './test-fixtures'

const COMPONENT_IDS = ['floatT']
beforeEach(() => {
  registerComponent('floatT', {})
})
afterEach(() => COMPONENT_IDS.forEach(unregisterComponent))

const dmgOverlay: Overlay = {
  id: 'hud',
  children: [{
    id: 'dmgFloat',
    component: 'floatT',
    trigger: { when: 'enter' },
    inputs: {},
    layout: { left: 0.4, top: 0.2, width: 0.2, height: 0.1 },
  }],
}

describe('runtime overlay mount layout', () => {
  it('fills an omitted mount layout when a child uses the full parent stage', () => {
    const overlay: Overlay = {
      id: 'stageUi',
      children: [{
        id: 'fullStage',
        component: 'floatT',
        trigger: { when: 'enter' },
        inputs: {},
        layout: { left: 0, top: 0, width: 1, height: 1 },
      }],
    }
    const graph: GameGraph = {
      nodes: [node('a', {
        overlayNodes: [{ overlay: 'stageUi' }],
      })],
      edges: [],
    }
    const rt = new GraphRuntime(graph, scnOf(graph, {
      ui: { overlays: { stageUi: overlay } },
    }))

    const rendered = rt.start().find((directive): directive is RenderOverlayDirective => (
      isRenderOverlay(directive) && directive.elementId === 'stageUi/fullStage'
    ))

    expect(rendered?.mountLayout).toEqual({ left: 0, top: 0, width: 1, height: 1 })
  })
})

describe('watch reaction (数值变化 → spawn)', () => {
  it('keeps a spawn without ttl visible and can hide an existing node interface by mount', () => {
    const overlay: Overlay = {
      id: 'rageUi',
      children: [{ id: 'panel', component: 'floatT', trigger: { when: 'enter' }, inputs: { text: '怒气界面' } }],
    }
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 2000,
          overlayNodes: [{ id: 'boss-hud', overlay: 'rageUi' }],
          reactions: [
            { when: { type: 'at', ms: 300 }, do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'ent-boss', attr: 'rage', op: 'add', value: 20 }] }] },
            { when: { type: 'watch', of: 'entity.ent-boss.attr.rage', on: 'inc' }, do: [{ kind: 'spawn', from: 'rageUi/panel' }] },
            { when: { type: 'at', ms: 600 }, do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'ent-boss', attr: 'rage', op: 'add', value: -10 }] }] },
            { when: { type: 'watch', of: 'entity.ent-boss.attr.rage', on: 'dec' }, do: [{ kind: 'hideOverlay', mountId: 'boss-hud' }] },
          ],
        }),
      ],
      edges: [],
    }
    const rt = new GraphRuntime(graph, scnOf(graph, {
      entities: { 'ent-boss': { id: 'ent-boss', attrs: { rage: 10 } } },
      ui: { overlays: { rageUi: overlay } },
    }))

    expect(rt.start()).toContainEqual(expect.objectContaining({
      type: 'renderOverlay',
      elementId: 'boss-hud/panel',
    }))
    const shown = rt.tick(300).find((directive): directive is RenderOverlayDirective => (
      isRenderOverlay(directive) && directive.elementId.startsWith('spawn:')
    ))
    expect(shown?.component).toBe('floatT')
    expect(rt.tick(500).some((directive) => directive.type === 'removeOverlay')).toBe(false)
    expect(rt.tick(600)).toContainEqual(expect.objectContaining({
      type: 'removeOverlay',
      elementId: 'boss-hud/panel',
    }))
    expect(rt.tick(700).some((directive) => directive.type === 'removeOverlay')).toBe(false)
  })

  it('keeps a spawn action executable when a condition settlement is changed to a timed settlement', () => {
    const graph: GameGraph = {
      nodes: [node('a', {
        durationMs: 5000,
        reactions: [{
          when: { type: 'at', ms: 100 },
          do: [{ kind: 'spawn', from: 'hud/dmgFloat', inputs: { amount: 12 }, ttlMs: 800 }],
        }],
      })],
      edges: [],
    }
    const rt = new GraphRuntime(graph, scnOf(graph, { ui: { overlays: { hud: dmgOverlay } } }))
    rt.start()

    const dirs = rt.tick(100)
    const spawn = dirs.find((d): d is RenderOverlayDirective => isRenderOverlay(d) && d.elementId.startsWith('spawn:'))
    expect(spawn?.inputs.amount).toBe(12)
    expect(spawn?.mountLayout).toEqual({ left: 0.4, top: 0.2, width: 0.2, height: 0.1 })
    expect(spawn?.childLayout).toBeUndefined()
  })

  it('fires a numeric equality settlement only when the value reaches the exact target', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 5000,
          reactions: [
            { when: { type: 'at', ms: 100 }, do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'ent-player', attr: 'hp', op: 'set', value: 51 }] }] },
            { when: { type: 'at', ms: 200 }, do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'ent-player', attr: 'hp', op: 'set', value: 50 }] }] },
            {
              when: { type: 'state', condition: { all: [{ type: 'attr', entityId: 'ent-player', attr: 'hp', op: 'eq', value: 50 }] } },
              do: [{ kind: 'advance', edgeId: 'e-equal' }],
            },
          ],
        }),
        node('equal'),
      ],
      edges: [{ id: 'e-equal', source: 'a', target: 'equal', sourceHandle: 'settlement-advance:e-equal', targetHandle: 'in' }],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(graph, scn)
    rt.start()

    rt.tick(100)
    expect(rt.state.currentNodeId).toBe('a')

    rt.tick(200)
    expect(rt.state.currentNodeId).toBe('equal')
    expect(rt.state.traversedEdgeIds.has('e-equal')).toBe(true)
  })

  it('fires a non-equality state condition when it changes from false to true', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 5000,
          reactions: [
            { when: { type: 'at', ms: 100 }, do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'ent-player', attr: 'hp', op: 'set', value: 50 }] }] },
            {
              when: { type: 'state', condition: { all: [{ type: 'attr', entityId: 'ent-player', attr: 'hp', op: 'lte', value: 100 }] } },
              do: [{ kind: 'advance', edgeId: 'e-lte' }],
            },
          ],
        }),
        node('lte'),
      ],
      edges: [{ id: 'e-lte', source: 'a', target: 'lte', sourceHandle: 'settlement-advance:e-lte', targetHandle: 'in' }],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(graph, scn)
    rt.start()
    rt.tick(100)

    expect(rt.state.currentNodeId).toBe('lte')
    expect(rt.state.traversedEdgeIds.has('e-lte')).toBe(true)
  })

  it('does not repeat a state settlement while its condition remains true', () => {
    const graph: GameGraph = {
      nodes: [node('a', {
        durationMs: 5000,
        reactions: [
          { when: { type: 'at', ms: 100 }, do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'ent-player', attr: 'hp', op: 'set', value: 50 }] }] },
          { when: { type: 'at', ms: 200 }, do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'qi', op: 'add', value: 1 }] }] },
          {
            when: { type: 'state', condition: { all: [{ type: 'attr', entityId: 'ent-player', attr: 'hp', op: 'lte', value: 100 }] } },
            do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'qi', op: 'add', value: 1 }] }],
          },
        ],
      })],
      edges: [],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(graph, scn)
    rt.start()

    rt.tick(100)
    expect(rt.state.vars.qi).toBe(1)
    rt.tick(200)
    expect(rt.state.vars.qi).toBe(2)
  })

  it('routes advance to an edge in the active nested subProcess graph', () => {
    const graph: GameGraph = {
      nodes: [node('turn', { subProcess: { entry: 'atk', graph: {
        nodes: [
          node('atk', {
            durationMs: 5000,
            reactions: [
              { when: { type: 'at', ms: 100 }, do: [{ kind: 'effect', effects: [{ id: 'q', kind: 'var', varId: 'qi', op: 'add', value: 1 }] }] },
              { when: { type: 'watch', of: 'var.qi', on: 'inc' }, do: [{ kind: 'advance', edgeId: 'e-inner' }] },
            ],
          }),
          node('done', { durationMs: 100 }),
        ],
        edges: [{ id: 'e-inner', source: 'atk', target: 'done', sourceHandle: 'default', targetHandle: 'in' }],
      } } })],
      edges: [],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    rt.tick(100)

    expect(rt.state.currentNodeId).toBe('done')
    expect(rt.getActiveGraphPath()).toEqual(['turn'])
    expect(rt.state.callStack.map((frame) => frame.callerNodeId)).toEqual(['turn'])
    expect(rt.state.traversedEdgeIds.has('e-inner')).toBe(true)
  })

  it('holds a watch-selected edge until the node settlement', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 5000,
          routingSettlement: { type: 'complete' },
          reactions: [
            { when: { type: 'at', ms: 100 }, do: [{ kind: 'effect', effects: [{ id: 'q', kind: 'var', varId: 'qi', op: 'add', value: 1 }] }] },
            { when: { type: 'watch', of: 'var.qi', on: 'inc' }, do: [{ kind: 'advance', edgeId: 'e-next' }] },
          ],
        }),
        node('b', { durationMs: 100 }),
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

    rt.tick(100)
    expect(rt.state.currentNodeId).toBe('a')
    rt.onPerformanceEnd()
    expect(rt.state.currentNodeId).toBe('b')
  })

  it('spawns a transient float with abs(delta) when watched hp decreases', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 5000,
          reactions: [
            { when: { type: 'at', ms: 500 }, do: [{ kind: 'effect', effects: [{ id: 'd', kind: 'attr', entityId: 'ent-player', attr: 'hp', op: 'add', value: -20 }] }] },
            { when: { type: 'watch', of: 'entity.ent-player.attr.hp', on: 'dec' }, do: [{ kind: 'spawn', from: 'hud/dmgFloat', inputs: { amount: { expr: 'abs(delta)' } }, ttlMs: 800 }] },
          ],
        }),
      ],
      edges: [],
    }
    const scn = scnOf(graph, { ui: { overlays: { hud: dmgOverlay } } })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start() // baseline hp=300

    const dirs = rt.tick(600) // at 500 → hp-20 → watch(dec) → spawn
    const spawn = dirs.find((d): d is RenderOverlayDirective => isRenderOverlay(d) && d.elementId.startsWith('spawn:'))
    expect(spawn).toBeTruthy()
    expect(spawn!.component).toBe('floatT')
    expect(spawn!.inputs.amount).toBe(20)

    // ttl 到点自动回收
    const later = rt.tick(1600) // 600 + 800 = 1400 已过
    expect(later.some((d) => d.type === 'removeOverlay' && d.elementId === spawn!.elementId)).toBe(true)
  })

  it('spawns overlay with dmg=abs(delta) and remain=entity read', () => {
    const cheer: Overlay = {
      id: 'hitCheer',
      children: [{ id: 'banner', component: 'floatT', trigger: { when: 'enter' }, inputs: { heroName: '空藏' } }],
    }
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 5000,
          reactions: [
            { when: { type: 'at', ms: 500 }, do: [{ kind: 'effect', effects: [{ id: 'd', kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -40 }] }] },
            { when: { type: 'watch', of: 'entity.ent-boss.attr.hp', on: 'dec' }, do: [{ kind: 'spawn', from: 'hitCheer/banner', inputs: { dmg: { expr: 'abs(delta)' }, remain: { expr: 'entity.ent-boss.attr.hp' }, heroName: '空藏' }, ttlMs: 3000 }] },
          ],
        }),
      ],
      edges: [],
    }
    const scn = scnOf(graph, {
      ui: { overlays: { hitCheer: cheer } },
    })
    const rt = new GraphRuntime(scn.graph, scn) // boss hp=700
    rt.start()
    const dirs = rt.tick(600) // hp 700→660, dec
    const spawn = dirs.find((d): d is RenderOverlayDirective => isRenderOverlay(d) && d.elementId.startsWith('spawn:'))
    expect(spawn).toBeTruthy()
    expect(spawn!.component).toBe('floatT')
    expect(spawn!.inputs.dmg).toBe(40)
    expect(spawn!.inputs.remain).toBe(660)
    expect(spawn!.inputs.heroName).toBe('空藏')
  })

  it('heroName resolves dynamically from entity name via { ref } (rename-safe, not hardcoded)', () => {
    const cheer: Overlay = {
      id: 'hitCheer',
      children: [{ id: 'banner', component: 'floatT', trigger: { when: 'enter' }, inputs: {} }],
    }
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 5000,
          reactions: [
            { when: { type: 'at', ms: 500 }, do: [{ kind: 'effect', effects: [{ id: 'd', kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -10 }] }] },
            { when: { type: 'watch', of: 'entity.ent-boss.attr.hp', on: 'dec' }, do: [{ kind: 'spawn', from: 'hitCheer/banner', inputs: { heroName: { ref: 'entity.ent-player.name' } }, ttlMs: 3000 }] },
          ],
        }),
      ],
      edges: [],
    }
    const scn = scnOf(graph, {
      ui: { overlays: { hitCheer: cheer } },
      entities: { 'ent-player': { id: 'ent-player', kind: 'player', name: '苏鹤', attrs: { hp: 300 }, attrMeta: { hp: { max: 300 } } } },
    })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    const dirs = rt.tick(600)
    const spawn = dirs.find((d): d is RenderOverlayDirective => isRenderOverlay(d) && d.elementId.startsWith('spawn:'))
    expect(spawn!.inputs.heroName).toBe('苏鹤') // 跟随实体名，非写死
  })

  it('does not fire when direction mismatches (on=inc but value decreased)', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 5000,
          reactions: [
            { when: { type: 'at', ms: 500 }, do: [{ kind: 'effect', effects: [{ id: 'd', kind: 'attr', entityId: 'ent-player', attr: 'hp', op: 'add', value: -20 }] }] },
            { when: { type: 'watch', of: 'entity.ent-player.attr.hp', on: 'inc' }, do: [{ kind: 'spawn', from: 'hud/dmgFloat', ttlMs: 800 }] },
          ],
        }),
      ],
      edges: [],
    }
    const scn = scnOf(graph, { ui: { overlays: { hud: dmgOverlay } } })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    const dirs = rt.tick(600)
    expect(dirs.some((d) => isRenderOverlay(d) && d.elementId.startsWith('spawn:'))).toBe(false)
  })
})

describe('timed settlement locals (结算绑定界面)', () => {
  const spawnOf = (dirs: ReturnType<GraphRuntime['tick']>): RenderOverlayDirective | undefined =>
    dirs.find((d): d is RenderOverlayDirective => isRenderOverlay(d) && d.elementId.startsWith('spawn:'))

  const timedNode = (
    doActions: NonNullable<GameNode['data']['reactions']>[number]['do'],
    extra: Record<string, unknown> = {},
  ): GameNode => node('a', {
    durationMs: 5000,
    reactions: [{ when: { type: 'at', ms: 500 }, do: doActions }],
    ...extra,
  })

  const runTimed = (doActions: NonNullable<GameNode['data']['reactions']>[number]['do']) => {
    const graph: GameGraph = { nodes: [timedNode(doActions)], edges: [] }
    const scn = scnOf(graph, { ui: { overlays: { hud: dmgOverlay } } })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    return spawnOf(rt.tick(600))
  }

  it('injects observed prev/next/delta into a spawn in the same timed settlement', () => {
    const spawn = runTimed([
      { kind: 'effect', effects: [{ id: 'd', kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -40 }] },
      {
        kind: 'spawn',
        from: 'hud/dmgFloat',
        inputs: { dmg: { expr: 'abs(delta)' }, before: { expr: 'prev' }, after: { expr: 'next' } },
        ttlMs: 800,
      },
    ])

    expect(spawn?.inputs.dmg).toBe(40)
    expect(spawn?.inputs.before).toBe(700)
    expect(spawn?.inputs.after).toBe(660)
  })

  it('reports the clamped change rather than the authored effect value', () => {
    // qi 的 varMeta 上限是 9：作者写 +20，实际只涨 9。
    const spawn = runTimed([
      { kind: 'effect', effects: [{ id: 'q', kind: 'var', varId: 'qi', op: 'add', value: 20 }] },
      { kind: 'spawn', from: 'hud/dmgFloat', inputs: { gain: { expr: 'delta' } }, ttlMs: 800 },
    ])

    expect(spawn?.inputs.gain).toBe(9)
  })

  it('describes the last effect entry when one action writes several targets', () => {
    const spawn = runTimed([
      {
        kind: 'effect',
        effects: [
          { id: 'q', kind: 'var', varId: 'qi', op: 'add', value: 3 },
          { id: 'd', kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -25 },
        ],
      },
      { kind: 'spawn', from: 'hud/dmgFloat', inputs: { dmg: { expr: 'abs(delta)' } }, ttlMs: 800 },
    ])

    expect(spawn?.inputs.dmg).toBe(25)
  })

  it('reports zero delta when the spawn precedes the effect', () => {
    const spawn = runTimed([
      { kind: 'spawn', from: 'hud/dmgFloat', inputs: { dmg: { expr: 'abs(delta)' } }, ttlMs: 800 },
      { kind: 'effect', effects: [{ id: 'd', kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -40 }] },
    ])

    expect(spawn?.inputs.dmg).toBe(0)
  })

  it('reports zero delta when a once effect was already consumed', () => {
    const consumed = { id: 'once-q', kind: 'var', varId: 'qi', op: 'add', value: 1, once: true } as const
    const graph: GameGraph = {
      nodes: [node('a', {
        durationMs: 5000,
        reactions: [
          { when: { type: 'at', ms: 100 }, do: [{ kind: 'effect', effects: [consumed] }] },
          {
            when: { type: 'at', ms: 500 },
            do: [
              { kind: 'effect', effects: [consumed] },
              { kind: 'spawn', from: 'hud/dmgFloat', inputs: { gain: { expr: 'delta' } }, ttlMs: 800 },
            ],
          },
        ],
      })],
      edges: [],
    }
    const scn = scnOf(graph, { ui: { overlays: { hud: dmgOverlay } } })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()

    const spawn = spawnOf(rt.tick(600))
    expect(rt.state.vars.qi).toBe(1)
    expect(spawn?.inputs.gain).toBe(0)
  })

  it('does not leak locals from a flag effect that has no numeric target', () => {
    const spawn = runTimed([
      { kind: 'effect', effects: [{ id: 'd', kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -40 }] },
      { kind: 'effect', effects: [{ id: 'f', kind: 'flag', varId: 'lotusClue', value: true }] },
      { kind: 'spawn', from: 'hud/dmgFloat', inputs: { dmg: { expr: 'abs(delta)' } }, ttlMs: 800 },
    ])

    expect(spawn?.inputs.dmg).toBe(0)
  })
})

describe('container watch spans subflow (我方回合 场景)', () => {
  it('fires a watch declared on the subflow container while a child node deals damage', () => {
    const cheer: Overlay = {
      id: 'hitCheer',
      children: [{ id: 'banner', component: 'floatT', trigger: { when: 'enter' }, inputs: {} }],
    }
    const graph: GameGraph = {
      nodes: [
        // 容器（我方回合）：下钻到技能节点 atk；容器上挂 watch。
        node('turn', {
          subProcess: {
            entry: 'atk',
            graph: { nodes: [node('atk', {
              durationMs: 5000,
              reactions: [
                { when: { type: 'at', ms: 500 }, do: [{ kind: 'effect', effects: [{ id: 'd', kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -30 }] }] },
              ],
            })], edges: [] },
          },
          reactions: [
            { when: { type: 'watch', of: 'entity.ent-boss.attr.hp', on: 'dec' }, do: [{ kind: 'spawn', from: 'hitCheer/banner', inputs: { dmg: { expr: 'abs(delta)' } }, ttlMs: 3000 }] },
          ],
        }),
        node('done', {}),
      ],
      edges: [{ id: 'e', source: 'turn', target: 'done', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const scn = scnOf(graph, { ui: { overlays: { hitCheer: cheer } } })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    expect(rt.state.currentNodeId).toBe('atk') // 下钻进技能节点

    const dirs = rt.tick(600) // atk 扣 boss 30 → 容器 watch 生效 → spawn
    const spawn = dirs.find((d): d is RenderOverlayDirective => isRenderOverlay(d) && d.elementId.startsWith('spawn:'))
    expect(spawn).toBeTruthy()
    expect(spawn!.component).toBe('floatT')
    expect(spawn!.inputs.dmg).toBe(30)
  })
})

describe('non-blocking component events (回合按钮面板)', () => {
  it('container-mounted panel: click routes to mount event reaction (spawn / effect), 不阻塞', () => {
    const panel: Overlay = {
      id: 'hpPanel',
      children: [
        { id: 'panelA', component: 'floatT', trigger: { when: 'enter' }, inputs: {} },
        { id: 'panelB', component: 'floatT', trigger: { when: 'enter' }, inputs: {} },
      ],
    }
    const readouts: Overlay = {
      id: 'readouts',
      children: [{ id: 'bossHp', component: 'floatT', trigger: { when: 'enter' }, inputs: {} }],
    }
    const graph: GameGraph = {
      nodes: [
        node('turn', {
          subProcess: { entry: 'atk', graph: { nodes: [node('atk', { durationMs: 5000 })], edges: [] } },
          overlayNodes: [{
            overlay: 'hpPanel',
            reactions: [
              { when: { type: 'event', id: 'A' }, do: [{ kind: 'spawn', from: 'readouts/bossHp', inputs: { text: { expr: 'entity.ent-boss.attr.hp' } }, ttlMs: 1500 }] },
              { when: { type: 'event', id: 'B2' }, do: [{ kind: 'effect', effects: [{ id: 'q', kind: 'var', varId: 'qi', op: 'add', value: 2 }] }] },
            ],
          }],
        }),
      ],
      edges: [],
    }
    const scn = scnOf(graph, { ui: { overlays: { hpPanel: panel, readouts } } })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    expect(rt.state.currentNodeId).toBe('atk') // 下钻进技能节点，turn 在调用栈

    // 面板由容器挂载 → 在子流程节点内可见（childrenOf 继承容器 children）
    expect(rt['childrenOf'](rt['node']('atk')).some((c: { id: string }) => c.id === 'hpPanel/panelA')).toBe(true)

    // 点击 A → 非阻塞事件 → spawn boss 血量读数
    const dirsA = rt.emitComponentEvent('hpPanel/panelA', 'A')
    const spawn = dirsA.find((d): d is RenderOverlayDirective => isRenderOverlay(d) && d.elementId.startsWith('spawn:'))
    expect(spawn).toBeTruthy()
    expect(spawn!.inputs.text).toBe(700) // 小怪当前血量
    expect(rt.state.phase).toBe('playing') // 未阻塞

    // 点击 B2 → 英雄气力 +2
    rt.emitComponentEvent('hpPanel/panelB', 'B2')
    expect(rt.state.vars.qi).toBe(2)
  })

  it('panel button with goto: click jumps to target node (硬跳转)', () => {
    const panel: Overlay = {
      id: 'hpPanel',
      children: [{ id: 'panelB', component: 'floatT', trigger: { when: 'enter' }, inputs: {} }],
    }
    const graph: GameGraph = {
      nodes: [
        node('turn', {
          subProcess: { entry: 'atk', graph: { nodes: [node('atk', { durationMs: 5000 })], edges: [] } },
          overlayNodes: [{ overlay: 'hpPanel', reactions: [{ when: { type: 'event', id: 'B3' }, do: [{ kind: 'advance', edgeId: 'e-drink' }] }] }],
        }),
        node('drink', {}),
      ],
      edges: [{ id: 'e-drink', source: 'turn', target: 'drink', sourceHandle: 'B3', targetHandle: 'in' }],
    }
    const scn = scnOf(graph, { ui: { overlays: { hpPanel: panel } } })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    expect(rt.state.currentNodeId).toBe('atk')
    rt.emitComponentEvent('hpPanel/panelB', 'B3') // → goto drink
    expect(rt.state.currentNodeId).toBe('drink')
    expect(rt.state.callStack).toEqual([]) // 硬跳转清栈
  })
})

describe('lifecycle reactions (shown / hidden)', () => {
  it('fires shown on mount and hidden on node exit', () => {
    const overlay: Overlay = {
      id: 'hud2',
      children: [{ id: 'banner', component: 'floatT', trigger: { when: 'enter' }, inputs: {} }],
    }
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 100,
          overlayNodes: [{ overlay: 'hud2' }],
          reactions: [
            { when: { type: 'shown', of: 'banner' }, do: [{ kind: 'effect', effects: [{ id: 's', kind: 'var', varId: 'qi', op: 'set', value: 1 }] }] },
            { when: { type: 'hidden', of: 'banner' }, do: [{ kind: 'effect', effects: [{ id: 'h', kind: 'var', varId: 'qi', op: 'set', value: 5 }] }] },
          ],
        }),
        node('b', {}),
      ],
      edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const scn = scnOf(graph, { ui: { overlays: { hud2: overlay } } })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start() // banner mount → shown
    expect(rt.state.vars.qi).toBe(1)

    rt.onPerformanceEnd() // 演出结束 → 走边 → runExit(a) → banner unmount → hidden
    expect(rt.state.currentNodeId).toBe('b')
    expect(rt.state.vars.qi).toBe(5)
  })
})
