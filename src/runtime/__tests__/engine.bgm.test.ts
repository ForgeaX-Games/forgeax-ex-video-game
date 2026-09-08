/**
 * 引擎 BGM 钩子（SPEC §4.2/§4.3/§4.4，**v2 语义**）：**配了就一直播**。
 * 节点上配 `bgm` = 起播并跨节点持续；**离开那个节点、弹 `callStack` 帧、局内清空 `callStack`
 * 都什么都不做**。结束只有两个来源：别处 `mode: 'stop'`、`jump`/清局。
 *
 * 断言面 = 引擎发出的 `bgm` 指令 + 会话快照（壳层真正消费的两个面）；`BgmStack` 自身的语义由
 * `bgm-stack.test.ts` 覆盖，这里钉的是「钩子挂在哪、什么时候必须沉默」。唯一的例外是
 * `bgmDepth` 探针：v2 的层不再随离开节点消失，「多轮循环不叠层」这条只能从层数看出来。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GraphRuntime } from '../core/engine/engine'
import { GraphSession } from '../core/engine/session'
import { isBgm, isPlayClip } from '../core/engine/directives'
import type { RuntimeDirective } from '../core/engine/directives'
import { registerComponent, unregisterComponent } from '../core/registry/component-registry'
import type { GameGraph, GameScenario, NodeBgm, Overlay, SubFlowPackDef } from '../core/schema/graph-schema'
import { node, rid, scnOf } from './test-fixtures'

const STORY = 'bgm-story'
const BATTLE = 'bgm-battle'
const BOSS = 'bgm-boss'

/** 一批指令里的床轨 ref 序列（`null` = 停播）；`[]` = 这一步没动过 BGM 栈。 */
const refs = (dirs: RuntimeDirective[]): (string | null)[] => dirs.filter(isBgm).map((d) => d.ref)
const lastBgm = (dirs: RuntimeDirective[]) => dirs.filter(isBgm).at(-1)
/** 换片序列：用来反证「真的跑了多轮」，而不是图短路了。 */
const clipsOf = (dirs: RuntimeDirective[]): string[] => dirs.filter(isPlayClip).map((d) => d.nodeId)

/**
 * BGM 栈深度探针。刻意从私有字段读——不为一条测试给引擎加公开面，`frames()` 本就是
 * `BgmStack` 的公开快照。v2 里「层数不随回合增长」是核心不变量，且**只能**从层数观察：
 * 同 ref 叠十层与只有一层，听感与指令流完全一样，直到有人 `stop()` 才暴露。
 */
const bgmDepth = (rt: GraphRuntime): number =>
  (rt as unknown as { bgm: { frames(): readonly unknown[] } }).bgm.frames().length

/** 带文档床轨的 scenario（`bgm` 挂根，与 `variables` 同级）。 */
const withStory = (graph: GameGraph, over: Partial<GameScenario> = {}): GameScenario =>
  scnOf(graph, { bgm: { ref: STORY, loop: true }, ...over })

const edge = (id: string, source: string, target: string, condition?: unknown) => ({
  id,
  source,
  target,
  sourceHandle: 'default',
  targetHandle: 'in',
  ...(condition ? { data: { condition } } : {}),
}) as GameGraph['edges'][number]

const varGte = (varId: string, value: number) => ({ all: [{ type: 'var', varId, op: 'gte', value }] })

/** `complete` 相位给变量加 1（回合计数）。 */
const countUp = (varId: string) => ({
  when: { type: 'complete' },
  do: [{ kind: 'effect', effects: [{ id: `${varId}-add`, kind: 'var', varId, op: 'add', value: 1 }] }],
})

const roundVars = { variables: { round: { id: 'round', name: 'round', initial: 0 } } }

/** 反复 onPerformanceEnd 把图推到底，收集全过程指令（瞬时节点由引擎自己穿链）。 */
function runToEnd(rt: GraphRuntime, maxSteps = 60): RuntimeDirective[] {
  const out: RuntimeDirective[] = [...rt.start()]
  for (let i = 0; i < maxSteps && rt.state.phase === 'playing'; i++) out.push(...rt.onPerformanceEnd())
  return out
}

const packOf = (id: string, entry: string, graph: GameGraph): SubFlowPackDef => ({ id, version: '1', entry, graph })

function runtimeWithRootEntry(
  scenario: GameScenario,
  entry: string,
  dependencies: readonly SubFlowPackDef[],
): GraphRuntime {
  const rootId = '__test-root__'
  return new GraphRuntime(
    scenario.graph,
    scenario,
    undefined,
    [packOf(rootId, entry, scenario.graph), ...dependencies],
    rootId,
  )
}

describe('文档默认床轨（scenario.bgm）', () => {
  const solo = (): GameGraph => ({ nodes: [node('n1', { durationMs: 100 })], edges: [] })

  it('start 压栈底床轨：一条指令，从头起播', () => {
    const scn = withStory(solo())
    const dirs = new GraphRuntime(scn.graph, scn).start()
    expect(refs(dirs)).toEqual([STORY])
    expect(lastBgm(dirs)).toMatchObject({ ref: STORY, loop: true, restart: true, volume: 1 })
  })

  it('无 scenario.bgm → 静音起局，一条 bgm 指令都不发', () => {
    const scn = scnOf(solo())
    expect(refs(new GraphRuntime(scn.graph, scn).start())).toEqual([])
  })

  // 淡出恒取自**离场**那一帧，而文档床的离场就是「叙事 → 战斗」这条最常听到的转场。
  // 少了 `DocumentBgm.fadeOutMs`，它只能 0ms 掉到静音、再由战斗床自己淡入 = 一段听得出的空档。
  it('文档床的 fadeOutMs 在被节点作用域压住时生效（旗舰转场能对淡）', () => {
    const scn = scnOf(graphA(), { bgm: { ref: STORY, loop: true, fadeOutMs: 1200 } })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    expect(lastBgm(rt.onPerformanceEnd())).toMatchObject({ ref: BATTLE, fadeInMs: 400, fadeOutMs: 1200 })
  })
})

