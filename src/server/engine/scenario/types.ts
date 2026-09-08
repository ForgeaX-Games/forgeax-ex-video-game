/**
 * game-video 剧情数据模型
 *
 * 设计原则：
 *   1. **作者向**：编辑器先写 Scenario，运行时按 graph 走，不存在 LLM 实时改剧本
 *      （LLM 仅在编辑期辅助生成提示词、台词草稿、分支建议）
 *   2. **媒体不可知**：每个 Scene 的画面来源可以是
 *        - 上传的视频（VIDEO）
 *        - 提示词生成的图（IMAGE_PROMPT，由 GPT-Image-2 渲染）
 *        - 静态图片（IMAGE_STATIC，已渲染并入库）
 *      运行时按统一接口播放
 *   3. **时序统一**：Scene 的所有交互（台词、QTE 提示、分支显现）都用相对 ms 表达
 *   4. **可序列化**：整个 Scenario 必须 100% JSON 可往返，便于导出/共享/版本控制
 */

// ============================================================================
// 媒体引用
// ============================================================================

export type MediaKind = 'VIDEO' | 'IMAGE_PROMPT' | 'IMAGE_STATIC' | 'PLACEHOLDER'

/** 媒体在客户端的存储引用（视频走 IndexedDB blob，图像走 dataUrl 或外链） */
export interface MediaRef {
  kind: MediaKind
  /** PLACEHOLDER 时无意义；其他类型为本地资源 id 或外链 URL */
  ref?: string
  /** IMAGE_PROMPT 模式下的提示词（最终发给 GPT-Image-2） */
  prompt?: string
  /** 用户填写的元数据（描述、长度等），仅 UI 展示，不影响运行时 */
  meta?: {
    durationMs?: number
    width?: number
    height?: number
    note?: string
  }
}

// ============================================================================
// 台词 / 旁白
// ============================================================================

export type DialogueRole = 'narration' | 'protagonist' | 'character' | 'system'

export interface DialogueLine {
  id: string
  role: DialogueRole
  /** 角色名（role=character 时显示） */
  speaker?: string
  text: string
  /** 在 scene 时间线里的出现时刻（ms） */
  startMs: number
  /**
   * 该台词消失或被下一句覆盖的时刻（ms）。
   * 不填 → 持续显示直到下一条台词或场景结束。
   */
  endMs?: number
  /** 打字机速度（每字符 ms），不填用全局默认 */
  charMs?: number
}

/**
 * 富文本「文字叠加」—— v7（剪映 / Premiere 式贴字）。
 *
 * 与 DialogueLine 的区别：DialogueLine 是固定底栏电影字幕（绑 TTS / 叙事），
 * TextOverlayClip 是作者在画面任意位置自由摆放的装饰文字（标题卡、角标、台词花字），
 * 支持自由定位 / 缩放 / 旋转 / 字体 / 字号 / 粗细 / 颜色 / 描边 / 底色。
 *
 * 坐标 x/y 为归一化（0~1，相对画面），字号 fontSizePct 为画面高度百分比（用 cqh 渲染），
 * 这样在编辑器画布与播放器舞台上表现一致、与分辨率无关。
 */
export interface TextOverlayClip {
  id: string
  text: string
  /** 出现时刻（相对 scene 起点，ms）。 */
  startMs: number
  /** 消失时刻（ms）；不填 → 持续到场景结束。 */
  endMs?: number
  /** 归一化锚点坐标（0~1，画面中心为 0.5,0.5）。 */
  x: number
  y: number
  /** 字号：画面高度百分比（如 6 = 画面高度的 6%）。默认 6。 */
  fontSizePct?: number
  /** 自由缩放倍数（角柄拖拽，叠加在 fontSizePct 之上）。默认 1。 */
  scale?: number
  /** 旋转角度（deg）。默认 0。 */
  rotation?: number
  /** 字体族（FONT_PRESETS 的 key 或任意 css font-family）。 */
  fontFamily?: string
  /** 字重 100~900。默认 700。 */
  fontWeight?: number
  /** 斜体。 */
  italic?: boolean
  /** 下划线。 */
  underline?: boolean
  /** 文字颜色。默认 #ffffff。 */
  color?: string
  /** 描边颜色。 */
  strokeColor?: string
  /** 描边宽度（px @ 1080p 基准）。 */
  strokeWidth?: number
  /** 文字底色条（半透明矩形）；不填 → 无底色。 */
  bgColor?: string
  /** 对齐。默认 center。 */
  align?: 'left' | 'center' | 'right'
  /** 投影。默认 true。 */
  shadow?: boolean
  /** 透明度 0~1。默认 1。 */
  opacity?: number
}

// ============================================================================
// 剪映式后期效果 —— v8（滤镜 / 调节 / 特效 / 贴纸 / 转场 / 首尾动画）
// ============================================================================
//
// 全部为「作者元数据 + 预览/播放期实时渲染」：不重新编码 mp4。
//   · 滤镜 + 调节 → 合成 CSS filter 串作用到 <video>/<img>
//   · 特效 / 贴纸 → 画面叠层（暗角、颗粒、光效、抖动；花字/图标）
//   · 转场 / 首尾动画 → 节点级，按 elapsed 在画面边界跑入/出动画
//
// 时间轴语义沿用其它 clip：startMs/endMs 为相对 scene 起点的 ms 区间。

/**
 * 画面色彩参数（滤镜预设与「调节」手动项共用）。
 * 全部为「相对默认值的偏移/倍率」，0 表示不改变，便于按强度线性缩放与叠加。
 */
export interface AdjustParams {
  /** 亮度，-1~1（0=原样，映射到 css brightness 0~2）。 */
  brightness?: number
  /** 对比度，-1~1。 */
  contrast?: number
  /** 饱和度，-1~1。 */
  saturation?: number
  /** 色温，-1(冷)~1(暖)；用 sepia + hue 近似。 */
  temperature?: number
  /** 色相旋转，-180~180（deg）。 */
  hue?: number
  /** 模糊，0~1（映射到 0~12px）。 */
  blur?: number
  /** 暗角强度，0~1（叠层径向渐变）。 */
  vignette?: number
  /** 颗粒/噪点强度，0~1（叠层噪声纹理）。 */
  grain?: number
  /** 怀旧/褐色，0~1（css sepia）。 */
  sepia?: number
}

/** 滤镜 clip：引用一个内置/自定义滤镜预设，按 intensity 缩放其 AdjustParams。 */
export interface FilterClip {
  id: string
  startMs: number
  endMs: number
  /** 预设 id（FX_FILTERS 或自定义库）。 */
  presetId: string
  /** 强度 0~1，默认 1。 */
  intensity?: number
}

/** 调节 clip：作者手动调的色彩参数（不挂预设）。 */
export interface AdjustClip {
  id: string
  startMs: number
  endMs: number
  params: AdjustParams
}

/** 特效 clip：叠层型动效（光效/抖动/马赛克/故障/暗角脉冲...）。 */
export interface EffectClip {
  id: string
  startMs: number
  endMs: number
  /** 预设 id（FX_EFFECTS）。 */
  presetId: string
  /** 强度 0~1，默认 1。 */
  intensity?: number
}

/**
 * 贴纸 clip：画面上自由摆放的装饰元素。
 *   - kind='numeric'：数值花字（如「好感度 +1」），text 必填，走描边花字样式
 *   - kind='builtin' ：内置矢量图标（箭头/定位/问号/强调线...），presetId 指定
 *   - kind='emoji'   ：emoji 字符，text 存 emoji
 *   - kind='image'   ：素材库自定义图片，mediaId 指向 mediaStore
 */
export interface StickerClip {
  id: string
  startMs: number
  endMs: number
  kind: 'numeric' | 'builtin' | 'emoji' | 'image'
  /** numeric/emoji 的文本内容。 */
  text?: string
  /** builtin 图标预设 id（FX_STICKERS）。 */
  presetId?: string
  /** image 类型引用的 mediaStore id。 */
  mediaId?: string
  /** 归一化锚点（0~1，中心 0.5,0.5）。 */
  x: number
  y: number
  /** 基准尺寸：画面高度百分比。默认 12。 */
  sizePct?: number
  /** 自由缩放倍数。默认 1。 */
  scale?: number
  /** 旋转角度（deg）。默认 0。 */
  rotation?: number
  /** 主色（numeric/builtin 可用）。 */
  color?: string
  /** 透明度 0~1。默认 1。 */
  opacity?: number
  /** 入场动画预设 id（FX_CLIP_ANIM 子集，pop/fade/slide）。 */
  enter?: string
  /** 出场动画预设 id。 */
  exit?: string
  /**
   * 图层混合模式(v9)—— UI 素材去背/叠加用。默认 normal。
   * screen/lighten 让纯黑底消失(保辉光/粒子);multiply 让纯白底消失(保暗线稿)。
   */
  blendMode?: UIBlendMode
  /** 关联的 UI 素材库资产 id（Scenario.uiAssets）；从 UI 库拖入时回填(v9)。 */
  uiAssetId?: string
  /** true = 钉到整场(endMs 跟随场景时长, Tier B 单场常驻)(v9)。 */
  pinToScene?: boolean
}

/** 转场（节点级入场）：在 scene 开头一段时间内跑转场动画。 */
export interface TransitionSpec {
  /** 预设 id（FX_TRANSITIONS：flashBlack/flashWhite/dissolve/pushIn/slideLeft/zoomBlur...）。 */
  presetId: string
  /** 转场时长（ms）。默认按预设。 */
  durationMs: number
}


/** 单端动画（首或尾）。 */
export interface ClipAnimEnd {
  /** 预设 id（FX_CLIP_ANIM：fade/zoomIn/zoomOut/slideIn/slideOut...）。 */
  preset: string
  /** 动画时长（ms）。 */
  durationMs: number
}

/**
 * 首尾动画（节点级）：本节点画面的入场/出场动画。
 * 默认（in/out 都不填时由渲染层兜底）以黑底渐显/渐隐处理。
 */
export interface ClipAnimSpec {
  in?: ClipAnimEnd
  out?: ClipAnimEnd
}

// ============================================================================
// QTE 节奏点（Quick Time Event）
// ============================================================================

export type QTECueShape = 'tap' | 'hold' | 'sweep'

/**
 * 慢放/子弹时间触发点 —— 把一个 QTECue 升级为视频时间轴上的"触发点"。
 *
 * 行为：
 *   1. **进入区间**：t ∈ [appearAt - leadInMs, targetAt + window.good] 时
 *      把视频 playbackRate 设为 `rate`（典型 0.25 ~ 0.5 = 慢放）。
 *   2. **命中**：cue 被解算（PERFECT/GREAT/GOOD/MISS）后：
 *      - 命中且 requireHit=true → 立即恢复 1.0（成功继续播放）。
 *      - MISS 或区间结束未命中 → 触发"失败结算"：
 *          * 优先跳 `failSceneId`（若提供）
 *          * 否则走 scene.branches 里 kind='qte_fail' 的分支
 *          * 都没有 → 弹通用 SettlementOverlay
 *   3. **不强制要求命中**：requireHit=false 时仅作为氛围慢放，命中与否不会
 *      改变后续流程（只是好看）。
 *
 * 数据约束：rate ∈ (0.05, 1)；leadInMs ≥ 0；其余字段可选。
 */
export interface QTECueSlowMo {
  /** 慢放倍率（典型 0.25 ~ 0.5）。1.0 等于不慢放（视为关闭）。 */
  rate: number
  /** 进入慢放的提前量（ms）。默认 = 0，与 cue.appearAt 同步进入。 */
  leadInMs?: number
  /** 命中后保持慢放的额外尾巴（ms）。默认 0 = 命中立刻恢复正常速度。 */
  holdAfterHitMs?: number
  /** true（默认）= 玩家必须命中才能继续，MISS 即 fail。false = 仅氛围。 */
  requireHit?: boolean
  /** 失败时直接跳到的结算场景 id；不填则回退到 scene.branches qte_fail。 */
  failSceneId?: string
}

export interface QTECue {
  id: string
  /** 视觉形态 */
  shape: QTECueShape
  /** 屏幕归一化坐标 (0..1) */
  x: number
  y: number
  /** 提示出现时刻（ms，相对 scene 起点） */
  appearAt: number
  /**
   * 命中目标时刻（ms）。
   * 玩家点击发生时刻与 targetAt 的差 = `delta`：
   *   - |delta| ≤ window.perfect → PERFECT
   *   - |delta| ≤ window.great   → GREAT
   *   - |delta| ≤ window.good    → GOOD
   *   - 其它（含 appearAt 之前）  → MISS
   * delta < 0 = 提前点；delta > 0 = 延迟点
   */
  targetAt: number
  /**
   * shape='hold' 时必填：玩家需保持按住的目标时长 (ms)。
   * shape='sweep' 时必填：玩家需要在该方向上完成滑动；用 sweep 对应字符串。
   */
  durationMs?: number
  sweepDir?: 'up' | 'down' | 'left' | 'right'
  /** 自定义图标/标签（可选，UI 提示用） */
  label?: string
  /**
   * 子弹时间 / 触发点配置。
   * 不填 = 普通 QTE 节奏点；填了 = 视频时间轴上的"慢放触发点"。
   */
  slowMo?: QTECueSlowMo
}

