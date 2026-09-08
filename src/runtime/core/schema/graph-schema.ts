/**
 * 域 graph schema —— 新引擎/蓝图的**持久化 SSOT 形态**（存 blueprint.json）。
 *
 * 在 `./react-flow-schema.ts` 的泛型骨架（Node/Handle/Edge/Graph）之上落定本引擎的数据契约。
 * 视频覆盖物见 `./node-config-schema.ts`：
 *   - **Overlay** → `GameScenario.ui.overlays`（含 `children`）
 *   - **OverlayNode** → `NodeData.overlayNodes[]`
 *
 * **图原生类型**（GraphEffect / GraphCondition / Entity…）保持通用、无品类假设：
 *   - 实体 = 一袋开放数值 `attrs` + 可选约束 `attrMeta`（min/max/initial）；**没有 hp 特权字段**——
 *     hp 只是"名为 hp、attrMeta 带 max/initial 的一个 attr"的**约定**。
 *   - 条件/副作用全走 attr/var，`attrRatio` = `attrs[attr] / attrMeta[attr].max`。
 *   - 一切逻辑声明式、可序列化、无函数入库。
 */
import type { Graph, Node, Edge, Handle } from './react-flow-schema'
import type { GameScenarioUi, OverlayNode, Reaction } from './node-config-schema'

export type {
  BindValue,
  Layout,
  LayoutValue,
  OverlayChild,
  Overlay,
  GameScenarioUi,
  OverlayNode,
  OverlayInstanceChild,
  OverlayInstance,
  ComponentInput,
  ComponentEvent,
  ComponentManifest,
  ComponentTimingContract,
  NodeAction,
  OverlayReactionAction,
  OverlayReaction,
  Reaction,
  ReactionTrigger,
  OverlayEventRef,
} from './node-config-schema'

import type {
  KinoVideoGenerationMode,
  KinoVideoResolution,
  KinoVideoSize,
} from './kino-schema'

export { overlayMountId } from './node-config-schema'

export {
  STAGE_FILL_LAYOUT,
  layoutValueToCss,
  layoutToCss,
  layoutWrapStyle,
  layoutHasExplicitSize,
  layoutIsEffectivelyEmpty,
  mountWrapStyle,
  childWrapStyle,
} from './layout'

export {
  expandOverlayMount,
  expandNodeOverlays,
  expandNodeChildren,
  nodeOverlayChildren,
  nodeOverlayMounts,
  overlayInstanceChildId,
} from './expand-overlay'

export {
  aggregateOverlayEvents,
  aggregateNodeOverlayEvents,
  eventsFromParams,
  overlayReactionKey,
  resolveOverlayReaction,
  resolveEventReactionDo,
  resolveEventReactions,
  completeReactions,
} from './overlay-events'

/**
 * 数值 = 常量或表达式字符串。求值语法只此一套，见 expr.ts —— `pick` 不是第二套表达式。
 * `pick` 是编辑器专属 sidecar：记录「用下拉选取式拼出该 expr」时的选择结构，供重开时复原
 * 下拉；由编辑器编译进 `expr`。引擎只读 `expr`，从不读 `pick`。
 */
export type NumOrExpr = number | { expr: string; pick?: ValuePick }
/** `pick` 的选取式结构（运行时忽略）：常量，或一条左结合的 ±×÷ 条款链。 */
export type ValuePick =
  | { mode: 'const'; const: number }
  | { mode: 'pick'; terms: ValueTerm[] }
export type ValueTermOp = '+' | '-' | '*' | '/'
/** 一项：与前项做 op（首项仅 ±）；取值按 source —— entity.<refId>.attr.<attr> / var.<refId> / const。 */
export type ValueTerm = {
  op?: ValueTermOp
  source: 'entity' | 'var' | 'const'
  refId: string
  attr?: string
  constValue?: number
}
export type CmpOp = 'gte' | 'lte' | 'gt' | 'lt' | 'eq' | 'neq'
export type TextCmpOp = 'eq' | 'neq'
/** 文本值可为字面量，或对变量/实体文案的引用。 */
export type TextValue = string | { ref: string }