// ── 图 A：平铺普通节点 ────────────────────────────────────────────────────────
/** `n1`(无 bgm) → `s`(battle) → `n2`(无 bgm)。 */
function graphA(): GameGraph {
  return {
    nodes: [
      node('n1', { durationMs: 100 }),
      node('s', { durationMs: 100, bgm: { ref: BATTLE, fadeInMs: 400, fadeOutMs: 600 } }),
      node('n2', { durationMs: 100 }),
    ],
    edges: [edge('e1', 'n1', 's'), edge('e2', 's', 'n2')],
  }
}

describe('§9-1 节点层默认粘住（v2 与初版的核心差别）', () => {
  it('进入带 bgm 的节点起播；**走边离开后仍在响**，一条指令都不再发', () => {
    const scn = withStory(graphA())
    const rt = new GraphRuntime(scn.graph, scn)
    expect(refs(rt.start())).toEqual([STORY])

    const toS = rt.onPerformanceEnd()
    expect(rt.state.currentNodeId).toBe('s')
    expect(refs(toS)).toEqual([BATTLE])
    expect(lastBgm(toS)).toMatchObject({ ref: BATTLE, fadeInMs: 400, restart: true })

    // v2：离开 `s` 不是结束信号（初版在这里 pop 回 STORY）。
    const toN2 = rt.onPerformanceEnd()
    expect(rt.state.currentNodeId).toBe('n2')
    expect(refs(toN2)).toEqual([])
    expect(bgmDepth(rt)).toBe(2) // 文档床 + s 那层，仍在栈上
  })

  it('会话快照：离开该节点、乃至走到本局结束，快照里仍是 battle（引擎不在 ended 上停播）', () => {
    const s = new GraphSession(withStory(graphA()))
    expect(s.start().bgm?.ref).toBe(STORY)
    expect(s.performanceEnd().bgm?.ref).toBe(BATTLE) // → s
    const left = s.performanceEnd() // → n2，已离开 s
    expect(left.currentNodeId).toBe('n2')
    expect(left.bgm?.ref).toBe(BATTLE)
    const ended = s.performanceEnd() // n2 无出边 → 本局结束
    expect(ended.phase).toBe('ended')
    expect(ended.bgm?.ref).toBe(BATTLE)
  })

  it('volume-only 节点调整当前曲目音量，不换曲、不重开、不增加栈深', () => {
    const g: GameGraph = {
      nodes: [
        node('a', { durationMs: 100, bgm: { ref: BATTLE, volume: 0.8 } }),
        node('b', { durationMs: 100, bgm: { volume: 0.35 } }),
        node('c', { durationMs: 100 }),
      ],
      edges: [edge('e-ab', 'a', 'b'), edge('e-bc', 'b', 'c')],
    }
    const scn = withStory(g)
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    const toB = rt.onPerformanceEnd()
    expect(lastBgm(toB)).toMatchObject({ ref: BATTLE, volume: 0.35, restart: false })
    expect(bgmDepth(rt)).toBe(2)
    expect(refs(rt.onPerformanceEnd())).toEqual([])
  })

  it('volume-only 调低后回到曲目 owner，恢复 owner 配置的音量', () => {
    const g: GameGraph = {
      nodes: [
        node('a', { durationMs: 100, bgm: { ref: BATTLE, volume: 0.8 } }),
        node('b', { durationMs: 100, bgm: { volume: 0.35 } }),
      ],
      edges: [edge('e-ab', 'a', 'b'), edge('e-ba', 'b', 'a')],
    }
    const scn = withStory(g)
    const rt = new GraphRuntime(scn.graph, scn)
    expect(lastBgm(rt.start())).toMatchObject({ ref: BATTLE, volume: 0.8 })
    expect(lastBgm(rt.onPerformanceEnd())).toMatchObject({ ref: BATTLE, volume: 0.35, restart: false })
    expect(lastBgm(rt.onPerformanceEnd())).toMatchObject({ ref: BATTLE, volume: 0.8, restart: false })
    expect(bgmDepth(rt)).toBe(2)
  })

  it('volume-only 节点在静音状态下无操作', () => {
    const scn = scnOf({ nodes: [node('quiet', { durationMs: 100, bgm: { volume: 0.35 } })], edges: [] })
    const rt = new GraphRuntime(scn.graph, scn)
    expect(refs(rt.start())).toEqual([])
    expect(bgmDepth(rt)).toBe(0)
  })

  it('无 bgm 的节点进出全程沉默（栈没变就不发指令）', () => {
    const g: GameGraph = {
      nodes: [node('n1', { durationMs: 100 }), node('n2', { durationMs: 100 })],
      edges: [edge('e', 'n1', 'n2')],
    }
    const scn = withStory(g)
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    expect(refs(rt.onPerformanceEnd())).toEqual([])
  })

  it('后一个节点再配一首 → 压住前一首（栈加深，不是替换）', () => {
    const g: GameGraph = {
      nodes: [
        node('s1', { durationMs: 100, bgm: { ref: BATTLE, fadeOutMs: 600 } }),
        node('s2', { durationMs: 100, bgm: { ref: BOSS } }),
      ],
      edges: [edge('e', 's1', 's2')],
    }
    const scn = withStory(g)
    const rt = new GraphRuntime(scn.graph, scn)
    expect(refs(rt.start())).toEqual([STORY, BATTLE]) // 入口节点自己就带床
    expect(refs(rt.onPerformanceEnd())).toEqual([BOSS])
    expect(bgmDepth(rt)).toBe(3)
  })
})