export interface QTEHitWindow {
  perfect: number
  great: number
  good: number
}

export interface QTESpec {
  cues: QTECue[]
  /** 全局命中窗口（ms 容差，向 |delta| 比较） */
  window: QTEHitWindow
  /** 单点评分配置 */
  score: {
    perfect: number
    great: number
    good: number
    /** MISS 的扣分（一般为负，例 -10） */
    miss: number
  }
  /**
   * 通过本场 QTE 的最低累计分（用于条件分支）。
   * 不填则不约束。
   */
  passingScore?: number
}

// ============================================================================
// 小游戏 clip（时间轴轨道一种；运行时以类 QTE 方式影响剧情走向）
// ============================================================================

/**
 * MinigameClip —— 场景内"我在这一刻暂停视频、打开一个 iframe 小游戏"的配置。
 *
 * 判定结果通过 scene.branches 里的 qte_pass / qte_fail 分支影响剧情走向：
 *   - minigame-win  → 走 qte_pass（或按 scene.branches 里第一条 auto 继续播放）
 *   - minigame-lose → 走 qte_fail（没有 fail 分支则允许作者在 overlay 点"放弃"自动 auto 分支）
 *
 * 小游戏本身来自 src/minigames/ 目录，通过 reelMinigamesPlugin 以
 * `/__minigames/<id>/...` 形式 serve 给 iframe。具体入口 URL 查 minigames/registry.ts。
 *
 * 时间语义：
 *   - startMs = 在 scene.durationMs 里触发小游戏的时间点；到这一刻暂停视频进入小游戏
 *   - durationMs = 时间轴上占用的视觉块宽度（纯 UI；小游戏内部流程时长和这个没关系）
 */
export interface MinigameClip {
  id: string
  /** 引用 minigames/registry.ts 里的 descriptor.id */
  minigameId: string
  /** 场景内触发时刻（ms，相对 scene 起点） */
  startMs: number
  /** 时间轴块宽度（ms，纯 UI 占位；默认取 descriptor.defaultDurationMs） */
  durationMs: number
  /** 作者备注，UI 上显示在块内（可选） */
  label?: string
}

/**
 * 搜索段 clip —— v7 新增（道具搜索玩法，类似 QTE/小游戏的"段落型"互动）。
 *
 * 到达 startMs 时：视频在 [loopStartMs, loopEndMs] 之间静态循环（作者应生成
 * 一段"首尾相同、无干扰内容"的可循环视频），出现放大镜等搜寻图标，玩家在
 * hotspotIds 指定的热点处点击拾取物品。完成 / 跳过后从 endMs 继续正常播放。
 */
export interface SearchSegmentClip {
  id: string
  /** 段开始时刻（ms，相对 scene 起点）—— 触发搜查 + 视频循环。 */
  startMs: number
  /** 段结束时刻（ms）—— 时间轴块宽度 / 超时上限；搜完后从此处继续。 */
  endMs: number
  /**
   * 视频循环区间（ms，相对 scene/video 起点）。
   * 不填则默认 = [startMs, endMs]；通常指向作者生成的"静态可循环段"。
   */
  loopStartMs?: number
  loopEndMs?: number
  /**
   * 本段参与搜索的热点 id 列表，引用 scene.searchLoot[].id。
   * 缺省 / 空 = 用本场景全部 searchLoot 热点。
   */
  hotspotIds?: string[]
  /**
   * 完成条件：'all' 拾完本段全部热点，'any' 拾到任意一个即可。默认 'all'。
   */
  completeWhen?: 'all' | 'any'
  /**
   * 是否允许玩家跳过本段（不强制搜完）。默认 false（必须搜完才继续）。
   */
  allowSkip?: boolean
  /** 作者备注 / 玩家提示文案（如「仔细搜查房间」）。 */
  label?: string
}

// ============================================================================
// 分支
// ============================================================================

export type BranchKind = 'choice' | 'qte_pass' | 'qte_fail' | 'auto'

export interface Branch {
  id: string
  /** 选项文本（choice 类型必填） */
  label?: string
  /** 触发条件 */
  kind: BranchKind
  /** 跳转目标 sceneId */
  targetSceneId: string
  /**
   * 选项出现的时刻（ms，仅 kind='choice' 有意义）；
   * 不填 → 场景结束后才显示。
   */
  showAt?: number
  /**
   * 解锁条件 —— v6 新增（数值系统）。
   * 不满足时按 gateMode 隐藏或锁定。空 all[] / 缺省 = 无条件（始终可走）。
   */
  condition?: BranchCondition
  /**
   * 条件不满足时的表现 —— v6 新增：
   *   'hide'（默认）= 直接隐藏，积累达成才出现；
   *   'lock'        = 仍显示但置灰锁定，悬停提示所需条件。
   */
  gateMode?: 'hide' | 'lock'
  /**
   * 选中该分支时触发的数值变化 —— v6 新增（如「安慰她 → 好感+10」）。
   */
  effects?: VarEffect[]
  /**
   * 选中该分支时触发的物品增减 —— v7 新增（如「交出钥匙 → 消耗钥匙」）。
   */
  itemEffects?: ItemEffect[]
}

// ============================================================================
// 数值 / 变量系统（条件解锁）—— v6 新增
// ============================================================================

/** 变量类型：number = 数值（好感度 / 积分）；flag = 布尔旗标（是否经历过某事） */
export type GameVariableKind = 'number' | 'flag'

export interface GameVariable {
  id: string
  /** 显示名（如「小雨好感度」） */
  name: string
  kind: GameVariableKind
  /** 初始值：number 直接用数字；flag 用 0/1 表示 false/true */
  initial: number
  /** number 类型可选上下限（运行时 clamp） */
  min?: number
  max?: number
  /** 作者备注 */
  desc?: string
}

/** 单条条件子句 —— 一个 BranchCondition 内多条之间是 AND */
export type ConditionClause =
  | {
      type: 'var'
      varId: string
      op: 'gte' | 'lte' | 'gt' | 'lt' | 'eq' | 'neq'
      value: number
    }
  | { type: 'flag'; varId: string; equals: boolean }
  | { type: 'visited'; sceneId: string }
  /** 背包系统(v7)：拥有某物品 ≥ count(默认 1)。 */
  | { type: 'hasItem'; itemId: string; count?: number }

export interface BranchCondition {
  /** 全部满足（AND）才解锁；空数组 = 无条件 */
  all: ConditionClause[]
}

/** 数值副作用：选中分支 / 进入场景时改变某变量 */
export interface VarEffect {
  varId: string
  op: 'add' | 'set'
  value: number
}

/**
 * 物品副作用 —— v7 背包系统。选中分支 / 进入场景时增减某物品。
 *   - give：获得 count 件（默认 1）
 *   - take：消耗 count 件（默认 1，不足则尽量扣到 0）
 */
export interface ItemEffect {
  itemId: string
  op: 'give' | 'take'
  count?: number
}

/**
 * 背包物品定义 —— v7 背包系统。
 *
 * 物品的「美术」走透明抠图图标(iconMediaId 指向 mediaStore 里抠好底的 PNG)，
 * 可关联一个参考道具(propId → Scenario.props)以复用其外观/参考图做图标生成。
 */
export interface InventoryItem {
  id: string
  /** 显示名（如「生锈钥匙」） */
  name: string
  /** 抠图后的透明图标 mediaId（mediaStore）。 */
  iconMediaId?: string
  /** 关联的参考道具 id（Scenario.props），用于图标生成时复用外观。 */
  propId?: string
  /** 作者备注 / 给玩家看的物品描述。 */
  desc?: string
  /** 生成图标用的提示词（独立于 prop.prompt，可单独微调）。 */
  iconPrompt?: string
  /**
   * 从素材库拉入的参考图 mediaId 列表 —— 生成图标时作为图生图外观锚点，
   * 与 propId 互补（propId 复用参考道具，这里直接挑任意已有素材）。
   */
  iconRefMediaIds?: string[]
  /** 是否可堆叠（默认 false，单件语义）。 */
  stackable?: boolean
}

/**
 * 场景内可搜寻的战利品热点 —— v7 背包系统。
 *
 * 玩家在场景画面上「搜寻」时，悬停命中热点高亮、点击拾取对应物品。
 * 坐标用相对画面的归一化值（0~1），适配任意分辨率/裁剪。
 */
export interface SearchHotspot {
  id: string
  /** 拾取后获得的物品 id（Scenario.items）。 */
  itemId: string
  /** 归一化坐标（相对场景画面，0~1）。 */
  x: number
  y: number
  /** 命中半径（归一化，默认 0.07）。 */
  r?: number
  /** 拾取数量（默认 1）。 */
  count?: number
  /** 悬停/拾取提示文案（可选）。 */
  label?: string
}

/**
 * 场景进入门槛 —— v7 新增（数值/背包系统）。
 *
 * 玩家试图进入本场景时先求 condition：
 *   - 满足 → 正常进入。
 *   - 不满足 + onFail='redirect' → 自动改道到 redirectSceneId（门槛节点的典型用法：
 *     线索/好感不够时被引导去别处，而不是看到一个走不通的死节点）。
 *   - 不满足 + onFail='block' → 阻断（编辑器/试玩里提示 hint；运行时一般配合「隐藏」
 *     使这个节点在数值达标前不出现）。
 *
 * 缺省 / 字段不存在 = 无门槛（旧数据默认任何时候都能进）。
 */
export interface EntryGate {
  /** 进入条件（全部满足 AND）。 */
  condition: BranchCondition
  /** 不满足时如何处理。 */
  onFail: 'redirect' | 'block'
  /** onFail='redirect' 时改道到的场景 id。 */
  redirectSceneId?: string
  /** 给玩家/作者看的提示文案（如「线索不足，先去现场调查」）。 */
  hint?: string
}

// ============================================================================
// 多类型提示词 / 角色 / UI 风格
// ============================================================================

/**
 * 一个 scene 在生成阶段可能要分别走多个图像调用（场景画面 + UI 元素）。
 * 角色一致性提示词从 Scenario.characters 自动注入，不放这里。
 *
 * 都是字符串提示词；外部生成（midjourney/sora）可以把同一份字符串复制走、
 * 生成后把图像/视频拖回到 Scene.media 即可。
 */
export interface ScenePrompts {
  /** 场景画面提示词（核心，对应 media.prompt 主轴） */
  scene: string
  /** UI 元素提示词（按钮 / 字幕条 / QTE icon 视觉等的风格） */
  ui?: string
  /** 视频生成提示词（喂 seedance / sora 的 motion 描述） */
  video?: string
}

