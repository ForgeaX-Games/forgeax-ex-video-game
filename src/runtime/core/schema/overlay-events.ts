/**
 * overlay 事件聚合 + reactions → 边派生。
 *
 * 命名空间（event id）：
 * - 单挂载 + 单交互 child → `A`
 * - 单挂载 + 多交互 → `childId:A`
 * - 多挂载 → `mountId:childId:A`（该挂载仅一交互时可 `mountId:A`）
 */
import type { Overlay, OverlayReaction } from './graph-schema'
import type {
  ComponentEvent,
  ComponentManifest,
  NodeAction,
  OverlayEventRef,
  OverlayNode,
  Reaction,
} from './node-config-schema'
import { overlayMountId } from './node-config-schema'

export type ManifestResolver = (componentId: string) => ComponentManifest | undefined

/** Overlay 目录 reaction 的唯一稳定 key；不随挂载数或同类交互组件数量变化。 */
export function overlayReactionKey(childId: string, eventId: string): string {
  return `${childId}:${eventId}`
}

/** 目录继承动作只按稳定 key 精确匹配，不接受挂载层的历史别名。 */
export function resolveOverlayReaction(
  reactions: OverlayReaction[] | undefined,
  childId: string,
  eventId: string,
): OverlayReaction | undefined {
  const key = overlayReactionKey(childId, eventId)
  return reactions?.find((reaction) => reaction.when.id === key)
}

/** 从 `inputs.events` 折成事件表（交互目录 SSOT；组件未在 inputs 声明时回退 manifest.events）。 */
export function eventsFromParams(inputs: Record<string, unknown> | undefined): ComponentEvent[] {
  const events = inputs?.events
  if (!Array.isArray(events)) return []
  const out: ComponentEvent[] = []
  for (const e of events) {
    if (!e || typeof e !== 'object') continue
    const rec = e as { id?: unknown; label?: unknown }
    if (typeof rec.id !== 'string') continue
    out.push({
      id: rec.id,
      ...(typeof rec.label === 'string' ? { label: rec.label } : {}),
    })
  }
  return out
}

function emittingChildren(
  overlay: Overlay,
  resolve: ManifestResolver,
): Array<{ child: Overlay['children'][number]; events: ComponentEvent[] }> {
  return overlay.children
    .map((child) => {
      const fromParams = eventsFromParams(child.inputs)
      const manifest = resolve(child.component)
      const events = fromParams.length ? fromParams : (manifest?.events ?? [])
      return { child, events }
    })
    .filter((x) => x.events.length > 0)
}

/**
 * 聚合单张 Overlay 内事件（默认单挂载语境）。
 * 多个带事件的 child → eventId = `${childId}:${localId}`；仅一个 → 直接用 localId。
 */
export function aggregateOverlayEvents(
  overlay: Overlay | undefined,
  resolve: ManifestResolver,
  opts?: { mountId?: string; prefixMount?: boolean },
): OverlayEventRef[] {
  if (!overlay) return []
  const mountId = opts?.mountId ?? overlay.id
  const emitting = emittingChildren(overlay, resolve)
  const childNs = emitting.length > 1
  const out: OverlayEventRef[] = []
  for (const { child, events } of emitting) {
    for (const ev of events) {
      const local = childNs ? `${child.id}:${ev.id}` : ev.id
      const eventId = opts?.prefixMount ? `${mountId}:${local}` : local
      out.push({
        eventId,
        mountId,
        childId: child.id,
        localEventId: ev.id,
        label: ev.label,
        componentId: child.component,
      })
    }
  }
  return out
}

/** 聚合节点上全部挂载的事件。 */
export function aggregateNodeOverlayEvents(
  mounts: readonly OverlayNode[],
  overlays: Record<string, Overlay> | undefined,
  resolve: ManifestResolver,
): OverlayEventRef[] {
  const multi = mounts.length > 1
  const out: OverlayEventRef[] = []
  for (const mount of mounts) {
    const def = overlays?.[mount.overlay]
    out.push(
      ...aggregateOverlayEvents(def, resolve, {
        mountId: overlayMountId(mount),
        prefixMount: multi,
      }),
    )
  }
  return out
}

function eventReactionsFor(reactions: Reaction[] | undefined, eventId: string): Reaction[] {
  return (reactions ?? []).filter((r) => r.when.type === 'event' && r.when.id === eventId)
}

/** 新规格稳定 key 优先；尾部别名仅供读取尚未被编辑器重写的既有工程。 */
function eventKeys(outcome: string, childId?: string, mountId?: string): string[] {
  const keys: string[] = []
  if (childId) keys.push(overlayReactionKey(childId, outcome))
  keys.push(outcome)
  if (mountId) {
    keys.push(`${mountId}:${outcome}`)
    if (childId) keys.push(`${mountId}:${childId}:${outcome}`)
  }
  return keys
}

/**
 * 解析 event 类 reaction 候选：稳定 childId:eventId 优先，返回首个命中 key 的全部候选。
 */
export function resolveEventReactions(
  reactions: Reaction[] | undefined,
  outcome: string,
  childId?: string,
  mountId?: string,
): Reaction[] {
  if (!reactions?.length) return []
  for (const k of eventKeys(outcome, childId, mountId)) {
    const hits = eventReactionsFor(reactions, k)
    if (hits.length) return hits
  }
  return []
}

/**
 * 解析 event 类 reaction：稳定 childId:eventId 优先。
 * 返回首个候选的 do（不加权；加权请用 resolveEventReactions）。
 */
export function resolveEventReactionDo(
  reactions: Reaction[] | undefined,
  outcome: string,
  childId?: string,
  mountId?: string,
): NodeAction[] | undefined {
  return resolveEventReactions(reactions, outcome, childId, mountId)[0]?.do
}

/** node.data.reactions 中的 complete 类候选（保持作者顺序）。 */
export function completeReactions(reactions: Reaction[] | undefined): Reaction[] {
  return (reactions ?? []).filter((r) => r.when.type === 'complete')
}
