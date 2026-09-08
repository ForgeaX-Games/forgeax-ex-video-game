/**
 * node-config-schema — 视频覆盖物类型 SSOT。
 *
 * 统一命名（HTML 心智）：
 * - **Overlay**：界面编辑器配好的可复用覆盖物（`children` = 包内组件）
 * - **OverlayNode**：演出节点上的 overlay 配置（含 `reactions` 作者 SSOT）
 * - **OverlayInstance**：运行态展开结果（不落盘）
 *
 * 视频上只能挂 overlay（经 OverlayNode），不能把裸组件直接贴视频。
 * 作者面：组件导出事件 → Overlay 聚合 → `reactions`（when/do）；走向经 do 内 advance + 边。
 *
 * 接入：`GameScenario.ui.overlays` / `NodeData.overlayNodes`。
 */

import type {
  EdgeRouting,
  GameEdge,
  GameGraph,
  GameNode,
  GameScenario,
  GraphCondition,
  GraphEffect,
  Trigger,
} from './graph-schema'

// ═══════════════════════════════════════════════════════════════════════════
// 1. 组件导出契约（In · Events）
// ═══════════════════════════════════════════════════════════════════════════

/** State → 展示：常量或 `{ expr }`（声明式，无函数入库）。 */
export type BindValue = string | number | boolean | { expr: string }

/** 编辑器可渲染的输入槽（In · 唯一输入声明 SSOT）。 */
export interface ComponentInput {
  key: string
  label?: string
  valueType: 'string' | 'number' | 'boolean'
  required?: boolean
  /** 新建实例初值；放宽到任意（含结构化默认：选项数组 / QTE 拍点等）。 */
  default?: unknown
  /** 有 options ⇒ 编辑器出 select。 */
  options?: { value: string; label: string }[]
  /** 标量数值编辑器约束。 */
  min?: number
  step?: number
  /**
   * 用哪个**输入组件**渲染该 input：填了就优先用它，没填则按 `valueType` 出标量控件。
   * 例：`color`（取色）/ `entity`（实体引用）/ `events` / `effects` / `textStyle` / `qteCues` …
   */
  component?: string
}

/**
 * 组件对外抛出的事件（作者面 · 交互目录 SSOT）。
 * 只描述「会发什么」：`id` / `label`。
 * 运行时 submit / resolve → 归一成这些 id；边用 `sourceHandle === event.id` 承接。
 *
 * 门控、坐标等**组件私有**参数不要挂这里——见各组件自己的 inputs 项类型
 *（如 skill/choice 的 `ChoiceOption.condition`、hotspot 的 `HotspotSpot.x/y`）。
 * 将来事件若需自带入参，再在此加 `inputs?: ComponentInput[]`。
 */
export interface ComponentEvent {
  id: string
  label?: string
}

export type ComponentLayoutAnchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'target'
  | 'target-or-bottom-center'
  | 'center-or-bottom-center'

/** Agent 与编辑器共用的机器可读界面摆放契约；坐标均为相对舞台的 0~1。 */
export interface ComponentLayoutContract {
  anchor: ComponentLayoutAnchor
  preferredRegion: {
    x: readonly [number, number]
    y: readonly [number, number]
  }
  defaultLayout: {
    left: number
    top: number
    width: number
    height: number
  }
  minSize?: {
    width: number
    height: number
  }
  safeMargin: number
  avoid: readonly string[]
  maxInstances?: number
  overflow: 'forbidden'
}

export interface ComponentTimingContract {
  /** 调度类别；决定 child 应通过 enter、window 还是 spawn 出现。 */
  kind: 'persistent-hud' | 'windowed-qte' | 'spawn-only' | 'interactive-choice'
  /** 该类别下唯一正确的挂载方式。 */
  mount: 'trigger-enter' | 'window' | 'spawn'
  /** 组件自带的内部判定窗口（ms）。 */
  selfSettleMs?: number
  /** 被外层 window 卸载时是否仍会 emit。 */
  emitsOnUnmount?: boolean
  /** spawn 类的推荐存活时长。 */
  defaultTtlMs?: number
}