export interface Character {
  id: string
  name: string
  /** 外观气质提示词（可单独喂 GPT-Image-2 生成立绘/参考图） */
  prompt: string
  /**
   * 在 mediaStore 里的参考图 id；用于后续生场景时作 reference image 锚点。
   * 语义：角色头像或单视图立绘（兼容旧 v1 schema）。
   */
  refImageId?: string
  /**
   * 角色三视图拼图（正面 / 侧面 / 背面）的 mediaStore id —— v2 新增。
   * 生图流水线喂关键帧时优先用这张；缺失时回退到 refImageId。
   * 三视图拼图能让 GPT-Image-2 / Gemini 在不同镜头下保持一致。
   */
  turnaroundRefImageId?: string
  /**
   * 角色**大头照**（headshot）的 mediaStore id —— P1-B 新增。
   *
   * sd2-pe 人脸参考最佳实践：仅头肩、正脸/微侧、干净背景。作为 Seedance 2.0
   * 角色人脸锚点（`<主体N>` 的人脸基准）。由 buildSeedanceReferenceSet 读取，
   * 写实角色（realistic=true）在上传层走半脸打码（P1-C）。
   * 缺失时回退到 turnaroundRefImageId / refImageId。
   */
  headshotMediaId?: string
  /**
   * 角色**全身照**（fullbody）的 mediaStore id —— P1-B 新增。
   *
   * 完整全身站姿 + 完整服化道，作为 Seedance 2.0 角色体型/妆造锚点。
   * 与 headshotMediaId 共同替代旧三视图（turnaround）进入 Seedance 通道。
   */
  fullbodyMediaId?: string
  /**
   * 是否「写实真人」—— P1-B 新增；驱动上传层是否对人脸做半脸打码（P1-C）。
   *
   * 取值来源：生成角色锚点时按 `scenario.visualStyle === 'photoreal'` 推断
   * （见 forgeImagePipeline.isRealisticVisualStyle）。非写实（动漫/卡通/3D 国风等）
   * 为 false，跳过打码。缺省（旧数据）视为未知，下游按保守策略可当作需要打码。
   */
  realistic?: boolean
  /**
   * 面部数字化像素覆盖强度（用于"安全版"角色参考稿）。
   *   - `'none'`：完全不覆盖（写实裸脸，可能触发平台合规策略）
   *   - `'subtle'`（默认）：小半张脸（~40%）像素马赛克覆盖一侧眼睛/面颊
   *   - `'full'`：整张脸像素马赛克，彻底抹掉五官
   *
   * 设计意图：
   *   · 角色设计稿需要"破碎感"而非真·五官图，避免平台误判为人脸数据
   *   · 仍保留未覆盖一侧，供作者确认妆容 / 肤色 / 眼神方向
   */
  faceMaskIntensity?: 'none' | 'subtle' | 'full'
  /**
   * 锚点别名表 —— v3.10 新增（模糊指代消歧）。
   *
   * 剧本中作者经常用模糊词（"那个男人"/"凶手"/"黑衣人"/"他"）指代同一个角色。
   * LLM 在生成大纲 / 扩写 / 分镜阶段会把这些表达 attach 到这里，让所有下游
   * 通过 alias 归一到同一个 character.id。
   *
   * 维护策略：
   *   - outline-architect / script-index-scanner 等 skill 输出时 LLM 直接填进来
   *   - normalizeScenario 在 LLM 输出归位到 Scenario 时**保留**该字段不丢
   *   - actLoopbackContext.formatCharactersAnchors 把 aliases 渲染进
   *     LOCKED ANCHORS prompt，让下一步 LLM 调用看到"这个角色还可以叫这些"
   *
   * 命名规范：纯文本，不要包标点；同一字符串只出现一次。如 ["凶手", "黑衣人", "那个男人"]。
   */
  aliases?: string[]
  /**
   * 角色锚点描述 —— v3.10 新增。
   *
   * 一句话浓缩"这个角色在剧本里最稳定的识别特征"（轮廓/嗓音/标志物/疤痕等）；
   * 与 prompt 不同：prompt 用于生图，anchor 用于**LLM 跨阶段调用时识别角色**。
   *
   * 例：anchor = "中年男性，左眉一道刀疤，嗓音低哑"；prompt 则可能浓墨重彩
   * 描写他的发型、服装、肌肉。两者各司其职，但互相补充。
   *
   * 缺省时 LLM 用 name + prompt 兜底；填了之后会被注入下游 prompt 的 LOCKED ANCHORS。
   */
  anchor?: string
  /**
   * 外观状态变体 —— v3.10 新增（合并"参考图状态"+"剧本装扮变体"）。
   *
   * 设计动因（用户反馈合并）：
   *   · 旧设计两套：参考图侧把"换装/年龄/伤痕"做多张参考图；剧本侧把"凶手装"
   *     "回家便服"做装扮变体。两者本质都是"同一角色的不同视觉状态"。
   *   · 合并成一个数组后，UI / 数据流都简单：每个 variant 同时承载（a）一张
   *     专属参考图、（b）一段触发短语、（c）一段 prompt 补充。
   *
   * 用法：
   *   - 角色编辑器 / ForgeWizard 的角色卡片用 MultiVersionStrip 渲染本数组
   *   - Shot.characterVariantIds[characterId] 选一个 variant.id 锁定这一镜的形态
   *   - prose-to-beats / storyboard-director 在检测到角色形态切换时输出对应
   *     variant.id（不再生成新角色）
   *
   * 命名约定：variant.id 在角色 scope 内唯一，如 `var-killer-suit`。
   */
  appearanceVariants?: CharacterAppearanceVariant[]
  /**
   * 音色锚点 —— v6.6 新增（角色配音 / 视频模型音色基准）。
   *
   * 类比 turnaroundRefImageId 之于"角色视觉锚":
   *   - 视觉锚 = 三视图，喂关键帧生图保人脸/服饰一致
   *   - 音色锚 = 一段试听 mp3 + voiceType id，下游 TTS / 视频配音读取它,
   *     保证整部剧里同一角色的嗓音稳定
   *
   * 设计意图:
   *   · 作者在 AssetPreviewDialog 选 voiceType (TTS voice_type 标识)
   *     -> 用试听文本生成一段 sample mp3 -> 听完不满意可以换 / 不行可以
   *     再录、再选，确认后 "保存为锚点" 把 voice_type 锁定到角色
   *   · 后续视频/旁白合成阶段读 character.voiceAnchor.voiceType 作配音
   *     默认值；缺省时退化为"导演兜底音色"
   *   · sampleMediaId 让作者随时回听已经锚定的音色，避免半年后看不懂
   *     "BV001_streaming" 是什么
   */
  voiceAnchor?: CharacterVoiceAnchor
  /**
   * 角色**试镜视频**的 mediaStore id —— 角色定妆照流程 v7 新增。
   *
   * 流程：定妆照图(turnaroundRefImageId) 生成后，以它为参考喂 Seedance 2.0 生成一段
   * ~10s / 3:4 的单人胸像「试镜视频」（带角色本人念白）。定妆照网格优先展示这段视频，
   * 原定妆照图仍在详情里保留。
   */
  auditionVideoMediaId?: string
  /**
   * 角色**音色样本 MP3** 的 mediaStore id —— 角色定妆照流程 v7 新增。
   *
   * 从试镜视频里完整提取的音轨（≈10s），作为该角色的「音色参考」。下游生成该角色镜头
   * 视频时，直接作 Seedance `reference_audio` 喂入（prompt 备注「XXX 的音色参考」），
   * 取代旧的预设 voiceType 音色锚点。
   */
  voiceSampleMediaId?: string
}

/**
 * 角色音色锚点 —— v6.6 新增。
 *
 * 字段语义:
 *   - voiceType: TTS 的 voice_type 标识 (例: "BV700_streaming")。
 *     这是下游真正用于合成的"音色 ID"，必须稳定。
 *   - label:    音色的人类可读标签 ("通用女声 · 知性"), 仅 UI 展示。
 *   - sampleMediaId: 试听 mp3 在 mediaStore 里的 id；不存在则 UI 退到
 *                    "未试听过" 状态。
 *   - sampleText: 当时用来生 sample 的文本，方便作者半年后还能复现。
 *   - speedRatio: 0.5-2.0，TTS 语速参数；缺省 1.0。
 *   - savedAt:  锚点确认时间戳 (ms)，UI 上排序 / 展示用。
 */
export interface CharacterVoiceAnchor {
  voiceType: string
  label?: string
  sampleMediaId?: string
  sampleText?: string
  speedRatio?: number
  savedAt?: number
}

/**
 * 角色外观状态变体 —— v3.10 新增。
 *
 * 表达"同一个角色 + 不同视觉状态"。把"参考图状态"和"剧本装扮变体"统一到一个结构：
 *
 *   - 参考图侧（角色编辑器 / 资产生成）：每个 variant 关联一张参考图（mediaId），
 *     用来跑生图 reference；"少年版""换装后""受伤后"等。
 *   - 剧本侧（LLM 解析）：作者在剧本里说"凶手脱掉黑衣换上便服"时，下游 LLM
 *     输出 variantId 指明这一镜对应哪个状态（不会误认成新角色）。
 *
 * 字段语义：
 *   - id          variant 在角色 scope 内的稳定 id（可被 shot 引用）
 *   - label       人类可读的简短标签（"凶手装"/"少年时期"/"受伤"）
 *   - prompt      只描述与基线 prompt 的差异（"剃光头/瘦削/眉骨擦伤"），
 *                 喂生图时作 prompt 增量；不写整段重新描述
 *   - aliases     该状态下作者会怎么称呼角色（"那个戴鸭舌帽的"/"光头男"），
 *                 与 Character.aliases 互补：本数组只在这种状态下生效
 *   - mediaId     参考图（mediaStore id）；未上传则 LLM 用 prompt 临时画
 *
 * 数据约束：
 *   - 同一 character 内 id 唯一；label 必填（作为 UI/LLM 双向锚点的必要可读性来源）
 *   - aliases 与 Character.aliases 不冲突，下游 dedupe 即可
 */
export interface CharacterAppearanceVariant {
  id: string
  label: string
  /** 与基线 character.prompt 的差异描述（增量），喂生图 reference */
  prompt: string
  /**
   * 该状态下的别名（仅当角色处于此状态时生效；与 Character.aliases 拼合用）。
   * 例：基线 = ["凶手", "黑衣人"]；variant("便服") = ["陈先生", "邻居老陈"]。
   */
  aliases?: string[]
  /** 参考图 mediaStore id；未上传则缺省 */
  mediaId?: string
}

export interface UIStyle {
  /** 全局 UI 风格描述（暗黑赛博 / 民国手绘 / 极简日漫……） */
  prompt: string
  refImageId?: string
}

// ============================================================================
// UI 素材库（v9 新增）—— 影游叠加式 UI 覆盖层的资产注册表 + 常驻 HUD 绑定
// ============================================================================

/**
 * 图层混合模式 —— UI 素材「去背 + 叠加」核心机制。
 *
 * 影游 UI 多为发光/粒子/半透明,无法硬抠图。改用图层属性去背(实证:gpt-image-2
 * 不支持原生透明,但能产出真·纯黑/纯白底):
 *   - screen/lighten:纯黑(#000)底消失,辉光/金光/粒子加光叠加保留(好感度飘字/光效)。
 *   - multiply:纯白(#fff)底消失,暗色线稿/描边保留(水墨边框)。
 *   - overlay/hard-light:对比增强叠加。normal:直接盖(配透明 PNG / 已抠图)。
 */
export type UIBlendMode =
  | 'normal'
  | 'screen'
  | 'multiply'
  | 'overlay'
  | 'hard-light'
  | 'lighten'
  | 'add'

/**
 * 去背方式 —— 决定生成时用什么底、运行时靠什么让底消失。
 *   - screen-black（默认）：纯黑底 + screen 混合(发光/金色/粒子首选)。
 *   - multiply-white：纯白底 + multiply 混合(暗色线稿/描边)。
 *   - alpha：原生透明 PNG(仅 gpt-image-1.x 支持;或已 chroma 抠好);normal 直接盖。
 *   - chroma：洋红底 + cutoutToTransparent 手动抠图(硬边纯色底);产出 alpha。
 *   - opaque：不去背(有底,靠 blendMode/透明度盖)。
 */
export type UIMatte =
  | 'screen-black'
  | 'multiply-white'
  | 'alpha'
  | 'chroma'
  | 'opaque'

/**
 * UI 素材角色 —— 高频影游叠加类型,驱动模板化生成 prompt 与默认锚点/生命周期。
 */
export type UIAssetRole =
  | 'affinity' // 好感度增减飘字
  | 'nameplate' // 人员出场 / 姓名下三分之一
  | 'location-title' // 地域名称标题卡
  | 'act-transition' // 幕次切换 / 第二日等时间流逝
  | 'exposition' // 背景交代艺术文字
  | 'interaction-hint' // 交互点 / QTE / 选择前提示
  | 'pip-silhouette' // 画中画卡通剪影
  | 'hp-bar' // 角色 / boss 血条
  | 'avatar-frame' // 角色 / boss 头像框
  | 'skill-box' // 技能框
  | 'attack-box' // 攻击框
  | 'ending-card' // 结局卡
  | 'tree-background' // 剧情树/关卡选择页全屏背景
  | 'tree-node-frame' // 剧情树节点框(叠在场景缩略图上)
  | 'screen-background' // 全屏 UI 页面背景(背包/主菜单/宝箱/搜刮)
  | 'screen-frame' // 全屏 UI 页面外框/边饰
  | 'custom' // 自定义

/** 数值绑定 —— HUD 元素把某变量映射到填充比例(血条)或数字显示。 */
export interface UIValueBind {
  /** 绑定的变量 id（Scenario.variables）。 */
  varId: string
  /** fill = 按 min~max 归一化成 0~1 填充宽度(血条);number = 直接显示数值。 */
  kind: 'fill' | 'number'
  /** fill 归一化下限(默认取变量 min 或 0)。 */
  min?: number
  /** fill 归一化上限(默认取变量 max 或 100)。 */
  max?: number
}

/**
 * UI 素材 —— 全局注册表(镜像 InventoryItem)。一份素材可被:
 *   - 拖入某场时间轴当瞬时/单场叠层(Tier A/B,生成 StickerClip)；
 *   - 绑成跨场常驻 HUD(Tier C,Scenario.hud 的 HudElement 引用)。
 */
