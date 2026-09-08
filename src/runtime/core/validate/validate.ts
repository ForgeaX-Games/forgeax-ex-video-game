/**
 * 图 validator —— AI 时代刚需：graph 是 SSOT 且会被 AI 生成/编辑，落盘/加载/AI 写入时都要能
 * 静态发现结构性错误，给出可读诊断（而不是运行时炸）。
 *
 * 覆盖：悬空边、sourceHandle 与派生 outputs 不匹配、未注册 component、component 参数非法、不可达节点；
 * 传 `opts`（实体/变量/道具 id）后还查**引用**：condition/effect/expr 里引用的 entity/var/item/nodeId
 * 是否存在、reactions 中 advance 是否指向真实边；并对**纯瞬时环**（全为无演出/无交互节点 + 无条件边）给告警。
 */
import type { GameGraph, GameScenario, NodeAction, Overlay, Reaction } from '../schema/graph-schema'
import { getSubFlowPack, getSubProcess } from '../schema/graph-schema'
import { isPosition } from '../schema/react-flow-schema'
import { expandNodeOverlays } from '../schema/expand-overlay'
import { overlayMountId } from '../schema/node-config-schema'
import { eventsFromParams, overlayReactionKey } from '../schema/overlay-events'
import { collectRefs } from '../engine/expr'
import { deriveOutputs, getComponent } from '../registry/component-registry'
import { defaultNodeKindRegistry, resolveNodeType } from '../nodes'

export interface Issue {
  level: 'error' | 'warn'
  code: string
  msg: string
  at?: string
}

/** 引用检查上下文：已声明的实体/变量/道具/节点 id。 */
export interface ValidateOpts {
  entities?: Iterable<string>
  vars?: Iterable<string>
  formulas?: Iterable<string>
  items?: Iterable<string>
  /** scenario.ui.overlays —— 展开 OverlayNode 做 component / handle 校验。 */
  overlays?: Record<string, Overlay>
  /**
   * `assets/manifest` 里 `kind: 'audio'` 的资产 id 表，用于校验 bgm.ref 能否解析。
   * 缺省 = 调用方没有资产表 → 只能给 warn（见 checkBgm）。
   */
  audioAssets?: Iterable<string>
}

/** 保留字 handle（default = 默认推进）由 edge 声明、非某 component 产出，始终合法。 */
function isRoutingHandle(h: string): boolean {
  return h === 'default'
}

const EFFECT_KINDS = new Set(['attr', 'var', 'flag', 'item'])
const CLAUSE_TYPES = new Set(['var', 'flag', 'visited', 'attr', 'attrRatio', 'attrCompare', 'score', 'hasItem'])

/** 引擎注入的局部量；只有部分 reaction 上下文能提供它们（见 spawnLocalsAvailable）。 */
const REACTION_LOCALS = new Set(['prev', 'next', 'delta'])

/** 只有写 attr / var 的 effect 有可采样的数值目标，能给后续动作产出 prev/next/delta。 */
function effectYieldsLocals(action: NodeAction): boolean {
  if (action.kind !== 'effect') return false
  const last = action.effects[action.effects.length - 1]
  return last?.kind === 'attr' || last?.kind === 'var'
}

/** 该 spawn 的 inputs 里用到的局部量名（表达式解析失败时按无引用处理，交给别的规则报）。 */
function spawnLocalsUsed(inputs: Record<string, unknown> | undefined): string[] {
  const used = new Set<string>()
  for (const value of Object.values(inputs ?? {})) {
    const expr = value && typeof value === 'object' ? (value as { expr?: unknown }).expr : undefined
    if (typeof expr !== 'string') continue
    try {
      for (const local of collectRefs(expr).locals) {
        if (REACTION_LOCALS.has(local)) used.add(local)
      }
    } catch {
      // 表达式本身不合法 —— 由 walkRefs 的 expr 规则负责报告。
    }
  }
  return [...used]
}

