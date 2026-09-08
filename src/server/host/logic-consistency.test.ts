import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { validateProjectForActivity } from './project-inspection'

const encoder = new TextEncoder()

/**
 * 整装完成的判据是**流程逻辑自洽**，不是真跑（设计调整：见 e2e 观察日志）。
 *
 * 原因：运行时推进需要节点已绑定成片，而成片在后面的阶段才产生。把真跑放在这里，
 * `simulate_pass_a` 结构上必然失败——实测整装 peer 因此陷入「改边 → 试玩失败 →
 * 再改同样的边」的死循环。成片接入后可按需独立运行模拟，不占用 Agent workflow。
 */

interface NodeSpec { id: string, name?: string }
interface EdgeSpec { id: string, source: string, target: string, handle?: string }

function project(nodes: NodeSpec[], edges: EdgeSpec[], extra: Record<string, unknown> = {}) {
  const graph = {
    nodes: nodes.map((node, index) => ({
      id: node.id,
      type: 'scene',
      position: { x: index * 120, y: 0 },
      data: { name: node.name ?? node.id, chapterSummary: `${node.id} 概要`, storyText: `${node.id} 正文` },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.handle ?? 'default',
      targetHandle: 'in',
      data: {},
    })),
  }
  return {
    revision: 1,
    version: 'game-video.graph.v1',
    graph,
    manifest: { mainPackId: 'bp-main', packs: { 'bp-main': { id: 'bp-main', title: '主蓝图', entry: nodes[0]!.id, graph } } },
    variables: {},
    entities: {},
    formulas: {},
    ...extra,
  }
}

function context(doc: unknown): ExtensionContext {
  const files = new Map<string, Uint8Array>([
    ['blueprint.json', encoder.encode(JSON.stringify(doc))],
    ['assets/manifest.json', encoder.encode(JSON.stringify({ version: 2, assets: [] }))],
  ])
  return {
    gameId: 'logic',
    files: {
      async read(path: string) { return files.get(path) ?? null },
      async write(path: string, bytes: Uint8Array) { files.set(path, bytes) },
      async list() { return [...files.keys()] },
      async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>) { return operation() },
    },
    media: { async list() { return [] }, async read() { return null } },
  } as unknown as ExtensionContext
}

async function check(doc: unknown, checkId: string): Promise<{ status: string, codes: string[] }> {
  const result = await validateProjectForActivity(context(doc), 'playtest.validating', 1, [checkId])
  const evidence = result.evidence[0]!
  return { status: evidence.status, codes: (evidence.issues ?? []).map((entry) => entry.code) }
}

const linear = project(
  [{ id: 'entry' }, { id: 'mid' }, { id: 'end' }],
  [{ id: 'e1', source: 'entry', target: 'mid' }, { id: 'e2', source: 'mid', target: 'end' }],
)

