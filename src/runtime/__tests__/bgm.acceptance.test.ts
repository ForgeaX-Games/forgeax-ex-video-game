/**
 * SPEC §6 验收：**同一段战斗、两种写法**（§6.1 平铺 / §6.2 子蓝图），都必须跑出 §6.3 那张听感表，
 * 且都**不要求作者改图结构**（D11）。走合成后的运行栈：`GraphRuntime` + `GraphSession` + 注入 pack。
 *
 * 与邻居的分工：`bgm-stack.test.ts` 钉栈语义、`engine.bgm.test.ts` 钉「钩子挂在哪」（每个钩子一张
 * 最小图）、`session.bgm.test.ts` 钉 directive→快照的传输。本文件不拆钩子，只问一件事：
 * **按 §6 的形状把图搭出来，一路 `performanceEnd` 跑到底，壳层听到的是不是 §6.3 那五行。**
 *
 * 断言面 = 壳层真正消费的两个面：`snap.bgm`（会话快照）与引擎发出的 `bgm` 指令流；**不读栈内部**。
 * 两种写法共用同一份表断言（`expectListeningTable`）——「两种写法听感一致」这句话只有在断言逐字
 * 相同时才算被钉住；各自私有的只有图的形状与那一处配置。
 *
 * 节点命名两种写法刻意一致（`n_open` / `enter` / `a_my` / `b_ai` / `t_end` / `win` / `lose`），
 * 于是驱动器与断言都能共用。**不动** 出厂 `demo/blueprint.json`；富内容样例在测试 fixtures。
 */
import { describe, expect, it } from 'vitest'
import { GraphRuntime } from '../core/engine/engine'
import { GraphSession, type SessionSnapshot } from '../core/engine/session'
import { isBgm, isPlayClip, type RuntimeDirective } from '../core/engine/directives'
import type { GameGraph, GameScenario, SubFlowPackDef } from '../core/schema/graph-schema'
import { node, scnOf } from './test-fixtures'

const STORY = 'bgm-story'
const BATTLE = 'bgm-battle'
/** 战斗床的淡变（两种写法配在不同节点上，值一样，于是听感表也一样）。 */
const BATTLE_BGM = { ref: BATTLE, restart: false, fadeInMs: 800, fadeOutMs: 1200 } as const
/** 跑满这么多回合才走 `t_end`（≥2 才叫「多回合」）。 */
const ROUNDS_TO_END = 3
/** 战斗结果编码（`t_end` 写 `vars.battleResult`，由它后面的条件边判胜负）。 */
const WIN = 1
const LOSE = 2

const refs = (dirs: RuntimeDirective[]): (string | null)[] => dirs.filter(isBgm).map((d) => d.ref)
/** 换片序列（用来反证「真的跑了多轮」，而不是图短路了）。 */
const clipsOf = (dirs: RuntimeDirective[]): string[] => dirs.filter(isPlayClip).map((d) => d.nodeId)

const edge = (id: string, source: string, target: string, condition?: unknown) => ({
  id,
  source,
  target,
  sourceHandle: 'default',
  targetHandle: 'in',
  ...(condition ? { data: { condition } } : {}),
}) as GameGraph['edges'][number]

const varGte = (varId: string, value: number) => ({ all: [{ type: 'var', varId, op: 'gte', value }] })
const varEq = (varId: string, value: number) => ({ all: [{ type: 'var', varId, op: 'eq', value }] })

/** `when` 相位上加一个变量副作用（回合计数 / 写战斗结果）。 */
const effectOn = (when: 'enter' | 'complete', varId: string, op: 'add' | 'set', value: number) => ({
  when: { type: when },
  do: [{ kind: 'effect', effects: [{ id: `${varId}-${op}`, kind: 'var', varId, op, value }] }],
})

/**
 * 战斗回合圈：`enter → a_my → b_ai →(未满 rounds) enter`，满了走 `t_end`（瞬时、写结果）。
 * `tEndExtra` 落在 `t_end` 上：平铺写法什么都不放（结束交给主图的 win/lose），子蓝图写法在这里
 * 放 `mode: 'stop'` —— 那是包的出口终端，也是包自洽的**唯一**手段。
 */
function roundLoopNodes(result: number, enterExtra: Record<string, unknown>, tEndExtra: Record<string, unknown> = {}) {
  return [
    node('enter', { durationMs: 1500, ...enterExtra }), // 进战待机（每回合回到这里）
    node('a_my', { durationMs: 1200, reactions: [effectOn('complete', 'round', 'add', 1)] }), // 我方技能演出
    node('b_ai', { durationMs: 1200 }), // 敌方防反演出
    node('t_end', { reactions: [effectOn('enter', 'battleResult', 'set', result)], ...tEndExtra }),
  ]
}

const roundLoopEdges = [
  edge('e-enter-amy', 'enter', 'a_my'),
  edge('e-amy-bai', 'a_my', 'b_ai'),
  edge('e-bai-end', 'b_ai', 't_end', varGte('round', ROUNDS_TO_END)),
  edge('e-loop', 'b_ai', 'enter'), // 无条件兜底 = 回合回环
]

