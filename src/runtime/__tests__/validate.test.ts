import { describe, expect, it } from 'vitest'
import { validateGraph } from '../core/validate/validate'
import type { GameGraph, GameNode, Overlay } from '../core/schema/graph-schema'

function perf(id: string, componentIds: string[] = []): { node: GameNode; overlays: Record<string, Overlay> } {
  const oid = `ov-${id}`
  const overlays: Record<string, Overlay> = {
    [oid]: {
      id: oid,
      children: componentIds.map((c, i) => ({
        id: `${id}-e${i}`,
        component: c,
        trigger: { when: 'enter' as const },
        inputs: {},
      })),
    },
  }
  const node: GameNode = {
    id,
    type: 'perf',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [],
    data: { name: id, ...(componentIds.length ? { overlayNodes: [{ overlay: oid }] } : {}) },
  }
  return { node, overlays }
}

describe('validateGraph', () => {
  it('valid graph → no issues', () => {
    const a = perf('a')
    const b = perf('b')
    const g: GameGraph = {
      nodes: [a.node, b.node],
      edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'default', targetHandle: 'in' }],
    }
    expect(validateGraph(g, { overlays: { ...a.overlays, ...b.overlays } })).toEqual([])
  })

  it('dangling edge target → error', () => {
    const a = perf('a')
    const g: GameGraph = {
      nodes: [a.node],
      edges: [{ id: 'e1', source: 'a', target: 'ghost', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const issues = validateGraph(g, { overlays: a.overlays })
    expect(issues.filter((i) => i.level === 'error')).toHaveLength(1)
    expect(issues[0]!.code).toBe('edge.target.missing')
  })

  it('strictly rejects non-stable catalog event keys and advance actions', () => {
    const a = perf('a', ['qte'])
    const overlay = Object.values(a.overlays)[0]!
    overlay.children[0]!.inputs = { events: [{ id: 'pass' }] }
    ;(overlay as unknown as { reactions: unknown }).reactions = [
      {
        when: { type: 'event', id: 'pass' },
        do: [{ kind: 'advance', edgeId: 'e1' }],
      },
    ]
    const issues = validateGraph({ nodes: [a.node], edges: [] }, { overlays: a.overlays })
    expect(issues.map((issue) => issue.code)).toContain('overlay.reaction.event.missing')
    expect(issues.map((issue) => issue.code)).toContain('overlay.reaction.action.kind')
  })

  it('accepts strict childId:eventId catalog effect/spawn actions', () => {
    const a = perf('a', ['qte'])
    const overlay = Object.values(a.overlays)[0]!
    overlay.children[0]!.inputs = { events: [{ id: 'pass' }] }
    overlay.reactions = [{
      when: { type: 'event', id: 'a-e0:pass' },
      do: [
        { kind: 'effect', effects: [] },
        { kind: 'spawn', from: 'ov-a/a-e0' },
      ],
    }]
    const issues = validateGraph({ nodes: [a.node], edges: [] }, { overlays: a.overlays })
    expect(issues.filter((issue) => issue.code.startsWith('overlay.reaction'))).toEqual([])
  })

  it('validates node reaction spawn template references', () => {
    const a = perf('a')
    a.node.data.reactions = [{
      when: { type: 'watch', of: 'score', on: 'change' },
      do: [{ kind: 'spawn', from: 'hud/missing' }],
    }]
    const overlays: Record<string, Overlay> = {
      hud: {
        id: 'hud',
        children: [{ id: 'rage', component: 'test.float', trigger: { when: 'enter' }, inputs: {} }],
      },
    }

    const issues = validateGraph({ nodes: [a.node], edges: [] }, { overlays })
    expect(issues.map((issue) => issue.code)).toContain('ref.spawn.missing')

    a.node.data.reactions[0]!.do = [{ kind: 'spawn', from: 'hud/rage' }]
    expect(validateGraph({ nodes: [a.node], edges: [] }, { overlays }).map((issue) => issue.code)).not.toContain('ref.spawn.missing')
  })

  describe('spawn locals (delta / prev / next)', () => {
    const overlays: Record<string, Overlay> = {
      hud: {
        id: 'hud',
        children: [{ id: 'rage', component: 'test.float', trigger: { when: 'enter' }, inputs: {} }],
      },
    }
    const codesFor = (reactions: NonNullable<GameNode['data']['reactions']>): string[] => {
      const a = perf('a')
      a.node.data.reactions = reactions
      return validateGraph({ nodes: [a.node], edges: [] }, { overlays, entities: ['ent-boss'] })
        .map((issue) => issue.code)
    }

    it('rejects a timed settlement spawn reading delta with no effect before it', () => {
      expect(codesFor([{
        when: { type: 'at', ms: 300 },
        do: [{ kind: 'spawn', from: 'hud/rage', inputs: { dmg: { expr: 'abs(delta)' } } }],
      }])).toContain('ref.spawn.locals.unavailable')
    })

    it('accepts a timed settlement spawn reading delta after a numeric effect', () => {
      expect(codesFor([{
        when: { type: 'at', ms: 300 },
        do: [
          { kind: 'effect', effects: [{ kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -10 }] },
          { kind: 'spawn', from: 'hud/rage', inputs: { dmg: { expr: 'abs(delta)' } } },
        ],
      }])).not.toContain('ref.spawn.locals.unavailable')
    })

    it('rejects delta after a flag effect, which has no numeric target to sample', () => {
      expect(codesFor([{
        when: { type: 'at', ms: 300 },
        do: [
          { kind: 'effect', effects: [{ kind: 'flag', varId: 'lotusClue', value: true }] },
          { kind: 'spawn', from: 'hud/rage', inputs: { dmg: { expr: 'abs(delta)' } } },
        ],
      }])).toContain('ref.spawn.locals.unavailable')
    })

    it('accepts delta in a watch reaction, where the engine supplies it from the watched value', () => {
      expect(codesFor([{
        when: { type: 'watch', of: 'score', on: 'change' },
        do: [{ kind: 'spawn', from: 'hud/rage', inputs: { dmg: { expr: 'abs(delta)' } } }],
      }])).not.toContain('ref.spawn.locals.unavailable')
    })

    it('rejects delta in a state reaction, where the engine supplies no locals', () => {
      expect(codesFor([{
        when: { type: 'state', condition: { all: [{ type: 'score', op: 'gte', value: 1 }] } },
        do: [{ kind: 'spawn', from: 'hud/rage', inputs: { dmg: { expr: 'abs(delta)' } } }],
      }])).toContain('ref.spawn.locals.unavailable')
    })

    it('does not mistake a dotted reference for a bare local', () => {
      expect(codesFor([{
        when: { type: 'at', ms: 300 },
        do: [{ kind: 'spawn', from: 'hud/rage', inputs: { hp: { expr: 'entity.ent-boss.attr.hp' } } }],
      }])).not.toContain('ref.spawn.locals.unavailable')
    })
  })

  it('validates that hideOverlay targets an existing interface mount in the same node', () => {
    const valid = perf('valid')
    valid.node.data.overlayNodes = [{ id: 'boss-hud', overlay: 'hud' }]
    valid.node.data.reactions = [
      { when: { type: 'watch', of: 'score', on: 'dec' }, do: [{ kind: 'hideOverlay', mountId: 'boss-hud' }] },
    ]
    const invalid = perf('invalid')
    invalid.node.data.reactions = [
      { when: { type: 'watch', of: 'score', on: 'dec' }, do: [{ kind: 'hideOverlay', mountId: 'missing-ui' }] },
    ]
    const overlays: Record<string, Overlay> = {
      hud: {
        id: 'hud',
        children: [{ id: 'rage', component: 'test.float', trigger: { when: 'enter' }, inputs: {} }],
      },
    }

    expect(validateGraph({ nodes: [valid.node], edges: [] }, { overlays }).map((issue) => issue.code))
      .not.toContain('ref.hideOverlay.mount.missing')
    expect(validateGraph({ nodes: [invalid.node], edges: [] }, { overlays }).map((issue) => issue.code))
      .toContain('ref.hideOverlay.mount.missing')
  })

  it('rejects invalid routing settlement data', () => {
    const a = perf('a')
    const b = perf('b')
    ;(a.node.data as unknown as Record<string, unknown>).routingSettlement = { type: 'at', ms: -1 }
    const g: GameGraph = {
      nodes: [a.node, b.node],
      edges: [{
        id: 'e1',
        source: 'a',
        target: 'b',
        sourceHandle: 'default',
        targetHandle: 'in',
        data: { transition: 'onSettlement' },
      }],
    }
    const codes = validateGraph(g, { overlays: { ...a.overlays, ...b.overlays } }).map((issue) => issue.code)
    expect(codes).toContain('node.routingSettlement.invalid')
    expect(codes).toContain('edge.transition.default')
  })
})
