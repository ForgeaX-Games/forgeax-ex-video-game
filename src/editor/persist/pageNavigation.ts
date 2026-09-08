import type { ProductionProjection, PageLocation } from '../../workflow/contracts'
import {
  catalogPlacementKey,
  getAssetCatalogSnapshot,
  resolveCatalogItemLocation,
  type CatalogTabKind,
} from '@/editor/assets/asset-catalog'
import type { AssetLibraryRootKind } from '@/authoring/assets/registry-types'
import { useCatalogNav } from './catalogNavStore'
import { useDocumentNav } from './documentNavStore'
import { useGraphScenario } from './graphScenarioStore'
import { useGraphView } from './graphViewStore'
import { isConcurrentGroup, useProductionProjection } from './productionProjectionStore'
import { useRuleSelection } from './ruleSelectionStore'
import { useUiSelection } from './uiSelectionStore'

export type NavigationSource = 'agent' | 'user' | 'host'

export function navigatePage(
  location: PageLocation,
  options: { source?: NavigationSource; activityRevision?: number } = {},
): boolean {
  const projection = useProductionProjection.getState().projection
  if (
    options.source === 'agent'
    && options.activityRevision !== undefined
    && projection
    && options.activityRevision < projection.activityRevision
  ) return false

  if (options.source === 'user') {
    useProductionProjection.getState().markManualNavigation()
  }
  const view = useGraphView.getState()
  switch (location.kind) {
    case 'document':
      useProductionProjection.getState().reveal(['documents'])
      useDocumentNav.getState().setDocumentType(location.documentType)
      view.setView('documents')
      break
    case 'blueprint': {
      useProductionProjection.getState().reveal(['graph'])
      const scenario = useGraphScenario.getState()
      if (location.blueprintId && scenario.blueprints[location.blueprintId]) {
        scenario.selectBlueprint(location.blueprintId)
      }
      if (location.nodeId) scenario.setSelectedNode(location.nodeId)
      view.setView('graph')
      break
    }
    case 'rule':
      useProductionProjection.getState().reveal(['rule', `rule-${location.section}`])
      useRuleSelection.getState().select(location.section, location.itemId)
      view.setView('rule')
      break
    case 'ui':
      useProductionProjection.getState().reveal(['ui'])
      useUiSelection.getState().selectUiNode(location.treeNodeId ?? null, location.overlayId)
      view.setView('ui')
      break
    case 'asset': {
      useProductionProjection.getState().reveal(['assets'])
      const requestedTab = catalogTabForRoot(location.root)
      const catalog = getAssetCatalogSnapshot(useGraphScenario.getState().game)
      const resolved = location.entryId && catalog
        ? resolveCatalogItemLocation(catalog, { tabKind: requestedTab, itemId: location.entryId })
        : undefined
      const tabKind = resolved?.tabKind ?? requestedTab
      const target = resolved?.target ?? location.folderId ?? `root:${tabKind}`
      useCatalogNav.getState().setLocation(location.entryId
        ? { kind: 'item', tabKind, itemId: resolved?.itemId ?? location.entryId, placementKey: resolved?.placementKey ?? catalogPlacementKey(tabKind, location.entryId), target }
        : location.folderId
          ? { kind: 'folder', tabKind, folderId: location.folderId, target }
          : { kind: 'tab-root', tabKind, target: `root:${tabKind}` })
      view.setView('assets')
      break
    }
    case 'play':
      if (location.nodeId) useGraphScenario.getState().setSelectedNode(location.nodeId)
      view.setView('play')
      break
  }
  return true
}

function catalogTabForRoot(root: AssetLibraryRootKind): CatalogTabKind {
  return root === 'sound' ? 'audio' : root === 'image' ? 'image' : root
}

export function applyProductionProjection(projection: ProductionProjection): void {
  const changed = useProductionProjection.getState().setProjection(projection)
  const { followMode } = useProductionProjection.getState()
  // 并发组不自动跳转：三条线同时动时，跟着 focus 跳会不停打断用户操作。
  // 此时只靠 activeAncestors 展开一级菜单 + 模块上的进行中标记表达进度。
  if (changed && followMode && projection.focus && !isConcurrentGroup(projection)) {
    navigatePage(projection.focus.location, {
      source: 'agent',
      activityRevision: projection.activityRevision,
    })
  }
}

export function resumeProductionFollow(): boolean {
  const production = useProductionProjection.getState()
  production.setFollowMode(true)
  const projection = useProductionProjection.getState().projection
  if (!projection?.focus) return false
  return navigatePage(projection.focus.location, {
    source: 'agent',
    activityRevision: projection.activityRevision,
  })
}