// ── §6.1 平铺写法：床配在战斗入口节点，win/lose 各写一个 `mode: 'stop'`，全图无容器 ─────
function flatScenario(result: number): GameScenario {
  const graph: GameGraph = {
    nodes: [
      node('n_open', { durationMs: 4000 }), // 序章：不带 bgm，整段听文档床
      // 战斗入口：配一次就一直播（D5）。它是回合圈的回环点 —— 每轮都会重新走进来。
      ...roundLoopNodes(result, { bgm: BATTLE_BGM }),
      // 就近显式结束（D6）：只有这两处写 stop，作者不必知道上一首是什么。
      node('win', { durationMs: 3000, bgm: { mode: 'stop' } }),
      node('lose', { durationMs: 3000, bgm: { mode: 'stop' } }),
    ],
    edges: [
      edge('e-open-enter', 'n_open', 'enter'),
      ...roundLoopEdges,
      edge('e-end-win', 't_end', 'win', varEq('battleResult', WIN)),
      edge('e-end-lose', 't_end', 'lose', varEq('battleResult', LOSE)),
    ],
  }
  return scenarioOf(graph)
}

// ── §6.2 子蓝图写法：包内入口起播 + 包的出口终端写 stop，主图与 win/lose **什么都不写** ──
function packScenario(): GameScenario {
  const graph: GameGraph = {
    nodes: [
      node('n_open', { durationMs: 4000 }),
      // 战斗已经是一个 subFlowPack：主图这个 caller 上**没有** bgm，包自洽。
      node('combat', { subFlowPack: { id: 'bp-combat', version: '1', entry: 'enter' } }),
      node('win', { durationMs: 3000 }),
      node('lose', { durationMs: 3000 }),
    ],
    edges: [
      edge('e-open-combat', 'n_open', 'combat'),
      edge('e-combat-win', 'combat', 'win', varEq('battleResult', WIN)),
      edge('e-combat-lose', 'combat', 'lose', varEq('battleResult', LOSE)),
    ],
  }
  return scenarioOf(graph)
}

/**
 * §6.2 的包：与 §6.1 同一个回合圈，多的只有出口终端 `t_end` 上那句 `mode: 'stop'`。
 * 这是「让一个包自洽」的**唯一**手段——弹 `callStack` 帧不动 BGM 栈，所以每条出口终端都得写；
 * 从别的路径（硬打断）离开这个包时，战斗床会漏给调用方继续播（见 `engine.bgm.test.ts` 的
 * 「接受的后果」）。这里的包只有 `t_end` 一条出口，故一句就够。
 */
function combatPack(result: number): SubFlowPackDef {
  return {
    id: 'bp-combat',
    version: '1',
    entry: 'enter',
    graph: {
      nodes: roundLoopNodes(result, { bgm: BATTLE_BGM }, { bgm: { mode: 'stop' } }),
      edges: roundLoopEdges,
    },
  }
}

/** 文档床 `bgm-story` 挂根（§3.1）；回合计数与战斗结果走 vars。 */
const scenarioOf = (graph: GameGraph): GameScenario =>
  scnOf(graph, {
    bgm: { ref: STORY, loop: true },
    variables: {
      round: { id: 'round', name: '回合', initial: 0 },
      battleResult: { id: 'battleResult', name: '战斗结果', initial: 0 },
    },
  })

/** 一种写法 = 一对工厂；其余（驱动 + 断言）两种写法逐字共用。 */
interface Pattern {
  readonly name: string
  session(result: number): GraphSession
  runtime(result: number): GraphRuntime
}

const FLAT: Pattern = {
  name: '§6.1 平铺（床配在战斗入口节点，win/lose 写 mode: stop，无容器）',
  session: (result) => new GraphSession(flatScenario(result)),
  runtime: (result) => {
    const scn = flatScenario(result)
    return new GraphRuntime(scn.graph, scn)
  },
}

const PACK: Pattern = {
  name: '§6.2 子蓝图（包内入口起播 + 包的出口终端写 mode: stop，主图与 win/lose 不写任何 bgm）',
  session: (result) => new GraphSession(packScenario(), { packs: [combatPack(result)] }),
  runtime: (result) => {
    const scn = packScenario()
    return new GraphRuntime(scn.graph, scn, undefined, [combatPack(result)])
  },
}

/** 一步「演出结束」→ 记下落点与此刻的床轨（`bgm` 的**对象引用**本身就是「这步有没有发指令」）。 */
interface Beat {
  node: string | null
  bgm: SessionSnapshot['bgm']
}

/** 把会话推到本局结束，逐步记账。 */
function driveToEnd(s: GraphSession, maxSteps = 60): Beat[] {
  const first = s.start()
  const beats: Beat[] = [{ node: first.currentNodeId, bgm: first.bgm }]
  for (let i = 0; i < maxSteps && s.snapshot.phase === 'playing'; i++) {
    const snap = s.performanceEnd()
    beats.push({ node: snap.currentNodeId, bgm: snap.bgm })
  }
  return beats
}