export interface UIAsset {
  id: string
  /** 显示名(如「好感度提升」「主角血条」)。 */
  name: string
  role: UIAssetRole
  /** 生成/抠图后的图 mediaId(mediaStore)。 */
  mediaId?: string
  /** 生成用英文 prompt(含单色底约束)。 */
  prompt?: string
  /** 图生图参考图 mediaId 列表(素材库挑)。 */
  refMediaIds?: string[]
  /** 去背方式;决定生成底色与默认 blendMode。 */
  matte: UIMatte
  /** 默认叠加混合模式(由 matte 推导默认,可覆盖)。 */
  blendMode: UIBlendMode
  /** 默认锚点(归一化 0~1)+ 缩放(画面高度百分比基准)。 */
  defaultAnchor?: { x: number; y: number; scale?: number }
  /** 瞬时类默认时长(ms);拖入时间轴的初始 clip 长度。 */
  defaultDurationMs?: number
  /** 默认生命周期意图:transient 瞬时 / scene 单场常驻 / hud 跨场常驻。 */
  lifecycle: 'transient' | 'scene' | 'hud'
  /** HUD 用默认数值绑定建议(血条等);可在 HudElement 覆盖。 */
  valueBind?: UIValueBind
  /** 作者备注。 */
  desc?: string
}

/**
 * 常驻 HUD 元素（Tier C）—— 跨场景、随游戏状态显隐、可绑数值实时更新。
 *
 * 由 Player 顶层 HudLayer 渲染(独立于单场时间轴):
 *   - visibleWhen 命中(如「战斗中」flag)才显示,跨多个 scene 节点持续。
 *   - valueBind 把变量实时映射到血条填充/数字。
 */
export interface HudElement {
  id: string
  /** 引用的 UI 素材(Scenario.uiAssets)。 */
  uiAssetId: string
  /** 屏幕锚点(归一化 0~1)+ 缩放(画面高度百分比基准,默认由素材定)。 */
  anchor: { x: number; y: number; scale?: number }
  /** 叠加混合模式(默认取素材 blendMode)。 */
  blendMode?: UIBlendMode
  /** 显示条件(复用分支条件:var/flag/visited/hasItem);缺省=恒显。 */
  visibleWhen?: BranchCondition
  /** 数值绑定(血条填充/数字)。 */
  valueBind?: UIValueBind
  /** 叠放层级(大在上,默认 0)。 */
  z?: number
}

/**
 * 剧情树主题预设 —— 决定连线/方向默认值与生成背景/节点框的 prompt 基调。
 *   default 用现有内置深色风;chinese=金线水墨;cartoon=明快描边;scifi=霓虹 HUD;
 *   custom=作者完全自定义(仅用显式字段,不套预设默认)。
 */
export type TreeThemePreset = 'default' | 'chinese' | 'cartoon' | 'scifi' | 'custom'

/** 剧情树布局导航模式:map=自由地图;linear=线性关卡列表(预留)。 */
export type TreeNavMode = 'map' | 'linear'

/**
 * 玩家可跳转范围:
 *   none    = 只读(现有行为,只能看)。
 *   visited = 可跳回已访问节点(回放) + 已访问节点的直接可达分支(推进)。
 *   all     = 任意节点自由跳(调试/自由探索)。
 */
export type TreeJumpScope = 'visited' | 'all' | 'none'

/** 剧情树连线样式。 */
export interface TreeEdgeStyle {
  /** 连线颜色(CSS color);缺省由预设定。 */
  color?: string
  /** 线宽(px)。 */
  width?: number
  /** 是否虚线。 */
  dashed?: boolean
}

/**
 * 剧情树主题(Tier: 游戏内剧情树 per-scenario 皮肤 + 章节/关卡选择导航)。
 *
 * 由播放器 BranchTreeReadonly / BranchTreeOverlay 消费:
 *   - 背景/节点框走 UI 部件(scenario.uiAssets)生成管线,这里只引用 assetId。
 *   - 全字段可选;整体缺省(scenario.treeTheme == undefined)时回落现有内置样式。
 */
export interface TreeTheme {
  preset: TreeThemePreset
  /** 全屏背景图,引用 uiAssets(role 'tree-background')。 */
  backgroundAssetId?: string
  /** 节点框(默认态),引用 uiAssets(role 'tree-node-frame')。 */
  nodeFrameAssetId?: string
  /** 当前节点高亮框(可选)。 */
  nodeFrameCurrentAssetId?: string
  /** 未解锁节点框(可选)。 */
  nodeFrameLockedAssetId?: string
  /** 连线样式(缺省由预设)。 */
  edge?: TreeEdgeStyle
  /** dagre 布局方向(默认 'TB')。 */
  direction?: 'TB' | 'LR'
  /** 节点是否显示场景缩略图(默认 true;false=纯标题框)。 */
  showThumbnails?: boolean
  /** 导航模式(默认 'map')。 */
  navMode?: TreeNavMode
  /** 玩家可跳转范围(默认 'visited')。 */
  jumpScope?: TreeJumpScope
  /** 关卡选择页标题(缺省用剧本名)。 */
  title?: string
}

/**
 * 全屏 UI 页面类型(v11)—— 仿《底特律:变人》类深度互动影游的整页 UI。
 *   - inventory:真背包(读运行时 ownedItems + scenario.items 出网格,可查看/丢弃)。
 *   - mainMenu:主菜单(继续/重开/关卡选择/退出等按钮)。
 *   - chest:开宝箱(点击开启 → 发 loot 给玩家,一次性)。
 *   - search:搜刮页(整页背景 + 归一化热点,点击拾取,搜打撤)。
 *   - custom:自定义(纯 slot 拼装:装饰部件 + 按钮 + 动作绑定)。
 */
export type UIScreenKind = 'inventory' | 'mainMenu' | 'chest' | 'search' | 'custom'

/**
 * 全屏页面动作 —— 按钮/热点触发的行为。运行时由 Player 的 ScreenOverlay 分发。
 */
export type UIScreenAction =
  | { type: 'close' } // 关闭本页,续播
  | { type: 'restart' } // 从头开始
  | { type: 'home' } // 返回主页
  | { type: 'exit' } // 退出试玩
  | { type: 'levelSelect' } // 打开剧情树/关卡选择
  | { type: 'jumpScene'; sceneId: string } // 跳到某场
  | { type: 'openScreen'; screenId: string } // 打开另一个全屏页面
  | { type: 'giveItems'; effects: ItemEffect[] } // 发/扣物品
  | { type: 'applyVars'; effects: VarEffect[] } // 改数值

/**
 * 全屏页面槽位 —— custom 页的拼装单元(也可用于其它 kind 追加装饰/按钮)。
 * 坐标/尺寸均为归一化(相对页面 0~1)。
 */
export interface UIScreenSlot {
  id: string
  /** widget=纯装饰部件图;button=可点按钮;text=文本标签。 */
  kind: 'widget' | 'button' | 'text'
  /** 引用的 UI 部件(scenario.uiAssets)mediaId 来源;widget/button 背景图用。 */
  assetId?: string
  /** 文案(button 标签 / text 内容)。 */
  label?: string
  /** 归一化位置(中心点)+ 尺寸(相对页宽/页高)。 */
  x: number
  y: number
  w?: number
  h?: number
  /** button 点击动作。 */
  action?: UIScreenAction
  /**
   * 数值绑定(与 HUD 同一套 UIValueBind)—— widget 槽位可把变量实时映射成
   * 血条填充(fill,按 min~max 揭开图像)或数字(number,叠字)。缺省=纯静态图。
   */
  valueBind?: UIValueBind
  /**
   * 显示条件(复用分支条件 var/flag/visited/hasItem)—— 缺省=恒显。
   * 用于"血量低于 X 才显示警示图标""拿到钥匙才显示某按钮"等数值联动。
   */
  visibleWhen?: BranchCondition
  /** 叠放层级(大在上,默认 0)。 */
  z?: number
}

/**
 * 全屏 UI 页面定义(v11)—— 全局注册表 scenario.uiScreens。
 *
 * 由 Player 顶层 ScreenOverlay(portal)按 kind 渲染,读运行时 ownedItems / vars。
 * 触发:PlayerMenu 菜单项(inventory/mainMenu/custom)或时间轴 ScreenClip(chest/search)。
 */
export interface UIScreen {
  id: string
  /** 显示名(菜单项/编辑器列表用)。 */
  name: string
  kind: UIScreenKind
  /**
   * 单页独立开关(缺省 = 开)。关掉这一页 → 运行时菜单入口 / 时间轴触发 / 跨页跳转
   * 都跳过它,但保留定义方便随时开回。让作者能按"背包 / 游戏化主界面"逐个取舍,
   * 而不用连整套全屏页面系统一起关。runtime 由 effectiveUIScreens 统一过滤。
   */
  enabled?: boolean
  /** 全屏背景图,引用 uiAssets(role 'screen-background')。 */
  backgroundAssetId?: string
  /** 页面外框图(可选),引用 uiAssets(role 'screen-frame')。 */
  frameAssetId?: string
  /** 页面标题 / 副标题(缺省用 name)。 */
  title?: string
  subtitle?: string
  /** 拼装槽位(custom 主用;其它 kind 可追加装饰/按钮)。 */
  slots?: UIScreenSlot[]
  /** chest:开启时发放的战利品(一次性)。 */
  loot?: ItemEffect[]
  /** chest:开启时同时应用的数值奖励(如金币 +100、经验 +50)。与 loot 并行。 */
  lootVars?: VarEffect[]
  /** chest:开启后置位的 flag 变量 id(防重复开箱;可选)。 */
  openedVarId?: string
  /** search:整页搜刮热点(归一化坐标,点击拾取)。 */
  hotspots?: SearchHotspot[]
  /** mainMenu:显示哪些内置按钮(缺省全显)。 */
  menuActions?: UIScreenAction['type'][]
  /** 是否可被玩家用 ESC / 关闭按钮关掉(mainMenu 可设 false 强制选择)。 */
  dismissible?: boolean
}

/**
 * 全屏页面时间轴触发 clip(v11)—— 挂在 Scene.screens,到点弹出对应页面。
 * 镜像 MinigameClip:播放到 startMs 时暂停并打开 screenId 指向的全屏页面。
 */
export interface ScreenClip {
  id: string
  /** 指向 scenario.uiScreens 的页面 id。 */
  screenId: string
  /** 触发时间(相对本场,ms)。 */
  startMs: number
}

/**
 * 全局"美术风格"—— 影响所有素材生成的 prompt 前缀。
 *
 * 这里只是一个 string literal union；预设表 + 注入函数都在 llm/visualStylePresets.ts。
 * 之所以在 types 层复一份，是为了**保持 scenario → llm 的依赖方向不反转**
 * （types 必须是"纯数据"，不能 import 具体的 provider/preset 实现）。
 */
export type VisualStyle =
  | 'photoreal'
  | 'anime'
  | 'cartoon'
  | 'pixelart'
  | 'watercolor'
  | 'ink'
  | 'render3d2d'

/**
 * 电影美学调色滤镜（film-looks）—— 与 VisualStyle(渲染媒介) 正交的第二维度。
 * 决定全片的色板/对比/胶片质感/高光阴影染色，与媒介叠加使用（例：写实 + 蒂尔橙）。
 * 定义源在 skills/film-looks/<id>/SKILL.md，由 filmLookPresets 解析。可选，不选=不加调色。
 */
export type FilmLook =
  | 'retro-future'
  | 'baroque-chiaroscuro'
  | 'teal-orange'
  | 'bleach-bypass'
  | 'pastel-symmetry'
  | 'noir-lowkey'
  | 'warm-nostalgia'
  | 'clinical-scifi'
  | 'morandi-muted'
  | 'bronze-epic'

/**
 * 导演流派 id —— v3.8 新增。
 *
 * 纯字符串联合；具体的 persona 文本（身份 / 剪辑语法 / 镜头语言 / 节奏 / 下游绑定）
 * 现在写在 llm/skills/directors/<id>/SKILL.md，由 directorSkillLoader 解析成
 * DirectorPersona，与 types 层解耦——保证 types 不把 prompt 实现拖进来。
 *
 * 新加流派 = 加字符串 + 建 skills/directors/<id>/SKILL.md + 在 loader 注册表登记
 * （UI 选择器/海报会自动读取）。
 */
export type DirectorStyleId =
  | 'foreknowledge-suspense'
  | 'precision-noir'
  | 'minimal-epic'
  | 'mood-neon'
  | 'luminous-anime'
  | 'kinetic-clarity'
  | 'cyberpunk-neonoir'
  | 'unseen-horror'
  | 'nonlinear-scifi'
  | 'pulp-dialogue'
  | 'custom'

