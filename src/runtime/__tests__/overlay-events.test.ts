import { describe, expect, it } from 'vitest'
import { registerTestComponents } from './test-components'
import { getComponentManifest } from '../core/registry/component-registry'
import type { Overlay, Reaction } from '../core/schema/node-config-schema'
import {
  aggregateOverlayEvents,
  aggregateNodeOverlayEvents,
  overlayReactionKey,
  resolveOverlayReaction,
  resolveEventReactionDo,
} from '../core/schema/overlay-events'
import { GraphRuntime } from '../core/engine/engine'
import { scnOf, node, rid } from './test-fixtures'
import type { GameGraph } from '../core/schema/graph-schema'

registerTestComponents()

describe('overlay events / reactions', () => {
  const overlay: Overlay = {
    id: 'battleHud',
    children: [
      { id: 'hp', component: 'battleHpBar', inputs: { bind: 'ent-player' } },
      {
        id: 'parry',
        component: 'test.qte',
        inputs: {
          events: [
            { id: 'A', label: '防反' },
            { id: 'B', label: '闪避' },
            { id: 'miss', label: '失手' },
          ],
        },
      },
    ],
  }

  it('aggregates events from inputs.events when single emitter', () => {
    const refs = aggregateOverlayEvents(overlay, getComponentManifest)
    expect(refs.map((r) => r.eventId)).toEqual(['A', 'B', 'miss'])
    expect(refs[0]?.componentId).toBe('test.qte')
  })

  it('namespaces when multiple emitters', () => {
    const multi: Overlay = {
      id: 'm',
      children: [
        {
          id: 'q1',
          component: 'qte',
          inputs: { events: [{ id: 'pass' }, { id: 'fail' }] },
        },
        {
          id: 'q2',
          component: 'qte',
          inputs: { events: [{ id: 'pass' }, { id: 'fail' }] },
        },
      ],
    }
    const refs = aggregateOverlayEvents(multi, getComponentManifest)
    expect(refs.map((r) => r.eventId)).toEqual(['q1:pass', 'q1:fail', 'q2:pass', 'q2:fail'])
  })

  it('resolveEventReactionDo matches bare and namespaced keys', () => {
    const actions = [{ kind: 'advance' as const, edgeId: 'e2' }]
    const bare: Reaction[] = [{ when: { type: 'event', id: 'A' }, do: actions }]
    const ns: Reaction[] = [{ when: { type: 'event', id: 'parry:A' }, do: actions }]
    expect(resolveEventReactionDo(bare, 'A')?.[0]).toEqual(actions[0])
    expect(resolveEventReactionDo(ns, 'A', 'parry')?.[0]).toEqual(actions[0])
  })

  it('catalog reactions use the stable childId:eventId key', () => {
    const reactions = [{
      when: { type: 'event' as const, id: 'parry:A' },
      do: [{ kind: 'effect' as const, effects: [] }],
    }]
    expect(overlayReactionKey('parry', 'A')).toBe('parry:A')
    expect(resolveOverlayReaction(reactions, 'parry', 'A')).toBe(reactions[0])
    expect(resolveOverlayReaction(reactions, 'other', 'A')).toBeUndefined()
  })

  it('runs catalog actions before mount additions, then routes by event edge', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          overlayNodes: [{
            overlay: 'ov-a',
            reactions: [{
              when: { type: 'event', id: 'pass' },
              do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'qi', op: 'mul', value: 3 }] }],
            }],
          }],
        }),
        node('b'),
      ],
      edges: [{ id: 'e-pass', source: 'a', target: 'b', sourceHandle: 'pass', targetHandle: 'in' }],
    }
    const scn = scnOf(graph, {
      variables: { qi: { id: 'qi', initial: 1 } },
      ui: {
        overlays: {
          'ov-a': {
            id: 'ov-a',
            children: [{ id: 'q', component: 'qte', trigger: { when: 'enter' }, inputs: {} }],
            reactions: [{
              when: { type: 'event', id: 'q:pass' },
              do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'qi', op: 'set', value: 2 }] }],
            }],
          },
        },
      },
    })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    expect(rt.state.vars.qi).toBe(1)
    rt.emitComponentEvent(rid('a', 'q'), 'pass')
    expect(rt.state.vars.qi).toBe(6)
    expect(rt.state.currentNodeId).toBe('b')
  })

  it('event reaction applies effects; edge (by handle) decides routing', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 1000,
          overlayNodes: [{
            overlay: 'ov-a',
            reactions: [{
              when: { type: 'event', id: 'pass' },
              do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'qi', op: 'add', value: 3 }] }],
            }],
          }],
        }),
        node('b', { durationMs: 500 }),
      ],
      edges: [
        { id: 'e-pass', source: 'a', target: 'b', sourceHandle: 'pass', targetHandle: 'in' },
      ],
    }
    const scn = scnOf(graph, {
      ui: {
        overlays: {
          'ov-a': {
            id: 'ov-a',
            children: [
              {
                id: 'q',
                component: 'qte',
                trigger: { when: 'enter' },
                inputs: {},
              },
            ],
          },
        },
      },
    })
    const a = scn.graph.nodes.find((n) => n.id === 'a')!
    a.data.overlayNodes = [{
      overlay: 'ov-a',
      reactions: [{
        when: { type: 'event', id: 'pass' },
        do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'qi', op: 'add', value: 3 }] }],
      }],
    }]
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    expect(rt.state.phase).toBe('playing')
    rt.emitComponentEvent(rid('a', 'q'), 'pass')
    expect(rt.state.currentNodeId).toBe('b')
    expect(rt.state.vars.qi).toBe(3)
  })

  it('multi-mount namespaces event ids', () => {
    const mounts = [
      { overlay: 'hudA' },
      { overlay: 'hudB' },
    ]
    const overlays = {
      hudA: {
        id: 'hudA',
        children: [{ id: 'q', component: 'qte', inputs: { events: [{ id: 'A' }] } }],
      },
      hudB: {
        id: 'hudB',
        children: [{ id: 'q', component: 'qte', inputs: { events: [{ id: 'A' }] } }],
      },
    }
    const refs = aggregateNodeOverlayEvents(mounts, overlays, getComponentManifest)
    expect(refs.map((r) => r.eventId)).toEqual(['hudA:A', 'hudB:A'])
  })
})