/** Overlay 目录 reactions 是比挂载 Reaction 更窄的持久化契约，逐字段 fail-loud。 */
function checkOverlayReactions(
  overlay: Overlay,
  overlays: Record<string, Overlay>,
  issues: Issue[],
): void {
  const raw = (overlay as { reactions?: unknown }).reactions
  if (raw === undefined) return
  if (!Array.isArray(raw)) {
    issues.push({ level: 'error', code: 'overlay.reactions.type', msg: 'overlay.reactions 必须是数组', at: `overlay:${overlay.id}.reactions` })
    return
  }
  const allowed = new Set<string>()
  for (const child of overlay.children) {
    const declared = eventsFromParams(child.inputs)
    const events = declared.length ? declared : (getComponent(child.component)?.events ?? [])
    for (const event of events) allowed.add(overlayReactionKey(child.id, event.id))
  }
  const seen = new Set<string>()
  raw.forEach((value, index) => {
    const at = `overlay:${overlay.id}.reactions[${index}]`
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      issues.push({ level: 'error', code: 'overlay.reaction.type', msg: '目录 reaction 必须是对象', at })
      return
    }
    const reaction = value as Record<string, unknown>
    const when = reaction.when
    if (!when || typeof when !== 'object' || Array.isArray(when)
      || (when as Record<string, unknown>).type !== 'event'
      || typeof (when as Record<string, unknown>).id !== 'string') {
      issues.push({ level: 'error', code: 'overlay.reaction.trigger', msg: '目录 reaction 只允许 { type: event, id: childId:eventId }', at })
      return
    }
    const id = (when as { id: string }).id
    if (!allowed.has(id)) {
      issues.push({ level: 'error', code: 'overlay.reaction.event.missing', msg: `目录 reaction key '${id}' 必须精确匹配 childId:eventId`, at })
    }
    if (seen.has(id)) {
      issues.push({ level: 'error', code: 'overlay.reaction.duplicate', msg: `目录 reaction key '${id}' 重复`, at })
    }
    seen.add(id)
    if (!Array.isArray(reaction.do)) {
      issues.push({ level: 'error', code: 'overlay.reaction.actions.type', msg: '目录 reaction.do 必须是数组', at })
      return
    }
    reaction.do.forEach((action, actionIndex) => {
      const actionAt = `${at}.do[${actionIndex}]`
      if (!action || typeof action !== 'object' || Array.isArray(action)) {
        issues.push({ level: 'error', code: 'overlay.reaction.action.type', msg: '目录动作必须是对象', at: actionAt })
        return
      }
      const a = action as Record<string, unknown>
      if (a.kind !== 'effect' && a.kind !== 'spawn') {
        issues.push({ level: 'error', code: 'overlay.reaction.action.kind', msg: `目录动作只允许 effect/spawn，不允许 '${String(a.kind)}'`, at: actionAt })
      } else if (a.kind === 'effect' && !Array.isArray(a.effects)) {
        issues.push({ level: 'error', code: 'overlay.reaction.effect.type', msg: 'effect.effects 必须是数组', at: actionAt })
      } else if (a.kind === 'spawn' && (typeof a.from !== 'string' || a.from.length === 0)) {
        issues.push({ level: 'error', code: 'overlay.reaction.spawn.from', msg: 'spawn.from 必须是非空 overlayId/childId', at: actionAt })
      } else if (a.kind === 'spawn') {
        const slash = (a.from as string).indexOf('/')
        const overlayId = slash > 0 ? (a.from as string).slice(0, slash) : ''
        const childId = slash > 0 ? (a.from as string).slice(slash + 1) : ''
        if (!overlayId || !childId || !overlays[overlayId]?.children.some((child) => child.id === childId)) {
          issues.push({ level: 'error', code: 'overlay.reaction.spawn.missing', msg: `spawn.from '${String(a.from)}' 未命中目录组件模板`, at: actionAt })
        }
      }
    })
  })
}

interface RefCtx {
  entities: Set<string>
  vars: Set<string>
  formulas: Set<string>
  items: Set<string>
  nodeIds: Set<string>
}

/** 检查表达式字符串里的声明引用与允许的 reaction 局部量。 */
function checkExpr(expr: string, ctx: RefCtx, at: string, issues: Issue[]): void {
  let refs
  try {
    refs = collectRefs(expr)
  } catch {
    issues.push({ level: 'error', code: 'ref.expr.invalid', msg: `expr 无法解析：'${expr}'`, at })
    return
  }
  for (const id of new Set(refs.entities)) {
    if (!ctx.entities.has(id)) issues.push({ level: 'error', code: 'ref.entity.missing', msg: `expr 引用未知实体 '${id}'`, at })
  }
  for (const id of new Set(refs.vars)) {
    if (!ctx.vars.has(id)) issues.push({ level: 'error', code: 'ref.var.missing', msg: `expr 引用未知变量 '${id}'`, at })
  }
  for (const id of new Set(refs.formulas)) {
    if (!ctx.formulas.has(id)) issues.push({ level: 'error', code: 'ref.formula.missing', msg: `expr 引用未知公式 '${id}'`, at })
  }
  for (const id of new Set(refs.locals)) {
    if (!REACTION_LOCALS.has(id)) {
      issues.push({ level: 'error', code: 'ref.symbol.unknown', msg: `expr 引用未知裸符号 '${id}'`, at })
    }
  }
}