// ── §9-2 mode: 'stop' ────────────────────────────────────────────────────────
describe("§9-2 mode: 'stop'：结束当前层，回到上一层还没结束的", () => {
  /** `s1`(battle) → `s2`(boss) → `w1`(stop) → `w2`(stop)，全程平铺、无容器。 */
  const g = (): GameGraph => ({
    nodes: [
      node('s1', { durationMs: 100, bgm: { ref: BATTLE, fadeOutMs: 600 } }),
      node('s2', { durationMs: 100, bgm: { ref: BOSS, fadeOutMs: 300 } }),
      node('w1', { durationMs: 100, bgm: { mode: 'stop' } }),
      node('w2', { durationMs: 100, bgm: { mode: 'stop' } }),
    ],
    edges: [edge('e1', 's1', 's2'), edge('e2', 's2', 'w1'), edge('e3', 'w1', 'w2')],
  })

  it('逐层回退：stop → 上一层未结束的（boss → battle → story），淡出取自离场帧', () => {
    const scn = withStory(g())
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start() // s1: story + battle
    rt.onPerformanceEnd() // s2: boss
    const back1 = rt.onPerformanceEnd() // w1: stop → battle
    expect(refs(back1)).toEqual([BATTLE])
    expect(lastBgm(back1)).toMatchObject({ ref: BATTLE, fadeOutMs: 300, restart: true })
    const back2 = rt.onPerformanceEnd() // w2: stop → story
    expect(refs(back2)).toEqual([STORY])
    expect(lastBgm(back2)).toMatchObject({ ref: STORY, fadeOutMs: 600 })
    expect(bgmDepth(rt)).toBe(1) // 只剩文档床
  })

  it('D13 文档床是地板：只剩文档床时 stop 一条指令都不发（多写一个 stop 不会哑掉整局）', () => {
    const scn = withStory({
      nodes: [node('n1', { durationMs: 100 }), node('w', { durationMs: 100, bgm: { mode: 'stop' } })],
      edges: [edge('e', 'n1', 'w')],
    })
    const rt = new GraphRuntime(scn.graph, scn)
    expect(refs(rt.start())).toEqual([STORY])
    expect(refs(rt.onPerformanceEnd())).toEqual([])
    expect(bgmDepth(rt)).toBe(1)
  })

  it('无文档床时 stop 掉唯一一层 = 停播（ref null，只有 fadeOutMs 有意义）', () => {
    const scn = scnOf({
      nodes: [
        node('s', { durationMs: 100, bgm: { ref: BATTLE, fadeOutMs: 600 } }),
        node('w', { durationMs: 100, bgm: { mode: 'stop' } }),
      ],
      edges: [edge('e', 's', 'w')],
    })
    const rt = new GraphRuntime(scn.graph, scn)
    expect(refs(rt.start())).toEqual([BATTLE])
    const off = rt.onPerformanceEnd()
    expect(refs(off)).toEqual([null])
    expect(lastBgm(off)).toMatchObject({ ref: null, fadeOutMs: 600 })
  })
})

// ── §9-3 容器不是作用域：弹 callStack 帧一律不动 BGM 栈 ────────────────────────
describe('§9-3a 包内起播：内层帧与包帧弹出全程沉默（音乐跟着出包继续响）', () => {
  /** 主图：`n1` → `combat`(subFlowPack，**不配 bgm**) → `after`。 */
  const main = (): GameGraph => ({
    nodes: [
      node('n1', { durationMs: 100 }),
      node('combat', { subFlowPack: { id: 'bp-combat', version: '1' } }),
      node('after', { durationMs: 100 }),
    ],
    edges: [edge('e-n1', 'n1', 'combat'), edge('e-out', 'combat', 'after')],
  })
  /** 包内：入口起播；`p_skill` 是无 bgm 的内层容器，每次压弹都**不得**误结束战斗床。 */
  const pack = () =>
    packOf(
      'bp-combat',
      'p_enter',
      {
        nodes: [
          node('p_enter', { durationMs: 100, bgm: { ref: BATTLE, fadeInMs: 800, fadeOutMs: 600 } }),
          node('p_skill', { subProcess: { entry: 'p_hit', graph: {
            nodes: [node('p_hit', { durationMs: 100 })],
            edges: [],
          } } }),
          node('p_end', {}),
        ],
        edges: [edge('e-pe', 'p_enter', 'p_skill'), edge('e-ps', 'p_skill', 'p_end')],
      },
    )

  it('内层压弹与出包都不发指令；回到主图时战斗床仍在栈顶', () => {
    const scn = withStory(main())
    const rt = new GraphRuntime(scn.graph, scn, undefined, [pack()])
    expect(refs(rt.start())).toEqual([STORY])
    expect(refs(rt.onPerformanceEnd())).toEqual([BATTLE]) // n1 → combat(切图) → p_enter
    expect(rt.state.currentNodeId).toBe('p_enter')

    // 包内 `p_skill` 下钻到 p_hit：深度 1 → 2，与战斗床无关。
    expect(refs(rt.onPerformanceEnd())).toEqual([])
    expect(rt.state.currentNodeId).toBe('p_hit')
    // p_hit 无出边 → 弹 p_skill 帧（2 → 1），同一步里 p_end 又弹了 combat 帧（1 → 0）：
    // 两次弹帧都不动 BGM 栈，战斗床活着。这一步正是 §1.1「不得因出子流程误切回叙事曲」。
    expect(refs(rt.onPerformanceEnd())).toEqual([])
    expect(rt.state.currentNodeId).toBe('after')
    expect(rt.state.callStack).toEqual([])
    expect(bgmDepth(rt)).toBe(2)
  })

  it('内层帧单独弹出时同样沉默（把出包那一步隔开看）', () => {
    // 包内终端 `p_tail` 把「弹内层帧」与「弹包帧」分到两步。
    const p = packOf('bp-combat', 'p_enter', {
      nodes: [
        node('p_enter', { durationMs: 100, bgm: { ref: BATTLE, fadeOutMs: 600 } }),
        node('p_skill', { subProcess: { entry: 'p_hit', graph: {
          nodes: [node('p_hit', { durationMs: 100 })],
          edges: [],
        } } }),
        node('p_tail', { durationMs: 100 }),
      ],
      edges: [edge('e-pe', 'p_enter', 'p_skill'), edge('e-ps', 'p_skill', 'p_tail')],
    })
    const scn = withStory(main())
    const rt = new GraphRuntime(scn.graph, scn, undefined, [p])
    rt.start()
    rt.onPerformanceEnd() // → p_enter（battle）
    rt.onPerformanceEnd() // → p_skill descend → p_hit
    expect(refs(rt.onPerformanceEnd())).toEqual([]) // 弹 p_skill 帧 → p_tail
    expect(rt.state.currentNodeId).toBe('p_tail')
    expect(refs(rt.onPerformanceEnd())).toEqual([]) // 弹 combat 帧出包 → 照样沉默
    expect(bgmDepth(rt)).toBe(2)
  })
})

