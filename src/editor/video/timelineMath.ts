/**
 * 时间轴拖拽 —— 纯数学工具
 *
 * 设计原则：
 *   - 全部是 *纯* 函数（无 DOM、无 React、无副作用）
 *   - 所有距离换算都基于「线性比例」：deltaPx / trackWidth = deltaMs / totalMs
 *   - 防御异常输入：除 0、负宽、NaN 都返回安全值，不抛异常
 *
 * 这些是阶段 C 拖拽链路的最低层；高层 hook（useTimelineDrag）和领域 patch
 * 函数（dialogueDrag/cueDrag/branchDrag）都建立在这之上。
 */

/**
 * 把屏幕像素差转成毫秒差。
 *
 * 公式：deltaMs = deltaPx * totalMs / trackWidthPx
 *
 * @param deltaPx 像素位移（带符号；正 = 向右，负 = 向左）
 * @param totalMs 整条轨道代表的总毫秒数（即 scene.durationMs）
 * @param trackWidthPx 轨道渲染宽度（即 .ks-timeline-tracks 的 clientWidth）
 * @returns 对应的毫秒差，未取整
 */
export function pxToMs(
  deltaPx: number,
  totalMs: number,
  trackWidthPx: number,
): number {
  if (!Number.isFinite(deltaPx) || !Number.isFinite(totalMs) || !Number.isFinite(trackWidthPx)) return 0
  if (totalMs <= 0 || trackWidthPx <= 0) return 0
  return (deltaPx * totalMs) / trackWidthPx
}

/**
 * pxToMs 的逆运算 —— 把毫秒差转成像素差，给"画拖拽预览"用。
 *
 * 公式：deltaPx = deltaMs * trackWidthPx / totalMs
 */
export function msToPx(
  deltaMs: number,
  totalMs: number,
  trackWidthPx: number,
): number {
  if (!Number.isFinite(deltaMs) || !Number.isFinite(totalMs) || !Number.isFinite(trackWidthPx)) return 0
  if (totalMs <= 0 || trackWidthPx <= 0) return 0
  return (deltaMs * trackWidthPx) / totalMs
}

/**
 * 把毫秒值约束到 [min, max] 区间。
 *
 *   - 值 < min → 返回 min
 *   - 值 > max → 返回 max
 *   - NaN → 返回 min（避免拖拽产物里漏出 NaN 污染数据）
 *   - min > max（参数错位）→ 退回 min，不抛异常
 */
export function clampMs(ms: number, min: number, max: number): number {
  if (Number.isNaN(ms)) return min
  if (min > max) return min
  if (ms < min) return min
  if (ms > max) return max
  return ms
}

/**
 * 把毫秒值吸附到指定网格。
 *
 *   - gridMs <= 0 / undefined → 不吸附，原样返回
 *   - 半网格点采用 `Math.round` 半进位（0.5 → 1）
 *   - 支持负数（保持符号）
 */
export function snapMs(ms: number, gridMs: number | undefined): number {
  if (gridMs === undefined || gridMs <= 0 || !Number.isFinite(gridMs)) return ms
  // Math.round 对负数是「向 +∞」，与正数行为不一致；
  // 这里用 sign + abs 让正负行为对称。
  const sign = ms < 0 ? -1 : 1
  const abs = Math.abs(ms)
  return sign * Math.round(abs / gridMs) * gridMs
}

/**
 * 修饰键 → 吸附粒度（对齐前端 0.01 秒分度）。
 *
 * 默认 10ms（0.01s）；
 * Shift = 10ms（同默认，精细）；
 * Alt = 100ms（0.1s 粗调）。
 *
 * Shift 优先于 Alt（同时按下时取 Shift）。
 */
export interface SnapModifiers {
  shift: boolean
  alt: boolean
}

export function resolveSnapGridMs(mods: SnapModifiers): number {
  if (mods.shift) return 10
  if (mods.alt) return 100
  return 10
}