// ── 副作用（图原生，通用）────────────────────────────────────────────────────
/** 数值类 effect 的运算：加 / 乘 / 设为（减 = 增加负数）。 */
export type NumericEffectOp = 'add' | 'mul' | 'set'
export type GraphEffect =
  | { kind: 'attr'; entityId: string; attr: string; op: NumericEffectOp; value: NumOrExpr; once?: boolean; id?: string }
  /** 缺少 valueType 的旧数据按数值变量解释。 */
  | { kind: 'var'; varId: string; valueType?: 'number'; op: NumericEffectOp; value: NumOrExpr; once?: boolean; id?: string }
  | { kind: 'var'; varId: string; valueType: 'text'; op: 'set'; value: TextValue; once?: boolean; id?: string }
  | { kind: 'flag'; varId: string; value: boolean; id?: string }
  | { kind: 'item'; itemId: string; op: 'give' | 'take'; count: number; id?: string }

// ── 条件（图原生，通用；无 hp 特判）──────────────────────────────────────────
export type GraphClause =
  /** 缺少 valueType 的旧数据按数值变量解释。 */
  | { type: 'var'; varId: string; valueType?: 'number'; op: CmpOp; value: number }
  | { type: 'var'; varId: string; valueType: 'text'; op: TextCmpOp; value: TextValue }
  | { type: 'flag'; varId: string; equals: boolean }
  | { type: 'visited'; nodeId: string }
  /** 直接比某实体某 attr 的值。 */
  | { type: 'attr'; entityId: string; attr: string; op: CmpOp; value: number }
  /** 比某 attr 的"比例"= attrs[attr] / attrMeta[attr].max（如 hp 血量比例；死亡 = attrRatio hp lte 0）。 */
  | { type: 'attrRatio'; entityId: string; attr: string; op: CmpOp; value: number }
  /** 两实体同名 attr 运行时比较（如出手判断比 speed）。 */
  | { type: 'attrCompare'; left: string; right: string; attr: string; op: CmpOp }
  | { type: 'score'; op: CmpOp; value: number }
  | { type: 'hasItem'; itemId: string; count?: number }
export interface GraphCondition {
  all: GraphClause[]
}

// ── 实体 / 变量定义 ──────────────────────────────────────────────────────────
/** 规则作者可持久化的值。字符串不参与数值公式或实体数值属性。 */
export type ScalarValue = string | number

