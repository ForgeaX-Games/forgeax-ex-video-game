/**
 * 材料时间轴 —— 视频 tab 与剧情树抽屉共享的时间轴层的纯工具 + 类型 + 常量。
 *
 * 这里只放**无 React / 无 DOM 副作用**的东西：材料模型、轨道/缩放几何、刻度生成、
 * 分类样式映射。`<MaterialTimeline>`（渲染 + 交互）与 `CatalogTabs`（收集材料 +
 * patch 回写 scenario）都从这里取，避免两处各持一份定义漂移，也避免组件与其宿主
 * 互相 import 造成的循环依赖。
 */

/**
 * 时间轴材料种类 —— 主要用于「添加控件」图标槽与条带配色。
 * 未落入默认六槽的挂载组件一律用 `component`（默认图标），时间轴仍会显示。
 * `mount` = 挂载级条目（蓝图节点配置面板专用，一份挂载一条；不出现在视频 tab 的 child 级时间轴）。
 */
export type MaterialKind = 'video' | 'subtitle' | 'overlay' | 'qte' | 'option' | 'filter' | 'fx' | 'component' | 'mount'

/** 自计时飘字在时间轴上的固定展示宽度；只表达触发时刻，不表达组件内部动画时长。 */
export const FLOAT_TEXT_TIMELINE_WIDTH_PX = 120

/** 时间轴上的一段材料（由 scene 派生，见 CatalogTabs.collectMaterials）。 */
export interface MaterialItem {
  key: string
  id: string
  kind: MaterialKind
  label: string
  startMs: number
  endMs: number
  zIndex: number
  /** 只读轨道（如节点视频）：可点击定位播放头，但不可移动、裁剪、删除或选入组件检视器。 */
  locked?: boolean
  /** 固定像素宽度的触发型条目；存在时不可从时间轴拉伸，动画时长由组件内部配置控制。 */
  fixedWidthPx?: number
  /** 落盘 OverlayChild.component（含皮肤 alias）；检视器 / 添加通用组件用。 */
  componentId?: string
  /** 段内的一个「判定点」标记（当前仅 QTE 用：= cue.targetAt 计分锚点）；缺省无标记。 */
  markerMs?: number
  /**
   * 该素材所在的组件已脱离共享方案跟随（挂载上有它的 override / 新增）。
   * 未标记 = 仍跟随方案，改方案会同步；标记后可在素材属性里「↺ 回连方案」。
   */
  overridden?: boolean
  /**
   * 视频条帧画面地址（剪映同款 Filmstrip）。
   * 优先于 `MaterialTimeline` 的统一 `videoSrc`；Flow 多段预览用它按片段各自抽帧。
   */
  videoSrc?: string
}

/**
 * 音频时间轴上的一段音轨（当前仅**显示 + 拖动**，不做实际音频编辑）。
 * 素材自带音轨（视频内嵌声）默认落在第 0 轨、`builtin: true`。
 */
export interface AudioItem {
  key: string
  label: string
  startMs: number
  endMs: number
  zIndex: number
  /** 音源 URL（用于时间轴波形解码）；缺省则只画底纹条。 */
  src?: string
  /** 素材自带音轨（视频内嵌声道）；仅显示用途，暂不可删。 */
  builtin?: boolean
}

/**
 * 时间轴上的一个**节点级时刻点**（不是材料）——「这一刻会发生一件事」。
 *
 * 与 `MaterialItem.markerMs` 的分工：那个是某段材料**内部**的判定锚点（QTE 计分点），跟着材料
 * 走；这里的是节点自己的时刻（延迟事件边的结算点、生命周期效果的施加时刻），不属于任何材料，
 * 因而不需要 zIndex / 轨道 / 选中态。混进材料流会被迫伪造这些属性。
 */
export interface TimelinePointMarker {
  /** 稳定 id：拖拽回写时用它定位（如 `settlement` / `life:3`）。 */
  id: string
  ms: number
  /** 决定配色与提示语气；样式见 MaterialTimeline 的 `.gc-point-mark` 系列。 */
  kind: 'settlement' | 'lifecycle' | 'derived'
  /** 悬浮提示里的一句话（含时刻由组件自己拼）。 */
  label: string
  /** 缺省可拖；派生自界面窗口的空心菱形不可直接改时间。 */
  draggable?: boolean
}