/** 深度遍历任意值，凡遇 {expr} / GraphEffect / GraphClause 形状即校验其 id 引用（对任意 component inputs 通用）。 */
function walkRefs(value: unknown, ctx: RefCtx, at: string, issues: Issue[]): void {
  if (value == null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const v of value) walkRefs(v, ctx, at, issues)
    return
  }
  const o = value as Record<string, unknown>
  if (typeof o.expr === 'string') checkExpr(o.expr, ctx, at, issues)
  if (typeof o.kind === 'string' && EFFECT_KINDS.has(o.kind)) {
    if (o.kind === 'attr' && typeof o.entityId === 'string' && !ctx.entities.has(o.entityId)) {
      issues.push({ level: 'error', code: 'ref.entity.missing', msg: `effect 引用未知实体 '${o.entityId}'`, at })
    }
    if ((o.kind === 'var' || o.kind === 'flag') && typeof o.varId === 'string' && !ctx.vars.has(o.varId)) {
      issues.push({ level: 'error', code: 'ref.var.missing', msg: `effect 引用未知变量 '${o.varId}'`, at })
    }
    if (o.kind === 'item' && typeof o.itemId === 'string' && ctx.items.size > 0 && !ctx.items.has(o.itemId)) {
      issues.push({ level: 'warn', code: 'ref.item.missing', msg: `effect 引用未声明道具 '${o.itemId}'`, at })
    }
  }
  if (typeof o.type === 'string' && CLAUSE_TYPES.has(o.type)) {
    if ((o.type === 'attr' || o.type === 'attrRatio') && typeof o.entityId === 'string' && !ctx.entities.has(o.entityId)) {
      issues.push({ level: 'error', code: 'ref.entity.missing', msg: `condition 引用未知实体 '${o.entityId}'`, at })
    }
    if (o.type === 'attrCompare') {
      for (const side of ['left', 'right'] as const) {
        if (typeof o[side] === 'string' && !ctx.entities.has(o[side] as string)) {
          issues.push({ level: 'error', code: 'ref.entity.missing', msg: `condition 引用未知实体 '${o[side] as string}'`, at })
        }
      }
    }
    if ((o.type === 'var' || o.type === 'flag') && typeof o.varId === 'string' && !ctx.vars.has(o.varId)) {
      issues.push({ level: 'error', code: 'ref.var.missing', msg: `condition 引用未知变量 '${o.varId}'`, at })
    }
    if (o.type === 'visited' && typeof o.nodeId === 'string' && !ctx.nodeIds.has(o.nodeId)) {
      issues.push({ level: 'error', code: 'ref.node.missing', msg: `condition visited 引用未知节点 '${o.nodeId}'`, at })
    }
  }
  for (const v of Object.values(o)) walkRefs(v, ctx, at, issues)
}

/** 纯瞬时环告警：环内全是「无视频 + 无演出时长 + 无交互 child」的节点、且构成环的边都无 condition → 可能同步空转。 */
function checkInstantCycle(graph: GameGraph, overlays: Record<string, Overlay> | undefined, issues: Issue[]): void {
  const instant = new Set(
    graph.nodes
      .filter((n) => {
        const children = expandNodeOverlays(overlays, n).flatMap((i) => i.children)
        const hasMedia = !!n.data.media?.ref
        const hasEvents = children.some(
          (el) => (getComponent(el.component)?.events?.length ?? 0) > 0
            || (Array.isArray((el.inputs as { events?: unknown })?.events)
              && ((el.inputs as { events: unknown[] }).events.length > 0)),
        )
        return !hasMedia && !n.data.durationMs && !hasEvents
      })
      .map((n) => n.id),
  )
  const adj = new Map<string, string[]>()
  for (const e of graph.edges) {
    if (e.data?.condition) continue // 有条件的边不算恒真穿链
    if (!instant.has(e.source) || !instant.has(e.target)) continue
    const list = adj.get(e.source) ?? []
    list.push(e.target)
    adj.set(e.source, list)
  }
  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map<string, number>()
  let found = false
  const dfs = (u: string): void => {
    color.set(u, GRAY)
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v) ?? WHITE
      if (c === GRAY) found = true
      else if (c === WHITE) dfs(v)
    }
    color.set(u, BLACK)
  }
  for (const id of instant) if ((color.get(id) ?? WHITE) === WHITE) dfs(id)
  if (found) {
    issues.push({ level: 'warn', code: 'cycle.instant', msg: '存在纯瞬时环（全无演出/交互 + 无条件边），运行时可能触发 anti-runaway 中断' })
  }
}

const BGM_MODES = new Set(['push', 'replace', 'stop'])

/**
 * BGM 配置落在哪儿 —— 两处的 schema 不同（`NodeBgm` vs `DocumentBgm`），同一个键换个位置就是死键：
 * 只有节点有 `mode` / `restart`（作用域语义）；`loop` 在文档床和节点曲目上都有效。
 */
type BgmPosition = 'node' | 'doc'

/** 节点作用域独有的键 → 落到文档床上一律不生效（见 checkBgm 的 `bgm.key.ignored`）。 */
const NODE_ONLY_BGM_KEYS = ['mode', 'restart'] as const
const DOC_ONLY_BGM_KEYS = [] as const

/**
 * 校验一处 BGM 配置（`doc.bgm` 或 `node.data.bgm`，SPEC §3.3）。
 *
 * 读**原始值**而不是 `getNodeBgm`：runtime 对非法形状（非对象 / ref 空串）静默丢弃 →
 * 作者只会听到「没响」，正是这里要 fail-loud 的场景。
 * `volume` 直接写 `HTMLAudioElement`、fade 直接进定时器，两者都不在下游 clamp。
 *
 * 节点级的 `mode: 'stop'` 与 volume-only 配置免 ref，所以本函数收 `position`：文档床没有
 * `mode`，`engine.applyDocBgm` 只看 `doc.ref`，于是 `scenario.bgm = { mode: 'stop' }` 落地是
 * 「静音起局」而不是作者以为的「结束音乐」——豁免跟着带到文档级，这条就静默通过了。
 */