/**
 * 场所 · Location —— v2 新增。
 *
 * 一部剧本通常在少量场所反复发生（厨房、教室、废弃仓库、雨夜街角……）。
 * v1 里每个 scene 独自持有 media.prompt，同一场所跨场景容易画出来不一样；
 * v2 把"场所"抽出来，先为每个 location 生一张"空场基准图"（refImageId），
 * 之后关键帧生图喂三张 ref（character turnaround + location base + uiStyle）。
 */
export interface Location {
  id: string
  /** 场所名（中文，UI 展示；同时也会进 prompt） */
  name: string
  /** 场所描述提示词：光线、时间、材质、氛围等 */
  prompt: string
  /** 基准图（空场全貌） mediaStore id */
  refImageId?: string
  /**
   * v3.6 · 多角度参考图数组。
   * 每一项代表该场所的一个独立拍摄角度（室内、室外、过道、特写局部…），
   * 生镜关键帧时按 scene.locationAngle 选最匹配的一张作为 reference。
   */
  angleRefs?: LocationAngleRef[]
}

/** 场所角度参考图 —— 一个 Location 可以有多张，代表不同拍摄方向/区域 */
export interface LocationAngleRef {
  /** 唯一 id，格式 `<locationId>-angle<N>` */
  id: string
  /** 人类可读的角度描述，例如"入口外观"/"主厅"/"后厨/局部" */
  label: string
  /** 生图 prompt 补充描述（对 location.prompt 的补充，聚焦本角度的差异） */
  anglePrompt: string
  /** mediaStore id */
  mediaId?: string
}

/**
 * 关键道具 · Prop —— v3.7 新增。
 *
 * 剧本中反复出现且有强身份识别的物品（信物、武器、关键文件、徽章……）。
 * 为它们生成独立基准图，可在跨镜分镜中作为 reference 注入，保证同一道具
 * 在前后画面里外观统一（颜色/材质/形制不漂移）。
 *
 * 不是所有道具都值得进这个模块 —— 只有"关键识别物"。
 * 锻造流水线里 LLM 会判断剧本中的"重复具名物品"并只抽取这类进入 props[]。
 */
export interface Prop {
  id: string
  /** 道具名（中文 UI 展示 + 进 prompt） */
  name: string
  /** 道具描述提示词：材质 / 颜色 / 形态 / 标识细节 */
  prompt: string
  /** 基准图（孤立展示，纯背景） mediaStore id */
  refImageId?: string
  /**
   * 锚点别名 —— v3.10 新增（同 Character.aliases）。
   *
   * 作者在剧本里指代道具的非正式说法（"那把刀"/"凶器"/"那东西"），
   * LLM 解析阶段挂上来；下游链路通过 alias 归一到同一个 prop.id。
   */
  aliases?: string[]
  /**
   * 道具识别锚点 —— v3.10 新增。
   *
   * 浓缩本道具最稳定的视觉/语义识别特征（材质 + 形制 + 标识），与 prompt 区分：
   * prompt 用于生图，anchor 用于跨阶段 LLM 调用时认人对物。
   * 例：anchor = "黑色枪柄、刻有 K 字母、握把缠红绳"
   */
  anchor?: string
  /**
   * 状态变体 —— v3.10 新增（合并参考图状态 + 剧本变体）。
   *
   * 同 CharacterAppearanceVariant 的设计动因：把"参考图侧的多状态"和
   * "剧本里同一道具的不同形态"统一成一个结构。
   *
   * 用例：枪 → "完整""断成两截""刻字版"；信物 → "原件""血迹版""碎片"。
   *
   * Shot.propVariantIds[propId] 选一个 variant.id 锁定本镜形态。
   */
  variants?: PropVariant[]
}

/**
 * 道具状态变体 —— v3.10 新增。
 *
 * 字段语义参考 CharacterAppearanceVariant：id 唯一、label 必填、prompt 是
 * 增量描述、mediaId 关联参考图、aliases 是该状态下的别名。
 */
export interface PropVariant {
  id: string
  label: string
  prompt: string
  aliases?: string[]
  mediaId?: string
}

// 'seedance-local'（本机 Python Flask 后端）已于 2026-06 退役，统一走宿主 litellm 网关。
export type VideoProviderKind = 'seedance' | 'jimeng' | 'mock'

export interface VideoConfig {
  provider: VideoProviderKind
  apiKey?: string
  /** 自定义 endpoint；空则使用 provider 默认 */
  apiBase?: string
  /**
   * 模型或推理接入点 id。
   *
   * Seedance 2.0 在火山方舟上有两种 `model` 字段填法，本字段**都接受**：
   *   1. 公共 model id，形如 `doubao-seedance-1-0-pro-250528`
   *      走官方共享的推理池，档位（1080p/720p）与付费方式按 model 默认
   *   2. 私有推理接入点 id（endpoint id），形如 `ep-xxxxxxxxxxxxxx-xxxxx`
   *      走用户自己的 endpoint，**档位由 endpoint 创建时的配置决定**
   *      （这也是 Seedance 2.0 官方样例的用法；1080p 通常要求用 endpoint）
   *
   * 调用时会原样写进请求 body 的 `model` 字段，Seedance 后端按 prefix 自动区分。
   */
  model?: string
  /** 默认时长（秒），seedance 支持 1~12 秒（官方样例到 11s） */
  durationSec?: number
  /**
   * 纵横比 / 分辨率档位表达（client-side 标签）。
   *
   * **重要**：Seedance 2.0 的真实 API 并**不**接受 `resolution` 字段——
   * 实际档位（480p/720p/1080p）是由 `model`（endpoint）决定的。
   * 本字段仅有两个现实作用：
   *   1. 推导顶层 `ratio`（16:9 / 9:16 / 1:1）塞进 request body
   *   2. tail-frame canvas 尺寸（pxWidth × pxHeight）
   *
   * 合法值见 `llm/seedanceResolution.VideoSize`。
   */
  size?:
    | '1080p'
    | '1080p-portrait'
    | '720p'
    | '720p-portrait'
    | '720p-square'
    | '480p'
    | '1280x720'
    | '720x1280'
    | '1024x1024'
  /**
   * 让 Seedance 直接生成**带音轨**的视频（generate_audio）。
   *
   * true  = 模型按 prompt / 参考音频 吐出含 BGM / 环境音 的 mp4
   * false = 纯视觉轨（后期在时间轴自行叠 audio clip）
   *
   * 缺省 = true（与官方样例一致；体验更完整）。
   */
  generateAudio?: boolean
  /**
   * 是否在视频右下角打"Seedance"水印。缺省 = false。
   */
  watermark?: boolean
}

// ============================================================================
// 音频 · Audio（v3 新增 · 时间轴剪辑）
// ============================================================================

/**
 * 音频轨类别 —— 控制混音默认增益、字幕/提示的 UI 颜色。
 *
 *   bgm  背景音乐（低 gain、循环）
 *   sfx  环境/音效
 *   vo   旁白 / 角色配音（最高优先级）
 */
export type AudioRole = 'bgm' | 'sfx' | 'vo'

/**
 * 单条音频片段 —— 时间轴 AUDIO 轨上的一格 clip。
 *
 * 引用层语义：
 *   - `ref` 指向 mediaStore 里的 id（用户上传的音频或 TTS 生成的片段）
 *   - `startMs` / `durationMs` 是在 scene 时间线里的位置（不是媒体原长）
 *   - `offsetMs` / `clipDurationMs` 是在媒体素材上的"入点/出点"，
 *     剪切（split）就是把一条 clip 切成两条共享 ref、offset 相接的 clip
 *
 * 约束：
 *   - volume 0..1，不做 per-channel
 *   - fadeInMs / fadeOutMs：剪映式淡入/淡出包络(ms),成片/导出按之调音量;时间轴上画三角提示
 */
export interface AudioClip {
  id: string
  role: AudioRole
  /** mediaStore id（声音文件） */
  ref: string
  /** clip 在 scene 时间线里的起点（ms，相对 scene 0 点） */
  startMs: number
  /** clip 在 scene 时间线里的长度（ms） */
  durationMs: number
  /** 在源音频里的入点（ms，默认 0） */
  offsetMs?: number
  /** 0..1，默认 1 */
  volume?: number
  /** 淡入时长(ms,默认 0)——剪映式音量包络,从 0 升到 volume */
  fadeInMs?: number
  /** 淡出时长(ms,默认 0)——剪映式音量包络,末尾从 volume 降到 0 */
  fadeOutMs?: number
  /** 作者给的标签（如"主题曲"、"脚步声"），UI 展示用 */
  label?: string
}

// ============================================================================
// 场景
// ============================================================================

// ============================================================================
// 分镜 · Shot（v3 新增）
// ============================================================================

/**
 * 镜头景别（Framing）—— 标准电影语言的六种基准景别。
 *
 *   wide     远景 / 大全景（建立镜头）
 *   medium   中景（人物腰以上）
 *   close    近景 / 特写
 *   insert   细节插入（道具、字条、伤口、屏幕……）
 *   ots      过肩（Over The Shoulder）
 *   pov      主观镜头（Point of View）
 *
 * 本轮不做运镜 DSL（推拉摇移），那些都塞进 Shot.cameraHint 字符串。
 */
export type ShotFraming = 'wide' | 'medium' | 'close' | 'insert' | 'ots' | 'pov'

// ─────────────────────────────────────────────────────────────────────────────
// 3D 辅助相机调度（低模 blockout）—— 2026-06 新增
//
// 一个低模 3D 空间：摆白模/图片/带色角色占位 + 带序号相机。渲染机位白模静帧作
// 「软参考」(reference_image，绝不 first_frame) + 相机/站位/配色转提示词，喂视频模型。
// 设计见 docs/superpowers/specs/2026-06-16-3d-camera-blocking-design.md
// ─────────────────────────────────────────────────────────────────────────────

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** 物体/相机位姿。rot 为欧拉角（度）。 */
export interface Transform {
  pos: Vec3
  rot: Vec3
  scale: Vec3
}

export type BlockoutObjectKind =
  | 'billboard'
  | 'box'
  | 'capsule'
  /** 有四肢的人形白模占位（角色），可整体移动/旋转/缩放 */
  | 'figure'
  | 'cylinder'
  | 'plane'

/** 人形白模姿势预设（仅 kind==='figure' 生效）。 */
export type BlockoutFigurePose =
  | 'stand'
  | 'apose'
  | 'tpose'
  | 'walk'
  | 'run'
  | 'sit'
  | 'crouch'
  | 'point'
  | 'wave'
  | 'cross'
  | 'fight'

export interface BlockoutObject {
  id: string
  kind: BlockoutObjectKind
  label?: string
  transform: Transform
  /** 人形姿势（kind==='figure'）—— 缺省按 'stand' 渲染 */
  pose?: BlockoutFigurePose
  /** 关联锚点（角色/场景/道具）—— 角色占位据此取「角色色」与参考图 */
  linkedAnchor?: {
    kind: 'character' | 'location' | 'prop'
    id: string
    variantId?: string
  }
  /** billboard 贴图用的 mediaStore id（一般取 linkedAnchor 的参考图） */
  texMediaId?: string
  /** 角色占位的稳定配色（hex），由角色 id 派生（colorForCharacter） */
  colorRole?: string
}

export type CameraMove =
  | 'static'
  | 'dolly-in'
  | 'dolly-out'
  | 'orbit'
  | 'pan'
  | 'crane'

export interface BlockoutCamera {
  id: string
  /** 序号；相机列表 / 逐机位出图都按它排（normalize 后从 0 连续重排） */
  order: number
  name: string
  transform: Transform
  /** 等效焦段(mm)，内部用 mmToFov 换算 three fov */
  fovMm: number
  framing: ShotFraming
  move: CameraMove
  /** 可选：朝向某物体（覆盖 rot 计算 lookAt） */
  targetObjectId?: string
}

export interface Blockout {
  id: string
  name: string
  objects: BlockoutObject[]
  cameras: BlockoutCamera[]
}

/**
 * 单个镜头 —— v3 新增。
 *
 * 一个 Scene（剧情节点）由 2~4 个 Shot 组成；Shot 是生图 / 生视频 / 一致性锚点的
 * 最小单位。MVP 阶段播放器仍按 Scene 级播"代表帧"，shot 只负责：
 *
 *   1) 生图的 prompt 分层（framing / cameraHint / transitionHint 都会拼进去）
 *   2) 场景详情抽屉里的"镜头板"分面预览
 *   3) 将来按时间轴切镜时的数据基础（startMs / endMs 预留）
 *
 * 缺省约定（兼容旧剧本）：
 *   · 若 Scene 未提供 shots，schemaMigrate 会兜底注入一个 medium 单镜
 *   · keyShotId 默认指向 shots[0]；Scene.media.ref 永远 = keyShot 的 keyframe
 */