/** 无固定时间坐标的结算条件；每个条件在时间轴上独占一轨（行结构：↻ 条件 chips → 动作 chips）。 */
export interface TimelineConditionMarker {
  id: string
  /** 完整文案（title / 无障碍名），由条件侧 + 动作侧拼接。 */
  label: string
  /** 条件侧分段 chips（如 [分数, 增加] / [满足 2 项条件]）。 */
  conditionChips: string[]
  /** 动作侧分段 chips（效果 / 绑定界面 / 推进各一段）。 */
  actionChips: string[]
}

/**
 * 结算**绑定界面**（某结算 `do` 内的一个 `spawn`）在时间轴上的投影；不落盘。
 *
 * 与 `MaterialItem` 的分工：材料条可自由拖 start / end / 换轨；绑定界面的起始恒等于宿主结算
 * 时刻、行号由装箱派生，只有结束（= `ttlMs`）可编辑。混进材料流会被迫伪造 zIndex / locked。
 */
export interface TimelineSpawnBar {
  /** 稳定 id：`settlement-spawn:${settlementIndex}:${actionIndex}`；与预览画布投影同串。 */
  id: string
  label: string
  /** 恒等于宿主结算的 `when.ms`，不可单独编辑。 */
  startMs: number
  /** 有 `ttlMs` 时 = startMs + ttlMs；常驻时 = 节点末端。 */
  endMs: number
  /** 常驻（无 `ttlMs`）：右端画开口，拖动即就地转成按时长隐藏。 */
  openEnded: boolean
  /** 组内行号，0 = 最靠近菱形轨的一行。 */
  rowInGroup: number
}

/** 同一结算点下的绑定界面组；虚线框覆盖组内全部行 × [startMs, endMs]。 */
export interface TimelineSpawnGroup {
  /** = 宿主菱形标记 id（`life:${settlementIndex}`），点选时复用既有 focus 联动。 */
  markerId: string
  settlementIndex: number
  startMs: number
  endMs: number
  /** 自菱形轨向上数的起始行，从 1 开始；绝对轨号由渲染层换算。 */
  uBase: number
  bars: TimelineSpawnBar[]
}

/** 界面组占用的最高相对行；渲染层据此把菱形轨整体下移让出空间。 */
export function spawnGroupsMaxRow(groups: readonly TimelineSpawnGroup[]): number {
  return groups.reduce((mx, g) => Math.max(mx, g.uBase + g.bars.length - 1), 0)
}

/** 相对行（自菱形轨向上数）→ 绝对轨号。 */
export function spawnBarTrack(lifecycleTrack: number, uBase: number, rowInGroup: number): number {
  return lifecycleTrack - (uBase + rowInGroup)
}

/** 全流程预览在同一时间轴上展示的节点片段；仅为编辑器内存投影，不进入蓝图协议。 */
export interface TimelineSegment {
  id: string
  label: string
  startMs: number
  endMs: number
  active?: boolean
}

export const TIMELINE_RULER_H = 24
export const TIMELINE_LAYER_TOP = 34
export const TIMELINE_LAYER_STEP = 34
// 存储硬上限（防脏数据爆表）；可见轨数是「无限」的，由数据 + 一条空投放轨动态派生。
export const TIMELINE_MAX_LAYER = 15
// 默认可见轨数（0..MIN-1）；更多轨道由固定高度视口纵向滚动查看。
export const TIMELINE_MIN_TRACKS = 6
export const ZOOM_MIN = 1
export const ZOOM_MAX = 5
/** 缩放步进（±按钮 / 滑轨吸附粒度）。 */
export const ZOOM_STEP = 0.2

/** 滚动条量级：视口宽在此幅度内来回跳，判为滚动条显隐引起的自激振荡而非真实布局变化。 */
export const SCROLLBAR_JITTER_PX = 24

