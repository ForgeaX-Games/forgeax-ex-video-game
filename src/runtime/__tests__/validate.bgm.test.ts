import { describe, expect, it } from 'vitest'
import { validateGraph, validateScenario, type Issue } from '../core/validate/validate'
import type { GameGraph, GameNode, GameNodeData, GameScenario } from '../core/schema/graph-schema'

/** 单节点图：BGM 校验不依赖边/overlay，图越小越不会混进别的 issue。 */
function node(data: Partial<GameNodeData> & { name: string }): GameNode {
  return {
    id: 'combat',
    type: 'perf',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [],
    data: data as GameNodeData,
  }
}

function graphWithBgm(bgm: unknown): GameGraph {
  return { nodes: [node({ name: 'combat', bgm } as never)], edges: [] }
}

function scenarioWithBgm(docBgm: unknown, nodeBgm?: unknown): GameScenario {
  return {
    version: 'game-video.graph.v1',
    ...(docBgm === undefined ? {} : { bgm: docBgm as GameScenario['bgm'] }),
    graph: nodeBgm === undefined
      ? { nodes: [node({ name: 'combat' })], edges: [] }
      : graphWithBgm(nodeBgm),
  }
}

const bgmIssues = (issues: Issue[]): Issue[] => issues.filter((i) => i.code.startsWith('bgm.'))
const errors = (issues: Issue[]): Issue[] => issues.filter((i) => i.level === 'error')