function checkBgm(
  raw: unknown,
  at: string,
  audio: Set<string> | undefined,
  issues: Issue[],
  position: BgmPosition,
): void {
  if (raw == null) return
  const b = (typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>

  // 「结束当前音乐」那一条不引入曲子 → 免 ref，且**给了也忽略**（§3.3 首行）：runtime 的 stop 分支
  // 压根不读 ref，连「能不能解析」都是伪问题。面板切到 stop 时会把 ref 收掉（见 patchNodeBgm）。
  const isStop = position === 'node' && b.mode === 'stop'
  const ref = b.ref
  const isVolumeOnly = position === 'node' && ref === undefined && b.volume !== undefined
  if (!isStop && !isVolumeOnly && (typeof ref !== 'string' || ref.trim().length === 0)) {
    issues.push({
      level: 'error',
      code: 'bgm.ref.empty',
      msg: position === 'node'
        ? "bgm.ref 必须是非空字符串（只有 mode: 'stop' 或仅配置 volume 时可以不带；否则 runtime 静默丢弃该 bgm 配置）"
        : 'bgm.ref 必须是非空字符串（否则 runtime 静默丢弃该 bgm 配置）',
      at,
    })
  }
  if (b.volume !== undefined && (typeof b.volume !== 'number' || !Number.isFinite(b.volume) || b.volume < 0 || b.volume > 1)) {
    issues.push({ level: 'error', code: 'bgm.volume.range', msg: `bgm.volume '${String(b.volume)}' 越界（须是 [0, 1] 内的数字）`, at })
  }
  if (b.loop !== undefined && typeof b.loop !== 'boolean') {
    issues.push({ level: 'error', code: 'bgm.flag.type', msg: `bgm.loop '${String(b.loop)}' 非法（只能是 true / false）`, at })
  }
  for (const key of ['fadeInMs', 'fadeOutMs'] as const) {
    const v = b[key]
    if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
      issues.push({ level: 'error', code: 'bgm.fade.negative', msg: `bgm.${key} '${String(v)}' 非法（须是 ≥ 0 的数字）`, at })
    }
  }
  // mode / restart 的**值**只在节点级判：文档床上它们是死键，由下面那条 warn 一次说完，
  // 否则同一个键既被说「这里没用」又被说「值不对」，作者不知道该改哪个。
  if (position === 'node') {
    if (b.mode !== undefined && !BGM_MODES.has(b.mode as string)) {
      issues.push({ level: 'error', code: 'bgm.mode.unknown', msg: `bgm.mode '${String(b.mode)}' 非法（只能是 push | replace | stop）`, at })
    }
    // `normalizeFrame` 对 `restart` 只做 `?? false`：`'false'` / `1` 这类值一路 truthy 进帧，
    // 作者写的字面意思与跑出来的行为相反，且全程无报错 → 只能 fail-loud。
    if (b.restart !== undefined && typeof b.restart !== 'boolean') {
      issues.push({ level: 'error', code: 'bgm.flag.type', msg: `bgm.restart '${String(b.restart)}' 非法（只能是 true / false）`, at })
    }
    // `stop` 分支压根不读 ref（SPEC §3.3「给了也忽略」），留着它作者会以为
    // 这条 stop 之后播的是这首。面板不会写出这种形状（`patchNodeBgm` 把 stop 折叠成独占一条）。
    if (isStop && b.ref !== undefined) {
      issues.push({
        level: 'warn',
        code: 'bgm.ref.ignored',
        msg: "bgm.ref 在 mode: 'stop' 上不生效（那一条只结束当前层，不引入曲子）",
        at,
      })
    }
  }
  // 放错位置的键：不会跑坏（runtime 压根不转发），但作者以为配了个这里不存在的功能 → 点名说清。
  const misplaced = (position === 'node' ? DOC_ONLY_BGM_KEYS : NODE_ONLY_BGM_KEYS).filter((k) => b[k] !== undefined)
  if (misplaced.length > 0) {
    issues.push({
      level: 'warn',
      code: 'bgm.key.ignored',
      msg: position === 'node'
        ? `bgm.${misplaced.join(' / ')} 是文档床（scenario.bgm）独有字段，节点上不生效`
        : `bgm.${misplaced.join(' / ')} 是节点作用域独有字段，文档床上不生效`,
      at,
    })
  }
  // ref 解析：与 media / 道具引用同级只给 warn —— 目前还没有把 audio 写进 assets/manifest 的链路，
  // error 会红掉每张合法图。日后 audio 资产落盘后再升级。
  if (!isStop && typeof ref === 'string' && ref.trim().length > 0) {
    if (!audio) {
      issues.push({ level: 'warn', code: 'bgm.ref.unresolved', msg: `bgm.ref '${ref}' 无 audio 资产表可校验（壳层能否 resolve 未知）`, at })
    } else if (!audio.has(ref)) {
      issues.push({ level: 'warn', code: 'bgm.ref.unresolved', msg: `bgm.ref '${ref}' 未在 assets/manifest 的 audio 资产里找到`, at })
    }
  }
}