/**
 * 视口宽度闩锁状态。
 *
 * 画布宽由视口 `clientWidth` 派生，而滚动条显隐又会改 `clientWidth`，天然成环：
 * 画布变宽 → 出横向滚动条 → 内高变矮 → 出纵向滚动条 → clientWidth 变窄 → 画布变窄 → …
 * 每帧抽动一次，还会让视频条帧画面位图反复重建。
 *
 * 不用 `scrollbar-gutter: stable` 切环：常驻沟槽会破坏设计稿的时间轴观感。改在这里闩住——
 * 一旦观察到「按滚动条量级变窄」，就记住那个更宽的值；它再次出现时不再采用，环在一个来回内收敛。
 */
export interface ViewportWidthLatch {
  /** 当前采用的视口宽。 */
  width: number
  /** 被判为滚动条抖动而压住的更宽值；再次量到同一值时忽略。 */
  suppressed: number | null
}

export function initialViewportWidthLatch(): ViewportWidthLatch {
  return { width: 0, suppressed: null }
}

/** 收到一次测量：返回新的闩锁状态（无变化时返回原对象，避免多余渲染）。 */
export function latchViewportWidth(state: ViewportWidthLatch, measured: number): ViewportWidthLatch {
  if (measured === state.width) return state
  const delta = measured - state.width
  // 真实布局变化（拖分栏 / 窗口缩放）：直接采用并清掉旧怀疑对象。
  if (Math.abs(delta) > SCROLLBAR_JITTER_PX) return { width: measured, suppressed: null }
  // 已被压住的宽度再次出现 = 正在来回抖，维持窄值（它不会再触发横向滚动条）。
  if (measured === state.suppressed) return state
  // 按滚动条量级变窄：采用窄值，并记住刚才那个更宽的值。
  if (delta < 0) return { width: measured, suppressed: state.width }
  // 首次按滚动条量级变宽：可能是真实变化，先采用；若随后又缩回来就会被上面两条收敛。
  return { width: measured, suppressed: state.suppressed }
}

/** 前端时间输入分度：0.01 秒（底层仍存毫秒）。 */
export const TIME_STEP_SEC = 0.01
/** 结算菱形与 2px 播放头之间的最小中心距：覆盖菱形半宽、播放头半宽和少量视觉间隙。 */
export const TIMELINE_SETTLEMENT_CLEARANCE_PX = 14

/**
 * 根据当前时间轴比例，把结算点放到播放头左侧一个不会重叠的像素距离。
 * 时间结果向上取到 10ms 网格，避免取整后视觉间距反而小于目标；起点左侧空间不足时
 * 改放到播放头右侧同等距离，既不产生负数，也不让 0ms 附近重新重叠。
 */
export function settlementInsertMsBeforePlayhead(
  playheadMs: number,
  maxMs: number,
  canvasPx: number,
): number {
  if (!(maxMs > 0)) return 0
  const currentMs = clampMs(playheadMs, 0, maxMs)
  if (!(canvasPx > 0)) return currentMs
  const stepMs = TIME_STEP_SEC * 1000
  const clearanceMs = Math.ceil((TIMELINE_SETTLEMENT_CLEARANCE_PX * maxMs / canvasPx) / stepMs) * stepMs
  const beforeMs = currentMs - clearanceMs
  return beforeMs >= 0
    ? clampMs(beforeMs, 0, maxMs)
    : clampMs(currentMs + clearanceMs, 0, maxMs)
}

export function msToSec(ms: number): number {
  return Math.round(ms) / 1000
}

/** 秒 → 毫秒（四舍五入到整数 ms）。 */
export function secToMs(sec: number): number {
  if (!Number.isFinite(sec)) return 0
  return Math.round(sec * 1000)
}

/** m:ss.cc（秒保留两位小数）。 */
export function fmtDur(ms: number): string {
  const totalSec = Math.max(0, ms) / 1000
  const m = Math.floor(totalSec / 60)
  const s = totalSec - m * 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}

/** ruler 时刻标签（Figma 15635:85018）：`mm:ss` 双双补零；亚秒刻度加一位小数（`00:00.5`）。 */
export function fmtTickClock(ms: number): string {
  const totalSec = Math.max(0, ms) / 1000
  const m = Math.floor(totalSec / 60)
  const s = totalSec - m * 60
  const ss = Number.isInteger(s) ? String(s).padStart(2, '0') : s.toFixed(1).padStart(4, '0')
  return `${String(m).padStart(2, '0')}:${ss}`
}

