/**
 * expandOverlay — Overlay ⊕ OverlayNode[] → OverlayInstance[]（运行前展开，不落盘）。
 */
import type { GameNode, GameScenario } from './graph-schema'
import type {
  Overlay,
  OverlayChild,
  OverlayInstance,
  OverlayInstanceChild,
  OverlayNode,
} from './node-config-schema'
import { overlayMountId } from './node-config-schema'

/** 运行态 child id：始终 mount/catalog，单挂载同形。 */
export function overlayInstanceChildId(mountId: string, childId: string): string {
  return `${mountId}/${childId}`
}

/** 节点上的挂载列表。 */
export function nodeOverlayMounts(node: GameNode | undefined): OverlayNode[] {
  return node?.data.overlayNodes ?? []
}

/** 字段级合并：顶层覆盖 + inputs/layout 各自浅合（与旧 patchOverlayChild 同款语义）。 */
export function mergeChild(base: OverlayChild, patch: Partial<OverlayChild>): OverlayChild {
  return {
    ...base,
    ...patch,
    inputs: patch.inputs ? { ...base.inputs, ...patch.inputs } : base.inputs,
    layout: patch.layout ? { ...base.layout, ...patch.layout } : base.layout,
  }
}

/**
 * Prototype + sparse override 解析：`mount.overlay` 的 children 为原型基底，
 * 逐组件套 `mount.overrides`（字段级覆盖）、按 `mount.removed` 屏蔽、末尾追加 `mount.added`。
 * 未出现在 overrides/added/removed 里的组件原样跟随原型（编辑方案即同步）。
 * 孤儿 override/removed（原型已删该 childId）静默忽略。
 */
export function resolveMountChildren(
  overlays: Record<string, Overlay> | undefined,
  mount: OverlayNode,
): OverlayChild[] {
  // 历史蓝图曾把节点副本直接落在 mount.children；优先读取它，避免
  // 校验器与运行时错误地退回共享模板默认时序（尤其是 QTE window）。
  const base = mount.children ?? overlays?.[mount.overlay]?.children ?? []
  const removed = mount.removed
  const overrides = mount.overrides
  const out: OverlayChild[] = []
  for (const child of base) {
    if (removed?.includes(child.id)) continue
    const patch = overrides?.[child.id]
    out.push(patch ? mergeChild(child, patch) : child)
  }
  if (mount.added?.length) out.push(...mount.added)
  return out
}

function toInstanceChild(
  def: OverlayChild,
  meta: { mountId: string; overlayId: string; nodeId: string },
): OverlayInstanceChild {
  const catalogId = def.id
  const runtimeId = overlayInstanceChildId(meta.mountId, catalogId)
  const inputs = { ...(def.inputs ?? {}) }
  return {
    id: runtimeId,
    component: def.component,
    trigger: def.trigger ?? { when: 'enter' },
    window: def.window,
    layout: def.layout,
    inputs,
    source: {
      mountId: meta.mountId,
      overlayId: meta.overlayId,
      childId: catalogId,
      nodeId: meta.nodeId,
    },
  }
}

/** 展开单份挂载；目录缺失则 null。 */
export function expandOverlayMount(
  overlays: Record<string, Overlay> | undefined,
  node: GameNode,
  mount: OverlayNode,
): OverlayInstance | null {
  const def = overlays?.[mount.overlay]
  if (!def) return null
  const mountId = overlayMountId(mount)
  const children: OverlayInstanceChild[] = []
  for (const child of resolveMountChildren(overlays, mount)) {
    children.push(
      toInstanceChild(child, {
        mountId,
        overlayId: def.id,
        nodeId: node.id,
      }),
    )
  }
  return {
    mountId,
    overlayId: def.id,
    nodeId: node.id,
    layout: mount.layout,
    children,
    reactions: mount.reactions,
  }
}

/** 展开节点上全部挂载。 */
export function expandNodeOverlays(
  overlays: Record<string, Overlay> | undefined,
  node: GameNode,
): OverlayInstance[] {
  const out: OverlayInstance[] = []
  for (const mount of nodeOverlayMounts(node)) {
    const inst = expandOverlayMount(overlays, node, mount)
    if (inst) out.push(inst)
  }
  return out
}

/** 从 scenario 展开节点全部 children（扁平）。 */
export function expandNodeChildren(scenario: GameScenario, node: GameNode): OverlayInstanceChild[] {
  return expandNodeOverlays(scenario.ui?.overlays, node).flatMap((i) => i.children)
}

/** 引擎 / 校验用：当前节点可调度的 children。 */
export function nodeOverlayChildren(scenario: GameScenario, node: GameNode | undefined): OverlayInstanceChild[] {
  if (!node) return []
  return expandNodeChildren(scenario, node)
}