export interface Shot {
  /** "sh_01" 级，scene 内唯一 */
  id: string
  /** 在 scene 内的顺序（0-based）；渲染 / 批量生图都按这个排 */
  order: number
  /** 景别 —— 生图时作为 framing cue 注入 prompt */
  framing: ShotFraming
  /** 运镜 / 机位 / 焦段提示（字符串，例如 "slow dolly-in from low angle"） */
  cameraHint?: string
  /** 本镜画面提示词（核心给生图） */
  prompt: string
  /** 在 scene 时间线里的起止（ms）—— 本轮可不填；下一轮 Player 切镜会用到 */
  startMs?: number
  endMs?: number
  /** 本镜出场的角色 id（scene.characterIds 的子集；缺省=继承 scene 全员） */
  characterIds?: string[]
  /**
   * 本镜每个出场角色的形态 variant —— v3.10 新增。
   *
   * 形如 `{ "char-li-jian": "var-killer-suit" }`：本镜中李建是"凶手装"形态。
   * Variant 来自 Character.appearanceVariants[]。
   *
   * 缺省 = 继承上一镜（连续场景）/ 角色基线（首次出场）。LLM 在剧本里检测到
   * 角色"换装/受伤/老化"等状态切换时主动写入此 map。
   *
   * 数据校验在 normalizeScenario：variantId 不存在于 character.appearanceVariants 时
   * 安静丢弃（不抛错），保证非破坏性。
   */
  characterVariantIds?: Record<string, string>
  /** 本镜出场的关键道具 id 列表 —— v3.10 新增（来自 scenario.props） */
  propIds?: string[]
  /**
   * 本镜道具形态 variant —— v3.10 新增。
   *
   * 形如 `{ "prop-knife": "var-knife-broken" }`：本镜中那把刀是"断刃"形态。
   * Variant 来自 Prop.variants[]。
   */
  propVariantIds?: Record<string, string>
  /** 本镜关键帧的 mediaStore id（生图产物） */
  keyframeMediaRef?: string
  /** 与相邻镜头的衔接说明，给 LLM 下一镜接续参考；不影响当前生图 */
  transitionHint?: string
  /**
   * 电影分镜脚本扩展字段 —— v3.7 新增（storyboard 管线产物）。
   *
   * 不改变 MVP 渲染逻辑，仅被：
   *   1) storyboard-director LLM 直接填充
   *   2) buildShotKeyframePrompt 在拼 prompt 时"视觉化"这些元素
   *      （音效 → 视觉暗示、潜台词 → 面部肌肉、表演 → 动作强度）
   *   3) 未来视频生成 / 台词 TTS / 剪辑 UI 读取
   *
   * 全部可选：老数据 / idea 模式产物不会有这些字段。
   */
  /**
   * 本镜目标播放时长（秒）—— v3.8 放开为任意正整数秒。
   *
   * 取值范围：允许 1-60 秒（1s 快切、60s 超长段落都要支持）。
   * 由 forgeVideoPlan 根据 modelCapabilities.maxSingleClipSec 决定要不要拆段；
   * **类型层不做档位约束**，让能力表成为唯一事实源。
   *
   * 历史兼容：旧剧本里的 5 / 10 仍合法，normalizeStoryboardShots 透传即可。
   */
  durationSec?: number
  /**
   * 原文引用段 —— v3.8 新增。
   *
   * 作用：剧本（script 模式）权威不变。本 shot 由剧本哪几句话"化"出来，
   * 原样 quote 到这里。后续所有下游（buildShotKeyframePrompt / forgeVideoPlan /
   * forgeKineticVideoPrompt）都**看得到原文**，不会出现 LLM 分完镜就"忘了"剧本原意的问题。
   *
   * 数据流：
   *   script 模式：storyboard-director 从 sceneText 里挑出对应段落放这里
   *   idea 模式：未必有；缺省表示"从 scene.prompts.scene 外推，无原文锚点"
   *
   * 不含格式化标记（LLM 不要加引号、编号或省略号）；UI 层需要 quote 样式自行加。
   */
  sourceTextSpan?: string
  /**
   * 连续组 id —— v3.8 新增（视频编排核心）。
   *
   * 语义：**同一组的 shot 在成片里是"一镜到底的延续"**（或至少是物理连续的）。
   * Planner 用这个标签决定 DAG 形态：
   *   - 同组 shots 串行执行，前镜的"结尾画面"作为下一镜的 startFrame
   *   - 不同组 shots 并行执行，互不依赖
   *
   * 打标者：`storyboard-director` skill 依据叙事语义决定
   *   （同一场追逐戏=同组；追逐→回忆闪回=切组）
   *
   * 不打标（undefined）= 独立 shot，作者没提示组属性，Planner 视为单独组。
   *
   * 命名约定：`grp-<sceneId>-<序号>`，方便后台日志追溯。
   */
  continuityGroupId?: string
  /** 本镜的核心台词（1 句，`[]` 表示有意无台词）；与 scene.dialogue 可重叠，以 shot 为单位给 TTS/字幕用 */
  dialogueText?: string
  /** 潜台词：角色**没说出口**的真实意图（外化到微表情 prompt） */
  subtext?: string
  /** 表演指导：音色 / 语速 / 音量 / 面部协同（多维语气参数） */
  performance?: string
  /** 环境音 / 非台词人声（喘息、吞咽）；会被 buildShotKeyframePrompt 翻译为视觉暗示 */
  audioHint?: string
  /** 背景状态：清晰 / 模糊 / 动态 —— 决定焦外散景策略 */
  bokehState?: 'sharp' | 'blurred' | 'dynamic'
  /**
   * 关键帧策略 —— v3.8 新增。
   *
   *   'single'  只生一张中间代表帧（静态氛围镜、慢运镜、情绪镜）
   *   'ab'      生首帧 A + 尾帧 B（大动作、快速运镜、明显位移），
   *             视频生成时把 A/B 作为首尾锚点
   *
   * 由 storyboard-director 根据镜头的"动作幅度 × 运镜复杂度"智能决定。
   * 缺省 = 'single'，保持与旧数据兼容。
   */
  keyframeStrategy?: 'single' | 'ab'
  /**
   * A 帧（首帧）提示词 —— v3.8 新增，keyframeStrategy='ab' 时必填。
   * 不写入 scene.media，由独立字段承载；关键帧生图会用它调用 buildShotKeyframePrompt(frame='A')。
   */
  startFramePrompt?: string
  /**
   * B 帧（尾帧）提示词 —— v3.8 新增，keyframeStrategy='ab' 时必填。
   * 与 startFramePrompt 配对，保证运镜连贯（光源守恒、道具守恒、物理累积）。
   */
  endFramePrompt?: string
  /** A 帧关键帧的 mediaStore id —— keyframeStrategy='ab' 时落此处；'single' 时为空，用 keyframeMediaRef */
  startFrameMediaRef?: string
  /** B 帧关键帧的 mediaStore id —— keyframeStrategy='ab' 时落此处 */
  endFrameMediaRef?: string
  /**
   * 图生视频提示词 —— v3.8 新增。
   * 由 kinetic-video-prompt skill 产出，遵循"激进运镜 + 爆发性动作 + 混沌环境" 黄金三角。
   * 空 = 视频生成时回退到 shot.prompt。
   */
  kineticVideoPrompt?: string
  /**
   * 电影级出片提示词 —— v4 新增。
   * 由 cinema-video-prompt skill 产出：分秒时间码 + 镜头语言 + 逐字台词(点名角色) +
   * 角色↔参考图锚定，面向 R2V 多参考图出片。比 kineticVideoPrompt 更长(保留换行/时间码)，
   * 是出片链路(orchestrateVideos)的首选提示词。空 = 回退到 kineticVideoPrompt / shot.prompt。
   */
  cinemaVideoPrompt?: string
  /**
   * 本镜渲染好的视频素材 mediaStore id —— v3.8 新增。
   *
   * 与 keyframeMediaRef 共存：
   *   - 未生视频：只有 keyframeMediaRef，时间轴占位渲染**图像**
   *   - 已生视频：videoMediaRef 存在时时间轴**用视频覆盖图像**（图像保留作 fallback）
   *
   * 写入时机：forgeKineticVideo 成功后回写。
   */
  videoMediaRef?: string
  /**
   * 本镜视频的「真实时长」(ms) —— 视频元素 loadedmetadata 后探测回写。
   *
   * 用途：把「视频时长」与「图像/镜窗时长(startMs..endMs)」解耦。镜窗是作者在时间轴上
   * 自由拖拽的布局参考(图片只是占位参考)，可以拉得比视频长；但视频本身有固定时长，
   * VIDEO 轨上的视频条应按这个真实时长绘制、播放到此即定格，绝不随图片镜窗无限拉伸。
   *
   * 未写入(旧数据 / 还没探测到)时退化为按镜窗时长绘制(兼容旧行为)。
   */
  videoNaturalDurationMs?: number
  /**
   * 本镜播放倍速(剪映式变速)——默认 1。
   *   · 0.5..2:视频 playbackRate 据此加速/减速;
   *   · 0:定格(freeze frame),画面停在当前帧。
   * 成片/试玩按此设 <video>.playbackRate;时间轴上画速度徽标。
   */
  speed?: number
  /**
   * 本镜「首尾动画」—— v8 后期效果（剪映式 clip 入/出动画）。
   *
   * 与 scene.clipAnim 的区别：多镜节点里每段视频各自独立的入/出动画，
   * 互不影响（选中镜 1 设的渐隐只作用于镜 1 的尾部）。单视频节点（无 shots）
   * 仍用 scene.clipAnim 兜底。
   */
  clipAnim?: ClipAnimSpec
  /**
   * 进入本镜的「转场」—— v8 剪映式两段视频衔接转场。
   *
   * 语义：作用在「上一镜 → 本镜」的衔接点（本镜 startMs 处），闪黑/闪白等在
   * 衔接点达到峰值。仅对 order≥1（有前一镜）的镜头有意义。直接渲染在 VIDEO 轨
   * 两段视频之间，而非独立轨道。
   */
  transitionIn?: TransitionSpec
}

/**
 * 时间轴标记点（剪映式打点）—— 编辑期参考锚点，挂在 scene.markers。
 * 不进成片 / 试玩输出；用于标尺打点、命名与吸附。
 */
export interface TimelineMarker {
  id: string
  /** 标记点时间（ms），相对当前场景时间轴起点。 */
  ms: number
  /** 可选命名。 */
  label?: string
}

