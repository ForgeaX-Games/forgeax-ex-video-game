import { describe, expect, it } from 'vitest'
import type { GameNode, GameScenario, Overlay } from '@/runtime/core/schema/graph-schema'
import type { Reaction } from '@/runtime/core/schema/node-config-schema'
import { collectSettlementSpawnGroups, settlementSpawnAddress } from '../settlementSpawnGroups'
import { collectNodeTimelineMarkers } from '../nodeTimelineMarkers'
import { setSettlementReactionMs } from '@/authoring/graph/graph-edit'

const DURATION_MS = 4000

const hud: Overlay = {
  id: 'hud',
  title: '战斗界面',
  children: [
    { id: 'rage', component: 'floatText', trigger: { when: 'enter' }, inputs: {} },
    { id: 'cheer', component: 'floatText', trigger: { when: 'enter' }, inputs: {} },
  ],
}

function seed(reactions: Reaction[]): { scenario: GameScenario; node: GameNode } {
  const node: GameNode = {
    id: 'a',
    type: 'perf',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [],
    data: { name: 'a', durationMs: DURATION_MS, reactions },
  }
  const scenario: GameScenario = {
    version: 't',
    variables: {},
    entities: {},
    ui: { overlays: { hud } },
    graph: { nodes: [node], edges: [] },
  } as unknown as GameScenario
  return { scenario, node }
}

const groupsOf = (reactions: Reaction[]) => {
  const { scenario, node } = seed(reactions)
  return collectSettlementSpawnGroups(scenario, node, DURATION_MS)
}

const timedSpawn = (ms: number, ttls: Array<number | undefined>): Reaction => ({
  when: { type: 'at', ms },
  do: [
    { kind: 'effect', effects: [] },
    ...ttls.map((ttlMs, i) => ({
      kind: 'spawn' as const,
      from: `hud/${i === 0 ? 'rage' : 'cheer'}`,
      ...(ttlMs != null ? { ttlMs } : {}),
    })),
  ],
})

describe('collectSettlementSpawnGroups', () => {
  it('gives every bound interface its own row inside one settlement group', () => {
    const [group] = groupsOf([timedSpawn(3000, [500, 800])])

    expect(group?.bars.map((bar) => bar.rowInGroup)).toEqual([0, 1])
    expect(group?.uBase).toBe(1)
    expect(group?.settlementIndex).toBe(0)
  })

  it('derives every bar start from the host settlement ms', () => {
    const [group] = groupsOf([timedSpawn(3000, [500, 800])])

    expect(group?.startMs).toBe(3000)
    expect(group?.bars.map((bar) => bar.startMs)).toEqual([3000, 3000])
  })

  it('ends a timed bar at settlement ms plus its display duration', () => {
    const [group] = groupsOf([timedSpawn(1000, [500])])

    expect(group?.bars[0]?.endMs).toBe(1500)
    expect(group?.bars[0]?.openEnded).toBe(false)
  })

  it('runs a persistent bar to the end of the node performance', () => {
    const [group] = groupsOf([timedSpawn(1000, [undefined])])

    expect(group?.bars[0]?.endMs).toBe(DURATION_MS)
    expect(group?.bars[0]?.openEnded).toBe(true)
  })

  it('never puts two interfaces on one row, even across settlements that do not overlap in time', () => {
    // a 结算绑 2 个界面、b 结算绑 1 个 → 三个界面占三行，互不同行。
    const groups = groupsOf([timedSpawn(0, [500, 500]), timedSpawn(3000, [500])])
    const rows = groups.flatMap((group) => group.bars.map((bar) => group.uBase + bar.rowInGroup))

    expect(rows).toHaveLength(3)
    expect(new Set(rows).size).toBe(3)
    // 三个界面只占三行：不为分组额外消耗行。
    expect(Math.max(...rows)).toBe(3)
  })

  it('stacks groups upward in time order, keeping the rows of each group contiguous', () => {
    const groups = groupsOf([timedSpawn(0, [500, 500]), timedSpawn(3000, [500])])

    // 第一组占 1、2 行，第二组紧接第 3 行 —— 三个界面正好三行，不额外占行。
    expect(groups[0]?.uBase).toBe(1)
    expect(groups[1]?.uBase).toBe(3)
  })

  it('keeps rows distinct for overlapping groups too', () => {
    const groups = groupsOf([timedSpawn(0, [3000, 3000]), timedSpawn(1000, [500])])
    const rows = groups.flatMap((group) => group.bars.map((bar) => group.uBase + bar.rowInGroup))

    expect(new Set(rows).size).toBe(rows.length)
    expect(groups[1]?.uBase).toBe(3)
  })

  it('skips settlements that bind no interface', () => {
    expect(groupsOf([{ when: { type: 'at', ms: 500 }, do: [{ kind: 'effect', effects: [] }] }])).toEqual([])
  })

  it('calls a spawn a bound interface in the diamond label, matching the action card', () => {
    const { scenario, node } = seed([timedSpawn(3_000, [500, 800])])
    const { pointMarkers } = collectNodeTimelineMarkers(scenario, node)

    expect(pointMarkers.find((marker) => marker.id === 'life:0')?.label).toContain('绑定 2 个界面')
  })

  it('pairs each group with its diamond marker through the settlement subset index', () => {
    const reactions: Reaction[] = [
      { when: { type: 'watch', of: 'score', on: 'inc' }, do: [{ kind: 'effect', effects: [] }] },
      timedSpawn(3000, [500]),
    ]
    const { scenario, node } = seed(reactions)
    const [group] = collectSettlementSpawnGroups(scenario, node, DURATION_MS)
    const { pointMarkers } = collectNodeTimelineMarkers(scenario, node)

    expect(group?.markerId).toBe('life:1')
    expect(pointMarkers.some((marker) => marker.id === group?.markerId && marker.ms === 3000)).toBe(true)
  })

  it('addresses each bar by settlement and action index for write-back', () => {
    const reactions: Reaction[] = [
      { when: { type: 'watch', of: 'score', on: 'inc' }, do: [{ kind: 'effect', effects: [] }] },
      timedSpawn(3000, [500, 800]),
    ]
    const { scenario, node } = seed(reactions)
    const [group] = collectSettlementSpawnGroups(scenario, node, DURATION_MS)

    // do[0] 是 effect，两个 spawn 落在 do[1] / do[2]。
    expect(group?.bars.map((bar) => bar.id)).toEqual(['settlement-spawn:1:1', 'settlement-spawn:1:2'])
  })

  it('labels a bar with its overlay title', () => {
    const [group] = groupsOf([timedSpawn(1000, [500])])

    expect(group?.bars[0]?.label).toBe('战斗界面')
  })
})