describe('§9-3b 容器节点本身配 bgm：与普通节点同一套寿命（弹回外层不结束）', () => {
  /** `combat` 是 subFlow 容器，自己配一首；内层还有一层子流程反复压弹。 */
  const g = (): GameGraph => ({
    nodes: [
      node('n1', { durationMs: 100 }),
      node('combat', {
        bgm: { ref: BATTLE, fadeOutMs: 600 },
        subProcess: { entry: 'enter', graph: {
          nodes: [
            node('enter', { durationMs: 100 }),
            node('skill', {
              reactions: [countUp('round')],
              subProcess: { entry: 'hit', graph: { nodes: [node('hit', { durationMs: 100 })], edges: [] } },
            }),
            node('t_end', {}),
          ],
          edges: [
            edge('e-es', 'enter', 'skill'),
            edge('e-end', 'skill', 't_end', varGte('round', 2)),
            edge('e-loop', 'skill', 'enter'),
          ],
        } },
      }),
      node('after', { durationMs: 100 }),
    ],
    edges: [
      edge('e-n1', 'n1', 'combat'),
      edge('e-out', 'combat', 'after'),
    ],
  })

  it('descend 那一刻起播；内层多回合压弹沉默；容器帧弹出也沉默（整局只两条指令）', () => {
    const scn = withStory(g(), roundVars)
    const rt = new GraphRuntime(scn.graph, scn)
    const all = runToEnd(rt)
    expect(rt.state.traversedEdgeIds.has('e-loop')).toBe(true) // 真的跑了 ≥2 回合
    expect(refs(all)).toEqual([STORY, BATTLE])
    expect(rt.state.currentNodeId).toBe('after')
    expect(bgmDepth(rt)).toBe(2)
  })

  it('容器 returning 再 enter 不二次起播（§4.4：否则每轮多叠一层）', () => {
    const scn = withStory(g(), roundVars)
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    rt.onPerformanceEnd() // n1 → combat descend（battle）→ enter
    expect(bgmDepth(rt)).toBe(2)
    // 整局跑完：容器帧弹出→returning 再 enter combat 走的是 advance（不再 descend），全程只这一层。
    for (let i = 0; i < 30 && rt.state.phase === 'playing'; i++) {
      rt.onPerformanceEnd()
      expect(bgmDepth(rt)).toBeLessThanOrEqual(2)
    }
    expect(rt.state.currentNodeId).toBe('after')
    expect(bgmDepth(rt)).toBe(2)
  })
})

/**
 * 去掉 `endsWithScope` 后**被产品明确接受**的后果（2026-07-27 决策）：包只能靠自己出口终端上的
 * `mode: 'stop'` 收摊；从别的路径离开包时，包起播的那首会**漏给调用方**继续播。
 * 这条钉住的是「它是决策，不是漏改」——真要改回自动结束，得先改这条。
 */
describe('接受的后果：包没走 stop 出去 → 音乐漏给调用方', () => {
  /** 包内两条出口：`p_win` 写了 stop（自洽），`p_flee` 什么都不写（漏）。 */
  const packWithExits = (exit: 'p_win' | 'p_flee') =>
    packOf('bp-combat', 'p_enter', {
      nodes: [
        node('p_enter', { durationMs: 100, bgm: { ref: BATTLE, fadeOutMs: 600 } }),
        node('p_win', { durationMs: 100, bgm: { mode: 'stop' } }),
        node('p_flee', { durationMs: 100 }),
      ],
      edges: [edge('e-out', 'p_enter', exit)],
    })
  const main = (): GameGraph => ({
    nodes: [
      node('combat', { subFlowPack: { id: 'bp-combat', version: '1' } }),
      node('after', { durationMs: 100 }),
    ],
    edges: [edge('e-after', 'combat', 'after')],
  })

  function runPack(exit: 'p_win' | 'p_flee'): { rt: GraphRuntime; all: RuntimeDirective[] } {
    const scn = withStory(main())
    const rt = new GraphRuntime(scn.graph, scn, undefined, [packWithExits(exit)])
    const all = runToEnd(rt)
    expect(rt.state.currentNodeId).toBe('after') // 两条路都真的出了包
    return { rt, all }
  }

  it('出口终端写了 mode: stop → 包自洽，出包回叙事床', () => {
    const { rt, all } = runPack('p_win')
    expect(refs(all)).toEqual([STORY, BATTLE, STORY])
    expect(bgmDepth(rt)).toBe(1)
  })

  it('出口终端没写 stop → 战斗床跟着出包，在调用方继续响（不再有自动结束）', () => {
    const { rt, all } = runPack('p_flee')
    expect(refs(all)).toEqual([STORY, BATTLE])
    expect(bgmDepth(rt)).toBe(2)
  })
})

/**
 * 上一条的**最坏形态**，SPEC §9 风险表「漏播的包被放在循环里 → 每转一圈叠一层，无上限」那一行
 * 就指着本用例。同样是**已接受的后果**，不是待修的 bug：真要给它加防线，先改 SPEC（§6.2 的
 * WARNING + §9 那一行），再让下面这条明确的断言红掉——别把它当成一次莫名其妙的失败改掉。
 *
 * 为什么两道现有防线都拦不住（这正是它值得单独钉一条的原因）：
 * - **栈顶防重压守卫**（`engine.ts` `applyNodeBgm` 的 `top?.owner !== owner`）：再进包时栈顶是
 *   环里**另一个** pusher 的层，owner 不同 → 照压。守卫只挡「同一个节点连着自己」。
 * - **`bgm.cycle.stacking`**（`validate.ts` `checkBgmStackingCycle`）：它只走单张图。包内那个
 *   pusher 在另一张图里，主图的容器节点自身没配 `bgm` → 环里只数得出 1 个 pusher，闭嘴。
 *
 * 于是一张能爬到深度 20 的图，今天全套测试都是绿的——除了这一条。
 */
