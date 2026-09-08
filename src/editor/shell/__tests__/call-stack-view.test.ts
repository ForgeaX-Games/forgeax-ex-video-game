import { describe, expect, it } from 'vitest'
import { getSubProcess, type GameGraph } from '@/runtime/core/schema/graph-schema'
import {
  activeSubflowPath,
  blueprintBreadcrumbs,
  deepestCallerOnBlueprint,
  subflowMembers,
  visibleSubflowNodeIds,
} from '../call-stack-view'

const graph: GameGraph = {
  nodes: [
    { id: 'start', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: '开始' } },
    {
      id: 'turn', type: 'perf', position: { x: 100, y: 0 }, inputs: [], outputs: [],
      data: {
        name: '我方回合',
        subProcess: {
          entry: 'skill',
          graph: {
            nodes: [
              { id: 'skill', type: 'perf', position: { x: 100, y: 100 }, inputs: [], outputs: [], data: { name: '选择技能' } },
              { id: 'hit', type: 'perf', position: { x: 200, y: 100 }, inputs: [], outputs: [], data: { name: '攻击' } },
            ],
            edges: [{ id: 'turn-1', source: 'skill', target: 'hit', sourceHandle: 'default', targetHandle: 'in' }],
          },
        },
      },
    },
    { id: 'end', type: 'perf', position: { x: 200, y: 0 }, inputs: [], outputs: [], data: { name: '结束' } },
  ],
  edges: [
    { id: 'main-1', source: 'start', target: 'turn', sourceHandle: 'default', targetHandle: 'in' },
    { id: 'main-2', source: 'turn', target: 'end', sourceHandle: 'default', targetHandle: 'in' },
  ],
}

describe('blueprintBreadcrumbs', () => {
  it('collapses same-graph subflow frames', () => {
    const crumbs = blueprintBreadcrumbs(
      'main', '主蓝图',
      [
        { blueprintId: 'main', title: '主蓝图' }, // same-graph subFlow
        { blueprintId: 'main', title: '主蓝图' }, // still on main before/at pack call
      ],
      'pack', '战斗',
    )
    expect(crumbs.map((c) => c.blueprintId)).toEqual(['main', 'pack'])
  })

  it('nested pack: caller frame uses returnBlueprintId of inner pack', () => {
    const crumbs = blueprintBreadcrumbs(
      'main', '主蓝图',
      [
        { blueprintId: 'main', title: '主蓝图' },
        { blueprintId: 'pack-a', title: '战斗 A' }, // return frame: called pack-b from pack-a graph
      ],
      'pack-b', '战斗 B',
    )
    expect(crumbs.map((c) => c.blueprintId)).toEqual(['main', 'pack-a', 'pack-b'])
  })
})

describe('deepestCallerOnBlueprint', () => {
  it('picks deepest caller on pinned blueprint', () => {
    const stack = [
      { blueprintId: 'main', callerNodeId: 'turn' },
      { blueprintId: 'main', callerNodeId: 'combat' },
    ]
    expect(deepestCallerOnBlueprint(stack, 'main', 'pack')).toBe('combat')
    expect(deepestCallerOnBlueprint(stack, 'pack', 'pack')).toBeNull()
  })
})

describe('subflow scope view', () => {
  it('collects members without leaking back into the parent flow', () => {
    const child = getSubProcess(graph.nodes[1]!.data)!.graph
    expect([...subflowMembers(child, 'skill')]).toEqual(['skill', 'hit'])
  })

  it('shows containers at root and only owned members after drilling', () => {
    expect([...visibleSubflowNodeIds(graph, [])]).toEqual(['start', 'turn', 'end'])
    expect([...visibleSubflowNodeIds(graph, ['turn'])]).toEqual(['skill', 'hit'])
  })

  it('derives the active same-blueprint subflow path from runtime frames', () => {
    expect(activeSubflowPath(graph, [
      { blueprintId: 'main', callerNodeId: 'turn', graphPath: [] },
      { blueprintId: 'main', callerNodeId: 'not-a-subflow' },
      { blueprintId: 'other', callerNodeId: 'turn' },
    ], 'main')).toEqual(['turn'])
  })
})