/**
 * 强连通分量（Tarjan）。判「谁和谁在同一个环区」用：分量内任意两点互相到得了，
 * 单点分量只有带自环时才算环。悬空 target 会被当成一个到不了任何地方的点（悬空边另有 error）。
 */
function stronglyConnectedComponents(graph: GameGraph): string[][] {
  const adj = new Map<string, string[]>()
  for (const e of graph.edges) {
    const list = adj.get(e.source) ?? []
    list.push(e.target)
    adj.set(e.source, list)
  }
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const out: string[][] = []
  let counter = 0
  const connect = (u: string): void => {
    index.set(u, counter)
    low.set(u, counter)
    counter += 1
    stack.push(u)
    onStack.add(u)
    for (const v of adj.get(u) ?? []) {
      if (!index.has(v)) {
        connect(v)
        low.set(u, Math.min(low.get(u)!, low.get(v)!))
      } else if (onStack.has(v)) {
        low.set(u, Math.min(low.get(u)!, index.get(v)!))
      }
    }
    if (low.get(u) !== index.get(u)) return
    const comp: string[] = []
    for (;;) {
      const w = stack.pop()!
      onStack.delete(w)
      comp.push(w)
      if (w === u) break
    }
    out.push(comp)
  }
  for (const n of graph.nodes) if (!index.has(n.id)) connect(n.id)
  return out
}

/**
 * 环内叠层告警：一个环区里有 **≥2 个各自起播**（`push`，含缺省）的 bgm 节点，且环内没有任何
 * `mode: 'stop'` —— 每转一圈栈就多叠几层，作者听到的症状是
 * 「『结束当前音乐』没反应」（那条 stop 只退回上一圈的同一首）。
 *
 * 运行时**刻意不合并**这些层：层是作者明写的「记住上一首」（D8），替他合并等于作废他的配置。
 * 所以这条规则是产品侧的补偿——静态期能看出来的事，不该留给耳朵去查。
 *
 * 判据的取舍（都是为了不误报、宁可漏报）：
 * - 只数 `push`：`replace` 换栈顶不加深栈（引擎的 owner 守卫也保证同一节点回环不叠层），
 *   把它算进来会红掉「同场切 BOSS 曲」这种正确写法。
 * - 环区 = 强连通分量：分量内两个 push 节点**未必**落在同一个具体环上（例如 8 字形共用一个
 *   枢纽节点的两个环，各自只有一个 push 节点）→ 这种情况会**误报**一条 warn。
 * - **收层的 `stop` 在被调用的包里时同样误报**，而且这条落在推荐路径上：`enter`(push) →
 *   `combat`(容器，自己也 push) → `enter` 这种环，只要 `combat` 指向的包在自己的出口终端上写了
 *   `mode: 'stop'`（SPEC §6.2 现在把这条当作包自洽的正统写法），运行时每圈都收得干净、栈深恒定，
 *   但 `hasEnd` 只看**正在校验的这张图**上的节点，看不见包里那句 stop → 照样报一条 warn。
 *   与下一条是同一个信息缺口的两面：validator 手上只有一张孤立 graph，没有 `manifest.packs`。
 * - 只看单张图：跨蓝图的环（容器反复下钻同一个包）看不见 → **漏报**。
 *   最坏的一种是「包漏播 + 环里另有一个 pusher」：每圈叠两层且无上限，这里静默
 *   （包内的 pusher 在另一张图里，主图容器节点自身没配 `bgm` → 环里只数得出 1 个 pusher）。
 *   见 SPEC §9 风险表与 `engine.bgm.test.ts` 的「漏播在循环里会逐圈叠加」。
 * - 环内任一节点有 `stop` 就闭嘴：`stop` 是**唯一**能在局内结束一层的手段，它不保证收得干净
 *   （那条 stop 可能被条件边绕过），但这条规则的目的是提醒「你可能没写结束」，作者写了就不该再吵。
 *   反过来，环里只靠「出了这个子流程」来收层的图**收不住**（弹帧不动 BGM 栈）→ 照报不误。
 */
function checkBgmStackingCycle(graph: GameGraph, issues: Issue[]): void {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const order = new Map(graph.nodes.map((n, i) => [n.id, i]))
  const selfLooped = new Set(graph.edges.filter((e) => e.source === e.target).map((e) => e.source))
  for (const comp of stronglyConnectedComponents(graph)) {
    if (comp.length < 2 && !selfLooped.has(comp[0]!)) continue
    const pushers: string[] = []
    let hasEnd = false
    for (const id of comp) {
      const raw = (byId.get(id)?.data as { bgm?: unknown } | undefined)?.bgm
      if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) continue
      const b = raw as Record<string, unknown>
      if (b.mode === 'stop') {
        hasEnd = true
        continue
      }
      if ((b.mode === undefined || b.mode === 'push') && typeof b.ref === 'string' && b.ref.trim().length > 0) {
        pushers.push(id)
      }
    }
    if (hasEnd || pushers.length < 2) continue
    pushers.sort((a, z) => (order.get(a) ?? 0) - (order.get(z) ?? 0))
    issues.push({
      level: 'warn',
      code: 'bgm.cycle.stacking',
      msg: `环里有多个节点各自起播 bgm（${pushers.join(' / ')}）且环内没有 mode: 'stop'：`
        + '每转一圈都会多叠一层，之后的「结束当前音乐」只会退回上一圈那一首（听起来像没反应）',
      at: pushers[0],
    })
  }
}