describe('接受的后果（最坏形态）：漏播在循环里会逐圈叠加，无上限', () => {
  const LOOP_ROUNDS = 4
  /** 环里的另一个 pusher：它和包内那个 pusher 交替占据栈顶，于是两边的守卫都认不出对方。 */
  const loopPusher = { ref: BOSS, fadeOutMs: 300 }

  /** 主图的环：`enter`(pusher) → `combat`(容器，**自身不配 bgm**) → 回 `enter`；跑满 rounds 出环。 */
  const main = (): GameGraph => ({
    nodes: [
      node('enter', { durationMs: 100, bgm: loopPusher, reactions: [countUp('round')] }),
      node('combat', { subFlowPack: { id: 'bp-combat', version: '1' } }),
      node('after', { durationMs: 100 }),
    ],
    edges: [
      edge('e-ec', 'enter', 'combat'),
      edge('e-ca', 'combat', 'after', varGte('round', LOOP_ROUNDS)),
      edge('e-ce', 'combat', 'enter'), // 无条件兜底 = 回环
    ],
  })
  /** 漏播的包：起播自己那首，出口终端 `p_end` **没有** `mode: 'stop'`。 */
  const leakyPack = () =>
    packOf('bp-combat', 'p_enter', {
      nodes: [
        node('p_enter', { durationMs: 100, bgm: { ref: BATTLE, fadeOutMs: 600 } }),
        node('p_end', {}),
      ],
      edges: [edge('e-pe', 'p_enter', 'p_end')],
    })

  it('每圈 +2 层（环里的 pusher 一层、包里的 pusher 一层），一路涨到出环', () => {
    const scn = withStory(main(), roundVars)
    const rt = runtimeWithRootEntry(scn, 'enter', [leakyPack()])
    const depths: number[] = []
    // 每次走进 `enter` 记一次栈深；起局那次也算（start 进入蓝图 entry）。
    rt.start()
    depths.push(bgmDepth(rt))
    for (let i = 0; i < 40 && rt.state.phase === 'playing'; i++) {
      rt.onPerformanceEnd()
      if (rt.state.currentNodeId === 'enter') depths.push(bgmDepth(rt))
    }

    // 先自证图真的转满了圈、也真的进出过包（否则「涨」可能只是走了一条直路）。
    expect(rt.state.traversedEdgeIds.has('e-ce')).toBe(true)
    expect(rt.state.traversedEdgeIds.has('e-pe')).toBe(true)
    expect(rt.state.vars.round).toBe(LOOP_ROUNDS)
    expect(rt.state.currentNodeId).toBe('after')

    // 断言写成**显式的增长序列**而不是 `toBeGreaterThan`：日后谁加了防线，看到的是
    // 「期望 [2,4,6,8] 拿到 [2,2,2,2]」这种一眼能读懂的红，而不是一句含糊的比较失败。
    // 文档床 1 层 + 每圈两个 pusher 各一层 → 第 k 次走进 enter 时深度 = 2k。
    expect(depths).toEqual([2, 4, 6, 8])
    // 出环时那些层一个都没退（谁都没写 stop）：环里叠了几层就留几层。
    expect(bgmDepth(rt)).toBe(2 * LOOP_ROUNDS + 1)
  })

  it('包的出口终端补上 mode: stop 就不再叠：同一张图恒定 2 层', () => {
    // 反证前一条测的是「漏」而不是「循环本身会叠」：唯一的差别就是 `p_end` 上那一句 stop。
    const tightPack = packOf('bp-combat', 'p_enter', {
      nodes: [
        node('p_enter', { durationMs: 100, bgm: { ref: BATTLE, fadeOutMs: 600 } }),
        node('p_end', { bgm: { mode: 'stop' } }),
      ],
      edges: [edge('e-pe', 'p_enter', 'p_end')],
    })
    const scn = withStory(main(), roundVars)
    const rt = runtimeWithRootEntry(scn, 'enter', [tightPack])
    const depths: number[] = []
    rt.start()
    depths.push(bgmDepth(rt))
    for (let i = 0; i < 40 && rt.state.phase === 'playing'; i++) {
      rt.onPerformanceEnd()
      if (rt.state.currentNodeId === 'enter') depths.push(bgmDepth(rt))
    }

    expect(rt.state.currentNodeId).toBe('after')
    expect(rt.state.vars.round).toBe(LOOP_ROUNDS)
    // 包每圈自己收摊 → 回到 enter 时栈顶恒是 enter 自己那层，守卫接手，一层都不多。
    expect(depths).toEqual([2, 2, 2, 2])
    expect(bgmDepth(rt)).toBe(2)
  })
})

// ── §9-5 多回合循环：层数与指令数都不随轮数增长 ──────────────────────────────
/** 平铺回合循环（§6.1 形状的最小版）：`enter`(配床) ⇄ `beat`，跑满 rounds 轮后走 `win`(stop)。 */
function loopGraph(rounds: number, bgm: NodeBgm): GameGraph {
  return {
    nodes: [
      node('n1', { durationMs: 100 }),
      node('enter', { durationMs: 100, bgm }),
      node('beat', { durationMs: 100, reactions: [countUp('round')] }),
      node('win', { durationMs: 100, bgm: { mode: 'stop' } }),
    ],
    edges: [
      edge('e-n1', 'n1', 'enter'),
      edge('e-eb', 'enter', 'beat'),
      edge('e-bw', 'beat', 'win', varGte('round', rounds)),
      edge('e-loop', 'beat', 'enter'),
    ],
  }
}

function runLoop(rounds: number, bgm: NodeBgm): { rt: GraphRuntime; all: RuntimeDirective[] } {
  const scn = withStory(loopGraph(rounds, bgm), roundVars)
  const rt = new GraphRuntime(scn.graph, scn)
  const all = runToEnd(rt)
  // 自证真的跑满了：回环边走过、`enter` 换了 rounds 次片。
  expect(rt.state.traversedEdgeIds.has('e-loop')).toBe(true)
  expect(clipsOf(all).filter((id) => id === 'enter')).toHaveLength(rounds)
  expect(rt.state.currentNodeId).toBe('win')
  return { rt, all }
}