describe('走不出去的循环', () => {
  it('线性到终局的图通过', async () => {
    expect(await check(linear, 'playtest.no-dead-loop')).toMatchObject({ status: 'pass' })
  })

  it('某个子图被默认出边一直自动带着转，且到不了任何停下来的地方：逐节点拦住', async () => {
    // dead-loop 的本义：这一段既到不了结局，也没有任何等观众点击的地方。
    // 注意 a / b 之间必须是**默认**出边——玩家点击构成的环是停得下来的，不算死循环。
    const trapped = project(
      [{ id: 'entry' }, { id: 'a' }, { id: 'b' }, { id: 'end' }],
      [
        { id: 'e1', source: 'entry', target: 'a', handle: 'A' },
        { id: 'e2', source: 'entry', target: 'end', handle: 'B' },
        { id: 'e3', source: 'a', target: 'b' },
        { id: 'e4', source: 'b', target: 'a' },
      ],
    )

    const result = await check(trapped, 'playtest.no-dead-loop')
    expect(result.status).toBe('fail')
    expect(result.codes).toContain('playtest.dead-loop')
  })

  it('多结局都算终局：不需要作者标记哪个是结局', async () => {
    // 结局的定义就是「没有出边」，所以有几个结局都成立，反向传播从全部终局一起出发。
    const multiEnding = project(
      [{ id: 'entry' }, { id: 'fork' }, { id: 'good' }, { id: 'bad' }, { id: 'secret' }],
      [
        { id: 'e1', source: 'entry', target: 'fork' },
        { id: 'e2', source: 'fork', target: 'good', handle: 'A' },
        { id: 'e3', source: 'fork', target: 'bad', handle: 'B' },
        { id: 'e4', source: 'fork', target: 'secret', handle: 'C' },
      ],
    )

    expect(await check(multiEnding, 'playtest.no-dead-loop')).toMatchObject({ status: 'pass' })
  })

  it('所有结局都由玩家点「再来一局」回到开头：合法的无限循环设计', async () => {
    // 引擎在「没有自动出边、只有事件出边」的节点上会停下等玩家（声明式等待），
    // 所以这种图观众随时能停在结局画面上，也可以主动点着再玩一轮。
    const playerDrivenLoop = project(
      [{ id: 'entry' }, { id: 'fork' }, { id: 'good' }, { id: 'bad' }],
      [
        { id: 'e1', source: 'entry', target: 'fork' },
        { id: 'e2', source: 'fork', target: 'good', handle: 'A' },
        { id: 'e3', source: 'fork', target: 'bad', handle: 'B' },
        { id: 'e4', source: 'good', target: 'entry', handle: 'replay' },
        { id: 'e5', source: 'bad', target: 'entry', handle: 'replay' },
      ],
    )

    expect(await check(playerDrivenLoop, 'playtest.no-dead-loop')).toMatchObject({ status: 'pass' })
  })

  it('整张图全是默认出边串成的环：观众被一直自动拖着走，拦住并指路', async () => {
    const autoLoop = project(
      [{ id: 'entry' }, { id: 'a' }, { id: 'b' }],
      [
        { id: 'e1', source: 'entry', target: 'a' },
        { id: 'e2', source: 'a', target: 'b' },
        { id: 'e3', source: 'b', target: 'entry' },
      ],
    )

    const result = await check(autoLoop, 'playtest.no-dead-loop')
    expect(result.status).toBe('fail')
    // 只报一条总结性的，而不是把每个节点都判死循环。
    expect(result.codes).toEqual(['playtest.no-rest-point'])
  })

  it('结局播完自动回到抉择点仍然合法：抉择点本身就是停得下来的地方', async () => {
    // 街机式循环：结局演出播完自动回到分叉，观众可以一直停在分叉上不选。
    const arcadeLoop = project(
      [{ id: 'entry' }, { id: 'fork' }, { id: 'good' }, { id: 'bad' }],
      [
        { id: 'e1', source: 'entry', target: 'fork' },
        { id: 'e2', source: 'fork', target: 'good', handle: 'A' },
        { id: 'e3', source: 'fork', target: 'bad', handle: 'B' },
        { id: 'e4', source: 'good', target: 'entry' },
        { id: 'e5', source: 'bad', target: 'entry' },
      ],
    )

    expect(await check(arcadeLoop, 'playtest.no-dead-loop')).toMatchObject({ status: 'pass' })
  })

  it('环里留了一条通向终局的出口就算合法：回溯与重试都会成环', async () => {
    const loopWithExit = project(
      [{ id: 'entry' }, { id: 'a' }, { id: 'b' }, { id: 'end' }],
      [
        { id: 'e1', source: 'entry', target: 'a' },
        { id: 'e2', source: 'a', target: 'b', handle: 'A' },
        { id: 'e3', source: 'b', target: 'a', handle: 'A' },
        { id: 'e4', source: 'b', target: 'end', handle: 'B' },
      ],
    )

    expect(await check(loopWithExit, 'playtest.no-dead-loop')).toMatchObject({ status: 'pass' })
  })
})

describe('孤岛与悬空出边', () => {
  it('完整连通的图通过', async () => {
    expect(await check(linear, 'playtest.no-orphan-exit')).toMatchObject({ status: 'pass' })
  })

  it('指向不存在节点的边被拦住', async () => {
    const dangling = project(
      [{ id: 'entry' }, { id: 'mid' }],
      [{ id: 'e1', source: 'entry', target: 'mid' }, { id: 'e2', source: 'mid', target: 'ghost' }],
    )

    const result = await check(dangling, 'playtest.no-orphan-exit')
    expect(result.status).toBe('fail')
    expect(result.codes).toContain('playtest.edge.dangling')
  })

  it('同一出口连出多条边被拦住：运行时只会走一条', async () => {
    const ambiguous = project(
      [{ id: 'entry' }, { id: 'a' }, { id: 'b' }],
      [
        { id: 'e1', source: 'entry', target: 'a' },
        { id: 'e2', source: 'entry', target: 'b' },
      ],
    )

    const result = await check(ambiguous, 'playtest.no-orphan-exit')
    expect(result.codes).toContain('playtest.edge.duplicate-handle')
  })

  it('从 entry 不可达的孤岛节点被拦住', async () => {
    const island = project(
      [{ id: 'entry' }, { id: 'mid' }, { id: 'lonely' }],
      [{ id: 'e1', source: 'entry', target: 'mid' }],
    )

    const result = await check(island, 'playtest.no-orphan-exit')
    expect(result.codes).toContain('graph.node.unreachable')
  })
})

