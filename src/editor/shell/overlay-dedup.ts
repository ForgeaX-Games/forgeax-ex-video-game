/**
 * overlay-dedup —— 界面方案「内容去重」的纯派生逻辑（无 React，可测）。
 *
 * 判等**不看 id/title**，只看 overlay 的内容——每个 `OverlayChild` 的 `component` + 归一
 * `layout` + 归一 `inputs`；`trigger` / `window` / `note` / `id` 不参与（换位/换名不影响
 * 「这块界面长什么样」）。children 顺序无关（各 child 签名排序后拼接）。
 *
 * 用途：界面tab（GraphConfigView）三类方案（自定义 `scheme-*` / 内置 / 基础 `base:*`）都住在
 * 同一个 `scenario.ui.overlays` 目录，`base:*` 自动生成、用户又能手搓，极易出现「内容等价、
 * id 不同」的重复。这里只**发现并标记**（§8 人为最终权威：不自动删、不合并）。
 *
 * §2 Derive：重复关系纯从 overlays 目录派生，不落盘、不加 schema 字段。
 */
import type { Layout, Overlay, OverlayChild } from '@/runtime/core/schema/graph-schema'

/** `Layout` 的全部可声明字段（node-config-schema.ts `Layout` 的 SSOT 镜像）。 */
const LAYOUT_KEYS = [
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'height',
  'translateX',
  'translateY',
  'zIndex',
] as const satisfies readonly (keyof Layout)[]

/**
 * 归一 layout：只保留**已声明**的字段（缺省字段一律省略，不补 0）。
 * 这样「显式写默认值」与「留空」被视为不同表达——与 schema 的 CSS-inset 语义一致
 * （缺省 = 自适应/继承，显式 0 = 贴边），不做误合并。
 */
function normalizeLayout(layout: Layout | undefined): Record<string, unknown> {
  if (!layout) return {}
  const out: Record<string, unknown> = {}
  for (const k of LAYOUT_KEYS) {
    const v = layout[k]
    if (v !== undefined) out[k] = v
  }
  return out
}

/** 稳定序列化：对象按 key 排序递归，数组保序——同内容永远同串（JSON.stringify key 序不稳）。 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

/** 单个 child 的内容签名：component + 归一 layout + 归一 inputs。 */
function childSignature(child: OverlayChild): string {
  return stableStringify({
    component: child.component,
    layout: normalizeLayout(child.layout),
    inputs: child.inputs ?? {},
  })
}

/**
 * overlay 内容签名：各 child 签名**排序后**拼接（children 顺序无关）。
 * 只随「组件 + 位置 + 参数」变化，不随 id/title/children 排列变化。
 */
export function overlaySignature(overlay: Overlay): string {
  const childSigs = overlay.children.map(childSignature).sort()
  return stableStringify(childSigs)
}

/**
 * 找出内容重复的 overlay 组。
 *
 * - 排除 `node:*`（时间轴内容容器，不是可复用界面方案，不参与去重）。
 * - 按内容签名分桶，只有**同桶 ≥2** 的才算重复。
 * - 返回 `overlayId → 与它内容相同的其它 overlayId[]`（已排序，稳定），供 UI 直接查某项的重复对象；
 *   无重复项不出现在 Map 里。
 */
export function findDuplicateOverlays(
  overlays: Record<string, Overlay>,
): Map<string, string[]> {
  const buckets = new Map<string, string[]>()
  for (const [id, ov] of Object.entries(overlays)) {
    if (id.startsWith('node:')) continue
    if (!ov) continue
    const sig = overlaySignature(ov)
    const bucket = buckets.get(sig)
    if (bucket) bucket.push(id)
    else buckets.set(sig, [id])
  }
  const out = new Map<string, string[]>()
  for (const ids of buckets.values()) {
    if (ids.length < 2) continue
    const sorted = [...ids].sort()
    for (const id of sorted) {
      out.set(id, sorted.filter((other) => other !== id))
    }
  }
  return out
}