describe('bgm 校验（SPEC §3.3）· 节点级', () => {
  it('合法配置 + 资产表命中 → 零 issue', () => {
    const g = graphWithBgm({ ref: 'a-aud-battle', mode: 'replace', volume: 0.8, fadeInMs: 800, fadeOutMs: 600, restart: false })
    expect(validateGraph(g, { audioAssets: ['a-aud-battle'] })).toEqual([])
  })

  it('ref 空串 → error（runtime 会静默丢弃，正是要 fail-loud 的场景）', () => {
    const issues = validateGraph(graphWithBgm({ ref: '' }), { audioAssets: ['a-aud-battle'] })
    expect(errors(issues).map((i) => i.code)).toEqual(['bgm.ref.empty'])
    expect(errors(issues)[0]!.at).toBe('node:combat.bgm')
  })

  it('ref 非 string / bgm 非对象 → error', () => {
    for (const bad of [{ ref: 42 }, {}, 'a-aud-battle', ['a-aud-battle']]) {
      const issues = validateGraph(graphWithBgm(bad), { audioAssets: ['a-aud-battle'] })
      expect(errors(issues).map((i) => i.code)).toEqual(['bgm.ref.empty'])
    }
  })

  it('volume 越界 → error', () => {
    for (const volume of [1.5, -0.1, Number.NaN, '0.5']) {
      const issues = validateGraph(graphWithBgm({ ref: 'a-aud-battle', volume }), { audioAssets: ['a-aud-battle'] })
      expect(errors(issues).map((i) => i.code)).toEqual(['bgm.volume.range'])
    }
  })

  it('volume 边界 0 / 1 合法', () => {
    for (const volume of [0, 1]) {
      expect(validateGraph(graphWithBgm({ ref: 'a-aud-battle', volume }), { audioAssets: ['a-aud-battle'] })).toEqual([])
    }
  })

  it('volume-only 不带 ref 合法，表示调整当前曲目音量', () => {
    expect(validateGraph(graphWithBgm({ volume: 0.4 }), { audioAssets: ['a-aud-battle'] })).toEqual([])
  })

  it('非法 volume-only 只报音量范围错误，不强迫补曲目', () => {
    const issues = validateGraph(graphWithBgm({ volume: 2 }), { audioAssets: ['a-aud-battle'] })
    expect(errors(issues).map((i) => i.code)).toEqual(['bgm.volume.range'])
  })

  it('fadeInMs / fadeOutMs 为负 → error', () => {
    const issues = validateGraph(
      graphWithBgm({ ref: 'a-aud-battle', fadeInMs: -1, fadeOutMs: -5 }),
      { audioAssets: ['a-aud-battle'] },
    )
    expect(errors(issues).map((i) => i.code)).toEqual(['bgm.fade.negative', 'bgm.fade.negative'])
    expect(errors(issues)[0]!.msg).toContain('fadeInMs')
    expect(errors(issues)[1]!.msg).toContain('fadeOutMs')
  })

  it("mode 只认 push | replace | stop（手写/AI 生成的 'pop' 会被 runtime 当 push）→ error", () => {
    const issues = validateGraph(graphWithBgm({ ref: 'a-aud-battle', mode: 'pop' }), { audioAssets: ['a-aud-battle'] })
    expect(errors(issues).map((i) => i.code)).toEqual(['bgm.mode.unknown'])
    expect(errors(issues)[0]!.msg).toContain('pop')
  })

  it('三个 mode 都合法（stop 是 v2 的显式结束）', () => {
    for (const bgm of [{ ref: 'a-aud-battle', mode: 'push' }, { ref: 'a-aud-battle', mode: 'replace' }, { mode: 'stop' }]) {
      expect(bgmIssues(validateGraph(graphWithBgm(bgm), { audioAssets: ['a-aud-battle'] }))).toEqual([])
    }
  })

  // v2 的 `{ mode: 'stop' }` 不引入曲子（SPEC §3.3「mode: 'stop' 时可省」）。v1 的规则会把最常见的
  // `win.data.bgm = { mode: 'stop' }` 判成 error，作者只能靠填一个假 ref 来消红。
  it("mode: 'stop' 可以不带 ref → 零 issue", () => {
    expect(validateGraph(graphWithBgm({ mode: 'stop' }), { audioAssets: ['a-aud-battle'] })).toEqual([])
  })

  // 「给了也忽略」（SPEC §3.3 首行）：runtime 的 applyNodeBgm 在 stop 分支根本不读 ref，
  // 所以连「能不能解析」都不必问——面板会把这个 ref 收掉（见 patchNodeBgm 的 track→stop 折叠）。
  // 但「不校验」≠「不吭声」：手写/AI 生成的图里留着 ref，作者会以为这条 stop 之后会播这首。
  it("mode: 'stop' 上的 ref 不做解析校验，只报一条「给了也忽略」的 warn", () => {
    for (const ref of ['a-aud-ghost', '']) {
      const issues = validateGraph(graphWithBgm({ mode: 'stop', ref }), { audioAssets: ['a-aud-battle'] })
      expect(errors(issues)).toEqual([])
      expect(bgmIssues(issues).map((i) => [i.level, i.code, i.at])).toEqual([['warn', 'bgm.ref.ignored', 'node:combat.bgm']])
    }
  })

  // `normalizeFrame` 对 restart 只做 `?? false`：字符串 'yes' 是 truthy，'false' 也是 truthy，
  // 于是作者写错类型时不但不报错，行为还与他写的字面意思相反。
  it('restart 非布尔 → error（runtime 的 `?? false` 会把它当真）', () => {
    for (const bad of ['yes', 'false', 1, 0, null]) {
      const issues = validateGraph(graphWithBgm({ ref: 'a-aud-battle', restart: bad }), { audioAssets: ['a-aud-battle'] })
      expect(errors(issues).map((i) => i.code)).toEqual(['bgm.flag.type'])
      expect(errors(issues)[0]!.msg).toContain('restart')
    }
    expect(validateGraph(graphWithBgm({ ref: 'a-aud-battle', restart: false }), { audioAssets: ['a-aud-battle'] })).toEqual([])
    expect(validateGraph(graphWithBgm({ ref: 'a-aud-battle', restart: true }), { audioAssets: ['a-aud-battle'] })).toEqual([])
  })

  it('节点曲目接受 loop 布尔值，非法类型 fail-loud', () => {
    expect(validateGraph(graphWithBgm({ ref: 'a-aud-battle', loop: false }), { audioAssets: ['a-aud-battle'] })).toEqual([])
    const issues = validateGraph(graphWithBgm({ ref: 'a-aud-battle', loop: 'once' }), { audioAssets: ['a-aud-battle'] })
    expect(errors(issues).map((i) => i.code)).toEqual(['bgm.flag.type'])
    expect(errors(issues)[0]!.msg).toContain('loop')
  })

  it('有资产表但 ref 缺失 → warn（与 media/道具引用同级，不 error）', () => {
    const issues = validateGraph(graphWithBgm({ ref: 'a-aud-ghost' }), { audioAssets: ['a-aud-battle'] })
    expect(bgmIssues(issues)).toHaveLength(1)
    expect(bgmIssues(issues)[0]).toMatchObject({ level: 'warn', code: 'bgm.ref.unresolved', at: 'node:combat.bgm' })
    expect(bgmIssues(issues)[0]!.msg).toContain('a-aud-ghost')
  })

  it('无资产表 → warn 而非 error（当前没有 audio 资产落盘链路）', () => {
    const issues = validateGraph(graphWithBgm({ ref: 'a-aud-battle' }))
    expect(errors(issues)).toEqual([])
    expect(bgmIssues(issues).map((i) => [i.level, i.code])).toEqual([['warn', 'bgm.ref.unresolved']])
  })

  it('容器节点（subFlowPack）上的 bgm 同样受校验', () => {
    const g: GameGraph = {
      nodes: [{
        ...node({ name: 'combat' }),
        data: {
          name: 'combat',
          subFlowPack: { id: 'bp-combat', entry: 'enter' },
          bgm: { ref: 'a-aud-battle', volume: 3 },
        } as unknown as GameNodeData,
      }],
      edges: [],
    }
    const issues = validateGraph(g, { audioAssets: ['a-aud-battle'] })
    expect(errors(issues).map((i) => i.code)).toEqual(['bgm.volume.range'])
  })

  it('无 bgm 字段的旧图 → 零 issue', () => {
    expect(validateGraph({ nodes: [node({ name: 'combat' })], edges: [] }, { audioAssets: [] })).toEqual([])
  })
})