describe('交互与规则可执行性', () => {
  it('事件出边没有任何界面元件提供对应事件时被拦住', async () => {
    const unreachableInteraction = project(
      [{ id: 'entry' }, { id: 'end' }],
      [{ id: 'choose', source: 'entry', target: 'end', handle: 'choose' }],
    )

    const result = await check(unreachableInteraction, 'playtest.interactions-reachable')
    expect(result.status).toBe('fail')
    expect(result.codes).toContain('ui.exit.no-source')
  })

  it('声明了状态却没有任何结算写回时被拦住', async () => {
    const noSettlement = project(
      [{ id: 'entry' }, { id: 'end' }],
      [{ id: 'e1', source: 'entry', target: 'end' }],
      { variables: { score: { id: 'score', initial: 0, min: 0, max: 10 } } },
    )

    const result = await check(noSettlement, 'playtest.rules-executable')
    expect(result.status).toBe('fail')
    expect(result.codes).toContain('finalization.settlements.missing')
  })
})

describe('数值设计合理性', () => {
  it('区间与初始值自洽时通过', async () => {
    const sane = project(
      [{ id: 'entry' }, { id: 'end' }],
      [{ id: 'e1', source: 'entry', target: 'end' }],
      { variables: { hp: { id: 'hp', name: '生命', initial: 10, min: 0, max: 20 } } },
    )

    expect(await check(sane, 'playtest.numeric-sanity')).toMatchObject({ status: 'pass' })
  })

  it('min 大于 max 被拦住', async () => {
    const inverted = project(
      [{ id: 'entry' }, { id: 'end' }],
      [{ id: 'e1', source: 'entry', target: 'end' }],
      { variables: { hp: { id: 'hp', initial: 5, min: 20, max: 0 } } },
    )

    const result = await check(inverted, 'playtest.numeric-sanity')
    expect(result.status).toBe('fail')
    expect(result.codes).toContain('playtest.variable.range-inverted')
  })

  it('初始值落在区间外被拦住', async () => {
    const outOfRange = project(
      [{ id: 'entry' }, { id: 'end' }],
      [{ id: 'e1', source: 'entry', target: 'end' }],
      { variables: { qi: { id: 'qi', initial: 99, min: 0, max: 10 } } },
    )

    const result = await check(outOfRange, 'playtest.numeric-sanity')
    expect(result.codes).toContain('playtest.variable.initial-out-of-range')
  })
})

describe('结局存在性（warn 级）', () => {
  it('一个真结局都没有时报 warn，但不阻塞完成', async () => {
    const endlessLoop = project(
      [{ id: 'entry' }, { id: 'fork' }, { id: 'good' }],
      [
        { id: 'e1', source: 'entry', target: 'fork' },
        { id: 'e2', source: 'fork', target: 'good', handle: 'A' },
        { id: 'e3', source: 'good', target: 'entry', handle: 'replay' },
      ],
    )

    const result = await validateProjectForActivity(
      context(endlessLoop),
      'game.finalizing',
      1,
      ['content.ending-presence'],
    )

    expect(result.evidence[0]!.status).toBe('warn')
    expect((result.evidence[0]!.issues ?? []).map((entry) => entry.code)).toContain('content.no-ending')
    // 刻意的循环设计不该被拦住。
    expect(result.ok).toBe(true)
  })

  it('有一个不再往外连边的收尾节点就不报', async () => {
    const result = await validateProjectForActivity(context(linear), 'game.finalizing', 1, ['content.ending-presence'])

    expect(result.evidence[0]!.status).toBe('pass')
  })
})