interface GraphValidationState {
  nodeIds: Set<string>
  edgeIds: Set<string>
}

function validateGraphScope(
  graph: GameGraph,
  opts: ValidateOpts | undefined,
  entry: string | undefined,
  state: GraphValidationState,
): Issue[] {
  const issues: Issue[] = []
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const overlays = opts?.overlays

  for (const node of graph.nodes) {
    if (state.nodeIds.has(node.id)) {
      issues.push({ level: 'error', code: 'node.id.duplicate', msg: `节点 id '${node.id}' 在嵌套图中重复`, at: node.id })
    }
    state.nodeIds.add(node.id)
  }
  for (const edge of graph.edges) {
    if (state.edgeIds.has(edge.id)) {
      issues.push({ level: 'error', code: 'edge.id.duplicate', msg: `边 id '${edge.id}' 在嵌套图中重复`, at: edge.id })
    }
    state.edgeIds.add(edge.id)
  }

  // 1) 边：悬空 source/target + sourceHandle 是否在派生 outputs 内
  for (const e of graph.edges) {
    if (!byId.has(e.source)) {
      issues.push({ level: 'error', code: 'edge.source.missing', msg: `edge ${e.id} source '${e.source}' not found`, at: e.id })
    }
    if (!byId.has(e.target)) {
      issues.push({ level: 'error', code: 'edge.target.missing', msg: `edge ${e.id} target '${e.target}' not found`, at: e.id })
    }
    if (e.sourceHandle && !isRoutingHandle(e.sourceHandle)) {
      const src = byId.get(e.source)
      if (src) {
        const outs = deriveOutputs(src, overlays).map((h) => h.id)
        if (!outs.includes(e.sourceHandle)) {
          issues.push({
            level: 'error',
            code: 'edge.handle.missing',
            msg: `edge ${e.id} sourceHandle '${e.sourceHandle}' not in node ${e.source} outputs [${outs.join(', ')}]`,
            at: e.id,
          })
        }
      }
    }
    const transition = (e.data as { transition?: unknown } | undefined)?.transition
    if (transition !== undefined && transition !== 'immediate' && transition !== 'onSettlement') {
      issues.push({ level: 'error', code: 'edge.transition.invalid', msg: `edge ${e.id} transition 非法`, at: e.id })
    }
    if ((e.sourceHandle ?? 'default') === 'default' && transition === 'onSettlement') {
      issues.push({ level: 'error', code: 'edge.transition.default', msg: `默认边 ${e.id} 不应配置延迟结算`, at: e.id })
    }
  }

  // 2) 节点 type：必须解析到已注册 NodeKind（运行时会静默回退 perf，这里 fail-loud）。
  for (const n of graph.nodes) {
    if (!isPosition(n.position)) {
      issues.push({
        level: 'error',
        code: 'node.position.missing',
        msg: `节点 ${n.id} 缺少 position: { x, y }`,
        at: n.id,
      })
    }
    if (!defaultNodeKindRegistry.get(resolveNodeType(n))) {
      issues.push({ level: 'error', code: 'node.type.unknown', msg: `节点 type '${n.type}' 未注册 NodeKind`, at: n.id })
    }
    const settlement = (n.data as { routingSettlement?: unknown }).routingSettlement
    if (settlement !== undefined) {
      const value = settlement as { type?: unknown; ms?: unknown }
      const valid = value && typeof value === 'object' && (
        value.type === 'complete' ||
        (value.type === 'at' && typeof value.ms === 'number' && Number.isFinite(value.ms) && value.ms >= 0)
      )
      if (!valid) {
        issues.push({ level: 'error', code: 'node.routingSettlement.invalid', msg: '节点路由结算点非法', at: n.id })
      }
    }
  }

  // 3) overlay children component：是否注册 + 参数校验
  for (const n of graph.nodes) {
    const children = expandNodeOverlays(overlays, n).flatMap((i) => i.children)
    for (const el of children) {
      const plugin = getComponent(el.component)
      if (!plugin) {
        issues.push({
          level: 'error',
          code: 'component.unknown',
          msg: `unknown component '${el.component}'`,
          at: `${n.id}/${el.id}`,
        })
        continue
      }
      for (const problem of plugin.validate?.(el.inputs) ?? []) {
        issues.push({
          level: 'error',
          code: 'component.invalid',
          msg: `${el.component}: ${problem}`,
          at: `${n.id}/${el.id}`,
        })
      }
    }
  }
  for (const overlay of Object.values(overlays ?? {})) checkOverlayReactions(overlay, overlays ?? {}, issues)

  // 4) 不可达节点（蓝图根缺省从 nodes[0]；内嵌子流程从显式 entry）
  if (graph.nodes.length > 0) {
    const start = entry ?? graph.nodes[0]!.id
    const adj = new Map<string, string[]>()
    for (const e of graph.edges) {
      const list = adj.get(e.source) ?? []
      list.push(e.target)
      adj.set(e.source, list)
    }
    const seen = new Set<string>([start])
    const queue = [start]
    while (queue.length > 0) {
      const id = queue.shift()!
      for (const next of adj.get(id) ?? []) {
        if (!seen.has(next)) {
          seen.add(next)
          queue.push(next)
        }
      }
    }
    for (const n of graph.nodes) {
      if (!seen.has(n.id)) {
        issues.push({ level: 'warn', code: 'node.unreachable', msg: `node '${n.id}' unreachable from start '${start}'`, at: n.id })
      }
    }
  }

  // 5) 纯瞬时环告警（静态）
  checkInstantCycle(graph, overlays, issues)

  // 6) 引用检查（需 opts 提供已声明的 entity/var/item id）：condition/effect/expr + reactions
  if (opts) {
    const ctx: RefCtx = {
      entities: new Set(opts.entities ?? []),
      vars: new Set(opts.vars ?? []),
      formulas: new Set(opts.formulas ?? []),
      items: new Set(opts.items ?? []),
      nodeIds: new Set(graph.nodes.map((n) => n.id)),
    }
    for (const n of graph.nodes) {
      const { subProcess: _subProcess, ...ownData } = n.data as unknown as Record<string, unknown>
      walkRefs(ownData, ctx, n.id, issues)
    }
    for (const e of graph.edges) walkRefs(e.data, ctx, e.id, issues)
    if (overlays) {
      for (const [oid, ov] of Object.entries(overlays)) {
        for (const ch of ov.children) walkRefs(ch, ctx, `overlay:${oid}/${ch.id}`, issues)
      }
    }
    const edgeIds = new Set(graph.edges.map((e) => e.id))
    for (const n of graph.nodes) {
      const packs: Array<{ reactions?: Reaction[]; at: string }> = [
        { reactions: n.data.reactions, at: `node:${n.id}.reactions` },
        ...(n.data.overlayNodes ?? []).map((m, mi) => ({
          reactions: m.reactions,
          at: `node:${n.id}.overlayNodes[${mi}].reactions`,
        })),
      ]
      const overlayMountIds = new Set((n.data.overlayNodes ?? []).map(overlayMountId))
      for (const pack of packs) {
        for (let i = 0; i < (pack.reactions ?? []).length; i++) {
          const r = pack.reactions![i]!
          const at = `${pack.at}[${i}]`
          if (r.when.type === 'state') walkRefs(r.when.condition, ctx, at, issues)
          if (r.when.type === 'complete' && r.when.if) walkRefs(r.when.if, ctx, at, issues)
          // watch 的局部量由被观察值提供；演出相位结算靠同一 do 内在前的数值 effect 采样；
          // event / state / shown / hidden 的执行路径不传局部量，任何位置都读不到。
          const phaseSamples = r.when.type === 'enter' || r.when.type === 'at'
            || r.when.type === 'exit' || r.when.type === 'complete'
          let localsAvailable = r.when.type === 'watch'
          for (const a of r.do) {
            if (phaseSamples && effectYieldsLocals(a)) localsAvailable = true
            else if (phaseSamples && a.kind === 'effect') localsAvailable = false
            if (a.kind === 'effect') walkRefs(a.effects, ctx, at, issues)
            if (a.kind === 'spawn') {
              walkRefs(a.inputs, ctx, at, issues)
              const localsUsed = spawnLocalsUsed(a.inputs)
              if (localsUsed.length && !localsAvailable) {
                issues.push({
                  level: 'error',
                  code: 'ref.spawn.locals.unavailable',
                  msg: `reaction spawn 读取 ${localsUsed.join(' / ')}，但此处没有可采样的数值变化：请在同一结算内把改属性/改变量的效果排在该界面之前`,
                  at,
                })
              }
              const slash = a.from.indexOf('/')
              const overlayId = slash > 0 ? a.from.slice(0, slash) : ''
              const childId = slash > 0 ? a.from.slice(slash + 1) : ''
              if (!overlayId || !childId || (overlays && !overlays[overlayId]?.children.some((child) => child.id === childId))) {
                issues.push({
                  level: 'error',
                  code: 'ref.spawn.missing',
                  msg: `reaction spawn.from '${a.from}' 未命中界面模板`,
                  at,
                })
              }
            }
            if (a.kind === 'hideOverlay' && !a.mountId.trim()) {
              issues.push({
                level: 'error',
                code: 'ref.hideOverlay.mount.empty',
                msg: 'reaction hideOverlay.mountId 不能为空',
                at,
              })
            }
            if (a.kind === 'hideOverlay' && a.mountId.trim() && !overlayMountIds.has(a.mountId)) {
              issues.push({
                level: 'error',
                code: 'ref.hideOverlay.mount.missing',
                msg: `reaction hideOverlay.mountId '${a.mountId}' 未命中本节点内已有界面`,
                at,
              })
            }
            if (a.kind === 'advance' && !edgeIds.has(a.edgeId)) {
              issues.push({ level: 'error', code: 'ref.edge.missing', msg: `reaction advance 指向未知边 '${a.edgeId}'`, at })
            }
          }
        }
      }
    }
  }

  // 7) 节点作用域 BGM 配置（容器与普通节点走同一条路）。
  const audio = opts?.audioAssets ? new Set(opts.audioAssets) : undefined
  for (const n of graph.nodes) {
    checkBgm((n.data as { bgm?: unknown }).bgm, `node:${n.id}.bgm`, audio, issues, 'node')
  }
  checkBgmStackingCycle(graph, issues)

  // 8) 私有内嵌子流程：字段互斥、入口直属、逐层递归校验。
  for (const node of graph.nodes) {
    const raw = node.data as unknown as Record<string, unknown>
    if ('subFlow' in raw || 'subFlowRef' in raw) {
      issues.push({ level: 'error', code: 'subProcess.legacy', msg: '旧 subFlow/subFlowRef 已不受支持，请使用 subProcess', at: node.id })
    }
    const process = getSubProcess(node.data)
    if ('subProcess' in raw && !process) {
      issues.push({
        level: 'error',
        code: 'subProcess.invalid',
        msg: 'subProcess 必须包含字符串 entry 和合法的 graph',
        at: node.id,
      })
    }
    if (process && getSubFlowPack(node.data)) {
      issues.push({ level: 'error', code: 'subProcess.conflict', msg: 'subProcess 与 subFlowPack 不能同时存在', at: node.id })
    }
    if (!process) continue
    if (!process.graph.nodes.some((child) => child.id === process.entry)) {
      issues.push({
        level: 'error',
        code: 'subProcess.entry.missing',
        msg: `subProcess entry '${process.entry}' 不在直属子图中`,
        at: node.id,
      })
    }
    const nested = validateGraphScope(process.graph, opts, process.entry, state)
    issues.push(...nested.map((issue) => ({
      ...issue,
      at: `${node.id}/subProcess${issue.at ? `/${issue.at}` : ''}`,
    })))
  }

  return issues
}