export interface Scene {
  id: string
  title: string
  media: MediaRef
  /** 场景总时长（ms）；视频时通常 = 视频时长 */
  durationMs: number
  dialogue: DialogueLine[]
  qte?: QTESpec
  branches: Branch[]
  /**
   * 进入本场景时触发的数值变化 —— v6 新增（数值系统）。
   * 例如「经过这一节点就 +好感」。每次进入都会触发（Player 用 visited 去重避免重复累加）。
   */
  onEnterEffects?: VarEffect[]
  /**
   * 进入本场景时触发的物品增减 —— v7 新增（背包系统）。
   * 例如「进入仓库 → 自动获得手电筒」。Player 用 visited 去重避免重复发放。
   */
  onEnterItemEffects?: ItemEffect[]
  /**
   * 可搜寻战利品热点 —— v7 新增（背包系统）。
   * 玩家在场景画面上搜寻、悬停高亮、点击拾取对应物品。缺省 = 不可搜寻。
   */
  searchLoot?: SearchHotspot[]
  /**
   * 进入门槛 —— v7 新增（数值/背包系统）。
   * 数值/物品不达标时改道或阻断进入本场景（见 EntryGate）。缺省 = 无门槛。
   */
  entryGate?: EntryGate
  /** 编辑器拖拽用：自由位置（用于分支树画布） */
  pos?: { x: number; y: number }
  /**
   * 多类型提示词。新增字段（向后兼容）：
   *   - 不填时，回退到 media.prompt 作为 scene
   *   - PromptTabs 在保存时同步写回 media.prompt（保持单一主提示词来源）
   */
  prompts?: ScenePrompts
  /** 出现的角色 id（从 Scenario.characters 引用，作为生图一致性锚点） */
  characterIds?: string[]
  /** 所在场所 id（从 Scenario.locations 引用）—— v2 新增 */
  locationId?: string
  /**
   * 导演 / 舞美背景描述 —— v3 新增。
   *
   * 语义上与 DialogueLine('narration') 严格区分：
   *   - narration = 画外**旁白**，会被 TTS 念、会在字幕条显示
   *   - background = 不念、不上字幕，仅用于喂生图 prompt、LLM 分镜规划、
   *     以及编辑器里给作者看的"这场戏的氛围速记"
   *
   * 时间轴 DIA 轨**不渲染**这个字段；Inspector 有独立输入框编辑。
   */
  background?: string
  /**
   * 分镜列表 —— v3 新增。
   *
   * 缺省 / 空数组都表示 "尚未分镜"，此时走单镜兜底（keyShotId 也随之失效）。
   * schemaMigrate v2→v3 会为旧数据自动注入一个 medium 单镜，保证下游所有
   * "以 shot 为单位"的代码（生图批次、镜头板 UI）不用特判。
   */
  shots?: Shot[]
  /**
   * 3D 相机调度 blockout 引用 —— 2026-06 新增。
   *
   * 指向 `Scenario.blockouts` 的 id。支持跨场景复用同一空间（多 Scene 指同一 id）。
   * 指向不存在的 id 时由 normalize 置空。
   */
  blockoutRef?: string
  /**
   * 代表帧指向哪一个 shot —— v3 新增。
   *
   * 播放器 / StoryTree 缩略 / StagePane 默认大图，都从这张取。
   * 缺省 = shots[0]；若指向不存在的 shotId，一律回退到 shots[0]。
   */
  keyShotId?: string
  /**
   * 音频 clip 列表 —— v3 新增（时间轴剪辑层）。
   *
   * 不是"轨道数组" —— role 字段承担分轨渲染；每条 clip 独立持有自己的
   * startMs/durationMs。允许同一 role 下的 clip 重叠（混音层自己处理）。
   * 空 / undefined 等价："这场戏没有作者手工摆的音频"（默认静音）。
   */
  audio?: AudioClip[]
  /**
   * 小游戏 clip —— v3.6 新增。
   *
   * 时间轴上作为一条独立轨渲染；Player 到达其 startMs 时暂停视频、弹出
   * iframe 小游戏。玩家通关走 qte_pass / 失败走 qte_fail。
   *
   * 缺省 / 空数组 = 这场戏没有小游戏。
   */
  minigames?: MinigameClip[]
  /**
   * 富文本文字叠加 clip —— v7 新增（剪映/PR 式贴字）。
   *
   * 时间轴上作为一条独立轨渲染（TXT 轨）；Player / 编辑器舞台在画面任意位置
   * 自由摆放、缩放、旋转。与 dialogue（固定底栏字幕）并行、互不影响。
   * 缺省 / 空数组 = 这场戏没有叠加文字。
   */
  textOverlays?: TextOverlayClip[]
  /**
   * 搜索段 clip —— v7 新增（道具搜索玩法）。
   *
   * 时间轴上作为一条独立轨渲染（SEARCH 轨）；Player 到达 startMs 时把视频
   * 在该段内静态循环（首尾相同的可循环视频），弹出放大镜搜寻图标，等待玩家
   * 在 hotspotIds 指定的热点处拾取物品。搜完 / 跳过后继续播放。
   * 缺省 / 空数组 = 这场戏没有搜索段。
   */
  searchSegments?: SearchSegmentClip[]
  /**
   * 全屏 UI 页面触发 clip —— v11 新增。播放到 startMs 时暂停并弹出对应全屏页面
   * (开宝箱 / 搜刮页 / 自定义等)。缺省 / 空数组 = 这场戏不自动弹全屏页面。
   */
  screens?: ScreenClip[]
  /**
   * 剪映式后期效果 —— v8 新增。全部为「作者元数据 + 实时渲染」，不重编码 mp4。
   * 缺省 / 空 = 这场戏没有该类效果。
   */
  /** 滤镜 clip（预设 + 强度，时间区间）。 */
  filterClips?: FilterClip[]
  /** 调节 clip（手动色彩参数，时间区间）。 */
  adjustClips?: AdjustClip[]
  /** 特效 clip（叠层动效，时间区间）。 */
  effectClips?: EffectClip[]
  /** 贴纸 clip（画面装饰元素，时间区间）。 */
  stickerClips?: StickerClip[]
  /** 入场转场（节点级，整段开头）。 */
  transition?: TransitionSpec
  /** 首尾动画（节点级，默认黑底渐显渐隐）。 */
  clipAnim?: ClipAnimSpec
  /**
   * 时间轴标记点（剪映式打点）—— v9 新增。编辑期参考锚点：标尺上打点/命名，
   * 拖拽 clip / 移动播放头可吸附到这些点。**不进成片 / 试玩输出**，纯作者元数据。
   * 缺省 / 空 = 没有标记点。供智能体经 reel:add-marker / reel:remove-marker 寻址。
   */
  markers?: TimelineMarker[]
  /**
   * 场景级图像素材库 —— v3.2 新增（资产生成面板）。
   *
   * 存 mediaStore id 列表，包含两类来源：
   *   1. 用户手动「上传图片」入库的参考图
   *   2. 作者将来想保留的多版本生成图（MVP 暂不写入，保留语义扩展）
   *
   * 顺序 = 列表顺序；`reorderSceneImages` 动作用于拖拽排序。
   * 这些图条目可以从资产面板拖入时间轴，作为多图分镜占位。
   */
  sceneImages?: string[]
  /**
   * 场景级视频素材库 —— v3.2 新增（资产生成面板）。
   * 语义与 sceneImages 一致，面向视频素材。
   */
  sceneVideos?: string[]
  /**
   * 作者确认"这里就是结局" —— v3.5 新增。
   *
   * 用于区分两种 branches 为空的场景：
   *   - 真结局（HE/BE/任意分支走到尽头）：isEnding === true → 修复断链对话框跳过
   *   - 误删的断头（作者没意识到）：undefined/false → 仍会被 detectOrphans 列出
   *
   * 写入时机：
   *   - "修复断链" 对话框里作者保持"（结局·不连）"选项点应用时自动写入
   *   - 未来也可在 SceneInspector 里暴露手动 toggle
   *
   * 清除时机：
   *   - 作者后来给这个 scene 加了 branches[]（不再是结局）→ 逻辑上过时但不强制清
   *     （保留字段只是一个"作者意图的标记"，不影响运行时）
   */
  isEnding?: boolean
  /**
   * 视频入点（ms） —— v3.9 新增（时间轴视频裁剪）。
   *
   * 仅 `media.kind === 'VIDEO'` 时有意义。作者在时间轴"视频条"拖左 handle
   * 改入点；StagePane 播放时 seek 到 offset 开始播放。
   *
   * 默认 0 = 从视频开头播。合法范围：0 ≤ offset < video.duration。
   *
   * 数据关系：
   *   - 时间轴上视频条的起点像素位置 ≡ 0（始终 scene 起点对齐）
   *   - offset 影响的是**播放器从哪个时刻开始读视频文件**，不影响时间轴布局
   *   - 与 durationMs（scene 总时长）正交：作者可自由决定"裁剪入点"，但
   *     scene 的时间线仍从 0 到 durationMs
   */
  videoOffsetMs?: number
  /**
   * 视频裁剪时长（ms） —— v3.9 新增。
   *
   * 仅 `media.kind === 'VIDEO'` 时有意义。`offset + clipDuration` 是视频的
   * "出点"；播放到出点时 player 暂停 + seek 回 offset（实现裁剪播放）。
   *
   * 默认 undefined = 播到视频原生结尾。合法范围：clipDuration > 0。
   *
   * 关系：clipDuration 是"裁剪后视频的有效时长"。理想情况下作者应同步
   * 调整 scene.durationMs = clipDuration，让 hoverMs/durationMs 映射和
   * 裁剪后的视频时长一致；但两者是独立字段，允许作者让 scene 比视频长或短
   * （典型：视频 5s、scene 10s，前 5s 播视频后 5s 黑场等操作）。
   */
  videoClipDurationMs?: number
  /**
   * 视频原生时长（ms） —— v3.9.1 新增（VIDEO handle 拖拽上限来源）。
   *
   * 仅 `media.kind === 'VIDEO'` 时有意义。drop 视频时从 payload.durationMs 或异步
   * probeVideoDurationMs(url) 得到，写入该字段。作者拖拽 VIDEO 轨 handle 时，
   * 出点不得超过 videoNaturalDurationMs（否则超出原视频范围）。
   *
   * 未写入时（旧数据）退化为无上限（兼容旧工程）。
   */
  videoNaturalDurationMs?: number

  /**
   * 场景背景音乐锚点 —— v6.7 新增（剧情树节点级 BGM）。
   *
   * 设计意图：
   *   - 作者在剧情树节点详情挂的 SceneBgmPanel 里, 让 LLM (sceneBgmComposer skill)
   *     给出一段满足"BGM 纪律"的影视级 brief, 喂给 MiniMax Music 生成 mp3
   *   - 生成后 mp3 落 mediaStore (mediaId 存这里), brief / 元数据也落这里
   *   - 后续渲染 / 导出时 Player 拿 mediaId 当背景音轨叠在场景视频上
   *
   * 不写入时 = 这场戏没专属 BGM (Player 走全局静默 / 上一场延续)
   *
   * 重要约定 (与 Character.voiceAnchor 类比):
   *   - sceneBgm 是"作者锚定的最终选择", 不是"候选池"
   *   - 想保留多版本试听, 走 mediaStore tag (kind=audio, sceneId)
   *   - 这里只存"已采纳的那一版"的指针 + 生成它时用的 brief
   *
   * @see CharacterVoiceAnchor (类似设计)
   */
  sceneBgm?: SceneBgmAnchor
  /**
   * 所属剧集 id —— v4 新增（分剧集化）。
   *
   * 指向 `Scenario.episodes[].id`。
   * 缺失 / undefined = 旧数据：迁移到 v4 时自动归入第一集（ep-default 或 episodes[0].id）。
   * 允许跨集连线（branch.targetSceneId 可以指向另一集的 scene，形成联通故事树）。
   */
  episodeId?: string
}

/**
 * 场景 BGM 锚点 —— v6.7 新增。
 *
 * 数据关系:
 *   - mediaId          指向 mediaStore.audio entry, mp3 二进制
 *   - prompt           是 LLM (sceneBgmComposer) 输出的英文 brief, 真正喂给 MiniMax 的字段
 *   - chineseSummary   作者母语速读, UI 卡片标题用
 *   - bpm/genre/mood/instruments  brief 的结构化拆分, 重生成时可作为锚点保留
 *   - userHint         作者最初输入的中文 hint (可空), 改 brief 时回显
 *   - userHintMode     'auto' | 'A' | 'B' | 'C', 调试 / UI 提示用
 *   - durationMs       生成出来的实际 mp3 时长 (ms), 作者剪辑时间轴时参考
 *   - savedAt          锚定时间戳, UI 显示"3 分钟前生成"
 */
export interface SceneBgmAnchor {
  /** mediaStore id（音频实体），缺失时 BGM 还在生成中或已被清理 */
  mediaId?: string
  /** 直接喂给 MiniMax `prompt` 字段的英文 brief */
  prompt: string
  /** ≤40 中文字符的一句摘要, UI 卡片标题用 */
  chineseSummary: string
  /** BPM 整数（与 prompt 内 BPM 数字一致） */
  bpm: number
  /** 子类型 genre, e.g. "cinematic neo-noir" */
  genre: string
  /** 2–4 个英文小写情绪标签 */
  moodTags: string[]
  /** 2–4 件具名乐器 */
  keyInstruments: string[]
  /** 建议时长（秒），60–180 */
  estDurationSec: number
  /** 作者输入的原始中文 hint（可空），改 brief 时回显 */
  userHint?: string
  /** 作者输入档位标识，sceneBgmComposer 自决 */
  userHintMode?: 'auto' | 'A' | 'B' | 'C'
  /** 生成出来的实际 mp3 时长（ms） */
  durationMs?: number
  /** 锚定时间戳 */
  savedAt?: number
}

// ============================================================================
// 剧集（Episode）—— v4 新增
// ============================================================================

/**
 * 一个剧集（Episode）是剧本内一个逻辑段落，拥有自己的起始场景和排序。
 *
 * 设计原则：
 *   - episodes[] 挂在 Scenario 顶层，与 characters / locations 并列，全集共享角色库
 *   - Scene.episodeId 指向所属集；未标注的旧 scene 通过迁移归入第一集（ep-default）
 *   - 跨集场景分支合法：branch.targetSceneId 可指向任何集的 scene，支持联通故事树
 *   - 删除一个 episode 时，其 scenes 不自动删除，而是解除绑定变成"孤立场景"（UI 展示在"未分集"组）
 */
export interface Episode {
  id: string
  /**
   * 展示标题，如"第一集：雨夜序章"或"Episode 1"。
   * 作者可手动修改；新建时自动生成。
   */
  title: string
  /** 本集简介（AI 可自动生成，也可作者填写） */
  synopsis?: string
  /**
   * 本集第一个场景的 id（入口节点）。
   * 锻造新集时自动指向 LLM 生成的第一个 scene；
   * 作者也可在 StoryTree 里拖拽重新指定。
   */
  rootSceneId: string
  /** 显示排序（0-based，升序），支持拖拽重排 */
  order: number
  /** 创建时间戳（ms） */
  createdAt: number
}

