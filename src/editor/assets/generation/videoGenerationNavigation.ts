import { useGraphView } from '../../persist/graphViewStore'
import type { GameGraph } from '@/runtime/core/schema/graph-schema'
import { parseCatalogPlacementKey, type CatalogTabKind } from '../asset-catalog'
import { useCatalogNav, type CatalogNavLocation } from '../../persist/catalogNavStore'
import { useVideoGenerationPanel } from '../../persist/videoGenerationPanelStore'
import { getInspectorMountOptions } from '../../host-init'
import { useVideoGenerationStore } from './videoGenerationStore'
import type { VideoGenerationScope } from './catalogGenerationRecovery'

const PENDING_SELECTION_KEY = 'game-video:pending-video-selection:v1'
const NODE_GENERATION_TARGET_KEY = 'game-video:node-generation-target:v1'
const VIDEO_GENERATION_TARGET_KEY = 'game-video:video-generation-target:v1'

export interface NodeGenerationTarget {
  gameId: string
  blueprintId: string
  nodeId: string
  graphPath?: string[]
}
export type VideoGenerationCatalogLocation = Exclude<CatalogNavLocation, { kind: 'catalog-root' }>
export interface CatalogVideoGenerationTarget {
  gameId: string
  entityId?: string
  assetId?: string
  catalogLocation?: VideoGenerationCatalogLocation
}

export function nodeVideoGenerationScope(target: Pick<NodeGenerationTarget, 'blueprintId' | 'nodeId'> & { graphPath?: readonly string[] }): VideoGenerationScope {
  return {
    mediaType: 'video',
    owner: 'node',
    blueprintId: target.blueprintId,
    nodeId: target.nodeId,
    ...(target.graphPath?.length ? { graphPath: [...target.graphPath] } : {}),
  }
}

export function catalogVideoGenerationScope(target: Pick<CatalogVideoGenerationTarget, 'entityId' | 'assetId'>): VideoGenerationScope {
  if (!target.entityId && !target.assetId) return { mediaType: 'video', owner: 'root' }
  if (target.entityId) return { mediaType: 'video', owner: 'entity', entityId: target.entityId }
  return {
    mediaType: 'video',
    owner: 'entity',
    assetId: target.assetId!,
  }
}

/** A node-scoped entry is exclusive: stale Catalog navigation must not restore another video. */
export function resolveVideoGenerationCatalogTarget(
  gameId: string,
  nodeTarget: NodeGenerationTarget | undefined,
  requestedTarget: CatalogVideoGenerationTarget | undefined,
  location: CatalogNavLocation,
): CatalogVideoGenerationTarget | undefined {
  if (nodeTarget) return undefined
  if (requestedTarget) return requestedTarget
  if (location.kind === 'catalog-root' || location.tabKind !== 'video') return undefined
  return {
    gameId,
    ...(location.kind === 'item' ? { entityId: location.itemId } : {}),
    catalogLocation: location,
  }
}

export { nodeVideoEntityId, nodeVideoTargetFromEntityId } from '@/authoring/assets/registry-types'

export function requestCatalogVideoGenerationTarget(target: CatalogVideoGenerationTarget): void {
  if (!target.gameId || typeof window === 'undefined') return
  useVideoGenerationStore.getState().select(target.gameId, catalogVideoGenerationScope(target), undefined)
  const catalogLocation = target.catalogLocation ?? captureCatalogLocation()
  window.sessionStorage.removeItem(NODE_GENERATION_TARGET_KEY)
  window.sessionStorage.setItem(VIDEO_GENERATION_TARGET_KEY, JSON.stringify({
    ...target,
    ...(catalogLocation ? { catalogLocation } : {}),
  }))
}

export function consumeCatalogVideoGenerationTarget(gameId: string): CatalogVideoGenerationTarget | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = window.sessionStorage.getItem(VIDEO_GENERATION_TARGET_KEY)
    window.sessionStorage.removeItem(VIDEO_GENERATION_TARGET_KEY)
    const value = raw ? JSON.parse(raw) as Partial<CatalogVideoGenerationTarget> : null
    const catalogLocation = parseCatalogLocation(value?.catalogLocation)
    const entityId = typeof value?.entityId === 'string' && value.entityId ? value.entityId : undefined
    const assetId = typeof value?.assetId === 'string' && value.assetId ? value.assetId : undefined
    return value?.gameId === gameId && (entityId || assetId || catalogLocation)
      ? { gameId, ...(entityId ? { entityId } : {}), ...(assetId ? { assetId } : {}), ...(catalogLocation ? { catalogLocation } : {}) }
      : undefined
  } catch { return undefined }
}

