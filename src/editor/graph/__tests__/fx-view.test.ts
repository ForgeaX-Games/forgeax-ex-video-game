import { describe, expect, it } from 'vitest'
import { toFXView } from '../canvas/fx-view'
import { NODIA_FIXTURE } from '@/editor/demo/__tests__/fixtures/nodia-fixture'
import { getSubProcess } from '@/runtime/core/schema/graph-schema'

const overlays = () => NODIA_FIXTURE.ui?.overlays
const processGraph = (id: string) => getSubProcess(NODIA_FIXTURE.graph.nodes.find((n) => n.id === id)!.data)!.graph

describe('toFXView', () => {
  it('derives handles: narrative handoff has a default output; wait has skill event outputs', () => {
    const rootFx = toFXView(NODIA_FIXTURE.graph, overlays())
    const handoff = rootFx.nodes.find((n) => n.id === 'n_nolotus')!
    const outIds = handoff.outputs.map((h) => h.data?.flowId)
    expect(outIds).toContain('default')

    const attackFx = toFXView(processGraph('a_my'), overlays())
    const wait = attackFx.nodes.find((n) => n.id === 'wait')!
    const wOut = wait.outputs.map((h) => h.data?.flowId)
    expect(wOut).toContain('light')
    expect(wOut).toContain('heavy')
    expect(wOut).toContain('ult')
  })

  it('every node has a single input handle; edges carry source/target handles', () => {
    const fx = toFXView(NODIA_FIXTURE.graph, overlays())
    expect(fx.nodes.every((n) => n.inputs.length === 1 && n.inputs[0]!.data?.flowId === 'in')).toBe(true)
    const e = fx.edges.find((x) => x.source === 'n_nolotus' && x.target === 'a_my')!
    expect(e.sourceHandle).toBe('source:default')
    expect(e.targetHandle).toBe('target:in')
  })

  it('output handles preserve stable flow labels without a catalog', () => {
    const fx = toFXView(processGraph('a_my'), overlays())
    const wait = fx.nodes.find((n) => n.id === 'wait')!
    const light = wait.outputs.find((h) => h.data?.flowId === 'light')!
    expect(light.label).toBe('light')
    expect(light.data?.displayLabel).toBe('light')
    const handoff = toFXView(NODIA_FIXTURE.graph, overlays()).nodes.find((n) => n.id === 'n_nolotus')!
    const def = handoff.outputs.find((h) => h.data?.flowId === 'default')!
    expect(def.label).toBe('默认推进')
  })

  it('leaf / container badges from overlayNode / subProcess', () => {
    const fx = toFXView(NODIA_FIXTURE.graph, overlays())
    expect(fx.nodes.find((n) => n.id === 'win')!.type).toBe('default')
    expect(fx.nodes.find((n) => n.id === 'b_ai')!.data.badge).toBeTruthy()
    const tele = toFXView(processGraph('b_ai'), overlays()).nodes.find((n) => n.id === 'tele')!
    // 有 overlay 则 badge=overlay；否则空（旧 qte-on-timeline 已迁走）
    expect(['overlay', '']).toContain(tele.data.badge)
  })

  it('nodes missing position still render via autoLayout', () => {
    const fx = toFXView({
      nodes: [
        { id: 'a', type: 'perf', position: { x: 80, y: 80 }, inputs: [], outputs: [], data: { name: 'a' } },
        { id: 'b', type: 'perf', inputs: [], outputs: [], data: { name: 'b' } } as unknown as typeof NODIA_FIXTURE.graph.nodes[0],
      ],
      edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'default', targetHandle: 'in' }],
    }, overlays())
    expect(fx.nodes.find((n) => n.id === 'b')!.position.x).toBeGreaterThan(0)
  })
})
