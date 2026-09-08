/**
 * Flow 预览时间轴：播放头跟随 vs 用户横滚浏览（业界剪辑软件同款 latch）。
 *
 * - 默认 soft follow：仅当 playhead 靠近/越出视口边距时才改 scrollLeft
 * - 用户手动滚动后脱钩；继续播放 / 重开 / seek 再挂钩
 * - 脱钩后若闲置超过 {@link FLOW_FOLLOW_IDLE_REATTACH_MS}，自动重新挂钩
 * - paused / ended 时永不跟滚（仍可更新 playhead 样式，由调用方决定）
 */

/** 手动横滚脱钩后，无继续滚动操作则自动恢复跟随的闲置时长。 */
export const FLOW_FOLLOW_IDLE_REATTACH_MS = 5_000

export interface FlowScrollFollowGate {
  followEnabled: boolean
  scrubbing: boolean
  paused: boolean
  phase: string
}

/** 是否允许程序改写横向 scrollLeft。 */
export function shouldFollowPlayheadScroll(gate: FlowScrollFollowGate): boolean {
  return gate.followEnabled
    && !gate.scrubbing
    && !gate.paused
    && gate.phase !== 'ended'
}

export interface SoftFollowScrollInput {
  playheadX: number
  viewportWidth: number
  scrollLeft: number
  /** playhead 退到视口左侧这个比例以内时重新拉回。默认 0.1。 */
  edgePaddingRatio?: number
  /** 跟随线：playhead 越过视口内这个相对位置后，画布连续跟滚把它钉在此处。默认 0.7。 */
  targetRatio?: number
}

/**
 * 计算跟随滚动的目标 scrollLeft。
 *
 * 分三段（业界剪辑软件的 smooth scroll，而不是每次越界跳一屏）：
 *   1. playhead 未到跟随线 → 不动滚动，让它自己往右走
 *   2. 越过跟随线 → 每帧连续把它钉在跟随线上（视觉上画布匀速左移，无跳跃）
 *   3. 落到视口左边距之外（seek 回退 / 重开）→ 直接拉回跟随线
 *
 * 返回 `null` 表示不要改滚动。
 */
export function nextSoftFollowScrollLeft(input: SoftFollowScrollInput): number | null {
  const viewportWidth = Math.max(0, input.viewportWidth)
  if (!(viewportWidth > 0)) return null
  const followLine = viewportWidth * (input.targetRatio ?? 0.7)
  const leftPad = viewportWidth * (input.edgePaddingRatio ?? 0.1)
  const x = input.playheadX
  const scrollLeft = input.scrollLeft
  if (x >= scrollLeft + followLine) return Math.max(0, x - followLine)
  if (x < scrollLeft + leftPad) return Math.max(0, x - followLine)
  return null
}

/**
 * 脱钩判定只认**真实用户输入**，不看 `scroll` 事件。
 *
 * 走过的两条弯路：
 *   1. 「程序写入中」布尔窗口 —— 连续跟滚每帧都写 scrollLeft，窗口一直开着，用户永远脱不了钩；
 *   2. 比对上次写入回读值 —— 浏览器的滚动锚定（内容增长 / 帧图加载）会自行微调 scrollLeft，
 *      发出对不上号的 scroll 事件，于是每跨节点就误脱钩。
 * 输入事件没有这两类歧义。
 */
export interface WheelIntentLike {
  deltaX: number
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

/**
 * 该滚轮事件是否表达「横向浏览」意图。
 * 纯纵向滚轮 = 看轨道，不该打断横向跟随（业界剪辑软件同款）。
 */
export function isHorizontalWheelIntent(event: WheelIntentLike): boolean {
  return event.deltaX !== 0 || event.shiftKey || event.ctrlKey || event.metaKey
}

const HORIZONTAL_NAV_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
])

/** 该按键是否会横向移动视口。 */
export function isHorizontalNavKey(key: string): boolean {
  return HORIZONTAL_NAV_KEYS.has(key)
}

export interface FollowIdleReattach {
  /** 用户手动横滚：立即脱钩，并（重新）开始闲置计时。 */
  noteUserScroll: () => void
  /** 显式挂钩或卸载：清掉闲置计时。 */
  cancel: () => void
}

/**
 * 脱钩后的闲置自动重新挂钩控制器。
 * `onDetach` / `onReattach` 由宿主写入 follow 开关。
 */
export function createFollowIdleReattach(options: {
  onDetach: () => void
  onReattach: () => void
  idleMs?: number
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clear?: (id: ReturnType<typeof setTimeout>) => void
}): FollowIdleReattach {
  const idleMs = options.idleMs ?? FLOW_FOLLOW_IDLE_REATTACH_MS
  const schedule = options.schedule ?? setTimeout
  const clear = options.clear ?? clearTimeout
  let timer: ReturnType<typeof setTimeout> | null = null

  const cancel = (): void => {
    if (timer == null) return
    clear(timer)
    timer = null
  }

  return {
    noteUserScroll: () => {
      options.onDetach()
      cancel()
      timer = schedule(() => {
        timer = null
        options.onReattach()
      }, idleMs)
    },
    cancel,
  }
}