// ── 环内叠层告警 ──────────────────────────────────────────────────────────────
/**
 * v2 的运行时策略是对的（层是作者明写的「记住上一首」，不能替他合并），但两个**不同**的起播
 * 节点在同一个环里时，每转一圈栈就多两层，作者看到的症状是「『结束当前音乐』没反应」。
 * 静态期能看出来的东西不该留给耳朵去查。
 */
function cycleNode(id: string, bgm?: unknown): GameNode {
  return {
    id,
    type: 'perf',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [],
    data: { name: id, durationMs: 100, ...(bgm === undefined ? {} : { bgm }) } as unknown as GameNodeData,
  }
}

const cycleEdge = (id: string, source: string, target: string): GameGraph['edges'][number] =>
  ({ id, source, target, sourceHandle: 'default', targetHandle: 'in' }) as GameGraph['edges'][number]

/** `enter` ⇄ `beat` 的最小回合环，两端 bgm 由参数给。 */
function loopGraph(enterBgm?: unknown, beatBgm?: unknown, tailBgm?: unknown): GameGraph {
  return {
    nodes: [cycleNode('enter', enterBgm), cycleNode('beat', beatBgm), cycleNode('win', tailBgm)],
    edges: [
      cycleEdge('e-eb', 'enter', 'beat'),
      cycleEdge('e-be', 'beat', 'enter'),
      cycleEdge('e-bw', 'beat', 'win'),
    ],
  }
}

const stacking = (g: GameGraph): Issue[] => validateGraph(g, { audioAssets: ['a-1', 'a-2'] }).filter((i) => i.code === 'bgm.cycle.stacking')