/** 可安全投影到数值运行态的标量。 */
export function isNumericScalar(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 可安全投影到文本运行态的标量。 */
export function isTextScalar(value: unknown): value is string {
  return typeof value === 'string'
}

export function variableValueKind(variable: Pick<Variable, 'initial'> | undefined): 'number' | 'text' {
  return isTextScalar(variable?.initial) ? 'text' : 'number'
}

/** attr 的静态约束/元信息（值本身在运行态的 attrs 里）。 */
export interface AttrMeta {
  min?: number
  max?: number
  /** 复位/复活的初值（restart/resetGlobals 用）。 */
  initial?: number
  /** HUD/编辑器显示名。 */
  label?: string
}
export interface Entity {
  /** 与 `GameScenario.entities` 的 Record key 对齐；编辑器添加时自动生成，不可手填。 */
  id: string
  name?: string
  kind?: string
  /** 开放标量袋：数值可被运行时公式引用；字符串仅供作者编辑与存储。 */
  attrs?: Record<string, ScalarValue>
  /** 每个 attr 的约束（clamp 上下界 / 初值 / 显示名）；可选。 */
  attrMeta?: Record<string, AttrMeta>
}
/** 节点使用哪些场景，以及是否作为该节点视频生成的参考。 */
export interface NodeSceneBinding {
  sceneId: string
  role?: 'primary' | 'secondary' | 'background'
  useAsVideoReference?: boolean
}

export interface Variable {
  /** 与 `GameScenario.variables` 的 Record key 对齐；编辑器添加时自动生成，不可手填。 */
  id: string
  name?: string
  initial?: ScalarValue
  min?: number
  max?: number
}

// ── 文字样式（图原生，镜像 legacy TextStyle；floatText / dialogue 共用底座）──────────
/**
 * 文字「长什么样」。位置/尺寸见 `Layout`。
 * 字段名与 CSS / React.CSSProperties 一一对应；呈现层只做单位换算与缺省兜底。
 * · `fontSize`：数值 = 画面高度百分比，渲染为 `${n}cqh`
 * · `WebkitTextStroke*`：对应 `-webkit-text-stroke-color/width`
 */
export interface GraphTextStyle {
  fontFamily?: string
  fontWeight?: number
  color?: string
  fontSize?: number
  textAlign?: 'left' | 'center' | 'right'
  textDecoration?: string
  backgroundColor?: string
  opacity?: number
  textShadow?: string
  WebkitTextStrokeColor?: string
  WebkitTextStrokeWidth?: number
}

/** 文字预设样式（预设网格一格）；内置在 text-style.ts，用户自定义存 GameScenario.textStylePresets。 */
export interface GraphTextStylePreset {
  id: string
  name: string
  style: GraphTextStyle
  /** 仅字幕预设：勾选后展示说话人前缀（映射到 dialogue.speaker）。 */
  speakerPrefix?: boolean
  /** 内置只读；用户自定义可编辑/删除。 */
  builtin?: boolean
}

/**
 * 触发时机（相对**本演出节点**的生命周期 / 时间线）。
 * 引擎按 when 在对应时刻跑该元素（`fired` 去重）。
 * 收尾 / 离场副作用走 `Reaction`（`complete` / `exit`），不在 Trigger 上表达。
 */
export type Trigger =
  /** 进入本节点、演出开始时立刻触发（开场 HUD / 进门对话等）。 */
  | { when: 'enter' }
  /**
   * 相对本节点演出起点经过 `ms` 毫秒后触发（卡点 QTE、中段飘字等）。
   * `ms` 与视频时间轴对齐；同一元素只触发一次。
   */
  | { when: 'at'; ms: number }

/**
 * Kind 插件职责（presentation 渲染 / interaction 交互）。副作用不在组件层，走 node.data.reactions。
 * 覆盖物见 OverlayChild.component（无落盘 role）。
 */
/** 节点端口描述（`outputs()` / `deriveOutputs` 返回）；边经 `sourceHandle`/`targetHandle` 引用其 `id`。 */
export interface NodeHandle {
  id: string
  label?: string
}

export interface NodeMedia {
  kind: string
  ref?: string
  /** 写给视频生成模型的镜头/动作/氛围提示词（图编辑器「重新生成」面板）。 */
  prompt?: string
  meta?: Record<string, unknown>
  /** 视频节点的生成预设；见 `NodeVideoGenerationPreset`。旧节点没有。 */
  generation?: NodeVideoGenerationPreset
}

/**
 * 节点视频的生成预设，**provider-resource-neutral**。
 *
 * 只保存作者选项和平台 asset id：Kino resource id 属于 provider、生成前可能还不存在，
 * 写进蓝图会让文档不可移植。完整 `KinoVideoGenerationParams` 只在用户点击生成的提交
 * 边界由 Host 解析。任务状态与成片 URL 住 `assets/manifest.json`，不在这里。
 *
 * `prompt` 不在本结构内 —— `NodeMedia.prompt` 保持基础 prompt 的唯一真相源，避免双写。
 */
export interface NodeVideoGenerationPreset {
  schemaVersion: 1
  durationSeconds: number
  generateAudio: boolean
  mode: KinoVideoGenerationMode
  size?: KinoVideoSize
  resolution?: KinoVideoResolution
  model?: string
  visualStyleKey?: string
  /** 逻辑参考：平台 asset id，**不是** Kino resource id。 */
  references?: {
    sceneAssetIds?: string[]
    firstFrameAssetId?: string
    lastFrameAssetId?: string
    extraImageAssetIds?: string[]
  }
}

/** 可重新生成的视频演出节点媒体：基础 prompt 必填，生成预设在完成门前补齐。 */
export interface NodeVideoMedia extends NodeMedia {
  kind: 'video'
  prompt: string
}

/** 节点出场角色绑定；只引用 `characterId`，不复制角色名或外观正文。 */
export interface NodeCastBinding {
  characterId: string
  role?: 'primary' | 'supporting' | 'background'
  /** 缺省 true。false = 仅叙事提及，不参与画面参考推导。 */
  onScreen?: boolean
}

/**
 * 复合节点标识。主蓝图与子蓝图可以存在同名 `nodeId`，所以单独的 nodeId 不唯一，
 * 素材归属与生产上下文查询都必须带 `blueprintId`。
 */
export interface NodeRef {
  blueprintId: string
  nodeId: string
}

/** 音频资产引用：只挂 `assets/manifest` 里的 id，永不落 URL（壳层 resolve，引擎只传 id）。 */
export type AudioRef = string

/**
 * 文档默认床轨（挂 `GameScenario` 根，与 `variables` / `entities` 同级）。
 * 会话 `start` 时以 owner `'__doc__'` 压入 BGM 栈，通常不在中途 pop。
 * 缺省 = 静音起局，直到走进首个带 `bgm` 的作用域。
 *
 * 不要拿入口节点的 `data.bgm` 充当「整局默认」：它确实会一直播（D5），但它是**作用域层**——
 * `jump` 会把它退掉、清局会按 `scenario.bgm` 重 derive，之后整局就再没有床轨了。整局默认只有
 * 写在这里才是地板（`stop` 也弹不掉，D13）。
 */
export interface DocumentBgm {
  ref: AudioRef
  /** 0..1，默认 1。 */
  volume?: number
  fadeInMs?: number
  /**
   * 文档床**离场**时的淡出时长（ms，默认 0 = 硬切）。
   *
   * 淡出恒取自离场那一帧（`BgmStack.resume`），所以「叙事床 → 战斗床」这条最常听到的转场
   * 只有写在这里才淡得出去；缺了它，进战斗时正响的叙事床会 0ms 掉到静音，再由战斗床按自己的
   * `fadeInMs` 淡入 —— 听感是一次明显的空档。
   */
  fadeOutMs?: number
  /** 默认 true。 */
  loop?: boolean
}

/**
 * 节点作用域 BGM（owner 视角，不是「触发类型」）。
 *
 * **配了就一直播**：进入该节点（容器则 `descend` 时）起播，跨多少节点都不停；
 * **走边离开该节点不结束**。结束只有两个来源，别无其他：
 *   - 后面某个节点配 `mode: 'stop'` → 结束当前这层，回到上一层还没结束的那首；
 *   - `jump` / 清局 → 引擎整体退栈（`unwindBgmToDocBed`）。
 *
 * 容器（`subProcess` / `subFlowPack`）**不是**作用域：容器上的 `bgm` 与普通节点同一规则，弹回外层
 * 不结束它。想要「出了这个子流程就结束」只能在包的每个出口终端上写 `mode: 'stop'`；被硬打断
 * 弹出容器（没走终端）时这首会漏到调用方继续播。反过来也成立——**配 BGM 不得要求作者改蓝图
 * 结构**（D11）：一段平铺节点共用一首曲子只需在头一个节点上配一次，不必包进容器。
 *
 * 内层节点不配 `bgm` 即继承当前栈顶（一律不动栈）。只配 `volume` 时不换曲、不新建作用域层，
 * 仅调整当前栈顶的音量；当前没有 BGM 时无操作。
 */
export interface NodeBgm {
  /** `mode: 'stop'` 或仅调整当前 BGM 音量时可省；其余情况必填。 */
  ref?: AudioRef
  /**
   * - `push`（默认）：起播并**记住**当前正响的那首，一直播到有人结束它。
   * - `replace`：换曲但**不**记住上一首（栈深不变）——「这首之后不需要回去」。
   * - `stop`：结束当前这层，回到上一层还没结束的那首。文档床是地板，弹不掉（D13）。
   */
  mode?: 'push' | 'replace' | 'stop'
  /** 0..1；未配置时沿用当前正在播放的 BGM 音量，起局无 BGM 时默认 1。 */
  volume?: number
  fadeInMs?: number
  fadeOutMs?: number
  /**
   * 同 ref 再次成为栈顶时是否从头播。
   * 默认 false = 续播（回合循环友好）。
   */
  restart?: boolean
  /** 默认 true = 循环；false = 单次播放。仅在配置了 ref 时生效。 */
  loop?: boolean
}

/**
 * 图节点 `data` **基类**（普通演出节点）。
 *
 * 子流程 / 子蓝图容器用特化类型：
 *   - `SubProcessNodeData` — 节点私有的内嵌子图
 *   - `SubFlowPackNodeData` — 跨图 pack 引用
 * `GameNode.data` = `GameNodeData` 联合；读写嵌套字段用 `getSubProcess` / `getSubFlowPack`。
 *
 * 覆盖物一律经 `overlayNodes` 引用并展开；视频上只能挂 Overlay，不能直挂裸组件。
 */
/**
 * 节点玩法契约 —— 三条线之间唯一的共享设计。
 *
 * 真跑里三条线各自猜对方的意图：总脉络编出没有元件提供的出口，数值线写了 43 个公式
 * 只有 3 个被用上，整装拿到一堆零件却不知道哪个配哪个。根因不是「看不见零件」，
 * 而是**没人把玩法本身写下来**——玩法是「这个节拍里观众做什么、什么变了、走向哪里」，
 * 它跨了三条线的写域，所以必须是显式契约而不是各自的默契。
 *
 * 由总脉络声明（它定节拍与分支，且能看元件清单），数值线**只读**它来决定要造哪些公式，
 * 整装照它挂载与接线。三段都有对应的完成门校验，见 `outline.interaction-plan` /
 * `rules.plan-formulas` / `finalization.plan-wired`。
 */
export interface NodeInteractionPlan {
  /**
   * 节拍类型。`narrative` 是**有意的纯叙事段**（观众只看），其余四类必须有 actions；
   * 这条区分让「漏配」和「刻意不配」在机器上可分辨。
   */
  beat: 'narrative' | 'choice' | 'combat' | 'check' | 'timed'
  /** 观众在这个节拍能做的事；每条对应一个界面元件事件。 */
  actions?: NodeInteractionAction[]
  /** 回合节拍未分胜负时回到的节点；由 Host 校验真实回边。 */
  loop?: {
    backTo: string
    note?: string
  }
  /** 终局/转折条件，例如 `entity.tiger.attr.hp <= 0`。整装把它落成出边条件或 state reaction。 */
  terminals?: Array<{ when: string; note?: string }>
}

/** 一次玩家动作：点哪个元件的哪个事件、改什么、走向哪里。 */
export interface NodeInteractionAction {
  /** 界面元件 id，必须在元件清单里（`list_ui_components`）。 */
  component: string
  /** 元件事件 id；它同时是本节点的出口 handle（见 `ComponentRegistry.deriveOutputs`）。 */
  event: string
  /** 一句话说明观众为什么会点它（作者语言），供整装与后续人工审读。 */
  intent: string
  /**
   * 这个动作改什么。`target` 用 `entity.<id>.attr.<attr>` 或 `var.<id>`；
   * `formulaId` 是**期望数值线提供的公式名**——数值线读这里决定要造哪些公式，
   * 整装用它写 effect。纯分支动作（只跳转不改数值）可以不填。
   */
  effect?: {
    target: string
    op: 'add' | 'sub' | 'set'
    formulaId?: string
    value?: number
  }
  /**
   * 这个动作要走的出边 `sourceHandle`。缺省即与 `event` 同名；
   * 填 `none` 表示只结算不离开节点；一次性组件不会因此获得第二次 emit。
   */
  exit?: string
}

export interface NodeData {
  name: string
  /** 章节/节拍概览，供节点卡与节点生产上下文使用。 */
  chapterSummary?: string
  /** 本节拍的玩法契约；见 `NodeInteractionPlan`。纯叙事节点也要显式声明 beat。 */
  interaction?: NodeInteractionPlan
  /**
   * 作者可读的演出/叙事正文（演出描述 + 台词 + 内心独白 + 选项）。
   * 视频是它的下游产物：正文 → 分镜 → 关键帧 → 视频。字段名是 storyText，不是 scriptText。
   */
  storyText?: string
  /** 本节点出场角色；引用 `assets/manifest.json.assetCatalog.entities.character` 的 key。 */
  cast?: NodeCastBinding[]
  /** 本节点使用的场景；引用 manifest 场景实体的 key。与 cast 对称。 */
  scenes?: NodeSceneBinding[]
  media?: NodeMedia
  mediaPlayMode?: 'once' | 'loop'
  /**
   * 延迟事件边的统一结算点。缺省在演出结束时结算；`at` 到点时提前收尾并离开节点。
   */
  routingSettlement?: RoutingSettlement
  /**
   * 可选播放时长上限（ms）。Inspector 不再暴露编辑；字段仍由 bindVideo、既有图数据、
   * 以及程序化写入保留，runtime 继续消费。
   * - 无视频节点：作停留节拍 / 时间轴标尺。
   * - 有视频节点：`>0` 且 `≤ 视频本身长度` 时，到点提前收演出；未填 / `≤0` / 超过视频长度
   *   → 视为无效、丢弃，以视频本身长度为准（不截断，交给 onEnded）。
   */
  durationMs?: number
  /** 本节点上的 overlay 挂载列表；纯过场可省略。 */
  overlayNodes?: OverlayNode[]
  /**
   * 本节点作为 owner 的作用域 BGM；缺省 = 不动 BGM 栈（继承上层）。
   * `SubFlow*NodeData` 由基类自动继承本字段，容器与普通节点同一套寿命规则，见 `NodeBgm`。
   */
  bgm?: NodeBgm
  reactions?: Reaction[]
}

/**
 * 跨图子蓝图指针（图上只存指针，不存子图节点）。
 * 本体在 `manifest.packs[id]`；engine 开跑用根 `graph`，执行中遇依赖再查表。
 */
export interface SubFlowPack {
  /** 蓝图 id（与 BlueprintDoc.id 对齐）。 */
  id: string
  /** 可选版本钉死；解析时优先 `id@version`，否则回退 `id`。 */
  version?: string
  /** 覆盖包内默认入口；缺省用蓝图文档 entry。 */
  entry?: string
}

/**
 * 内嵌子流程本体。`entry` 只允许指向直属 `graph.nodes`；父子图之间不得直接连边。
 */
export interface SubProcess {
  entry: string
  graph: GameGraph
}

/**
 * 节点私有的内嵌子流程容器：首次进入压栈并切到 `subProcess.graph`；
 * 子图叶子无自动出边时弹回，容器不重播、沿父图出边续走。
 */
export interface SubProcessNodeData extends NodeData {
  subProcess: SubProcess
}

/**
 * 跨图子蓝图容器：进入后加载 pack，从 entry 跑；包内叶子无出边时弹回主图。
 */
export interface SubFlowPackNodeData extends NodeData {
  subFlowPack: SubFlowPack
}

/** 图上节点 data 联合（基类 ∪ 子流程特化）。 */
export type GameNodeData = NodeData | SubProcessNodeData | SubFlowPackNodeData

export function getSubProcess(d: GameNodeData): SubProcess | undefined {
  const process = (d as SubProcessNodeData).subProcess
  return process
    && typeof process === 'object'
    && typeof process.entry === 'string'
    && isGameGraph(process.graph)
    ? process
    : undefined
}

export function getSubFlowPack(d: GameNodeData): SubFlowPack | undefined {
  const p = (d as SubFlowPackNodeData).subFlowPack
  return p && typeof p === 'object' && typeof p.id === 'string' ? p : undefined
}

/**
 * 读节点作用域 BGM；**没有可用意图**的形状一律丢弃（非对象、只有 fade / mode 参数没曲子等）。
 *
 * 「可用意图」= 有可播的 `ref`（非空字符串）、`mode === 'stop'`（结束当前层，本就不带曲子），
 * **或**没有 ref 但有合法 `volume`（只调整当前栈顶音量）。
 * 不能只看 `ref`：那会把 `win.data.bgm = { mode: 'stop' }` 静默吃掉——作者配了「结束音乐」却
 * 一直听到战斗曲，且全程无报错。落盘的非法形状由 `validate.ts` fail-loud（读原始值），这里只
 * 保证引擎拿到的每一份 `bgm` 都真的有事可做。
 */
export function getNodeBgm(d: GameNodeData): NodeBgm | undefined {
  const b = (d as NodeData).bgm
  if (!b || typeof b !== 'object') return undefined
  if (b.mode === 'stop') return b
  if (typeof b.ref === 'string' && b.ref.length > 0) return b
  return b.ref === undefined
    && typeof b.volume === 'number'
    && Number.isFinite(b.volume)
    && b.volume >= 0
    && b.volume <= 1
    ? b
    : undefined
}

export function isSubflowContainerData(d: GameNodeData): boolean {
  return getSubProcess(d) != null || getSubFlowPack(d) != null
}

/**
 * 子蓝图包形态（与 BlueprintDoc 对齐字段；UI/测试注入用）。
 * 落盘权威是 `manifest.packs` 里的 `BlueprintDoc`，不再有根级 scenario.packs 数组。
 */
export interface SubFlowPackDef {
  id: string
  /** 内容版本；`subFlowPack` 指针可钉 `id@version`。 */
  version: string
  title?: string
  /** 包内入口节点 id。 */
  entry: string
  graph: GameGraph
  /** 可选：主图须具备的变量/实体（缺则启动/校验失败；P0 引擎仅在 resolve 时检查 entry 存在）。 */
  requires?: { vars?: string[]; entities?: string[] }
}

/** 延迟事件边共用节点的统一结算点。 */
export type RoutingSettlement =
  | { type: 'complete' }
  | { type: 'at'; ms: number }

/** 事件边的跳转方式；缺省 `immediate` 保持旧图行为。 */
export type EdgeTransition = 'immediate' | 'onSettlement'

/** 边路由数据（edge.data）——条件 / 权重 / 跳转方式；副作用走 reactions / option.effects。 */
export interface EdgeRouting {
  condition?: GraphCondition
  weight?: number
  transition?: EdgeTransition
}

/**
 * 图节点 type 字面量。合法集合的 **SSOT 是 `NodeKindRegistry`**（`runtime/nodes`），
 * 故用开放联合：保留 `'perf'` 的补全，同时允许任意已注册类型——加节点 = 注册一个 NodeKind，
 * 不必回改本行。浅守卫（isGameGraph）只认「非空字符串」，「是否已注册」的深校验走 validate.ts。
 */
export type GameNodeType = 'perf' | (string & {})

export type GameHandle = Handle<{ flowId?: string }>
export type GameNode = Node<GameNodeData, GameNodeType, { flowId?: string }>
export type GameEdge = Edge<EdgeRouting>
export type GameGraph = Graph<GameNode, GameEdge>

// （类型 Reaction 由上方 export type 与 node-config 导出；挂在节点 / overlay 挂载上，不再有局级 reactions。）

/** 顶层容器（blueprint.json 的文档内容形态）。 */
export interface GameScenario {
  version: string
  /** Record key === Variable.id（添加时自动生成）。 */
  variables?: Record<string, Variable>
  /** Record key === Entity.id（添加时自动生成）。 */
  entities?: Record<string, Entity>
  /**
   * Runtime-safe formula catalog. Authoring keeps the same AST plus optional `pick`
   * sidecars; runtime expressions may reference a formula with `formula.<id>`.
   */
  formulas?: Record<string, unknown>
  /** overlay 目录（`ui.overlays`）+ 可选主题色。 */
  ui?: GameScenarioUi
  /** 用户自定义文字预设（内置在 text-style.ts；这里只存用户新建的，按 subtitle/overlay 分组）。 */
  textStylePresets?: { subtitle?: GraphTextStylePreset[]; overlay?: GraphTextStylePreset[] }
  /** 文档默认床轨；缺省 = 静音起局。与 `NodeData.bgm` 一起构成 BGM 配置的唯一两处 SSOT。 */
  bgm?: DocumentBgm
  graph: GameGraph
}

/** 运行时守卫：浅校验 graph 形状（深校验走 validate.ts）。 */
export function isGameGraph(v: unknown): v is GameGraph {
  if (!v || typeof v !== 'object') return false
  const g = v as { nodes?: unknown; edges?: unknown }
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) return false
  return g.nodes.every((n) => {
    if (!n || typeof n !== 'object') return false
    const node = n as { type?: unknown; data?: unknown }
    // 浅守卫只认「type 是非空字符串」；「type 是否为已注册 NodeKind」的语义校验在 validate.ts。
    if (typeof node.type !== 'string' || !node.type) return false
    return !!node.data && typeof node.data === 'object'
  })
}

