import type {
  GameGraph,
  GraphLibraryDocument,
  OverlayNode,
  OverlayReaction,
  Reaction,
  UiTree,
} from '@/runtime/core/schema/graph-schema'
import { getSubProcess } from '@/runtime/core/schema/graph-schema'
import { ensureUiTree } from './ui-tree'

function referencesRemovedChild(value: string, childIds: ReadonlySet<string>): boolean {
  return [...childIds].some((childId) => (
    value === childId
    || value.startsWith(`${childId}:`)
    || value.includes(`:${childId}:`)
    || value.endsWith(`/${childId}`)
  ))
}

function cleanReactions(
  reactions: readonly Reaction[] | undefined,
  childIds: ReadonlySet<string>,
): Reaction[] | undefined {
  if (!reactions) return undefined
  const next = reactions.flatMap((reaction) => {
    const trigger = reaction.when
    if (
      (trigger.type === 'event' && referencesRemovedChild(trigger.id, childIds))
      || ((trigger.type === 'shown' || trigger.type === 'hidden')
        && referencesRemovedChild(trigger.of, childIds))
    ) return []
    const actions = reaction.do.filter((action) => (
      action.kind !== 'spawn' || !referencesRemovedChild(action.from, childIds)
    ))
    return actions.length ? [{ ...reaction, do: actions }] : []
  })
  return next.length ? next : undefined
}

function cleanOverlayReactions(
  reactions: readonly OverlayReaction[] | undefined,
  childIds: ReadonlySet<string>,
): OverlayReaction[] | undefined {
  if (!reactions) return undefined
  const next = reactions.flatMap((reaction) => {
    if (referencesRemovedChild(reaction.when.id, childIds)) return []
    const actions = reaction.do.filter((action) => (
      action.kind !== 'spawn' || !referencesRemovedChild(action.from, childIds)
    ))
    return actions.length ? [{ ...reaction, do: actions }] : []
  })
  return next.length ? next : undefined
}

function cleanMount(
  mount: OverlayNode,
  componentId: string,
  removedByOverlay: ReadonlyMap<string, ReadonlySet<string>>,
): OverlayNode {
  const removedChildIds = new Set(removedByOverlay.get(mount.overlay) ?? [])
  const added = mount.added?.filter((child) => {
    if (child.component !== componentId) return true
    removedChildIds.add(child.id)
    return false
  })
  const overrides = Object.fromEntries(
    Object.entries(mount.overrides ?? {}).filter(([childId, patch]) => (
      !removedChildIds.has(childId) && patch.component !== componentId
    )),
  )
  const removed = mount.removed?.filter((childId) => !removedChildIds.has(childId))
  return {
    ...mount,
    ...(added?.length ? { added } : { added: undefined }),
    ...(Object.keys(overrides).length ? { overrides } : { overrides: undefined }),
    ...(removed?.length ? { removed } : { removed: undefined }),
    reactions: cleanReactions(mount.reactions, removedChildIds),
  }
}

function cleanGraph(
  graph: GameGraph,
  componentId: string,
  removedOverlayId: string,
  removedByOverlay: ReadonlyMap<string, ReadonlySet<string>>,
): GameGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const process = getSubProcess(node.data)
      const removedChildIds = new Set<string>()
      const overlayNodes = (node.data.overlayNodes ?? []).flatMap((mount) => {
        for (const childId of removedByOverlay.get(mount.overlay) ?? []) {
          removedChildIds.add(childId)
        }
        for (const child of mount.added ?? []) {
          if (child.component === componentId) removedChildIds.add(child.id)
        }
        if (mount.overlay === removedOverlayId) return []
        return [cleanMount(mount, componentId, removedByOverlay)]
      })
      return {
        ...node,
        data: {
          ...node.data,
          ...(overlayNodes.length ? { overlayNodes } : { overlayNodes: undefined }),
          reactions: cleanReactions(node.data.reactions, removedChildIds),
          ...(process ? {
            subProcess: {
              ...process,
              graph: cleanGraph(process.graph, componentId, removedOverlayId, removedByOverlay),
            },
          } : {}),
        },
      }
    }),
  }
}

export function removeProjectComponentReferences(
  document: GraphLibraryDocument,
  componentId: string,
): GraphLibraryDocument {
  const removedOverlayId = `base:${componentId}`
  const removedByOverlay = new Map<string, ReadonlySet<string>>()
  const baseOverlay = document.ui?.overlays?.[removedOverlayId]
  if (baseOverlay) {
    removedByOverlay.set(removedOverlayId, new Set(baseOverlay.children.map((child) => child.id)))
  }
  const overlays = Object.fromEntries(
    Object.entries(document.ui?.overlays ?? {}).flatMap(([overlayId, overlay]) => {
      if (overlayId === removedOverlayId) return []
      const removedChildIds = new Set(
        overlay.children
          .filter((child) => child.component === componentId)
          .map((child) => child.id),
      )
      if (removedChildIds.size) removedByOverlay.set(overlayId, removedChildIds)
      const children = overlay.children.filter((child) => child.component !== componentId)
      const reactions = cleanOverlayReactions(overlay.reactions, removedChildIds)
      return [[overlayId, {
        ...overlay,
        children,
        ...(reactions?.length ? { reactions } : { reactions: undefined }),
      }]]
    }),
  )
  const packs = Object.fromEntries(
    Object.entries(document.manifest.packs).map(([packId, pack]) => [packId, {
      ...pack,
      graph: cleanGraph(pack.graph, componentId, removedOverlayId, removedByOverlay),
    }]),
  )
  const main = packs[document.manifest.mainPackId]
  const uiTree = ensureUiTree(document.uiTree as UiTree | undefined, overlays)
  return {
    ...document,
    ui: { ...document.ui, overlays },
    uiTree,
    graph: main?.graph ?? document.graph,
    manifest: { ...document.manifest, packs },
  }
}
