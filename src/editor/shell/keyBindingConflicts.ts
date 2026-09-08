/**
 * 交互按键重复检测 —— 扫描界面方案（及可选节点挂载增量）上的按键 inputs，
 * 同一按键被两处以上绑定时标冲突。纯数据，无 React/DOM。
 */
import type { GameGraph, Overlay, OverlayChild, OverlayNode } from '@/runtime/core/schema/graph-schema'
import { resolveMountChildren } from '@/runtime/core/schema/expand-overlay'
import { getComponentManifest } from '@/runtime/core/registry/component-registry'
import { defaultsForComponent } from './editors'
import { overlayDisplayLabel } from './schemeOverlays'

export interface KeyBindingSite {
  /** `${overlayId}/${childId}/${inputKey}`；节点增量用 `node:${nodeId}/...`。 */
  id: string
  overlayId: string
  overlayTitle: string
  childId: string
  componentId: string
  /** 组件 manifest 中文名。 */
  componentName: string
  inputKey: string
  /** manifest 原始 label，如「重攻击按键」。 */
  inputLabel: string
  /** 用于提示文案的交互名：去掉末尾「按键」。 */
  interactionName: string
  /** 展示用按键（保留作者大小写）。 */
  key: string
  /** 比较用规范化按键。 */
  normalizedKey: string
}

export interface KeyBindingConflict {
  site: KeyBindingSite
  /** 同键的其它绑定位点（至少一个）。 */
  others: readonly KeyBindingSite[]
}

function isKeyInput(key: string, label: string): boolean {
  return /key$/i.test(key) || /按键/.test(label)
}

function interactionNameOf(label: string, componentLabel: string): string {
  const stripped = (label.trim() || componentLabel).replace(/按键$/u, '').trim()
  return stripped || componentLabel
}

/** 与运行时 sameKey 对齐：忽略大小写差异，保留重音敏感度。 */
export function normalizeBindingKey(raw: string): string {
  return raw.trim().normalize('NFC')
}

export function keysMatch(a: string, b: string): boolean {
  return normalizeBindingKey(a).localeCompare(normalizeBindingKey(b), undefined, { sensitivity: 'accent' }) === 0
}

function resolveKeyValue(
  child: OverlayChild,
  inputKey: string,
  defaultValue: unknown,
): string | undefined {
  const configured = child.inputs?.[inputKey]
  if (typeof configured === 'string') {
    const trimmed = configured.trim()
    if (trimmed) return trimmed
    // 与运行时组件一致：清空按键不是禁用，而是恢复 manifest 默认键。
  } else if (configured != null) {
    return undefined
  }
  if (typeof defaultValue !== 'string') return undefined
  const fallback = defaultValue.trim()
  return fallback || undefined
}

function sitesForChild(
  overlayId: string,
  overlayTitle: string,
  child: OverlayChild,
  idPrefix?: string,
): KeyBindingSite[] {
  const manifest = getComponentManifest(child.component)
  if (!manifest) return []
  const defaults = defaultsForComponent(child.component)
  const componentLabel = manifest.label?.trim() || child.component
  const prefix = idPrefix ?? overlayId
  const sites: KeyBindingSite[] = []
  for (const input of manifest.inputs ?? []) {
    const label = input.label ?? input.key
    if (!isKeyInput(input.key, label)) continue
    const key = resolveKeyValue(child, input.key, defaults[input.key] ?? input.default)
    if (!key) continue
    sites.push({
      id: `${prefix}/${child.id}/${input.key}`,
      overlayId,
      overlayTitle,
      childId: child.id,
      componentId: child.component,
      componentName: componentLabel,
      inputKey: input.key,
      inputLabel: label,
      interactionName: interactionNameOf(label, componentLabel),
      key,
      normalizedKey: normalizeBindingKey(key),
    })
  }
  return sites
}

/** 只扫描当前正在编辑的一个界面方案。 */
export function collectCurrentOverlayKeyBindingSites(
  overlay: Overlay,
  overlays?: Record<string, Overlay>,
): KeyBindingSite[] {
  const title = overlayDisplayLabel(overlay.id, overlays ?? { [overlay.id]: overlay })
  return overlay.children.flatMap((child) =>
    sitesForChild(overlay.id, title, child))
}

/**
 * 只扫描当前蓝图节点内实际挂载后的组件。
 * 每个 mount 用自己的挂载 id 作为冲突作用域地址，重复挂载同一方案也不会互相覆盖。
 */
export function collectCurrentNodeKeyBindingSites(
  overlays: Record<string, Overlay> | undefined,
  nodeId: string,
  mounts: readonly OverlayNode[] | undefined,
): KeyBindingSite[] {
  if (!overlays || !mounts?.length) return []
  return mounts.flatMap((mount) => {
    const mountId = mount.id ?? mount.overlay
    const title = overlayDisplayLabel(mount.overlay, overlays)
    return resolveMountChildren(overlays, mount).flatMap((child) =>
      sitesForChild(mountId, title, child, `node:${nodeId}/${mountId}`))
  })
}

