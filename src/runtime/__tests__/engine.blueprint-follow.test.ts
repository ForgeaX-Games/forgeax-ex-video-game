import { describe, expect, it } from 'vitest'
import { GraphRuntime } from '../core/engine/engine'
import type { GameGraph, SubFlowPackDef } from '../core/schema/graph-schema'
import { node, rid, scnOf } from './test-fixtures'

describe('activeBlueprintId / callStack returnBlueprintId', () => {
  it('starts on rootBlueprintId with empty stack', () => {
    const main: GameGraph = { nodes: [node('a', { durationMs: 100 })], edges: [] }
    const scn = {
      ...scnOf(main),
      manifest: {
        version: 'game-video.blueprint-manifest.v1' as const,
        mainPackId: 'bp-main',
        packs: {
          'bp-main': { id: 'bp-main', title: '主蓝图', entry: 'a', graph: main },
        },
      },
    }
    const rt = new GraphRuntime(main, scn, undefined, [], 'bp-main')
    rt.start()
    expect(rt.getActiveBlueprintId()).toBe('bp-main')
    expect(rt.state.callStack).toEqual([])
  })

  it('enters subFlowPack → switches blueprint id and records returnBlueprintId', () => {
    const main: GameGraph = {
      nodes: [
        node('wrap', { subFlowPack: { id: 'enemy-turn', version: '1' }, durationMs: 100 }),
        node('after', {}),
      ],
      edges: [{ id: 'e', source: 'wrap', target: 'after', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const packGraph: GameGraph = { nodes: [node('tele', { durationMs: 100 })], edges: [] }
    const pack: SubFlowPackDef = { id: 'enemy-turn', version: '1', entry: 'tele', graph: packGraph, title: '敌方回合' }
    const rt = new GraphRuntime(main, scnOf(main), undefined, [pack], 'bp-main')
    rt.start()
    expect(rt.state.currentNodeId).toBe('tele')
    expect(rt.getActiveBlueprintId()).toBe('enemy-turn')
    expect(rt.state.callStack[0]?.callerNodeId).toBe('wrap')
    expect(rt.state.callStack[0]?.returnBlueprintId).toBe('bp-main')
    rt.onPerformanceEnd()
    expect(rt.state.currentNodeId).toBe('after')
    expect(rt.getActiveBlueprintId()).toBe('bp-main')
    expect(rt.state.callStack).toEqual([])
  })

  it('embedded subProcess keeps activeBlueprintId and records graph path', () => {
    const g: GameGraph = {
      nodes: [
        node('wrap', {
          subProcess: { entry: 'sub', graph: { nodes: [node('sub', { durationMs: 100 })], edges: [] } },
          durationMs: 100,
        }),
        node('after', {}),
      ],
      edges: [{ id: 'e', source: 'wrap', target: 'after', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const rt = new GraphRuntime(g, scnOf(g), undefined, [], 'bp-main')
    rt.start()
    expect(rt.state.currentNodeId).toBe('sub')
    expect(rt.getActiveBlueprintId()).toBe('bp-main')
    expect(rt.getActiveGraphPath()).toEqual(['wrap'])
    expect(rt.state.callStack[0]?.returnBlueprintId).toBe('bp-main')
  })

  it('container watch resolves its parent edge when the active pack has the same edge id', () => {
    const main: GameGraph = {
      nodes: [
        node('wrap', {
          subFlowPack: { id: 'enemy-turn', version: '1' },
          durationMs: 100,
          reactions: [{
            when: { type: 'watch', of: 'var.flag', on: 'change' },
            do: [{ kind: 'advance', edgeId: 'same-edge' }],
          }],
        }),
        node('after', {}),
      ],
      edges: [{ id: 'same-edge', source: 'wrap', target: 'after', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const packGraph: GameGraph = {
      nodes: [
        node('tele', {
          durationMs: 5000,
          reactions: [
            {
              when: { type: 'enter' },
              do: [{ kind: 'effect', effects: [{ id: 's', kind: 'var', varId: 'flag', op: 'set', value: 1 }] }],
            },
          ],
        }),
        node('wrong', {}),
      ],
      edges: [{ id: 'same-edge', source: 'tele', target: 'wrong', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const pack: SubFlowPackDef = { id: 'enemy-turn', version: '1', entry: 'tele', graph: packGraph }
    const scn = scnOf(main, { variables: { flag: { id: 'flag', name: 'flag', initial: 0 } } })
    const rt = new GraphRuntime(main, scn, undefined, [pack], 'bp-main')
    rt.start()
    expect(rt.state.currentNodeId).toBe('after')
    expect(rt.state.callStack).toEqual([])
    expect(rt.getActiveBlueprintId()).toBe('bp-main')
  })

  it('deferred container event keeps the scoped parent edge across settlement', () => {
    const main: GameGraph = {
      nodes: [
        node('wrap', {
          subFlowPack: { id: 'enemy-turn', version: '1' },
          timeline: [{ id: 'choice', kind: 'choiceX', inputs: { events: [{ id: 'go' }] } }],
        }),
        node('after', { durationMs: 100 }),
      ],
      edges: [{
        id: 'same-edge', source: 'wrap', target: 'after', sourceHandle: 'go', targetHandle: 'in',
        data: { transition: 'onSettlement' },
      }],
    }
    const packGraph: GameGraph = {
      nodes: [node('tele', { durationMs: 100 }), node('wrong', {})],
      edges: [{ id: 'same-edge', source: 'tele', target: 'wrong', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const pack: SubFlowPackDef = { id: 'enemy-turn', version: '1', entry: 'tele', graph: packGraph }
    const scn = scnOf(main)
    const rt = new GraphRuntime(scn.graph, scn, undefined, [pack], 'bp-main')
    rt.start()
    rt.emitComponentEvent(rid('wrap', 'choice'), 'go')
    expect(rt.state.currentNodeId).toBe('tele')
    rt.onPerformanceEnd()
    expect(rt.state.currentNodeId).toBe('after')
    expect(rt.getActiveBlueprintId()).toBe('bp-main')
  })

  it('jumpToNode with graph seeks inside pack graph', () => {
    const main: GameGraph = {
      nodes: [node('wrap', { subFlowPack: { id: 'enemy-turn', version: '1' }, durationMs: 100 })],
      edges: [],
    }
    const packGraph: GameGraph = {
      nodes: [node('tele', { durationMs: 100 }), node('mid', { durationMs: 100 })],
      edges: [{ id: 'e', source: 'tele', target: 'mid', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const pack: SubFlowPackDef = { id: 'enemy-turn', version: '1', entry: 'tele', graph: packGraph }
    const rt = new GraphRuntime(main, scnOf(main), undefined, [pack], 'bp-main')
    rt.start()
    rt.jumpToNode('mid', { graph: packGraph, blueprintId: 'enemy-turn' })
    expect(rt.state.currentNodeId).toBe('mid')
    expect(rt.getActiveBlueprintId()).toBe('enemy-turn')
    expect(rt.state.callStack).toEqual([])
  })
})