export function validateGraph(graph: GameGraph, opts?: ValidateOpts): Issue[] {
  return validateGraphScope(graph, opts, undefined, { nodeIds: new Set(), edgeIds: new Set() })
}

/** 是否存在「attr 可归零」的致死出口：边条件上的 attrRatio ≤ 0。 */
function hasLethalExit(graph: GameGraph, attr: string): boolean {
  for (const e of graph.edges) {
    for (const c of e.data?.condition?.all ?? []) {
      if (c.type === 'attrRatio' && c.attr === attr && (c.op === 'lte' || c.op === 'lt') && c.value <= 0) return true
      if (c.type === 'attr' && c.attr === attr && (c.op === 'lte' || c.op === 'lt') && c.value <= 0) return true
    }
  }
  return false
}

function mutatesAttr(value: unknown, attr: string): boolean {
  if (value == null || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some((v) => mutatesAttr(v, attr))
  const o = value as Record<string, unknown>
  if (o.kind === 'attr' && o.attr === attr && (o.op === 'add' || o.op === 'set')) return true
  return Object.values(o).some((v) => mutatesAttr(v, attr))
}

/**
 * 校验整份 GameScenario：graph 结构 + 致死 attr 无出口 warning + 文档默认床轨。
 * load / 保存前应走这里（fail-loud：error 级禁止静默降级）。
 *
 * @param opts 可选资产表：有 audio 资产 id 时才能判定 `bgm.ref` 是否可解析。
 */
export function validateScenario(scenario: GameScenario, opts?: Pick<ValidateOpts, 'audioAssets'>): Issue[] {
  const issues = validateGraph(scenario.graph, {
    entities: Object.keys(scenario.entities ?? {}),
    vars: Object.keys(scenario.variables ?? {}),
    formulas: Object.keys(scenario.formulas ?? {}),
    overlays: scenario.ui?.overlays,
    audioAssets: opts?.audioAssets,
  })

  // 文档默认床轨（`doc.bgm`）—— 与节点级同规则；节点级在 validateGraph 里。
  checkBgm(scenario.bgm, 'doc.bgm', opts?.audioAssets ? new Set(opts.audioAssets) : undefined, issues, 'doc')

  const zeroable = new Set<string>(['hp'])
  for (const ent of Object.values(scenario.entities ?? {})) {
    for (const [attr, meta] of Object.entries(ent.attrMeta ?? {})) {
      if (meta.min === 0) zeroable.add(attr)
    }
  }
  for (const attr of zeroable) {
    if (!mutatesAttr(scenario.graph, attr)) continue
    if (!hasLethalExit(scenario.graph, attr)) {
      issues.push({
        level: 'warn',
        code: 'lethal.no-exit',
        msg: `mutates attr '${attr}' but no attrRatio≤0 edge exit found`,
        at: `attr:${attr}`,
      })
    }
  }

  return issues
}