describe('§9-5 多回合循环回同一个配了 bgm 的节点：不叠层、不重开', () => {
  it('循环 6 轮与 2 轮的指令流逐条相同，栈深恒为 2（文档床 + 战斗床）', () => {
    const two = runLoop(2, { ref: BATTLE, fadeInMs: 800, fadeOutMs: 600 })
    const six = runLoop(6, { ref: BATTLE, fadeInMs: 800, fadeOutMs: 600 })
    expect(refs(two.all)).toEqual([STORY, BATTLE, STORY])
    expect(refs(six.all)).toEqual(refs(two.all))
    // 指令**总数**也不许随轮数长（哪怕 ref 没变的重复指令都会让壳层重开解码）。
    expect(six.all.filter(isBgm)).toHaveLength(3)
    expect(bgmDepth(six.rt)).toBe(1) // win 的 stop 已收掉战斗床，只剩文档床
  })

  it('循环途中层数不增长：每轮回到 enter 时栈深恒为 2', () => {
    const scn = withStory(loopGraph(4, { ref: BATTLE, fadeOutMs: 600 }), roundVars)
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    const depths: number[] = []
    for (let i = 0; i < 40 && rt.state.phase === 'playing'; i++) {
      rt.onPerformanceEnd()
      if (rt.state.currentNodeId === 'enter') depths.push(bgmDepth(rt))
    }
    expect(depths).toEqual([2, 2, 2, 2])
    expect(rt.state.currentNodeId).toBe('win')
    // 层数没长 → 一次 stop 就回得到叙事床（叠了 4 层的话这里还是 battle）。
    expect(bgmDepth(rt)).toBe(1)
  })

  it('restart: true 的循环节点每轮从头播，但**照样不叠层**（栈深恒为 2）', () => {
    const { rt, all } = runLoop(3, { ref: BATTLE, restart: true, fadeOutMs: 600 })
    expect(refs(all)).toEqual([STORY, BATTLE, BATTLE, BATTLE, STORY]) // 每轮一条重开指令
    expect(all.filter(isBgm).every((d) => d.restart)).toBe(true)
    expect(bgmDepth(rt)).toBe(1)
    // 反证：默认 restart 缺省时同一张图只发三条（上一例），差别只来自作者显式勾的 restart。
  })
})

// ── §9-6 replace ────────────────────────────────────────────────────────────
describe('§9-6 replace：不加深栈、不记住上一首', () => {
  it('换曲后栈深不变；随后 stop 回到的是 replace **之前**那一层的下面（story，不是 battle）', () => {
    const g: GameGraph = {
      nodes: [
        node('s', { durationMs: 100, bgm: { ref: BATTLE, fadeOutMs: 600 } }),
        node('r', { durationMs: 100, bgm: { ref: BOSS, mode: 'replace', fadeOutMs: 300 } }),
        node('w', { durationMs: 100, bgm: { mode: 'stop' } }),
      ],
      edges: [edge('e-sr', 's', 'r'), edge('e-rw', 'r', 'w')],
    }
    const scn = withStory(g)
    const rt = new GraphRuntime(scn.graph, scn)
    expect(refs(rt.start())).toEqual([STORY, BATTLE])
    expect(bgmDepth(rt)).toBe(2)
    expect(refs(rt.onPerformanceEnd())).toEqual([BOSS])
    expect(bgmDepth(rt)).toBe(2) // 栈深不变 = 没记住 battle
    const back = rt.onPerformanceEnd()
    expect(refs(back)).toEqual([STORY])
    expect(lastBgm(back)).toMatchObject({ ref: STORY, fadeOutMs: 300 })
  })

  // 两次普通面板操作就能走到：游戏设置里配了文档床 + 战斗入口选「换曲，不记住上一首」。
  // 若 replace 就地改写地板，那一层的 owner 仍是 `__doc__` → 后面的 `stop` 全是静默 no-op，
  // 战斗曲从此就是这一局的地板（`NodeInspector` / `ScenarioInspector` 都承诺地板活着）。
  it('文档床之上第一条 replace 压的是**新的一层**：随后的 stop 回得到文档床原曲', () => {
    const g: GameGraph = {
      nodes: [
        node('n1', { durationMs: 100 }),
        node('enter', { durationMs: 100, bgm: { ref: BATTLE, mode: 'replace', fadeOutMs: 600 } }),
        node('win', { durationMs: 100, bgm: { mode: 'stop' } }),
      ],
      edges: [edge('e-ne', 'n1', 'enter'), edge('e-ew', 'enter', 'win')],
    }
    const scn = withStory(g)
    const rt = new GraphRuntime(scn.graph, scn)
    expect(refs(rt.start())).toEqual([STORY])
    expect(refs(rt.onPerformanceEnd())).toEqual([BATTLE])
    expect(bgmDepth(rt)).toBe(2) // 地板还在下面
    const back = rt.onPerformanceEnd()
    expect(refs(back)).toEqual([STORY])
    expect(lastBgm(back)).toMatchObject({ ref: STORY, fadeOutMs: 600 })
    expect(bgmDepth(rt)).toBe(1)
  })
})

// ── §9-7 restart: false 续播 ─────────────────────────────────────────────────
describe('§9-7 restart: false（默认）续播', () => {
  it('另一个节点再配同一首 → 指令 restart 为 false（壳层别碰播放头）', () => {
    const g: GameGraph = {
      nodes: [
        node('s1', { durationMs: 100, bgm: { ref: BATTLE } }),
        node('s2', { durationMs: 100, bgm: { ref: BATTLE } }),
        node('s3', { durationMs: 100, bgm: { ref: BATTLE, restart: true } }),
      ],
      edges: [edge('e1', 's1', 's2'), edge('e2', 's2', 's3')],
    }
    const scn = withStory(g)
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    expect(lastBgm(rt.onPerformanceEnd())).toMatchObject({ ref: BATTLE, restart: false })
    expect(lastBgm(rt.onPerformanceEnd())).toMatchObject({ ref: BATTLE, restart: true })
  })
})

