import { describe, expect, it } from 'vitest'
import { GraphSession } from '../core/engine/session'
import type { GameGraph } from '../core/schema/graph-schema'
import { node, scnOf } from './test-fixtures'

describe('SessionSnapshot blueprint location', () => {
  it('snapshot exposes activeBlueprintId and callStack titles', () => {
    const main: GameGraph = {
      nodes: [node('wrap', { subFlowPack: { id: 'enemy-turn', version: '1' }, durationMs: 100 })],
      edges: [],
    }
    const packGraph: GameGraph = { nodes: [node('tele', { durationMs: 100 })], edges: [] }
    const scn = {
      ...scnOf(main),
      manifest: {
        version: 'game-video.blueprint-manifest.v1' as const,
        mainPackId: 'bp-main',
        packs: {
          'bp-main': { id: 'bp-main', title: '主蓝图', entry: 'wrap', graph: main },
          'enemy-turn': { id: 'enemy-turn', title: '敌方回合', version: '1', entry: 'tele', graph: packGraph },
        },
      },
    }
    const session = new GraphSession(scn, { rootBlueprintId: 'bp-main' })
    const snap = session.start()
    expect(snap.activeBlueprintId).toBe('enemy-turn')
    expect(snap.activeGraphPath).toEqual([])
    expect(snap.callStack).toEqual([{ blueprintId: 'bp-main', callerNodeId: 'wrap', graphPath: [], title: '主蓝图' }])
  })

  it('ends after a terminal subFlowPack without replaying its last clip', () => {
    const main: GameGraph = {
      nodes: [node('wrap', { subFlowPack: { id: 'child', version: '1' } })],
      edges: [],
    }
    const child: GameGraph = { nodes: [node('child-entry', { durationMs: 100 })], edges: [] }
    const scenario = {
      ...scnOf(main),
      manifest: {
        version: 'game-video.blueprint-manifest.v1' as const,
        mainPackId: 'bp-main',
        packs: {
          'bp-main': { id: 'bp-main', entry: 'wrap', graph: main },
          child: { id: 'child', version: '1', entry: 'child-entry', graph: child },
        },
      },
    }
    const session = new GraphSession(scenario, { rootBlueprintId: 'bp-main' })

    let snap = session.start()
    expect(snap.clip?.nodeId).toBe('child-entry')
    expect(snap.clipSeq).toBe(1)
    snap = session.performanceEnd()

    expect(snap.phase).toBe('ended')
    expect(snap.currentNodeId).toBe('wrap')
    expect(snap.activeBlueprintId).toBe('bp-main')
    expect(snap.callStack).toEqual([])
    expect(snap.clipSeq).toBe(1)
  })

  it('ends after a terminal subProcess without replaying its last clip', () => {
    const child: GameGraph = { nodes: [node('child-entry', { durationMs: 100 })], edges: [] }
    const main: GameGraph = {
      nodes: [node('wrap', { subProcess: { entry: 'child-entry', graph: child } })],
      edges: [],
    }
    const session = new GraphSession(scnOf(main), { rootBlueprintId: 'bp-main' })

    let snap = session.start()
    expect(snap.clip?.nodeId).toBe('child-entry')
    expect(snap.clipSeq).toBe(1)
    snap = session.performanceEnd()

    expect(snap.phase).toBe('ended')
    expect(snap.currentNodeId).toBe('wrap')
    expect(snap.activeBlueprintId).toBe('bp-main')
    expect(snap.activeGraphPath).toEqual([])
    expect(snap.callStack).toEqual([])
    expect(snap.clipSeq).toBe(1)
  })

  it('uses a new clip occurrence for same-id entries and returns through nested packs', () => {
    const main: GameGraph = {
      nodes: [node('wrap-a', { subFlowPack: { id: 'pack-a', version: '1' } }), node('after', { durationMs: 100 })],
      edges: [{ id: 'main-next', source: 'wrap-a', target: 'after', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const packA: GameGraph = {
      nodes: [node('entry', { durationMs: 100 }), node('wrap-b', { subFlowPack: { id: 'pack-b', version: '1' } })],
      edges: [{ id: 'a-next', source: 'entry', target: 'wrap-b', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const packB: GameGraph = { nodes: [node('entry', { durationMs: 100 })], edges: [] }
    const scn = {
      ...scnOf(main),
      manifest: {
        version: 'game-video.blueprint-manifest.v1' as const,
        mainPackId: 'bp-main',
        packs: {
          'bp-main': { id: 'bp-main', entry: 'wrap-a', graph: main },
          'pack-a': { id: 'pack-a', version: '1', entry: 'entry', graph: packA },
          'pack-b': { id: 'pack-b', version: '1', entry: 'entry', graph: packB },
        },
      },
    }
    const session = new GraphSession(scn, { rootBlueprintId: 'bp-main' })

    let snap = session.start()
    expect(snap.clip?.nodeId).toBe('entry')
    expect(snap.activeBlueprintId).toBe('pack-a')
    expect(snap.clipSeq).toBe(1)

    snap = session.performanceEnd()
    expect(snap.clip?.nodeId).toBe('entry')
    expect(snap.activeBlueprintId).toBe('pack-b')
    expect(snap.clipSeq).toBe(2)

    snap = session.performanceEnd()
    expect(snap.currentNodeId).toBe('after')
    expect(snap.activeBlueprintId).toBe('bp-main')
    expect(snap.callStack).toEqual([])
    expect(snap.clipSeq).toBe(3)
  })

  it('exposes a 2410ms HP-watch advance edge for child-blueprint play visualization', () => {
    const battleGraph: GameGraph = {
      nodes: [
        node('entry', { durationMs: 100 }),
        node('battle', {
          durationMs: 5000,
          reactions: [
            {
              when: { type: 'at', ms: 2410 },
              do: [{
                kind: 'effect',
                effects: [{ kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'set', value: 50 }],
              }],
            },
            {
              when: { type: 'watch', of: 'entity.ent-boss.attr.hp', on: 'dec' },
              do: [{ kind: 'advance', edgeId: 'battle-to-fail' }],
            },
          ],
        }),
        node('fail', { durationMs: 100 }),
      ],
      edges: [
        { id: 'entry-to-battle', source: 'entry', target: 'battle', sourceHandle: 'default', targetHandle: 'in' },
        {
          id: 'battle-to-fail',
          source: 'battle',
          target: 'fail',
          sourceHandle: 'settlement-advance:battle-to-fail',
          targetHandle: 'in',
        },
      ],
    }
    const scenario = {
      ...scnOf(battleGraph, {
        entities: {
          'ent-boss': {
            id: 'ent-boss',
            name: '小怪',
            kind: 'boss',
            attrs: { hp: 100 },
            attrMeta: { hp: { max: 100 } },
          },
        },
      }),
      manifest: {
        version: 'game-video.blueprint-manifest.v1' as const,
        mainPackId: 'battle-pack',
        packs: {
          'battle-pack': { id: 'battle-pack', title: '战斗子蓝图', entry: 'entry', graph: battleGraph },
        },
      },
    }
    const session = new GraphSession(scenario, { rootBlueprintId: 'battle-pack' })

    let snap = session.start()
    snap = session.performanceEnd()
    expect(snap.currentNodeId).toBe('battle')

    snap = session.tick(2410)
    expect(snap.currentNodeId).toBe('fail')
    expect(snap.activeBlueprintId).toBe('battle-pack')
    expect(snap.traversedEdgeIds).toContain('battle-to-fail')
    expect(snap.entryReason).toContain('settlement-advance:battle-to-fail')
  })
})