function captureCatalogLocation(): VideoGenerationCatalogLocation | undefined {
  const location = useCatalogNav.getState().location
  return location.kind === 'catalog-root' ? undefined : location
}

function parseCatalogLocation(value: unknown): VideoGenerationCatalogLocation | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as Partial<CatalogNavLocation>
  if (candidate.kind === 'tab-root' && isTabKind(candidate.tabKind)) {
    return { kind: 'tab-root', tabKind: candidate.tabKind, target: `root:${candidate.tabKind}` }
  }
  if (candidate.kind === 'folder' && isTabKind(candidate.tabKind)
    && typeof candidate.folderId === 'string' && candidate.folderId
    && typeof candidate.target === 'string' && candidate.target) {
    return { kind: 'folder', tabKind: candidate.tabKind, folderId: candidate.folderId, target: candidate.target }
  }
  if (candidate.kind === 'item' && isTabKind(candidate.tabKind)
    && typeof candidate.itemId === 'string' && candidate.itemId
    && typeof candidate.placementKey === 'string'
    && parseCatalogPlacementKey(candidate.placementKey)?.tabKind === candidate.tabKind
    && parseCatalogPlacementKey(candidate.placementKey)?.itemId === candidate.itemId
    && typeof candidate.target === 'string' && candidate.target) {
    return { kind: 'item', tabKind: candidate.tabKind, itemId: candidate.itemId, placementKey: candidate.placementKey, target: candidate.target }
  }
  return undefined
}

function isTabKind(value: unknown): value is CatalogTabKind {
  return value === 'image' || value === 'scene' || value === 'icon' || value === 'control'
    || value === 'character' || value === 'video' || value === 'audio' || value === 'font'
}

/** Bind a successful node-scoped generation without discarding its authored prompt or preset. */
export function bindVideoResourceToNode(
  graph: GameGraph,
  nodeId: string,
  resourceId: string,
): GameGraph {
  if (!resourceId.trim()) return graph
  let changed = false
  const nodes = graph.nodes.map((node) => {
    if (node.id !== nodeId || node.data.media?.ref === resourceId) return node
    changed = true
    return {
      ...node,
      data: {
        ...node.data,
        media: { ...node.data.media, kind: 'video' as const, ref: resourceId },
      },
    }
  })
  return changed ? { ...graph, nodes } : graph
}

/**
 * 画布节点「生成视频」入口:记下目标节点,再切到视频生成页由它预填。
 *
 * 标识不全时不切页——那样只会打开一个没有节点上下文的生成页,用户还得自己退回来。
 */
export function openNodeVideoGeneration(target: NodeGenerationTarget): void {
  if (!target.gameId.trim() || !target.blueprintId.trim() || !target.nodeId.trim()) return
  useVideoGenerationStore.getState().select(target.gameId, nodeVideoGenerationScope(target), undefined)
  requestNodeGenerationTarget(target)
  if (getInspectorMountOptions().videoGenerationEl) {
    useVideoGenerationPanel.getState().openForNode(target, useGraphView.getState().view)
    return
  }
  useGraphView.getState().setView('video-generate')
}

export function requestNodeGenerationTarget(target: NodeGenerationTarget): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(VIDEO_GENERATION_TARGET_KEY)
    window.sessionStorage.setItem(NODE_GENERATION_TARGET_KEY, JSON.stringify(target))
  } catch {
    // Optional navigation context; the blueprint remains fully authored.
  }
}

/** Consume once so later standalone t2v actions do not inherit a stale node. */
export function consumeNodeGenerationTarget(gameId: string): NodeGenerationTarget | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = window.sessionStorage.getItem(NODE_GENERATION_TARGET_KEY)
    window.sessionStorage.removeItem(NODE_GENERATION_TARGET_KEY)
    if (!raw) return undefined
    const value = JSON.parse(raw) as Partial<NodeGenerationTarget>
    return value.gameId === gameId
      && typeof value.blueprintId === 'string'
      && typeof value.nodeId === 'string'
      ? value as NodeGenerationTarget
      : undefined
  } catch {
    return undefined
  }
}

export function requestVideoAssetSelection(assetId: string): void {
  if (!assetId || typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(PENDING_SELECTION_KEY, assetId)
  } catch {
    // Session storage is optional; the generation task itself remains persisted remotely.
  }
}

export function consumeVideoAssetSelection(): string | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const assetId = window.sessionStorage.getItem(PENDING_SELECTION_KEY) ?? undefined
    window.sessionStorage.removeItem(PENDING_SELECTION_KEY)
    return assetId
  } catch {
    return undefined
  }
}