/** 编辑器界面目录 sidecar；scheme 只引用 `ui.overlays`，不复制标题或 Overlay 内容。 */
export type UiTreeNode = UiTreeFolderNode | UiTreeSchemeNode
export interface UiTreeFolderNode {
  kind: 'folder'
  id: string
  name: string
  children: UiTreeNode[]
}
export interface UiTreeSchemeNode {
  kind: 'scheme'
  id: string
  overlayId: string
}
export interface UiTree {
  root: UiTreeNode[]
}

/**
 * 全 game 共享的场景级 meta（不属于任何单张图）。编辑器公式库 formulas 与之同级。
 * `formulas` 的值形状是 `editor/persist/formula-authoring` 的 `Formula`；运行时保留其
 * AST 并允许表达式通过 `formula.<id>` 求值，uiTree 仍是作者态 Overlay 目录 sidecar。
 */
export type ScenarioMetaFields = Pick<GameScenario, 'variables' | 'entities' | 'ui' | 'textStylePresets' | 'bgm'> & {
  formulas?: Record<string, unknown>
  uiTree?: UiTree
}

/** 蓝图文档：一张独立可存取的图（主蓝图或子蓝图），与 `SubFlowPackDef` 同级但语义面向新蓝图库。 */
export interface BlueprintDoc {
  id: string
  title: string
  /** 子蓝图内容版本（对齐 `SubFlowPackDef.version` / `subFlowPack` 钉死）；主蓝图可缺省。 */
  version?: string
  entry: string
  graph: GameGraph
  requires?: { vars?: string[]; entities?: string[] }
}