/**
 * 一张可复用组件的导出清单（注册表声明；不落盘到 OverlayChild）。
 * Overlay 聚合 `events` → 挂载 `reactions`（event 类）编辑。
 */
export interface ComponentManifest {
  /** = OverlayChild.component */
  id: string
  label?: string
  inputs?: ComponentInput[]
  events: ComponentEvent[]
  /**
   * 面向 AI 的摆放位置与潜规则提示（非作者 UI 展示文案）。
   * 例：血条不建议同一场景出现两次；敌方血条一般放在页面顶部水平居中位置；
   * 我方血条一般放在页面右下角。list-ui-components 会把这段透传给 AI。
   */
  prompt?: string
  /** 面向 Agent 与编辑器的机器可读布局约束。 */
  layout?: ComponentLayoutContract
  /** 面向 Agent 与编辑器的机器可读生命周期约束。 */
  timing?: ComponentTimingContract
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Reaction（作者 SSOT：when → do；瘦形态，无 scope/preempt）
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 闭合动作原语（改状态 / 沿边推进 / 刷出瞬态组件）——同级并列，一个 do 可含多件事。
 * - effect：施加副作用（改 attr/var/flag/item）
 * - advance：沿指定出边 `edgeId` 推进到其 `target`（唯一「换节点」通道；目标只在边上）。
 *   交互/生命周期事件里可省略——省略时若存在匹配出边则默认推进；state 打断必须显式。
 * - spawn：由反应**主动实例化**一个 overlay 组件模板。`from` = `overlayId/childId` 引用目录模板，
 *   `inputs` 可含 `{expr}` 读 watch 局部量（prev/next/delta）；省略 `ttlMs` 时常驻到节点退出。
 * - hideOverlay：隐藏当前节点中 `mountId` 对应的整组已显示界面；重复隐藏或尚未显示时无操作。
 */
export type NodeAction =
  | { kind: 'effect'; effects: GraphEffect[] }
  | { kind: 'advance'; edgeId: string }
  | { kind: 'spawn'; from: string; inputs?: Record<string, unknown>; layout?: Layout; ttlMs?: number }
  | { kind: 'hideOverlay'; mountId: string }

/** Overlay 目录事件动作：目录是可复用表现/副作用模板，不得携带节点专属走向。 */
export type OverlayReactionAction = Exclude<NodeAction, { kind: 'advance' } | { kind: 'hideOverlay' }>

/**
 * Overlay 目录专用 reaction。稳定 key 恒为 `${childId}:${eventId}`；
 * 只允许组件 event → effect/spawn，节点挂载可再按顺序追加通用 NodeAction（含 advance）。
 */
export interface OverlayReaction {
  when: { type: 'event'; id: string }
  do: OverlayReactionAction[]
}

/**
 * 触发面（闭合）——节点生命周期 + 事件 + 数据/状态 + 组件生命周期。effect 一律挂 reactions。
 * - enter：进入节点（演出开始）
 * - at(ms)：演出播到第 ms 毫秒
 * - exit：离开节点前
 * - complete：节点收尾自动推进（`if` 缺省 = 无条件）
 * - event：组件事件（挂 mount.reactions；do = effect/spawn/advance）
 * - state：GraphCondition 从不成立变为成立时触发；编辑器与出边复用同一套条件配置。
 * - watch：观察某表达式(`of`)的值变化（`on` change/inc/dec）→ do（effect/spawn/advance）；
 *   在每个写屏障处重采样比对（pull-diff）。局部量 prev/next/delta 供 do 内 `{expr}` 使用。
 * - shown / hidden：某 overlay 组件实例**出现 / 消失**时触发（`of` = childId / mountId/childId / overlayId/childId）。
 */
export type ReactionTrigger =
  | { type: 'enter' }
  | { type: 'at'; ms: number }
  | { type: 'exit' }
  | { type: 'complete'; if?: GraphCondition }
  | { type: 'event'; id: string }
  | { type: 'state'; condition: GraphCondition }
  | { type: 'watch'; of: string; on?: 'change' | 'inc' | 'dec' }
  | { type: 'shown'; of: string }
  | { type: 'hidden'; of: string }

/**
 * 瘦 Reaction：when + do。作用域由挂载位置决定。
 * do 同级承载副作用（effect/spawn）+ 走向（advance edgeId）；**换节点只经边**。
 */
export interface Reaction {
  when: ReactionTrigger
  do: NodeAction[]
}

/** 节点演出相位驱动的结算子集；运行时仍需要与信号驱动的结算区分处理。 */
export function isLifecycleReaction(r: Reaction): boolean {
  // 脏 blueprint 里 reaction 可能整个缺 when（AI 把 condition 写到了顶层），
  // 这类条目一律不认作结算，交给 runtime.shape.valid 报错，而不是在渲染时抛错。
  const t = r?.when?.type
  return t === 'enter' || t === 'at' || t === 'exit' || t === 'complete'
}

/**
 * 作者界面统一呈现的「结算」：定时相位 + 数值变化 / 状态条件 / 界面条件触发；event 仍由组件入口管理。
 * 编辑器和时间轴以这个子集内的序号双向定位，不能使用会随数组重排漂移的绝对下标。
 */
export function isSettlementReaction(r: Reaction): boolean {
  const t = r?.when?.type
  return isLifecycleReaction(r) || t === 'watch' || t === 'state' || t === 'shown' || t === 'hidden'
}

/** Overlay 聚合后的事件（编辑器下拉项）。 */
export interface OverlayEventRef {
  eventId: string
  mountId: string
  childId: string
  localEventId: string
  label?: string
  componentId: string
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Overlay + children（界面包）
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 绝对定位排版（CSS inset 心智）—— overlay 内组件、挂载相对视频等共用。
 *
 * `number` = 相对父框的 0~1 比例（含负值，如 translateY: -0.5）；
 * 也可用 `'50%'` / `'12px'` 字符串。
 */
export type LayoutValue = number | `${number}%` | `${number}px`

export interface Layout {
  top?: LayoutValue
  right?: LayoutValue
  bottom?: LayoutValue
  left?: LayoutValue
  width?: LayoutValue
  height?: LayoutValue
  /** 自身偏移，对齐 CSS `transform: translate(...)` */
  translateX?: LayoutValue
  translateY?: LayoutValue
  /** 叠层顺序，对齐 CSS `z-index` */
  zIndex?: number
}

/**
 * Overlay 内一个 **组件实例**。
 * - `component`：唯一类型键（行为 + 皮均由此查注册表）
 * - layout：overlay 内组件相对**挂载盒**的排版（含 zIndex）；挂载有显式尺寸时缺省 = 左上角
 * - trigger / window：出现时机
 * - inputs：玩法 / 表现入参（不含摆放）
 */
export interface OverlayChild {
  id: string
  /** 组件 id（注册表键）。 */
  component: string
  layout?: Layout
  trigger?: Trigger
  window?: { startMs?: number; endMs?: number }
  /**
   * 组件参数袋（In）。
   * 禁止：pos / layout / component（摆放用 layout 字段；component 用顶栏字段）
   */
  inputs?: Record<string, unknown>
  note?: string
}

/**
 * 一张可复用 **Overlay**。
 * 键 = `scenario.ui.overlays[id]`。`children.length === 1` 也合法。
 */
export interface Overlay {
  id: string
  title?: string
  children: OverlayChild[]
  /** 目录继承动作；严格使用 `childId:eventId`，运行时仅在组件 emit 路径消费。 */
  reactions?: OverlayReaction[]
  /**
   * 面向 AI 的整块模板摆放提示：描述这张拼好的模板**作为一个整体**一般放在视频
   * 画布的什么位置（例如「我方状态 HUD 一般放在右下角」「字幕一般放在底部居中」）。
   * 模板内部各组件的相对布局已由 children[].layout 固化，此字段不再重复描述内部
   * 排布。作者在模板编辑页手动填写，也可用「AI 润色」按钮生成/优化。
   */
  prompt?: string
}

/** scenario.ui：overlay 目录。 */
export interface GameScenarioUi {
  overlays: Record<string, Overlay>
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. OverlayNode（节点上的 overlay 配置）
// ═══════════════════════════════════════════════════════════════════════════

/**
 * **OverlayNode** — 演出节点上的一份 overlay **挂载**（`NodeData.overlayNodes[]` 之一）。
 * - `id`：挂载键（多挂载时事件命名空间用）；缺省 = `overlay`
 * - `overlay`：引用哪张可复用 Overlay（原型；本挂载始终跟随其后续编辑，除被 override 的字段外）
 * - `layout`：整块相对视频画面；**无显式宽高时自适应内容**（单组件 overlay = 组件大小）。
 *   舞台坐标类（floatText / dialogue / transition）挂载时应配 `{ left:0, top:0, width:1, height:1 }`
 * - `reactions`：本挂载 when→do（多为 event；走向经 do 内 advance + 边）
 * - `overrides` / `added` / `removed`：本挂载对 `overlay` 的**稀疏差量**（prototype + override，对齐
 *   Figma 实例覆盖 / Unity Prefab modifications 心智）——未出现在这三者里的组件永远跟随原型；
 *   只有显式改过的字段才脱钩。合并规则见 `expand-overlay.ts#resolveMountChildren`。
 */
export interface OverlayNode {
  /**
   * 挂载键。缺省 = `overlay`。
   * 同一节点多次挂同一张 overlay 时必须显式且唯一。
   */
  id?: string
  /** `scenario.ui.overlays` 中的 overlay id（原型；持续可跟随，见上）。 */
  overlay: string
  /**
   * 旧版节点副本的完整 child 列表。只读兼容；新写入必须使用 overrides/added/removed。
   * 运行时展开时，存在该字段就以它作为本挂载的有效基底。
   */
  children?: OverlayChild[]
  /** 整块相对本节点视频；无显式尺寸 → 自适应子组件内容。 */
  layout?: Layout
  reactions?: Reaction[]
  /**
   * 逐组件差量：childId → 对原型该组件的字段级覆盖（仅存被改字段，未改字段仍读原型）。
   * 键在原型里已不存在（方案改动导致孤儿）时，解析器忽略该条目。
   */
  overrides?: Record<string, Partial<OverlayChild>>
  /** 本挂载本地新增的组件（不写回共享方案，只属于这个节点）。 */
  added?: OverlayChild[]
  /** 屏蔽原型里的这些 childId（tombstone；不物理删除共享方案）。 */
  removed?: string[]
}

/** 挂载键：显式 id 优先，否则 overlay 目录 id。 */
export function overlayMountId(mount: OverlayNode): string {
  return mount.id ?? mount.overlay
}

/**
 * 新建一份 overlay 挂载。同模板首份沿用 overlay id；重复挂载追加稳定序号，确保运行态 child id、
 * React key、时间轴与事件命名空间都按实例隔离。
 */
export function createOverlayMount(mounts: readonly OverlayNode[], overlayId: string): OverlayNode {
  const used = new Set(mounts.map(overlayMountId))
  if (!used.has(overlayId)) return { overlay: overlayId }
  let ordinal = 2
  while (used.has(`${overlayId}__${ordinal}`)) ordinal += 1
  return { id: `${overlayId}__${ordinal}`, overlay: overlayId }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. OverlayInstance（运行态；不落盘）
// ═══════════════════════════════════════════════════════════════════════════

/** 展开后单个 child（由目录 OverlayChild 投影；不落盘）。 */
export interface OverlayInstanceChild {
  /**
   * 运行态 id：始终 `${source.mountId}/${source.childId}`（单挂载同样），避免跨挂载撞名。
   */
  id: string
  component: string
  trigger: Trigger
  window?: { startMs?: number; endMs?: number }
  layout?: Layout
  inputs: Record<string, unknown>
  /** 溯源：挂载 / 模板 / 目录 child / 节点。多挂载路由与 id 派生均依赖此字段。 */
  source: { mountId: string; overlayId: string; childId: string; nodeId: string }
}

/**
 * 一份挂载展开后的运行态信封（不落盘）。
 * 节点可有多份；调度扁平遍历各 instance 的 children。
 */
export interface OverlayInstance {
  mountId: string
  overlayId: string
  nodeId: string
  layout?: Layout
  children: OverlayInstanceChild[]
  reactions?: Reaction[]
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Demo（reactions 作者 SSOT；走向经 do 内 advance + 边）
// ═══════════════════════════════════════════════════════════════════════════

/**
 * video → OverlayNode 挂上 overlay{ playerHp, bossHp, parry }
 * 扣血在 event reaction 的 effect；走向只靠边（do 省略 advance 时按匹配出边默认推进）。
 */
export const OVERLAY_DEMO = {
  version: 'game-video.overlay.v1',
  variables: {
    lastHit: { id: 'lastHit', initial: 0 },
  },
  entities: {
    'ent-player': {
      id: 'ent-player',
      name: '少主',
      attrs: { hp: 100, attack: 20, defense: 8 },
      attrMeta: { hp: { max: 100, initial: 100, label: '气血' } },
    },
    'ent-boss': {
      id: 'ent-boss',
      name: '刀狂',
      attrs: { hp: 120, attack: 24, defense: 10 },
      attrMeta: { hp: { max: 120, initial: 120, label: '气血' } },
    },
  },
  ui: {
    overlays: {
      battleHud: {
        id: 'battleHud',
        title: '战斗覆盖物（双血条 + 防反 + 飘字）',
        children: [
          {
            id: 'playerHp',
            component: 'battleHpBar',
            layout: { left: 0, top: 0, width: 1, height: 1 },
            trigger: { when: 'enter' },
            inputs: { bind: 'ent-player', label: '少主' },
          },
          {
            id: 'bossHp',
            component: 'battleHpBar',
            layout: { left: 0, top: 0, width: 1, height: 1 },
            trigger: { when: 'enter' },
            inputs: { bind: 'ent-boss', label: '刀狂' },
          },
          {
            id: 'parry',
            component: 'BattleParry',
            layout: { left: 0.5, top: 0.5, translateX: -0.5, translateY: -0.5 },
            trigger: { when: 'at', ms: 1200 },
            inputs: {
              events: [
                { id: 'A', label: '防反' },
                { id: 'B', label: '闪避' },
                { id: 'miss', label: '失手' },
              ],
              defaultEvent: 'miss',
              timeoutMs: 900,
            },
          },
        ],
      } satisfies Overlay,
    },
  } satisfies GameScenarioUi,
  graph: {
    nodes: [
      {
        id: 'n-boss-slash',
        type: 'perf',
        position: { x: 0, y: 0 },
        data: {
          name: 'Boss 横斩',
          media: { kind: 'VIDEO', ref: 'difanggongjiqianyao' },
          durationMs: 3200,
          overlayNodes: [{
            overlay: 'battleHud',
            layout: { left: 0, top: 0, width: 1, height: 1 },
            reactions: [
              {
                when: { type: 'event', id: 'A' },
                do: [{
                  kind: 'effect',
                  effects: [
                    { kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: { expr: '-(entity.ent-player.attr.attack)' } } satisfies GraphEffect,
                    { kind: 'var', varId: 'lastHit', op: 'set', value: { expr: 'entity.ent-player.attr.attack' } } satisfies GraphEffect,
                  ],
                }],
              },
              {
                when: { type: 'event', id: 'miss' },
                do: [{
                  kind: 'effect',
                  effects: [
                    { kind: 'attr', entityId: 'ent-player', attr: 'hp', op: 'add', value: { expr: '-(entity.ent-boss.attr.attack)' } } satisfies GraphEffect,
                  ],
                }],
              },
            ],
          } satisfies OverlayNode],
        },
      },
      {
        id: 'n-counter',
        type: 'perf',
        position: { x: 280, y: -80 },
        data: {
          name: '防反追击',
          media: { kind: 'VIDEO', ref: 'fangfan' },
          overlayNodes: [{ overlay: 'battleHud' }],
        },
      },
      {
        id: 'n-dodge',
        type: 'perf',
        position: { x: 280, y: 40 },
        data: {
          name: '闪避后摇',
          media: { kind: 'VIDEO', ref: 'shanbi' },
          overlayNodes: [{ overlay: 'battleHud' }],
        },
      },
      {
        id: 'n-hurt',
        type: 'perf',
        position: { x: 280, y: 160 },
        data: {
          name: '受击',
          media: { kind: 'VIDEO', ref: 'shouji' },
          overlayNodes: [{ overlay: 'battleHud' }],
        },
      },
    ] as GameNode[],
    edges: [
      {
        id: 'e-A',
        source: 'n-boss-slash',
        target: 'n-counter',
        sourceHandle: 'A',
        targetHandle: 'in',
        data: {} satisfies EdgeRouting,
      },
      {
        id: 'e-B',
        source: 'n-boss-slash',
        target: 'n-dodge',
        sourceHandle: 'B',
        targetHandle: 'in',
        data: {} satisfies EdgeRouting,
      },
      {
        id: 'e-miss',
        source: 'n-boss-slash',
        target: 'n-hurt',
        sourceHandle: 'miss',
        targetHandle: 'in',
        data: {} satisfies EdgeRouting,
      },
    ] as GameEdge[],
  } as GameGraph,
} as const satisfies Partial<GameScenario> & {
  ui: GameScenarioUi
  graph: GameGraph
}

/** n-boss-slash 展开 IR 示意（不落盘）。 */
export const OVERLAY_DEMO_INSTANCE: OverlayInstance = {
  mountId: 'battleHud',
  overlayId: 'battleHud',
  nodeId: 'n-boss-slash',
  layout: { left: 0, top: 0, width: 1, height: 1 },
  reactions: OVERLAY_DEMO.graph.nodes[0]!.data.overlayNodes![0]!.reactions,
  children: [
    {
      id: 'battleHud/playerHp',
      component: 'battleHpBar',
      layout: { left: 0, top: 0, width: 1, height: 1 },
      trigger: { when: 'enter' },
      inputs: { bind: 'ent-player', label: '少主' },
      source: { mountId: 'battleHud', overlayId: 'battleHud', childId: 'playerHp', nodeId: 'n-boss-slash' },
    },
    {
      id: 'battleHud/bossHp',
      component: 'battleHpBar',
      layout: { left: 0, top: 0, width: 1, height: 1 },
      trigger: { when: 'enter' },
      inputs: { bind: 'ent-boss', label: '刀狂' },
      source: { mountId: 'battleHud', overlayId: 'battleHud', childId: 'bossHp', nodeId: 'n-boss-slash' },
    },
    {
      id: 'battleHud/parry',
      component: 'BattleParry',
      trigger: { when: 'at', ms: 1200 },
      layout: { left: 0.5, top: 0.5, translateX: -0.5, translateY: -0.5 },
      inputs: {
        events: [
          { id: 'A', label: '防反' },
          { id: 'B', label: '闪避' },
          { id: 'miss', label: '失手' },
        ],
        defaultEvent: 'miss',
        timeoutMs: 900,
      },
      source: { mountId: 'battleHud', overlayId: 'battleHud', childId: 'parry', nodeId: 'n-boss-slash' },
    },
  ],
}