/**
 * 扫描全部可编辑界面方案中的按键绑定位点。
 * `base:*` 是组件库基础模板，不是实际摆放的界面；若把它计为占用，每个从基础模板创建、
 * 且仍使用 manifest 默认键的控件都会与模板自身产生假冲突。
 */
export function collectOverlayKeyBindingSites(
  overlays: Record<string, Overlay> | undefined,
): KeyBindingSite[] {
  if (!overlays) return []
  const sites: KeyBindingSite[] = []
  for (const overlay of Object.values(overlays)) {
    if (
      !overlay?.id
      || overlay.id.startsWith('node:')
      || overlay.id.startsWith('base:')
    ) continue
    const title = overlayDisplayLabel(overlay.id, overlays)
    for (const child of overlay.children ?? []) {
      sites.push(...sitesForChild(overlay.id, title, child))
    }
  }
  return sites
}

/**
 * 扫描蓝图节点挂载上的有效组件按键（含 overrides / added）。
 * 与目录方案一并比较时，同一目录 child 经挂载未改键不会重复计入——只收入
 * `added` 子项，以及相对目录默认值改过按键的 override。
 */
export function collectMountKeyBindingSites(
  overlays: Record<string, Overlay> | undefined,
  graphs: readonly GameGraph[] | undefined,
): KeyBindingSite[] {
  if (!overlays || !graphs?.length) return []
  const catalogSites = new Map(
    collectOverlayKeyBindingSites(overlays).map((site) => [site.id, site]),
  )
  const sites: KeyBindingSite[] = []
  for (const graph of graphs) {
    for (const node of graph.nodes ?? []) {
      const mounts = (node.data?.overlayNodes ?? []) as OverlayNode[]
      for (const mount of mounts) {
        const overlayId = mount.overlay
        const overlay = overlays[overlayId]
        const title = overlayDisplayLabel(overlayId, overlays)
        const children = resolveMountChildren(overlays, mount)
        const catalogChildIds = new Set((overlay?.children ?? []).map((child) => child.id))
        for (const child of children) {
          const childSites = sitesForChild(
            overlayId,
            title,
            child,
            `node:${node.id}/${overlayId}`,
          )
          for (const site of childSites) {
            const catalogId = `${overlayId}/${child.id}/${site.inputKey}`
            const catalog = catalogSites.get(catalogId)
            const isAdded = !catalogChildIds.has(child.id)
            const keyChanged = !catalog || !keysMatch(catalog.key, site.key)
            if (isAdded || keyChanged) sites.push(site)
          }
        }
      }
    }
  }
  return sites
}

export function collectAllKeyBindingSites(
  overlays: Record<string, Overlay> | undefined,
  graphs?: readonly GameGraph[],
): KeyBindingSite[] {
  return [
    ...collectOverlayKeyBindingSites(overlays),
    ...collectMountKeyBindingSites(overlays, graphs),
  ]
}

/** 按规范化按键分组，返回每个冲突位点及其它冲突方。 */
export function findKeyBindingConflicts(
  sites: readonly KeyBindingSite[],
): Map<string, KeyBindingConflict> {
  const byKey = new Map<string, KeyBindingSite[]>()
  for (const site of sites) {
    // 用首个站点的展示键做桶：匹配用 keysMatch 扫描已有桶。
    let bucketKey: string | undefined
    for (const existing of byKey.keys()) {
      if (keysMatch(existing, site.key)) {
        bucketKey = existing
        break
      }
    }
    const key = bucketKey ?? site.key
    const list = byKey.get(key) ?? []
    list.push(site)
    byKey.set(key, list)
  }
  const conflicts = new Map<string, KeyBindingConflict>()
  for (const group of byKey.values()) {
    if (group.length < 2) continue
    for (const site of group) {
      conflicts.set(site.id, {
        site,
        others: group.filter((other) => other.id !== site.id),
      })
    }
  }
  return conflicts
}

/** 当前界面方案内、存在按键冲突的 childId 集合。 */
export function keyConflictChildIds(
  overlayId: string,
  conflicts: ReadonlyMap<string, KeyBindingConflict>,
): Set<string> {
  const ids = new Set<string>()
  for (const conflict of conflicts.values()) {
    if (conflict.site.overlayId === overlayId) ids.add(conflict.site.childId)
  }
  return ids
}

/** 某组件某个按键字段的冲突提示文案；无冲突返回 null。 */
export function keyConflictTooltip(
  conflict: KeyBindingConflict | undefined,
): string | null {
  if (!conflict?.others.length) return null
  const other = conflict.others[0]!
  return `按键${conflict.site.key}已应用于${other.componentName}-${other.interactionName}`
}

export function conflictForInput(
  conflicts: ReadonlyMap<string, KeyBindingConflict>,
  overlayId: string,
  childId: string,
  inputKey: string,
): KeyBindingConflict | undefined {
  const direct = conflicts.get(`${overlayId}/${childId}/${inputKey}`)
  if (direct) return direct
  for (const conflict of conflicts.values()) {
    if (
      conflict.site.overlayId === overlayId
      && conflict.site.childId === childId
      && conflict.site.inputKey === inputKey
    ) {
      return conflict
    }
  }
  return undefined
}