describe('派生跟随（本设计的核心性质）', () => {
  it('keeps every timed interface the same length when the settlement moves', () => {
    const { scenario, node } = seed([timedSpawn(1_000, [500, 800])])
    const before = collectSettlementSpawnGroups(scenario, node, DURATION_MS)
    const lengths = (groups: ReturnType<typeof collectSettlementSpawnGroups>) =>
      groups[0]?.bars.map((bar) => bar.endMs - bar.startMs)

    const movedGraph = setSettlementReactionMs(scenario.graph, node.id, 0, 2_600)
    const after = collectSettlementSpawnGroups({ ...scenario, graph: movedGraph }, movedGraph.nodes[0]!, DURATION_MS)

    expect(lengths(before)).toEqual([500, 800])
    expect(lengths(after)).toEqual([500, 800])
    expect(after[0]?.bars.map((bar) => bar.startMs)).toEqual([2_600, 2_600])
    expect(after[0]?.bars.map((bar) => bar.endMs)).toEqual([3_100, 3_400])
  })

  it('moves the whole group when only the host settlement ms changes', () => {
    const reactions = [timedSpawn(3_000, [500, undefined])]
    const { scenario, node } = seed(reactions)
    const before = collectSettlementSpawnGroups(scenario, node, DURATION_MS)

    // 只改 when.ms —— 不碰任何 spawn 动作。
    const movedGraph = setSettlementReactionMs(scenario.graph, node.id, 0, 3_500)
    const movedNode = movedGraph.nodes[0]!
    const after = collectSettlementSpawnGroups({ ...scenario, graph: movedGraph }, movedNode, DURATION_MS)

    expect(before[0]?.bars.map((bar) => bar.startMs)).toEqual([3_000, 3_000])
    expect(after[0]?.startMs).toBe(3_500)
    expect(after[0]?.bars.map((bar) => bar.startMs)).toEqual([3_500, 3_500])
    // 定时条整体平移（跨度不变），常驻条仍然贴到节点末端。
    expect(after[0]?.bars.map((bar) => bar.endMs)).toEqual([4_000, DURATION_MS])
    expect(after[0]?.bars.map((bar) => bar.openEnded)).toEqual([false, true])
  })

  it('keeps every bound interface addressable after the settlement moves', () => {
    const { scenario, node } = seed([timedSpawn(3_000, [500, 800])])
    const movedGraph = setSettlementReactionMs(scenario.graph, node.id, 0, 1_000)
    const after = collectSettlementSpawnGroups({ ...scenario, graph: movedGraph }, movedGraph.nodes[0]!, DURATION_MS)

    expect(after[0]?.bars.map((bar) => bar.id)).toEqual(['settlement-spawn:0:1', 'settlement-spawn:0:2'])
  })
})

describe('settlementSpawnAddress', () => {
  it('reads back the settlement and action index a bar id encodes', () => {
    expect(settlementSpawnAddress('settlement-spawn:2:3')).toEqual({ settlementIndex: 2, actionIndex: 3 })
  })

  it('rejects ids that are not bound-interface addresses', () => {
    expect(settlementSpawnAddress('life:2')).toBeNull()
    expect(settlementSpawnAddress('mount:hud')).toBeNull()
    expect(settlementSpawnAddress('settlement-spawn:a:1')).toBeNull()
    expect(settlementSpawnAddress('settlement-spawn:1')).toBeNull()
  })

  it('round-trips the ids the projection produces', () => {
    const [group] = groupsOf([timedSpawn(1000, [500])])

    expect(settlementSpawnAddress(group!.bars[0]!.id)).toEqual({ settlementIndex: 0, actionIndex: 1 })
  })
})