// ── owner 命名空间：nodeId 只在蓝图内唯一 ─────────────────────────────────────
/**
 * 跨图同名 id 撞车探针。`switchGraph → indexGraph` 每次按蓝图重建 `this.nodes`，所以 nodeId 只在
 * **本蓝图内**唯一：可复用包里叫 `combat` / `enter` 的通名节点跟主图 caller 同名是常态。
 * owner 若是裸 nodeId，包内那个同名节点起播时会被当成「自己那层已在栈顶」→ 就地 replace 掉
 * 主图容器的层（v2 的叠层守卫正是按 owner 判的），出包后再 `stop` 就回不到战斗床了。
 */
describe('owner 按蓝图命名空间隔离（跨图同名 nodeId 不得互认对方的层）', () => {
  const main = (): GameGraph => ({
    nodes: [
      node('n1', { durationMs: 100 }),
      node('combat', { subFlowPack: { id: 'bp-combat' }, bgm: { ref: BATTLE, fadeOutMs: 600 } }),
      node('after', { durationMs: 100 }),
    ],
    edges: [edge('e-n1', 'n1', 'combat'), edge('e-out', 'combat', 'after')],
  })
  /** 包内入口与主图 caller **同名**，且自己也配了一首；随后包内 `p_stop` 结束它。 */
  const pack = packOf('bp-combat', 'combat', {
    nodes: [
      node('combat', { durationMs: 100, bgm: { ref: BOSS, fadeOutMs: 300 } }),
      node('p_stop', { durationMs: 100, bgm: { mode: 'stop' } }),
    ],
    edges: [edge('e-cs', 'combat', 'p_stop')],
  })

  it('包内同名节点压的是**新的一层**：stop 之后回到主图容器那首（不是叙事床）', () => {
    const scn = withStory(main())
    const rt = new GraphRuntime(scn.graph, scn, undefined, [pack])
    expect(refs(rt.start())).toEqual([STORY])
    expect(refs(rt.onPerformanceEnd())).toEqual([BATTLE, BOSS]) // descend 压 battle，包内同名节点压 boss
    expect(bgmDepth(rt)).toBe(3)
    const back = rt.onPerformanceEnd() // p_stop
    expect(refs(back)).toEqual([BATTLE])
    expect(lastBgm(back)).toMatchObject({ ref: BATTLE, fadeOutMs: 300 })
  })
})

// ── 作用域全灭：jump / 硬打断 / 容器出边事件 ──────────────────────────────────
describe('jump / 清局（与现有 reset 语义对齐；SPEC §4.2 生命周期表）', () => {
  /** 推到 `n2`：栈 = [文档床, battle]，且 v2 里离开 `s` 之后那层还在。 */
  function seedPastBattle(scn = withStory(graphA())): GraphRuntime {
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    rt.onPerformanceEnd() // → s（push battle）
    rt.onPerformanceEnd() // → n2（v2：battle 仍在栈上）
    return rt
  }

  it('默认 jump（保留全局态）：作用域层全退，文档床这一层留着继续响', () => {
    const rt = seedPastBattle()
    const dirs = rt.jumpToNode('n1')
    expect(refs(dirs)).toEqual([STORY])
    expect(lastBgm(dirs)).toMatchObject({ ref: STORY, fadeOutMs: 600, restart: true })
    expect(bgmDepth(rt)).toBe(1)
  })

  it('多层粘住的作用域一次退干净，只发**最终**该响的那一条', () => {
    const g: GameGraph = {
      nodes: [
        node('s1', { durationMs: 100, bgm: { ref: BATTLE, fadeOutMs: 600 } }),
        node('s2', { durationMs: 100, bgm: { ref: BOSS, fadeOutMs: 300 } }),
      ],
      edges: [edge('e', 's1', 's2')],
    }
    const scn = withStory(g)
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    rt.onPerformanceEnd()
    expect(bgmDepth(rt)).toBe(3)
    const dirs = rt.jumpToNode('s1')
    expect(refs(dirs)).toEqual([STORY, BATTLE]) // 退到文档床，再压 s1 自己的层
    // 淡出取**正在响的那条**（boss 的 300），不是退栈途中最后碰到的那层（battle 的 600）：
    // 壳层拿这个值去淡出 boss，写着 600 就等于把作者在 boss 上写的 300 换成了别人的数。
    expect(dirs.filter(isBgm)[0]).toMatchObject({ ref: STORY, fadeOutMs: 300 })
    expect(bgmDepth(rt)).toBe(2)
  })

  it('栈上只剩文档床时 jump 一条指令都不发（栈没变就不发）', () => {
    const scn = withStory(graphA())
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    expect(refs(rt.jumpToNode('n2'))).toEqual([])
    expect(refs(rt.jumpToNode('n2'))).toEqual([]) // 重复无变化仍沉默
  })

  it('jump resetGlobals：床轨按 scenario 重压（从头起播），与 resetGlobalsState 同步', () => {
    const rt = seedPastBattle()
    expect(refs(rt.jumpToNode('n1', { resetGlobals: true }))).toEqual([STORY])
    // 与默认 jump 的分水岭：栈上只剩文档床时，默认 jump 沉默、清局仍重压
    expect(refs(rt.jumpToNode('n2'))).toEqual([])
    expect(lastBgm(rt.jumpToNode('n2', { resetGlobals: true }))).toMatchObject({ ref: STORY, restart: true })
  })

  it('jump 进带 bgm 的节点：照常压该节点的层', () => {
    const scn = withStory(graphA())
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    expect(refs(rt.jumpToNode('s'))).toEqual([BATTLE])
  })

  it('无文档床时从作用域层 jump 出去 = 停播（ref null，只有 fadeOutMs 有意义）', () => {
    const rt = seedPastBattle(scnOf(graphA()))
    const dirs = rt.jumpToNode('n1')
    expect(refs(dirs)).toEqual([null])
    expect(lastBgm(dirs)).toMatchObject({ ref: null, fadeOutMs: 600 })
  })
})

