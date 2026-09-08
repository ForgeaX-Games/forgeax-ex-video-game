import { describe, expect, it } from 'vitest'
import { addNode, attachSubProcess, connect, disconnect, duplicateNodes, insertNodeAfter, insertNodeBefore, makeEmptySubFlowPack, patchSettlementSpawnLayout, reconnect, removeNode, removeSettlementSpawn, setLifecycleReactionMs, setNodePosition, setRoutingSettlementMs, setSettlementAdvanceTarget, setSettlementReactionMs, setSettlementSpawnTtlMs, updateEventRouteTiming } from '@/authoring/graph/graph-edit'
import type { GameGraph, GameNode } from '@/runtime/core/schema/graph-schema'
import { getSubProcess } from '@/runtime/core/schema/graph-schema'

const n = (id: string): GameNode => ({
  id,
  type: 'perf',
  position: { x: 0, y: 0 },
  inputs: [],
  outputs: [],
  data: { name: id },
})
const g0 = (): GameGraph => ({ nodes: [n('a'), n('b')], edges: [] })

describe('graph-edit', () => {
  it('addNode / removeNode(+连带删边)', () => {
    let g = addNode(g0(), n('c'))
    expect(g.nodes.map((x) => x.id)).toContain('c')
    g = connect(g, { source: 'a', sourceHandle: 'default', target: 'c' })
    g = removeNode(g, 'c')
    expect(g.nodes.some((x) => x.id === 'c')).toBe(false)
    expect(g.edges.length).toBe(0) // 连带删掉 a→c
  })

  it('connect: 拒绝自环 & 去重', () => {
    let g = connect(g0(), { source: 'a', sourceHandle: 'default', target: 'a' })
    expect(g.edges.length).toBe(0) // 自环拒绝
    g = connect(g0(), { source: 'a', sourceHandle: 'default', target: 'b' })
    const g2 = connect(g, { source: 'a', sourceHandle: 'default', target: 'b' })
    expect(g2.edges.length).toBe(1) // 重复拒绝
  })

  it('disconnect / reconnect', () => {
    let g = connect(g0(), { source: 'a', sourceHandle: 'default', target: 'b', id: 'e1' })
    g = reconnect(g, 'e1', { target: 'a' })
    // reconnect 到自身允许（数据层不校验语义），target 改为 a
    expect(g.edges[0]!.target).toBe('a')
    g = disconnect(g, 'e1')
    expect(g.edges.length).toBe(0)
  })

  it('setNodePosition', () => {
    const g = setNodePosition(g0(), 'a', { x: 100, y: 50 })
    expect(g.nodes.find((x) => x.id === 'a')!.position).toEqual({ x: 100, y: 50 })
  })

  it('immutability: 原图不被修改', () => {
    const src = g0()
    connect(src, { source: 'a', sourceHandle: 'default', target: 'b' })
    expect(src.edges.length).toBe(0)
  })

  it('updateEventRouteTiming keeps event edges and node settlement in sync', () => {
    let graph = connect(g0(), { source: 'a', sourceHandle: 'pass', target: 'b', id: 'e-pass' })
    graph = updateEventRouteTiming(graph, 'a', 'pass', 'onSettlement', { type: 'at', ms: 1200 })
    expect(graph.edges[0]?.data?.transition).toBe('onSettlement')
    expect(graph.nodes[0]?.data.routingSettlement).toEqual({ type: 'at', ms: 1200 })

    graph = updateEventRouteTiming(graph, 'a', 'pass', 'immediate')
    expect(graph.edges[0]?.data?.transition).toBeUndefined()
    expect(graph.nodes[0]?.data.routingSettlement).toBeUndefined()
  })

  it('setRoutingSettlementMs：只平移已存在的固定时刻结算，非 at 一律不动', () => {
    let graph = connect(g0(), { source: 'a', sourceHandle: 'pass', target: 'b', id: 'e-pass' })

    // 还没有结算点 / 结算=演出结束 时拖标记都不该"顺手"造出一个固定时刻。
    expect(setRoutingSettlementMs(graph, 'a', 800)).toBe(graph)
    graph = updateEventRouteTiming(graph, 'a', 'pass', 'onSettlement', { type: 'complete' })
    expect(setRoutingSettlementMs(graph, 'a', 800)).toBe(graph)

    graph = updateEventRouteTiming(graph, 'a', 'pass', 'onSettlement', { type: 'at', ms: 1200 })
    const moved = setRoutingSettlementMs(graph, 'a', 640.7)
    expect(moved.nodes[0]?.data.routingSettlement).toEqual({ type: 'at', ms: 641 }) // 取整
    expect(setRoutingSettlementMs(moved, 'a', -50).nodes[0]?.data.routingSettlement).toEqual({ type: 'at', ms: 0 }) // 夹 0
    expect(setRoutingSettlementMs(moved, 'a', 641)).toBe(moved) // 同值 = 原样返回，不制造新对象
    // 出边跳转方式不受影响。
    expect(moved.edges[0]?.data?.transition).toBe('onSettlement')
  })

  it('setLifecycleReactionMs：拖生命周期菱形落成 at(ms)，非生命周期相位不动', () => {
    const withReactions: GameGraph = {
      nodes: [{
        ...n('a'),
        data: {
          name: 'a',
          durationMs: 3000,
          reactions: [
            { when: { type: 'at', ms: 0 }, do: [] },
            { when: { type: 'complete' }, do: [] },
            { when: { type: 'watch', of: 'ent-boss.hp', on: 'dec' }, do: [] },
          ],
        },
      }, n('b')],
      edges: [],
    }

    const moved = setLifecycleReactionMs(withReactions, 'a', 0, 1250.6)
    expect(moved.nodes[0]?.data.reactions?.[0]?.when).toEqual({ type: 'at', ms: 1251 }) // 取整
    expect(setLifecycleReactionMs(moved, 'a', 0, 1251)).toBe(moved) // 同值不产生新对象
    expect(setLifecycleReactionMs(moved, 'a', 0, -5).nodes[0]?.data.reactions?.[0]?.when).toEqual({ type: 'at', ms: 0 })

    // 历史 complete 落成 at（与检视器改那一行同义）。
    expect(setLifecycleReactionMs(withReactions, 'a', 1, 2000).nodes[0]?.data.reactions?.[1]?.when)
      .toEqual({ type: 'at', ms: 2000 })
    // watch 没有「时刻」这个维度，拖不到也不该被误改。
    expect(setLifecycleReactionMs(withReactions, 'a', 2, 500)).toBe(withReactions)
    // 越界下标 no-op。
    expect(setLifecycleReactionMs(withReactions, 'a', 9, 500)).toBe(withReactions)
  })

  it('setSettlementReactionMs：统一结算序号包含条件项，但只有定时项可拖', () => {
    const graph: GameGraph = {
      nodes: [{
        ...n('a'),
        data: {
          name: 'a',
          reactions: [
            { when: { type: 'watch', of: 'entity.ent-player.attr.hp', on: 'dec' }, do: [] },
            { when: { type: 'at', ms: 500 }, do: [] },
          ],
        },
      }],
      edges: [],
    }

    expect(setSettlementReactionMs(graph, 'a', 0, 900)).toBe(graph)
    expect(setSettlementReactionMs(graph, 'a', 1, 900).nodes[0]?.data.reactions?.[1]?.when)
      .toEqual({ type: 'at', ms: 900 })
  })

  it('patchSettlementSpawnLayout：只更新指定条件结算的显示界面位置', () => {
    const graph: GameGraph = {
      nodes: [{
        ...n('a'),
        data: {
          name: 'a',
          reactions: [{
            when: { type: 'watch', of: 'score', on: 'inc' },
            do: [
              { kind: 'effect', effects: [] },
              { kind: 'spawn', from: 'hud/rage', ttlMs: 1200 },
            ],
          }],
        },
      }],
      edges: [],
    }

    const next = patchSettlementSpawnLayout(graph, 'a', 0, 1, { left: 0.25, top: 0.4 })
    expect(next.nodes[0]?.data.reactions?.[0]?.do[1]).toEqual({
      kind: 'spawn',
      from: 'hud/rage',
      ttlMs: 1200,
      layout: { left: 0.25, top: 0.4 },
    })
    expect(graph.nodes[0]?.data.reactions?.[0]?.do[1]).not.toHaveProperty('layout')
    expect(patchSettlementSpawnLayout(graph, 'a', 0, 0, { left: 1 })).toBe(graph)
  })

  describe('setSettlementSpawnTtlMs：拖绑定界面右端只改 ttlMs', () => {
    const bound = (): GameGraph => ({
      nodes: [{
        ...n('a'),
        data: {
          name: 'a',
          durationMs: 4000,
          reactions: [
            { when: { type: 'watch', of: 'score', on: 'inc' }, do: [] },
            {
              when: { type: 'at', ms: 3000 },
              do: [
                { kind: 'effect', effects: [] },
                { kind: 'spawn', from: 'hud/rage', ttlMs: 500 },
                { kind: 'spawn', from: 'hud/cheer' },
              ],
            },
          ],
        },
      }],
      edges: [],
    })
    const spawnAt = (graph: GameGraph, index: number) => graph.nodes[0]?.data.reactions?.[1]?.do[index]

    it('writes the dragged duration onto the addressed spawn only', () => {
      const next = setSettlementSpawnTtlMs(bound(), 'a', 1, 1, 1800)
      expect(spawnAt(next, 1)).toEqual({ kind: 'spawn', from: 'hud/rage', ttlMs: 1800 })
      expect(spawnAt(next, 2)).toEqual({ kind: 'spawn', from: 'hud/cheer' })
    })

    it('turns a persistent spawn into a timed one when its end is dragged', () => {
      expect(spawnAt(setSettlementSpawnTtlMs(bound(), 'a', 1, 2, 900), 2))
        .toEqual({ kind: 'spawn', from: 'hud/cheer', ttlMs: 900 })
    })

    it('clamps the duration to the node performance length', () => {
      expect(spawnAt(setSettlementSpawnTtlMs(bound(), 'a', 1, 1, 99999), 1))
        .toEqual({ kind: 'spawn', from: 'hud/rage', ttlMs: 4000 })
    })

    it('addresses by settlement subset index, so leading condition settlements do not shift it', () => {
      // 下标 0 是 watch 结算，它的 do 里没有 spawn —— 按绝对下标寻址就会误命中。
      expect(setSettlementSpawnTtlMs(bound(), 'a', 0, 1, 1800)).toEqual(bound())
    })

    it('is a no-op when the addressed action is not a spawn', () => {
      const graph = bound()
      expect(setSettlementSpawnTtlMs(graph, 'a', 1, 0, 1800)).toBe(graph)
      expect(setSettlementSpawnTtlMs(graph, 'a', 1, 9, 1800)).toBe(graph)
    })

    it('does not produce a new object when the duration is unchanged', () => {
      const graph = bound()
      expect(setSettlementSpawnTtlMs(graph, 'a', 1, 1, 500)).toBe(graph)
    })
  })

  describe('removeSettlementSpawn：从时间轴解除界面绑定', () => {
    const bound = (): GameGraph => ({
      nodes: [{
        ...n('a'),
        data: {
          name: 'a',
          durationMs: 4000,
          reactions: [
            { when: { type: 'watch', of: 'score', on: 'inc' }, do: [] },
            {
              when: { type: 'at', ms: 3000 },
              do: [
                { kind: 'effect', effects: [] },
                { kind: 'spawn', from: 'hud/rage', ttlMs: 500 },
                { kind: 'spawn', from: 'hud/cheer' },
              ],
            },
          ],
        },
      }],
      edges: [],
    })

    it('drops only the addressed spawn and keeps the settlement itself', () => {
      const next = removeSettlementSpawn(bound(), 'a', 1, 1)
      expect(next.nodes[0]?.data.reactions?.[1]?.when).toEqual({ type: 'at', ms: 3000 })
      expect(next.nodes[0]?.data.reactions?.[1]?.do).toEqual([
        { kind: 'effect', effects: [] },
        { kind: 'spawn', from: 'hud/cheer' },
      ])
    })

    it('is a no-op when the addressed action is not a spawn', () => {
      const graph = bound()
      expect(removeSettlementSpawn(graph, 'a', 1, 0)).toBe(graph)
      expect(removeSettlementSpawn(graph, 'a', 1, 9)).toBe(graph)
      expect(removeSettlementSpawn(graph, 'a', 0, 1)).toBe(graph)
    })
  })

  it('setSettlementAdvanceTarget：按目标节点复用或创建边，并保持 advance.edgeId 契约', () => {
    const graph: GameGraph = {
      nodes: [{
        ...n('a'),
        data: {
          name: 'a',
          reactions: [{
            when: { type: 'at', ms: 1000 },
            do: [
              { kind: 'effect', effects: [] },
              { kind: 'advance', edgeId: '' },
            ],
          }],
        },
      }, n('b'), n('c')],
      edges: [],
    }

    const toB = setSettlementAdvanceTarget(graph, 'a', 0, 1, 'b')
    expect(toB.edges).toHaveLength(1)
    expect(toB.edges[0]).toMatchObject({ source: 'a', target: 'b', targetHandle: 'in' })
    expect(toB.edges[0]?.sourceHandle).toMatch(/^settlement-advance:/)
    expect(toB.nodes[0]?.data.reactions?.[0]?.do[1]).toEqual({ kind: 'advance', edgeId: toB.edges[0]?.id })
    expect(toB.nodes[0]?.data.reactions).toHaveLength(1) // 专用 handle 不伪造 event reaction

    const toBAgain = setSettlementAdvanceTarget(toB, 'a', 0, 1, 'b')
    expect(toBAgain.edges).toHaveLength(1)

    const toC = setSettlementAdvanceTarget(toBAgain, 'a', 0, 1, 'c')
    expect(toC.edges).toHaveLength(1)
    expect(toC.edges[0]).toMatchObject({ id: toB.edges[0]?.id, source: 'a', target: 'c' })

    const cleared = setSettlementAdvanceTarget(toC, 'a', 0, 1, '')
    expect(cleared.edges).toHaveLength(0)
    expect(cleared.nodes[0]?.data.reactions?.[0]?.do).toEqual([{ kind: 'effect', effects: [] }])
  })

  it('setSettlementAdvanceTarget reuses an existing source-to-target edge', () => {
    const graph: GameGraph = {
      nodes: [{
        ...n('a'),
        data: {
          name: 'a',
          reactions: [{ when: { type: 'watch', of: 'score', on: 'change' }, do: [{ kind: 'advance', edgeId: '' }] }],
        },
      }, n('b')],
      edges: [{ id: 'existing', source: 'a', target: 'b', sourceHandle: 'pass', targetHandle: 'in' }],
    }
    const next = setSettlementAdvanceTarget(graph, 'a', 0, 0, 'b')
    expect(next.edges).toHaveLength(1)
    expect(next.nodes[0]?.data.reactions?.[0]?.do[0]).toEqual({ kind: 'advance', edgeId: 'existing' })
  })

  it('disconnect removes settlement advance so deleting the route disables the action', () => {
    const graph: GameGraph = {
      nodes: [{
        ...n('a'),
        data: {
          name: 'a',
          reactions: [{
            when: { type: 'at', ms: 1000 },
            do: [
              { kind: 'effect', effects: [] },
              { kind: 'advance', edgeId: 'route' },
            ],
          }],
        },
      }, n('b')],
      edges: [{ id: 'route', source: 'a', target: 'b', sourceHandle: 'settlement-advance:route', targetHandle: 'in' }],
    }
    const next = disconnect(graph, 'route')
    expect(next.edges).toHaveLength(0)
    expect(next.nodes[0]?.data.reactions?.[0]?.do).toEqual([{ kind: 'effect', effects: [] }])
  })

  it('makeEmptySubFlowPack', () => {
    const pack = makeEmptySubFlowPack({ id: 'enemy-turn', title: '敌方回合', version: '1' })
    expect(pack.version).toBe('1')
    expect(pack.entry).toBe('entry')
    expect(pack.graph.nodes[0]?.data.name).toBe('新演出节点')
    expect(pack.graph.nodes[0]?.data.durationMs).toBeUndefined()
  })

  it('attachSubProcess: creates its entry inside the private child graph', () => {
    let g = connect(g0(), { source: 'a', sourceHandle: 'default', target: 'b' })
    g = attachSubProcess(g, 'a')
    const process = getSubProcess(g.nodes.find((x) => x.id === 'a')!.data)
    expect(process?.entry).toBeTruthy()
    expect(process?.entry).not.toBe('b')
    expect(process?.graph.nodes.some((x) => x.id === process.entry)).toBe(true)
    expect(process?.graph.nodes[0]?.data.name).toBe('新演出节点')
    expect(g.nodes.some((x) => x.id === process?.entry)).toBe(false)
    expect(g.nodes.find((x) => x.id === 'b')).toBeTruthy()
    const again = attachSubProcess(
      {
        ...g,
        nodes: g.nodes.map((x) =>
          x.id === 'a'
            ? { ...x, data: { ...x.data, subFlowPack: { id: 'p', version: '1' } } }
            : x,
        ),
      },
      'a',
    )
    expect(getSubProcess(again.nodes.find((x) => x.id === 'a')!.data)?.entry).toBe(process?.entry)
    expect((again.nodes.find((x) => x.id === 'a')!.data as { subFlowPack?: unknown }).subFlowPack).toBeUndefined()
  })

  it('insertNodeAfter: 插入并改接 out 边', () => {
    let g = connect(g0(), { source: 'a', sourceHandle: 'default', target: 'b', id: 'e-ab' })
    const { graph: next, nodeId } = insertNodeAfter(g, 'a')
    expect(next.nodes.some((n) => n.id === nodeId)).toBe(true)
    expect(next.edges.some((e) => e.source === 'a' && e.target === nodeId && (e.sourceHandle ?? 'default') === 'default')).toBe(true)
    expect(next.edges.some((e) => e.source === nodeId && e.target === 'b')).toBe(true)
    expect(next.edges.some((e) => e.id === 'e-ab')).toBe(false)
  })

  it('insertNodeAfter: 指定出口只改接该出口的下游边', () => {
    let g = connect(g0(), { source: 'a', sourceHandle: 'fail', target: 'b', id: 'e-fail' })
    g = connect(g, { source: 'a', sourceHandle: 'default', target: 'b', id: 'e-default' })
    const { graph: next, nodeId } = insertNodeAfter(g, 'a', { sourceHandle: 'fail', gapY: 140 })
    expect(next.edges.some((e) => e.source === 'a' && e.target === nodeId && e.sourceHandle === 'fail')).toBe(true)
    expect(next.edges.some((e) => e.source === nodeId && e.target === 'b')).toBe(true)
    expect(next.edges.some((e) => e.id === 'e-fail')).toBe(false)
    expect(next.edges.some((e) => e.id === 'e-default')).toBe(true) // default 出口不受影响
    expect(next.nodes.find((x) => x.id === nodeId)!.position).toEqual({ x: 220, y: 140 })
  })

  it('insertNodeBefore: 插入并改接所有入边', () => {
    let g = connect(g0(), { source: 'a', sourceHandle: 'fail', target: 'b', id: 'e-fail' })
    g = connect(g, { source: 'a', sourceHandle: 'default', target: 'b', id: 'e-default' })
    const { graph: next, nodeId } = insertNodeBefore(g, 'b', { gapY: 40 })
    expect(next.nodes.some((n) => n.id === nodeId)).toBe(true)
    expect(next.nodes.find((x) => x.id === nodeId)!.position).toEqual({ x: -220, y: 40 })
    expect(next.edges.some((e) => e.source === 'a' && e.target === nodeId && e.sourceHandle === 'fail')).toBe(true)
    expect(next.edges.some((e) => e.source === 'a' && e.target === nodeId && e.sourceHandle === 'default')).toBe(true)
    expect(next.edges.some((e) => e.source === nodeId && e.target === 'b' && (e.sourceHandle ?? 'default') === 'default')).toBe(true)
    expect(next.edges.some((e) => e.id === 'e-fail' || e.id === 'e-default')).toBe(false)
  })

  it('insertNodeAfter: position 覆盖出口行错开（拖线松手落点）', () => {
    const g = connect(g0(), { source: 'a', sourceHandle: 'default', target: 'b', id: 'e-ab' })
    const { graph: next, nodeId } = insertNodeAfter(g, 'a', { position: { x: 333, y: 77 }, gapY: 999 })
    // 显式 position 优先，gapY 被忽略。
    expect(next.nodes.find((x) => x.id === nodeId)!.position).toEqual({ x: 333, y: 77 })
    expect(next.edges.some((e) => e.source === 'a' && e.target === nodeId)).toBe(true)
    expect(next.edges.some((e) => e.source === nodeId && e.target === 'b')).toBe(true)
  })

  it('insertNodeBefore: position 覆盖默认左侧落点（拖线松手落点）', () => {
    const g = connect(g0(), { source: 'a', sourceHandle: 'default', target: 'b', id: 'e-ab' })
    const { graph: next, nodeId } = insertNodeBefore(g, 'b', { position: { x: -50, y: -60 }, gapX: 999 })
    expect(next.nodes.find((x) => x.id === nodeId)!.position).toEqual({ x: -50, y: -60 })
    expect(next.edges.some((e) => e.source === 'a' && e.target === nodeId)).toBe(true)
    expect(next.edges.some((e) => e.source === nodeId && e.target === 'b')).toBe(true)
  })

  it('duplicateNodes: 多节点 + 内部边', () => {
    let g = connect(g0(), { source: 'a', sourceHandle: 'default', target: 'b', id: 'e-ab' })
    const { graph: next, nodeIds } = duplicateNodes(g, ['a', 'b'])
    expect(nodeIds).toHaveLength(2)
    expect(next.nodes.length).toBe(4)
    expect(next.edges.filter((e) => nodeIds.includes(e.source) && nodeIds.includes(e.target))).toHaveLength(1)
    expect(next.nodes.find((n) => n.id === nodeIds[0])!.data.name).toContain('副本')
  })

  it('duplicateNodes: 子流程容器递归重铸内部节点、边和引用 id', () => {
    const child: GameGraph = {
      nodes: [
        { ...n('inner-a'), data: { name: 'a', reactions: [{ when: { type: 'complete' }, do: [{ kind: 'advance', edgeId: 'inner-edge' }] }] } },
        n('inner-b'),
      ],
      edges: [{ id: 'inner-edge', source: 'inner-a', target: 'inner-b', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const source: GameGraph = {
      nodes: [{ ...n('container'), data: { name: '容器', subProcess: { entry: 'inner-a', graph: child } } }],
      edges: [],
    }
    const { graph: next, nodeIds } = duplicateNodes(source, ['container'])
    const copy = getSubProcess(next.nodes.find((node) => node.id === nodeIds[0])!.data)!
    const copiedEdge = copy.graph.edges[0]!

    expect(copy.entry).not.toBe('inner-a')
    expect(copy.graph.nodes.map((node) => node.id)).not.toContain('inner-a')
    expect(copiedEdge.id).not.toBe('inner-edge')
    expect(copiedEdge.source).toBe(copy.entry)
    const advance = copy.graph.nodes[0]!.data.reactions![0]!.do[0]
    expect(advance).toEqual({ kind: 'advance', edgeId: copiedEdge.id })
  })

  it('connect: 回填同名 event reaction 的 advance.edgeId', () => {
    const src: GameGraph = {
      nodes: [{
        ...n('a'),
        data: {
          name: 'a',
          overlayNodes: [{
            overlay: 'ov',
            reactions: [{ when: { type: 'event', id: 'pass' }, do: [{ kind: 'effect', effects: [] }] }],
          }],
        },
      }, n('b')],
      edges: [],
    }
    const g = connect(src, { source: 'a', sourceHandle: 'pass', target: 'b', id: 'e-pass' })
    const r = g.nodes[0]!.data.overlayNodes![0]!.reactions![0]!
    expect(r.do.some((a) => a.kind === 'advance' && a.edgeId === 'e-pass')).toBe(true)
  })

  it('disconnect: 清除指向该边的 advance；空 event reaction 一并删除', () => {
    const src: GameGraph = {
      nodes: [{
        ...n('a'),
        data: {
          name: 'a',
          overlayNodes: [{
            overlay: 'ov',
            reactions: [{ when: { type: 'event', id: 'pass' }, do: [{ kind: 'advance', edgeId: 'e-pass' }] }],
          }],
        },
      }, n('b')],
      edges: [{ id: 'e-pass', source: 'a', target: 'b', sourceHandle: 'pass', targetHandle: 'in' }],
    }
    const g = disconnect(src, 'e-pass')
    expect(g.edges.length).toBe(0)
    expect(g.nodes[0]!.data.overlayNodes![0]!.reactions).toBeUndefined()
  })

  it('connect: default 口不自动注入 advance', () => {
    const src: GameGraph = {
      nodes: [{
        ...n('a'),
        data: {
          name: 'a',
          reactions: [{ when: { type: 'event', id: 'default' }, do: [{ kind: 'effect', effects: [] }] }],
        },
      }, n('b')],
      edges: [],
    }
    const g = connect(src, { source: 'a', sourceHandle: 'default', target: 'b', id: 'e1' })
    expect(g.nodes[0]!.data.reactions![0]!.do.some((a) => a.kind === 'advance')).toBe(false)
  })

  it('connect: 无同名 event reaction 时自动创建含 advance 的 reaction', () => {
    const src: GameGraph = {
      nodes: [{
        ...n('a'),
        data: { name: 'a', overlayNodes: [{ overlay: 'ov' }] },
      }, n('b')],
      edges: [],
    }
    const g = connect(src, { source: 'a', sourceHandle: 'pass', target: 'b', id: 'e-pass' })
    const rs = g.nodes[0]!.data.overlayNodes![0]!.reactions!
    expect(rs).toHaveLength(1)
    expect(rs[0]).toEqual({
      when: { type: 'event', id: 'pass' },
      do: [{ kind: 'advance', edgeId: 'e-pass' }],
    })
  })

  it('connect: 新建 advance 挂到已有 event reaction 的挂载（非空 HUD）', () => {
    const src: GameGraph = {
      nodes: [{
        ...n('a'),
        data: {
          name: 'a',
          overlayNodes: [
            { overlay: 'hud' },
            {
              overlay: 'ov-qte',
              reactions: [{ when: { type: 'event', id: 'good' }, do: [{ kind: 'effect', effects: [] }] }],
            },
          ],
        },
      }, n('b')],
      edges: [],
    }
    const g = connect(src, { source: 'a', sourceHandle: 'pass', target: 'b', id: 'e-pass' })
    expect(g.nodes[0]!.data.overlayNodes![0]!.reactions).toBeUndefined()
    const rs = g.nodes[0]!.data.overlayNodes![1]!.reactions!
    expect(rs.some((r) => r.when.type === 'event' && r.when.id === 'pass')).toBe(true)
    expect(rs.find((r) => r.when.type === 'event' && r.when.id === 'pass')!.do).toEqual([
      { kind: 'advance', edgeId: 'e-pass' },
    ])
  })

  it('connect: 同 handle 第二条边时去掉独占 advance（走边池）', () => {
    const src: GameGraph = {
      nodes: [{
        ...n('a'),
        data: {
          name: 'a',
          overlayNodes: [{
            overlay: 'ov',
            reactions: [{
              when: { type: 'event', id: 'light' },
              do: [
                { kind: 'effect', effects: [] },
                { kind: 'advance', edgeId: 'e1' },
              ],
            }],
          }],
        },
      }, n('b'), n('c')],
      edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'light', targetHandle: 'in' }],
    }
    const g = connect(src, { source: 'a', sourceHandle: 'light', target: 'c', id: 'e2' })
    const r = g.nodes[0]!.data.overlayNodes![0]!.reactions![0]!
    expect(r.do.some((a) => a.kind === 'advance')).toBe(false)
    expect(r.do.some((a) => a.kind === 'effect')).toBe(true)
  })
})