// ============================================================================
// 剧本（顶层容器）
// ============================================================================

/**
 * 角色关系 —— v5 新增（小说家工作板）。
 *
 * 设计动因（2026-05-27 作者反馈）：
 *   "类似小说家写小说经常用的工具，如人物关系链 …… 既能通过对话询问，
 *    也能在左侧良好的展示给用户结果，还能支持修改调整重构等。"
 *
 * 数据形态：单向边 (fromCharId → toCharId, label)。
 *   - 作者可手动添加 / 编辑 / 删除
 *   - LLM 锻造剧本时也会顺带产出（pipeline 末段拉一遍 character relations skill）
 *   - 双向关系 = 两条边（A→B 和 B→A），label 各写一份；让作者能精准描述非对称关系
 *     （比如"A 暗恋 B"≠"B 把 A 当哥们儿"）
 *
 * id 由作者侧生成（ts + 随机后缀），便于增删 patch 写法。
 */
export interface CharacterRelation {
  id: string
  fromCharId: string
  toCharId: string
  /** 关系描述，如"父亲"、"前任"、"暗中跟踪"。中英文皆可。 */
  label: string
  /** 备注 / 关系演变（可选；多行） */
  note?: string
  /**
   * 关联信物 / 道具 —— 可选。这一对人之间的标志性物件（信物、凶器、定情之物…）。
   * 与 `label`（人物关系语义）**严格分离**：人物关系面板把它当作次要小标记单独展示，
   * 绝不混进关系标签、也不画到关系图连线上。仅作叙事备注，与 scenario.props 的
   * "关键道具基准图库"是两回事（这里只是文字，不参与生图一致性）。
   */
  itemHint?: string
}

/**
 * 剧情大纲节点 —— v5 新增（小说家工作板）。
 *
 * 与 Scene 的关系：
 *   - Outline 是"作者层面的纲领"，独立于 scenes 编辑，作者可先打大纲再扩写
 *   - 大纲 → scenes 的展开由 chat 命令 `/expand` 触发；展开后 scenes 不被绑死，
 *     作者改了大纲后可点"⟳ 据此更新后续"重新拉一次（⚠ 会与现有 scenes diff）
 *   - 删 / 重排大纲不会自动同步 scenes —— 避免"改个错字整树重生成"的灾难
 *
 * 数据形态：扁平有序数组 + parentId 形成树（最多三层：act → beat → moment）。
 */
export interface OutlineNode {
  id: string
  /** 父节点 id；顶级节点 = undefined（act 层） */
  parentId?: string
  /** 标题，作者编辑用，如"第二幕：雨夜抉择" */
  title: string
  /** 一句话 / 多句梗概 */
  summary?: string
  /** 同级排序 */
  order: number
}

/**
 * 影游工坊「模块」中枢里可独立开关的模块 id —— v7 新增。
 *
 * 与 shellStore.ImageSection 的取值刻意保持一致(同一批模块的两种视角:
 *   ImageSection = 边栏路由 / 内容区渲染哪个面板;
 *   ModuleId     = scenario.modules 里该模块是否启用)。
 */
export type ModuleId =
  | 'style'
  | 'director'
  | 'refs'
  | 'ui'
  | 'minigame'
  | 'numeric'
  | 'inventory'
  /** 全屏页面系统(v11)：真背包 / 游戏化主界面 / 开宝箱 / 搜刮页等整页 UI + 玩法。 */
  | 'uiScreen'

export interface Scenario {
  id: string
  title: string
  /** 作者描述，存档里给玩家看的简介 */
  synopsis?: string
  rootSceneId: string
  scenes: Record<string, Scene>
  /** 全局打字机默认速度（ms / 字符） */
  defaultCharMs: number
  /**
   * 编辑器版本（升级时做迁移用）。
   * v1 = 初版；
   * v2 = 加入 locations[] + Character.turnaroundRefImageId + Scene.locationId；
   * v3 = 加入 Scene.background + Scene.shots[] + Scene.keyShotId（分镜化）。
   * v4 = 加入 Episode[] + Scene.episodeId（分剧集化）。
   * v5 = 加入 outline[] + characterRelations[]（小说家工作板）。
   * v6 = 加入 variables{} + Branch.condition/effects/gateMode + Scene.onEnterEffects（数值系统）。
   * 读入时按版本链式升级（migrateScenarioToLatest 负责）。
   */
  schemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11

  /**
   * 模块开关 —— v7 新增。
   *
   * 影游工坊「模块」中枢里各模块的独立启用状态(美术/导演/参考图/界面/小游戏/数值/背包)。
   * 缺省 / 字段不存在 = 沿用旧行为(视为启用),保证旧数据零回归;只有作者显式关掉时
   * 才会在生产/运行时跳过该模块。读写统一走 `scenario/moduleFlags.ts`。
   */
  modules?: Partial<Record<ModuleId, boolean>>

  /**
   * 数值 / 变量注册表 —— v6 新增。
   *
   * 好感度 / 积分 / flag 等全局状态，用于分支 condition 解锁。
   * 缺失 / 空对象 = 没有数值系统（旧数据默认）。
   */
  variables?: Record<string, GameVariable>
  /**
   * 背包物品注册表 —— v7 新增（背包系统）。
   * 缺失 / 空对象 = 没有背包系统（旧数据默认）。
   */
  items?: Record<string, InventoryItem>
  /** 角色库（一致性锚点；refImageId 指向 mediaStore 里的固化参考图） */
  characters?: Record<string, Character>
  /** 场所库 —— v2 新增；scene.locationId 引用这里 */
  locations?: Record<string, Location>
  /** 关键道具库 —— v3.7 新增；剧本锻造时 LLM 抽取"重复出现的具名物品" */
  props?: Record<string, Prop>
  /**
   * 3D 相机调度 blockout 注册表 —— 2026-06 新增（共享，便于跨场景复用）。
   * `Scene.blockoutRef` 引用这里的 id。
   */
  blockouts?: Record<string, Blockout>
  /**
   * 剧集列表 —— v4 新增（分剧集化）。
   *
   * 缺失 / 空数组 = 旧数据单集模式（迁移时自动生成一个默认集 ep-default）。
   * 有序数组，order 字段决定显示顺序，作者可拖拽重排。
   */
  episodes?: Episode[]
  /** 全局 UI 视觉风格 —— 喂给生图模型当 prefix；保证按钮/字幕条/QTE icon 风格统一 */
  uiStyle?: UIStyle
  /**
   * UI 素材库 —— v9 新增。影游叠加式 UI 覆盖层的全局资产注册表(好感度飘字 / 姓名条 /
   * 血条 / 技能框……)。素材可拖入某场时间轴当瞬时/单场叠层,或绑成常驻 HUD。
   * 缺失 / 空对象 = 没有自定义 UI 素材(旧数据默认)。
   */
  uiAssets?: Record<string, UIAsset>
  /**
   * 常驻 HUD 绑定层 —— v9 新增(Tier C)。跨场景、随状态显隐、可绑数值实时更新的
   * UI 元素(血条 / 技能框)。由 Player 顶层 HudLayer 渲染,独立于单场时间轴。
   * 缺失 / 空数组 = 无常驻 HUD(旧数据默认,播放器保持零常驻 HUD 行为)。
   */
  hud?: HudElement[]
  /**
   * 剧情树主题 —— v10 新增。游戏内剧情树(BranchTreeOverlay)的 per-scenario 皮肤:
   * 节点框 / 背景图 / 连线风格(中式/卡通/科幻/默认) + 章节/关卡选择导航配置。
   * 缺失 = 回落播放器内置深色样式(向后兼容)。节点框/背景走 uiAssets 生成管线。
   */
  treeTheme?: TreeTheme
  /**
   * 全屏 UI 页面注册表 —— v11 新增。仿深度互动影游的整页 UI(真背包 / 主菜单 /
   * 开宝箱 / 搜刮页 / 自定义)。由 Player 顶层 ScreenOverlay 渲染,菜单或时间轴触发。
   * 缺失 / 空对象 = 无全屏页面(旧数据默认)。
   */
  uiScreens?: Record<string, UIScreen>
  /**
   * 全局"美术风格"—— 影响**所有**素材生成（场景图 / 角色立绘 / 参考图 / 批量生图）。
   * 与 uiStyle 的区别：uiStyle 约束 UI 外观（按钮/字幕），visualStyle 约束"画面内容"。
   * 作者在 Forge Tab 顶栏选一次即可；缺省视为 photoreal。
   * 修改后**不追溯旧图**，只影响之后新生成的图像。
   */
  visualStyle?: VisualStyle
  /**
   * 全局"电影美学调色"—— 与 visualStyle(渲染媒介) 正交的第二维度，二者叠加。
   * 决定全片的色板/对比/胶片质感/高光阴影染色（例：visualStyle=写实 + filmLook=蒂尔橙）。
   * 作者在「风格」模块选择；缺省=不加调色（保持媒介自身色彩）。修改不追溯旧图。
   */
  filmLook?: FilmLook
  /** 图像视图预选的小游戏池 id 列表；剧情树剪辑时据此过滤可选小游戏 */
  enabledMinigameIds?: string[]
  /** 视频模型 API 配置（运行时从 settingsStore 读默认，可在剧本里重写） */
  videoConfig?: VideoConfig
  /** 作者最初输入的"想法"——用作下次"再生成更多场景"的上下文 */
  originIdea?: string
  /**
   * 剧情大纲节点 —— v5 新增（小说家工作板）。
   *
   * 扁平数组 + parentId 形成树。作者层面的纲领，独立于 scenes 编辑，
   * 可先打大纲再 chat 触发 `/expand` 扩写为 scenes。修改大纲不会自动
   * 同步 scenes —— 由作者点"⟳ 据此更新后续"显式触发。
   */
  outline?: OutlineNode[]
  /**
   * 角色关系图 —— v5 新增（小说家工作板）。
   *
   * 单向边数组 (fromCharId → toCharId, label)。LLM 锻造剧本末段会
   * 顺带产出，作者也可手动增删改。展示在 ForgeStudio 左侧"人物关系" tab。
   */
  characterRelations?: CharacterRelation[]
  /**
   * 导演 agent 流派 —— v3.8 新增。
   *
   * 决定 storyboard-director / kinetic-video-prompt 两个 skill 注入哪一套 persona。
   * 流派 id 为原创命名（版权安全，不含真名）：
   *   'foreknowledge-suspense' 先知悬疑（主观镜/延迟揭示/声音先于画面）
   *   'precision-noir'         冷峻黑色（低饱和/长特写/精确时钟式剪辑）
   *   'minimal-epic'           极简史诗（超广角建立镜/静缓推进/极简剪辑）
   *   'mood-neon'              情绪浮光（手持抽帧/浅景深/霓虹染色/独白叠加）
   *   'luminous-anime'         高光日漫（逆光云层/三秒一景/轻音乐节拍）
   *   'kinetic-clarity'        清晰动能（黄金三角/甩镜/子弹时间但保持可读）
   *   'cyberpunk-neonoir'      赛博霓虹 · 都市雨夜（拉丝光流/FPV 穿越/手持抖）
   *   'unseen-horror'          过程恐怖（延迟惊吓/声音诱导/看不见更可怕）
   *   'nonlinear-scifi'        非线性科幻（交叉剪辑/并行时空/结构叙事）
   *   'pulp-dialogue'          断章对话（长局对话铺垫/暴力一瞬速决）
   *   'custom'                 作者自填 persona（自由文本，凌驾预设）
   *
   * 缺省 = 'minimal-epic'（审美稳、电影感强、对新手友好）。
   */
  directorStyle?: DirectorStyleId
  /**
   * 自定义导演 persona 文本 —— directorStyle='custom' 时读取。
   * 500 字以内；注入为"额外 persona"段落，覆盖所有预设流派的默认描述。
   */
  directorCustomPersona?: string
}

// ============================================================================
// 运行时状态（玩家会话）
// ============================================================================

export interface PlayerSessionState {
  scenarioId: string
  currentSceneId: string
  startedAt: number
  /** 当前 scene 内已经流逝的 ms */
  elapsedMs: number
  /** 累计分数（QTE） */
  totalScore: number
  /** 已经走过的分支选择（按时间序） */
  history: { sceneId: string; branchId: string }[]
}

// ============================================================================
// 编辑器视图 / 模式
// ============================================================================

export type StudioMode = 'editor' | 'player'

export type StudioPanel = 'scenes' | 'assets' | 'forge'
