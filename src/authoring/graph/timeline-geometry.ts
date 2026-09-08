/**
 * 时间几何 —— 把 Overlay child 的 trigger/window 折算成时间轴上的 [startMs, endMs]，
 * 以及结算绑定界面（spawn）的显示时长夹取。
 */
import type { GameNode } from '@/runtime/core/schema/graph-schema'
import type { OverlayChild, OverlayInstanceChild } from '@/runtime/core/schema/node-config-schema'

export function elementStartMs(el: OverlayInstanceChild): number {
  if (el.window?.startMs != null) return el.window.startMs
  if (el.trigger.when === 'at') return el.trigger.ms
  return 0
}

export function elementEndMs(el: OverlayInstanceChild, start = elementStartMs(el)): number {
  if (el.window?.endMs != null) return el.window.endMs
  return start + 1000
}

export function isElementActiveAt(el: OverlayInstanceChild, cursorMs: number): boolean {
  const a = elementStartMs(el)
  const b = elementEndMs(el, a)
  return cursorMs >= a && cursorMs < b
}

export function withElementStart(el: OverlayInstanceChild, nextStart: number): OverlayInstanceChild {
  const end = elementEndMs(el)
  const start = Math.max(0, nextStart)
  if (el.trigger.when === 'at') {
    return { ...el, trigger: { when: 'at', ms: start }, window: el.window ? { ...el.window, startMs: start } : { startMs: start, endMs: end } }
  }
  return { ...el, window: { startMs: start, endMs: Math.max(start + 1, end) } }
}

export function withElementEnd(el: OverlayInstanceChild, nextEnd: number): OverlayInstanceChild {
  const start = elementStartMs(el)
  return { ...el, window: { startMs: start, endMs: Math.max(start + 1, nextEnd) } }
}

export function withElementZIndex(el: OverlayInstanceChild, zIndex: number): OverlayInstanceChild {
  return { ...el, layout: { ...el.layout, zIndex } }
}

export function elementZIndex(el: OverlayInstanceChild): number {
  return el.layout?.zIndex ?? 0
}

/**
 * 模板没声明可见长度时，结算绑定界面的初始显示时长。
 * 只此一处定义：作者面各入口都读它，避免不同入口给出不同的"默认"。
 */
export const DEFAULT_SPAWN_TTL_MS = 2500

/**
 * 模板自己声明的可见长度 —— 结算绑定界面的初始「显示时长」优先取它。
 *
 * `window` 是界面显隐的唯一 SSOT（见 builtin-schemes 的预设注释）：写了 `endMs` 才有确定长度。
 * 不写 `endMs` 时这里返回 undefined（忠实反映「模板没说」），由调用方决定兜底——当前作者面
 * 兜底成一个确定时长而非常驻，理由见 `NodeActionsEditor.initialSpawnTtlMs`。
 */
export function spawnTemplateTtlMs(child: OverlayChild): number | undefined {
  const end = child.window?.endMs
  if (end == null) return undefined
  const start = child.window?.startMs ?? (child.trigger?.when === 'at' ? child.trigger.ms : 0)
  const span = Math.round(end - start)
  return span > 0 ? span : undefined
}

/** 本节点演出时长（ms）；缺省给一个安全上限，避免 spawn 无界。 */
export function nodePlayDurationMs(node: GameNode): number {
  const d = node.data.durationMs
  return typeof d === 'number' && Number.isFinite(d) && d > 0 ? Math.round(d) : 60_000
}

/** 本版：spawn 不跨节点——ttl 夹在 (0, nodeDur]；缺省/0 = 撑到本节点结束。 */
export function clampSettlementSpawnTtlMs(ttlMs: number | undefined, nodeDurMs: number): number {
  const cap = Math.max(100, Math.round(nodeDurMs))
  if (ttlMs == null || !Number.isFinite(ttlMs) || ttlMs <= 0) return cap
  return Math.min(Math.max(100, Math.round(ttlMs)), cap)
}
