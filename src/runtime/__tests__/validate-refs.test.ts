import { beforeAll, describe, expect, it } from 'vitest'
import { validateGraph } from '../core/validate/validate'
import { registerTestComponents } from './test-components'
import type { GameGraph, Overlay } from '../core/schema/graph-schema'

beforeAll(() => {
    registerTestComponents()
})

const optsBase = { entities: ['ent-player', 'ent-boss'], vars: ['qi'] }

function withOverlay(
  id: string,
  children: Overlay['children'],
): { graph: GameGraph; overlays: Record<string, Overlay> } {
  const oid = `ov-${id}`
  return {
    overlays: { [oid]: { id: oid, children } },
    graph: {
      nodes: [
        {
          id,
          type: 'perf',
          position: { x: 0, y: 0 },
          inputs: [],
          outputs: [],
          data: { name: id, overlayNodes: [{ overlay: oid }] },
        },
      ],
      edges: [],
    },
  }
}

describe('validateGraph reference checks', () => {
  it('flags unknown entity in effect and unknown var in expr', () => {
    const { graph, overlays } = withOverlay('a', [
      {
        id: 's',
        component: 'settle',
        trigger: { when: 'enter' },
        inputs: {
          effects: [
            {
              id: 'd',
              kind: 'attr',
              entityId: 'ent-ghost',
              attr: 'hp',
              op: 'add',
              value: { expr: 'var.missingVar + 1' },
            },
          ],
        },
      },
    ])
    const issues = validateGraph(graph, { ...optsBase, overlays })
    expect(issues.some((i) => i.code === 'ref.entity.missing' && i.msg.includes('ent-ghost'))).toBe(true)
    expect(issues.some((i) => i.code === 'ref.var.missing' && i.msg.includes('missingVar'))).toBe(true)
  })

  it('flags unknown entity in condition and unknown reaction advance edge', () => {
    const graph: GameGraph = {
      nodes: [
        {
          id: 'a',
          type: 'perf',
          position: { x: 0, y: 0 },
          inputs: [],
          outputs: [],
          data: {
            name: 'a',
            reactions: [{ when: { type: 'enter' }, do: [{ kind: 'advance', edgeId: 'missing-edge' }] }],
          },
        },
      ],
      edges: [
        {
          id: 'e',
          source: 'a',
          target: 'a',
          sourceHandle: 'default',
          targetHandle: 'in',
          data: {
            condition: { all: [{ type: 'attrRatio', entityId: 'ent-ghost', attr: 'hp', op: 'lte', value: 0 }] },
          },
        },
      ],
    }
    const issues = validateGraph(graph, optsBase)
    expect(issues.some((i) => i.code === 'ref.entity.missing')).toBe(true)
    expect(issues.some((i) => i.code === 'ref.edge.missing' && i.msg.includes('missing-edge'))).toBe(true)
  })

  it('flags missing formula references and unknown bare symbols', () => {
    const graph: GameGraph = {
      nodes: [{
        id: 'a',
        type: 'perf',
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        data: {
          name: 'a',
          reactions: [{
            when: { type: 'enter' },
            do: [{
              kind: 'effect',
              effects: [{
                kind: 'var',
                varId: 'qi',
                op: 'add',
                value: { expr: 'formula.missing + dmg_light' },
              }],
            }],
          }],
        },
      }],
      edges: [],
    }
    const issues = validateGraph(graph, { ...optsBase, formulas: [] })
    expect(issues.some((i) => i.code === 'ref.formula.missing' && i.msg.includes('missing'))).toBe(true)
    expect(issues.some((i) => i.code === 'ref.symbol.unknown' && i.msg.includes('dmg_light'))).toBe(true)
  })
})

