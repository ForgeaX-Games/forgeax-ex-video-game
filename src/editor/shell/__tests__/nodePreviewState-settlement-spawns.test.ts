import { describe, expect, it } from 'vitest'
import type { GameNode, GameScenario, Overlay } from '@/runtime/core/schema/graph-schema'
import type { Reaction } from '@/runtime/core/schema/node-config-schema'
import { registerComponent, unregisterComponent } from '@/runtime/core/registry/component-registry'
import { projectSelectedSettlementSpawns } from '../nodePreviewState'

registerComponent('test-preview-float', { inputs: [{ key: 'value', label: '数值', valueType: 'number' }] })

const rage: Overlay = {
  id: 'rage',
  title: '怒气值界面',
  children: [{
    id: 'value',
    component: 'test-preview-float',
    trigger: { when: 'enter' },
    inputs: { value: 1 },
    layout: { left: 0.1, top: 0.2 },
  }],
}

function seed(reactions: Reaction[]): { scenario: GameScenario; node: GameNode } {
  const node: GameNode = {
    id: 'a',
    type: 'perf',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [],
    data: { name: 'a', durationMs: 4_000, reactions },
  }
  const scenario = {
    version: 't',
    variables: {},
    entities: {},
    ui: { overlays: { rage } },
    graph: { nodes: [node], edges: [] },
  } as unknown as GameScenario
  return { scenario, node }
}

const idsFor = (reactions: Reaction[], settlementIndex: number): string[] => {
  const { scenario, node } = seed(reactions)
  return projectSelectedSettlementSpawns(scenario, node, settlementIndex).map((preview) => preview.id)
}

const boundSpawn = { kind: 'spawn', from: 'rage/value', ttlMs: 500 } as const

describe('projectSelectedSettlementSpawns', () => {
  it('projects the interfaces bound to a timed settlement so they can be placed on the canvas', () => {
    expect(idsFor([{ when: { type: 'at', ms: 3_000 }, do: [{ kind: 'effect', effects: [] }, boundSpawn] }], 0))
      .toEqual(['settlement-spawn:0:1'])
  })

  it('still projects condition settlement interfaces', () => {
    expect(idsFor([{ when: { type: 'watch', of: 'score', on: 'inc' }, do: [boundSpawn] }], 0))
      .toEqual(['settlement-spawn:0:0'])
  })

  it('leaves interface-lifecycle settlements out, since their interfaces are placed elsewhere', () => {
    expect(idsFor([{ when: { type: 'shown', of: 'value' }, do: [boundSpawn] }], 0)).toEqual([])
  })

  it('addresses by settlement subset index so a leading condition settlement does not shift it', () => {
    const reactions: Reaction[] = [
      { when: { type: 'watch', of: 'score', on: 'inc' }, do: [] },
      { when: { type: 'at', ms: 3_000 }, do: [boundSpawn] },
    ]
    expect(idsFor(reactions, 1)).toEqual(['settlement-spawn:1:0'])
    expect(idsFor(reactions, 0)).toEqual([])
  })
})

unregisterComponent('test-preview-float')