export function clampMs(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(max, Math.round(v)))
}

export function clampLayer(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(TIMELINE_MAX_LAYER, Math.round(v)))
}

export function clampZoom(v: number): number {
  if (!Number.isFinite(v)) return ZOOM_MIN
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v))
}

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}

export function normalizeLayer(v: number | undefined, fallback: number): number {
  if (v == null) return fallback
  // 兼容更早的 10/20/30 档位默认值（仅精确的整十值才当旧格式，避免误伤高轨号）。
  if (v === 10 || v === 20 || v === 30 || v === 40) return clampLayer(v / 10 - 1)
  return clampLayer(v)
}

export function layerFromPointerY(clientY: number, rect: DOMRect, maxLayer: number): number {
  const y = clientY - rect.top - TIMELINE_RULER_H
  const raw = Math.round((y - (TIMELINE_LAYER_TOP - TIMELINE_RULER_H)) / TIMELINE_LAYER_STEP)
  return Math.max(0, Math.min(maxLayer, raw))
}

export function layerTop(zIndex: number): number {
  return TIMELINE_LAYER_TOP + Math.max(0, zIndex) * TIMELINE_LAYER_STEP
}

/** ruler 刻度：按缩放挑一个「整」间隔，保证相邻刻度像素间距足够读。 */
export function buildMaterialTicks(maxMs: number, pxPerMs: number): Array<{ ms: number; label: string }> {
  if (!(pxPerMs > 0) || !(maxMs > 0)) return []
  const targetPx = 84
  const rawMs = targetPx / pxPerMs
  const nice = [100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000]
  const step = nice.find((n) => n >= rawMs) ?? 120000
  const out: Array<{ ms: number; label: string }> = []
  for (let t = 0; t <= maxMs + 1; t += step) out.push({ ms: t, label: fmtTickClock(t) })
  return out
}

export function materialLabel(kind: MaterialKind): string {
  switch (kind) {
    case 'video':
      return '视频'
    case 'subtitle':
      return '字幕'
    case 'overlay':
      return '飘字'
    case 'qte':
      return 'QTE 按键点'
    case 'option':
      return '选项'
    case 'filter':
      return '滤镜'
    case 'fx':
      return '特效'
    case 'component':
      return '组件'
    case 'mount':
      return '界面'
  }
}

export function materialDisplayLabel(item: Pick<MaterialItem, 'kind' | 'key'>): string {
  return materialLabel(item.kind)
}

/**
 * 该材料能否从时间轴直接删除。
 * 可删：字幕 / 结算飘字 / QTE 按键点（各自是独立子项）。
 * 选项：删「整条选项交互」= 抹掉 scene.choice + choice 分支，节点回落为叙事并自动续连到
 *   第一个选项原本的目标（applyMaterialDelete 处理）；因是破坏式改连接，删除前需二次确认。
 * QTE：删最后一个 QTE 按键点 = 删「整段 QTE 交互」（抹掉 scene.qte + qte_pass/qte_fail 分支，
 *   节点回落为叙事并自动续连到「通过 QTE」原目标，破坏式改连接需二次确认，
 *   在 applyMaterialDelete / confirmMaterialDelete 里判定）。
 */
export function canDeleteMaterial(kind: MaterialKind): boolean {
  return (
    kind === 'subtitle' ||
    kind === 'overlay' ||
    kind === 'qte' ||
    kind === 'option' ||
    kind === 'filter' ||
    kind === 'fx' ||
    kind === 'component' ||
    kind === 'mount'
  )
}

export function materialClass(kind: MaterialKind): string {
  switch (kind) {
    case 'video':
      return 'is-video'
    case 'subtitle':
      return 'is-subtitle'
    case 'overlay':
      return 'is-overlay'
    case 'qte':
      return 'is-qte'
    case 'option':
      return 'is-option'
    case 'filter':
      return 'is-filter'
    case 'fx':
      return 'is-fx'
    case 'component':
      return 'is-component'
    case 'mount':
      return 'is-mount'
  }
}