const at = (beats: Beat[], nodeId: string): Beat[] => beats.filter((b) => b.node === nodeId)

/** 反复 onPerformanceEnd 把图推到底，收集全过程指令。 */
function runToEnd(rt: GraphRuntime, maxSteps = 60): RuntimeDirective[] {
  const out: RuntimeDirective[] = [...rt.start()]
  for (let i = 0; i < maxSteps && rt.state.phase === 'playing'; i++) out.push(...rt.onPerformanceEnd())
  return out
}

/** §6.3 那张表，逐行断言；两种写法共用。`exit` = 走哪条结局边。 */
function expectListeningTable(p: Pattern, exit: 'win' | 'lose', result: number): void {
  const s = p.session(result)
  const beats = driveToEnd(s)
  const last = beats[beats.length - 1] as Beat

  // 图真的按 §6 跑了：三个回合、走过回环边、最后停在结局节点。
  expect(s.snapshot.hud.vars.round).toBe(ROUNDS_TO_END)
  expect(at(beats, 'enter')).toHaveLength(ROUNDS_TO_END)
  expect(last.node).toBe(exit)
  expect(s.snapshot.phase).toBe('ended')

  // 第 1 行「序章 → bgm-story」：叙事节点自己不带 bgm，听的是文档床。
  expect(beats[0]?.node).toBe('n_open')
  expect(beats[0]?.bgm).toMatchObject({ ref: STORY, loop: true, volume: 1, restart: true })

  // 第 2 行「进战斗 → bgm-battle」：换曲必然从头起播，fadeInMs 取自配置那一处。
  const battleBed = at(beats, 'enter')[0]?.bgm
  expect(battleBed).toMatchObject({ ref: BATTLE, fadeInMs: 800, restart: true })

  // 第 3 行「回合/技能来回、循环回 enter → 仍 battle，不重开、不多叠层」：
  // 整段战斗里每一步的 `bgm` 都是**同一个对象引用** = 这些步压根没发过 bgm 指令。
  // （若引擎把「离开节点」当结束、或每轮再 apply 一次，这里就会是新对象，哪怕 ref 还是 battle
  //  也会带 restart: true，壳层随之重开解码 —— 正是 §1.1 要禁的刺耳重播。）
  const battleBeats = beats.slice(
    beats.findIndex((b) => b.node === 'enter'),
    beats.findIndex((b) => b.node === exit),
  )
  expect(battleBeats.map((b) => b.node)).toContain('a_my')
  expect(battleBeats.map((b) => b.node)).toContain('b_ai')
  for (const b of battleBeats) expect(b.bgm).toBe(battleBed)

  // 第 4 行「到 win（stop 或出包）→ 回 bgm-story」：淡出取自战斗床那一层的 fadeOutMs。
  expect(last.bgm).toMatchObject({ ref: STORY, fadeOutMs: 1200, restart: true })

  // 第 5 行「win 演出中 → bgm-story 仍在响」：本局已 ended，引擎不在 ended 上补停播指令。
  expect(s.snapshot.currentNodeId).toBe(exit)
  expect(s.snapshot.bgm?.ref).toBe(STORY)
  expect(s.snapshot.callStack).toEqual([])
}

for (const p of [FLAT, PACK]) {
  describe(`SPEC §6.3 听感表 · ${p.name}`, () => {
    it('win 分支：五行逐行对上', () => {
      expectListeningTable(p, 'win', WIN)
    })

    it('lose 分支同样回叙事床（与走哪条结局边无关）', () => {
      expectListeningTable(p, 'lose', LOSE)
    })

    it('整局只有三条 bgm 指令 [story, battle, story]——多一条就是重开', () => {
      const rt = p.runtime(WIN)
      const all = runToEnd(rt)

      // 先自证图真的跑了多回合并从战斗里出来了。
      expect(rt.state.vars.round).toBe(ROUNDS_TO_END)
      expect(rt.state.traversedEdgeIds.has('e-loop')).toBe(true)
      expect(rt.state.currentNodeId).toBe('win')
      expect(rt.state.phase).toBe('ended')
      // 换片是每回合都换的（enter/a_my/b_ai 各三次）——床轨却一条指令都没多发。
      for (const id of ['enter', 'a_my', 'b_ai']) {
        expect(clipsOf(all).filter((c) => c === id)).toHaveLength(ROUNDS_TO_END)
      }

      expect(refs(all)).toEqual([STORY, BATTLE, STORY])
    })
  })
}

describe('SPEC §6 两种写法必须逐条一致（听感表不是「差不多」）', () => {
  it('整局 bgm 指令流（含 fade / restart / volume 全字段）完全相同', () => {
    const flat = runToEnd(FLAT.runtime(WIN)).filter(isBgm)
    const pack = runToEnd(PACK.runtime(WIN)).filter(isBgm)
    expect(pack).toEqual(flat)
  })
})