/**
 * 局内清 `callStack` 的三条路径（容器 handle 出边 / 显式 advance 走容器边 / 规则硬打断）。
 *
 * 这三条**不是** `jump`：作者没有离开这一局，只是被剧情/规则弹出了容器。v2 里层不绑
 * `callStack`（D5 / D11），所以它们**一个字都不发**——层是作者明写的「一直播」，得等某个节点的
 * `mode: 'stop'`。反过来把层一并退掉的话，「配了就一直播」在有容器的图上就成了空话（初版行为）。
 */
describe('局内清 callStack：BGM 栈原样，层继续响', () => {
  beforeEach(() => registerComponent('choiceX', {}))
  afterEach(() => unregisterComponent('choiceX'))

  /** `n1` → `combat`(subFlow enter，带 bgm) → 内层 `enter` 上的组件事件走容器的 `win` 出边。 */
  const handleEdgeGraph = (bgm: NodeBgm): GameGraph => ({
    nodes: [
      node('n1', { durationMs: 100 }),
      node('combat', { bgm, subProcess: { entry: 'enter', graph: {
        nodes: [node('enter', {
          durationMs: 1000,
          timeline: [{ id: 'c', kind: 'choiceX', trigger: { when: 'enter' }, inputs: { events: [{ id: 'win' }] } }],
        })],
        edges: [],
      } } }),
      node('win', { durationMs: 100 }),
    ],
    edges: [
      edge('e-n1', 'n1', 'combat'),
      { id: 'e-win', source: 'combat', target: 'win', sourceHandle: 'win', targetHandle: 'in' } as GameGraph['edges'][number],
    ],
  })

  function runHandleEdge(bgm: NodeBgm): { rt: GraphRuntime; dirs: RuntimeDirective[] } {
    const scn = withStory(handleEdgeGraph(bgm))
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    rt.onPerformanceEnd() // → combat descend(battle) → enter
    const dirs = rt.emitComponentEvent(rid('enter', 'c'), 'win')
    expect(rt.state.currentNodeId).toBe('win')
    expect(rt.state.callStack).toEqual([])
    return { rt, dirs }
  }

  it('内层节点触发容器 handle 出边：战斗层继续响（沉默）', () => {
    const { rt, dirs } = runHandleEdge({ ref: BATTLE, fadeOutMs: 600 })
    expect(refs(dirs)).toEqual([])
    expect(bgmDepth(rt)).toBe(2) // 文档床 + 战斗层，等某处 `mode: 'stop'`
  })

  it('显式 advance 走容器的边（overlay 事件反应）：层照样活着', () => {
    const panel: Overlay = {
      id: 'hpPanel',
      children: [{ id: 'btn', component: 'choiceX', trigger: { when: 'enter' }, inputs: { events: [{ id: 'B3' }] } }],
    }
    const g: GameGraph = {
      nodes: [
        node('combat', {
          bgm: { ref: BATTLE, fadeOutMs: 600 },
          subProcess: { entry: 'atk', graph: { nodes: [node('atk', { durationMs: 5000 })], edges: [] } },
          overlayNodes: [{ overlay: 'hpPanel', reactions: [{ when: { type: 'event', id: 'B3' }, do: [{ kind: 'advance', edgeId: 'e-out' }] }] }],
        }),
        node('after', { durationMs: 100 }),
      ],
      edges: [{ id: 'e-out', source: 'combat', target: 'after', sourceHandle: 'B3', targetHandle: 'in' } as GameGraph['edges'][number]],
    }
    const scn = withStory(g, { ui: { overlays: { hpPanel: panel } } })
    const rt = new GraphRuntime(scn.graph, scn)
    expect(refs(rt.start())).toEqual([STORY, BATTLE])
    expect(rt.state.currentNodeId).toBe('atk')
    const dirs = rt.emitComponentEvent('hpPanel/btn', 'B3')
    expect(rt.state.currentNodeId).toBe('after')
    expect(rt.state.callStack).toEqual([])
    expect(refs(dirs)).toEqual([])
    expect(bgmDepth(rt)).toBe(2)
  })

  /** 规则硬打断（watch advance）飞出容器：同样是局内路径，不是作者跳转。 */
  const interruptGraph = (bgm: NodeBgm): GameGraph => ({
    nodes: [
      node('combat', {
        bgm,
        reactions: [{ when: { type: 'watch', of: 'var.flag', on: 'change' }, do: [{ kind: 'advance', edgeId: 'e-win' }] }],
        subProcess: { entry: 'inner', graph: {
        nodes: [node('inner', {
          durationMs: 5000,
          reactions: [
            {
              when: { type: 'enter' },
              do: [{ kind: 'effect', effects: [{ id: 's', kind: 'var', varId: 'flag', op: 'set', value: 1 }] }],
            },
          ],
        })],
        edges: [],
      } } }),
      node('win', { durationMs: 100 }),
    ],
    edges: [{ id: 'e-win', source: 'combat', target: 'win', sourceHandle: 'default', targetHandle: 'in' } as GameGraph['edges'][number]],
  })

  function runInterrupt(bgm: NodeBgm): { rt: GraphRuntime; dirs: RuntimeDirective[] } {
    const scn = withStory(interruptGraph(bgm), { variables: { flag: { id: 'flag', name: 'flag', initial: 0 } } })
    const rt = new GraphRuntime(scn.graph, scn)
    const dirs = rt.start()
    expect(rt.state.currentNodeId).toBe('win')
    expect(rt.state.callStack).toEqual([])
    return { rt, dirs }
  }

  it('规则硬打断飞出容器：战斗层继续响（判胜那一下不替作者停曲）', () => {
    const { rt, dirs } = runInterrupt({ ref: BATTLE, fadeOutMs: 600 })
    expect(refs(dirs)).toEqual([STORY, BATTLE])
    expect(bgmDepth(rt)).toBe(2)
  })
})
