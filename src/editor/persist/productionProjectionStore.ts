import { create } from 'zustand'
import type { ProductionProjection } from '../../workflow/contracts'

interface ProductionProjectionStore {
  projection: ProductionProjection | null
  expanded: Set<string>
  followMode: boolean
  setProjection(projection: ProductionProjection): boolean
  toggleExpanded(id: string): void
  reveal(ids: readonly string[]): void
  setFollowMode(enabled: boolean): void
  markManualNavigation(): void
}

const SELECTABLE_PRODUCTION_MODULES = [
  'document.core',
  'document.pillar',
  'blueprint',
  'ui',
  'rules',
  'assets',
] as const

/** 一级目录本身不对应内容路由；至少一个实际模块解锁后，中间区才有内容可展示。 */
export function hasSelectableProductionContent(
  projection: ProductionProjection | null,
): boolean {
  if (!projection) return true
  return SELECTABLE_PRODUCTION_MODULES.some(
    (key) => projection.modules[key]?.availability !== undefined
      && projection.modules[key]?.availability !== 'hidden',
  )
}

function locationAncestors(location: NonNullable<ProductionProjection['focus']>['location']): string[] {
  switch (location.kind) {
    case 'document': return ['documents']
    case 'blueprint': return ['graph']
    case 'rule': return ['rule', `rule-${location.section}`]
    case 'ui': return ['ui']
    case 'asset': return location.root === 'video'
      ? ['assets', 'asset-root:video']
      : ['assets', `asset-root:${location.root === 'character' ? 'settings' : location.root}`]
    case 'play': return []
  }
}

/** 活动 → 侧栏一级菜单的祖先路径。并发时需要同时展开多条。 */
function activityAncestors(activity: string): string[] {
  if (activity === 'brief.collecting' || activity.startsWith('document.')) return ['documents']
  if (activity === 'blueprint.outline' || activity === 'game.finalizing') return ['graph']
  if (activity === 'rules.catalog') return ['rule', 'rule-entities']
  if (activity === 'rules.binding') return ['rule', 'rule-variables']
  if (activity === 'ui.authoring') return ['ui']
  if (activity.startsWith('characters.') || activity === 'assets.character') {
    return ['assets', 'asset-root:settings']
  }
  if (activity.startsWith('scenes.') || activity === 'assets.scene') {
    return ['assets', 'asset-root:scene']
  }
  if (activity.startsWith('video.')) return ['assets', 'asset-root:video']
  return []
}

/**
 * 跟随时要展开哪些一级菜单。
 *
 * 并发组里三条线同时在跑，单一 `focus` 只能指向其中一个——那样另外两条线在界面上
 * 完全看不见。所以展开集合取**当前组内全部活跃活动**的祖先路径并集，
 * 而不是只跟 focus 那一条。
 */
export function activeAncestors(projection: ProductionProjection): string[] {
  const fromActivities = (projection.activeActivities ?? [projection.activity])
    .flatMap(activityAncestors)
  const fromFocus = projection.focus ? locationAncestors(projection.focus.location) : []
  return [...new Set([...fromActivities, ...fromFocus])]
}

/**
 * 并发组不抢焦点。
 *
 * 三条线同时动时自动跳转会打断用户操作——正在看角色，画面突然跳到规则，
 * 比不跳更糟。串行段保留精确定位（体验更好），并发段只展开不选中。
 */
export function isConcurrentGroup(projection: ProductionProjection | null): boolean {
  return (projection?.activeActivities?.length ?? 0) > 1
}

export const useProductionProjection = create<ProductionProjectionStore>((set, get) => ({
  projection: null,
  expanded: new Set<string>(),
  // A new game follows Agent activity by default. Manual navigation suspends it.
  followMode: true,
  setProjection(projection) {
    const current = get().projection
    if (current && projection.workflowRevision < current.workflowRevision) return false
    set((state) => ({
      projection,
      expanded: state.followMode
        ? new Set([...state.expanded, ...activeAncestors(projection)])
        : state.expanded,
    }))
    return !current
      || projection.workflowRevision > current.workflowRevision
      || projection.focus?.revision !== current.focus?.revision
  },
  toggleExpanded(id) {
    set((state) => {
      const expanded = new Set(state.expanded)
      if (expanded.has(id)) expanded.delete(id)
      else expanded.add(id)
      return { expanded, followMode: false }
    })
  },
  reveal(ids) {
    set((state) => ({ expanded: new Set([...state.expanded, ...ids]) }))
  },
  setFollowMode(enabled) {
    set((state) => ({
      followMode: enabled,
      expanded: enabled && state.projection
        ? new Set([...state.expanded, ...activeAncestors(state.projection)])
        : state.expanded,
    }))
  },
  markManualNavigation() {
    set({ followMode: false })
  },
}))
