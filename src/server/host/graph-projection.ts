import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'

export type GraphProjectionField = 'summary' | 'interaction' | 'storyText' | 'overlays' | 'edges'

export interface GraphProjectionSelector {
  readonly blueprintId?: string
  readonly nodeIds?: readonly string[]
  readonly fields?: readonly GraphProjectionField[]
}

export interface GraphShard {
  readonly blueprintId: string
  readonly title: string
  readonly version?: string
  readonly entry: string
  readonly graph: {
    readonly nodes: readonly Record<string, unknown>[]
    readonly edges: readonly Record<string, unknown>[]
  }
}

export function graphSnapshotToken(gameId: string, revision: number): string {
  return `${gameId}:${revision}`
}

function projectNode(
  node: Record<string, unknown>,
  fields: ReadonlySet<GraphProjectionField> | null,
): Record<string, unknown> {
  if (!fields) return node
  const source = (node.data && typeof node.data === 'object' && !Array.isArray(node.data))
    ? node.data as Record<string, unknown>
    : {}
  const data: Record<string, unknown> = {}
  if (fields.has('summary')) {
    for (const key of ['name', 'chapterSummary']) {
      if (source[key] !== undefined) data[key] = source[key]
    }
  }
  if (fields.has('interaction') && source.interaction !== undefined) {
    data.interaction = source.interaction
  }
  if (fields.has('storyText') && source.storyText !== undefined) {
    data.storyText = source.storyText
  }
  if (fields.has('overlays') && source.overlayNodes !== undefined) {
    data.overlayNodes = source.overlayNodes
  }
  return { ...node, data }
}

/**
 * Build a bounded business-side graph shard. The returned DTO intentionally
 * does not pretend to be a complete GraphLibraryDocument: callers must carry
 * the revision from the surrounding get_graph response when they patch it.
 */
export function projectGraphShard(
  project: GraphLibraryDocument,
  selector: GraphProjectionSelector,
): GraphShard {
  const blueprintId = selector.blueprintId ?? project.manifest.mainPackId
  const pack = project.manifest.packs[blueprintId]
  if (!pack) throw new Error(`Unknown blueprint "${blueprintId}"`)

  const fields = selector.fields && selector.fields.length > 0
    ? new Set(selector.fields)
    : null
  const requestedNodeIds = selector.nodeIds && selector.nodeIds.length > 0
    ? new Set(selector.nodeIds)
    : null
  const nodes = pack.graph.nodes
    .filter((node) => !requestedNodeIds || requestedNodeIds.has(node.id))
    .map((node) => projectNode(node as unknown as Record<string, unknown>, fields))
  const selectedIds = new Set(nodes.map((node) => String(node.id)))
  const edges = fields && !fields.has('edges')
    ? []
    : pack.graph.edges
      .filter((edge) => !requestedNodeIds
        || (requestedNodeIds.has(edge.source) && requestedNodeIds.has(edge.target)))
      .map((edge) => edge as unknown as Record<string, unknown>)

  return {
    blueprintId,
    title: pack.title,
    ...(pack.version ? { version: pack.version } : {}),
    entry: pack.entry,
    graph: {
      nodes,
      edges: edges.filter((edge) => (
        selectedIds.has(String(edge.source)) && selectedIds.has(String(edge.target))
      )),
    },
  }
}