/**
 * 嵌在 scenario 根上的蓝图库（单文件 SSOT 的增量字段）。
 * `packs` 含主蓝图 + 全部子蓝图完整文档（与 `subFlowPack` 用语对齐）；
 * 根上的 `graph` 与 `packs[mainPackId].graph` 同步（双源，便于编辑库与运行入口共用）。
 */
export interface BlueprintManifest {
  version: 'game-video.blueprint-manifest.v1'
  mainPackId: string
  packs: Record<string, BlueprintDoc>
}

/**
 * 完整落盘/编辑文档 = 原 `GameScenario`（graph/variables/entities/…）+ `manifest`。
 * 不再使用独立的 sharedMeta / blueprints/ 文件夹。
 */
export type GraphLibraryDocument = GameScenario & {
  /**
   * 服务端权威文档修订号，由 Host 在写盘边界戳入（见 `src/server/host/document-revision.ts`）。
   * 供 `expectedRevision` 乐观锁使用；不是内容字段，编辑器纯函数不产生也不消费它。
   * `normalizeDocument` 会重建文档并丢弃本字段——这是有意的，只有持久化边界关心它。
   */
  revision?: number
  formulas?: Record<string, unknown>
  uiTree?: UiTree
  manifest: BlueprintManifest
}

/** 运行时守卫：浅校验是否为 `BlueprintDoc`（不深校验 graph 内部节点/边形状）。 */
export function isBlueprintDoc(v: unknown): v is BlueprintDoc {
  const d = v as BlueprintDoc | null
  return !!d && typeof d === 'object' && typeof d.id === 'string' && typeof d.entry === 'string'
    && !!d.graph && Array.isArray(d.graph.nodes) && Array.isArray(d.graph.edges)
}

/**
 * 解析一张图的可跑入口。
 * - `preferred` 仍在图里 → 用它（BlueprintDoc.entry / 引用节点上的 entry 覆盖）。
 * - 否则取无入边的根节点（偏左上优先）；再否则首节点。
 * 空图返回 undefined。用于：删掉默认 `entry` 节点后 doc.entry 仍写着 `'entry'` 的陈旧数据。
 */
export function resolveGraphEntry(graph: GameGraph, preferred?: string): string | undefined {
  const nodes = graph.nodes
  if (nodes.length === 0) return undefined
  if (preferred && nodes.some((n) => n.id === preferred)) return preferred
  const targets = new Set(graph.edges.map((e) => e.target))
  const roots = nodes.filter((n) => !targets.has(n.id))
  const pool = roots.length > 0 ? roots : nodes
  return [...pool].sort(
    (a, b) => a.position.x - b.position.x || a.position.y - b.position.y || a.id.localeCompare(b.id),
  )[0]!.id
}