describe('bgm 环内叠层告警（bgm.cycle.stacking）', () => {
  it('环里两个不同的起播节点、环内没有结束 → warn，点名那些节点', () => {
    const issues = stacking(loopGraph({ ref: 'a-1' }, { ref: 'a-2' }))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ level: 'warn', code: 'bgm.cycle.stacking', at: 'enter' })
    expect(issues[0]!.msg).toContain('enter')
    expect(issues[0]!.msg).toContain('beat')
  })

  it('环里只有一个起播节点 → 不报（引擎的 owner 守卫恒把它压在同一层上）', () => {
    expect(stacking(loopGraph({ ref: 'a-1' }))).toEqual([])
  })

  it("环内有 mode: 'stop' → 不报（作者自己在环里收了层）", () => {
    expect(stacking(loopGraph({ ref: 'a-1' }, { ref: 'a-2' }, undefined))).toHaveLength(1)
    const g = loopGraph({ ref: 'a-1' }, { ref: 'a-2' })
    g.nodes.push(cycleNode('mid', { mode: 'stop' }))
    g.edges.push(cycleEdge('e-bm', 'beat', 'mid'), cycleEdge('e-me', 'mid', 'enter'))
    expect(stacking(g)).toEqual([])
  })

  // 2026-07-27 去掉 `endsWithScope` 之后这条规则**变吵了**：此前环里勾了它就按「有结束手段」
  // 闭嘴（保守放过可能是包内图的情形）；如今弹帧 / 出包一律不动 BGM 栈，那种图也确实收不住，
  // 于是照报不误。`mode: 'stop'` 是唯一还能让它闭嘴的东西，提示语里也只该出现它。
  it('只有 mode: stop 能让它闭嘴，提示语不再指向别的结束手段', () => {
    const issues = stacking(loopGraph({ ref: 'a-1' }, { ref: 'a-2' }))
    expect(issues).toHaveLength(1)
    expect(issues[0]!.msg).toContain("mode: 'stop'")
    expect(issues[0]!.msg).not.toContain('endsWithScope')
  })

  it("mode: 'replace' 不算起播：换栈顶不加深栈 → 不报", () => {
    expect(stacking(loopGraph({ ref: 'a-1' }, { ref: 'a-2', mode: 'replace' }))).toEqual([])
    expect(stacking(loopGraph({ ref: 'a-1', mode: 'replace' }, { ref: 'a-2', mode: 'replace' }))).toEqual([])
  })

  it('环外的两个起播节点 → 不报（只走一次，不会反复叠）', () => {
    const g: GameGraph = {
      nodes: [cycleNode('a', { ref: 'a-1' }), cycleNode('b', { ref: 'a-2' }), cycleNode('c')],
      edges: [cycleEdge('e-ab', 'a', 'b'), cycleEdge('e-bc', 'b', 'c')],
    }
    expect(stacking(g)).toEqual([])
  })

  it('自环节点单独成环：一个节点起播 → 不报，环里再来一个才报', () => {
    const solo: GameGraph = { nodes: [cycleNode('n', { ref: 'a-1' })], edges: [cycleEdge('e-nn', 'n', 'n')] }
    expect(stacking(solo)).toEqual([])
  })

  it('每个环区只报一条（不按节点数刷屏）', () => {
    const g = loopGraph({ ref: 'a-1' }, { ref: 'a-2' })
    g.nodes.push(cycleNode('extra', { ref: 'a-1' }))
    g.edges.push(cycleEdge('e-bx', 'beat', 'extra'), cycleEdge('e-xe', 'extra', 'enter'))
    expect(stacking(g)).toHaveLength(1)
  })

  it('无 bgm 的旧图不受影响（环照样合法）', () => {
    expect(stacking(loopGraph())).toEqual([])
  })
})

describe('bgm 校验（SPEC §3.3）· 文档级', () => {
  it('合法 doc.bgm + 资产表命中 → 零 issue', () => {
    const scn = scenarioWithBgm({ ref: 'a-aud-story', volume: 1, fadeInMs: 1200, loop: true })
    expect(validateScenario(scn, { audioAssets: ['a-aud-story'] })).toEqual([])
  })

  it('doc.bgm.ref 空 → error，at 指向文档根', () => {
    const issues = validateScenario(scenarioWithBgm({ ref: '' }), { audioAssets: ['a-aud-story'] })
    expect(errors(issues).map((i) => [i.code, i.at])).toEqual([['bgm.ref.empty', 'doc.bgm']])
  })

  it('doc.bgm 的 volume / fadeInMs 同样受校验', () => {
    const issues = validateScenario(scenarioWithBgm({ ref: 'a-aud-story', volume: 1.2, fadeInMs: -3 }), {
      audioAssets: ['a-aud-story'],
    })
    expect(errors(issues).map((i) => i.code)).toEqual(['bgm.volume.range', 'bgm.fade.negative'])
  })

  it('doc.bgm 未解析 → warn', () => {
    const issues = validateScenario(scenarioWithBgm({ ref: 'a-aud-ghost' }), { audioAssets: ['a-aud-story'] })
    expect(bgmIssues(issues).map((i) => [i.level, i.code, i.at])).toEqual([['warn', 'bgm.ref.unresolved', 'doc.bgm']])
  })

  it('文档级与节点级两处同时报', () => {
    const scn = scenarioWithBgm({ ref: 'a-aud-story', volume: 9 }, { ref: 'a-aud-battle', mode: 'pop' })
    const issues = validateScenario(scn, { audioAssets: ['a-aud-story', 'a-aud-battle'] })
    expect(errors(issues).map((i) => [i.code, i.at])).toEqual([
      ['bgm.mode.unknown', 'node:combat.bgm'],
      ['bgm.volume.range', 'doc.bgm'],
    ])
  })

  it('无 doc.bgm 的旧图 → 零 issue', () => {
    expect(validateScenario(scenarioWithBgm(undefined), { audioAssets: [] })).toEqual([])
  })

  // 免 ref 是**节点独有**的豁免（`mode: 'stop'` = 结束当前层）。文档床没有 mode 这回事：
  // engine 的 applyDocBgm 只看 `doc.ref`，`{ mode: 'stop' }` 会被整条丢掉 = 静音起局，
  // 而作者写的是「结束音乐」。共用 checkBgm 时若把豁免也带到文档级，这条就静默通过了。
  it("doc.bgm 不享受 mode: 'stop' 的免 ref 豁免 → 仍报 ref.empty", () => {
    const issues = validateScenario(scenarioWithBgm({ mode: 'stop' }), { audioAssets: ['a-aud-story'] })
    expect(errors(issues).map((i) => [i.code, i.at])).toEqual([['bgm.ref.empty', 'doc.bgm']])
  })

  // 节点独有键落到文档床上：runtime 一律不当真（mode 无落点，restart 在起局那条指令上恒为真），
  // 所以是 warn 而不是 error —— 它不会跑坏，只是作者以为配了个不存在的功能。
  it('doc.bgm 上的节点独有键（mode / restart）→ warn，逐个点名', () => {
    const issues = validateScenario(
      scenarioWithBgm({ ref: 'a-aud-story', mode: 'replace', restart: true }),
      { audioAssets: ['a-aud-story'] },
    )
    expect(errors(issues)).toEqual([])
    const warns = bgmIssues(issues)
    expect(warns.map((i) => [i.level, i.code, i.at])).toEqual([['warn', 'bgm.key.ignored', 'doc.bgm']])
    for (const key of ['mode', 'restart']) expect(warns[0]!.msg).toContain(key)
  })

  // 反向不成立：文档床上的 mode 只是没用，不该再按节点规则判它的值（否则同一个键报两次）。
  it('doc.bgm 上的 mode 不再按节点规则判值（只报「这里没用」一条）', () => {
    const issues = validateScenario(scenarioWithBgm({ ref: 'a-aud-story', mode: 'pop' }), { audioAssets: ['a-aud-story'] })
    expect(bgmIssues(issues).map((i) => i.code)).toEqual(['bgm.key.ignored'])
  })

  it('doc.bgm 的 loop / fadeOutMs 是文档床自己的字段 → 不报', () => {
    const scn = scenarioWithBgm({ ref: 'a-aud-story', loop: false, fadeOutMs: 1200, volume: 0.6 })
    expect(validateScenario(scn, { audioAssets: ['a-aud-story'] })).toEqual([])
  })
})
