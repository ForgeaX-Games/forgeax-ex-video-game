import type { BlueprintDoc, GameGraph, GameScenario } from '@/runtime/core/schema/graph-schema'
import { getSubProcess } from '@/runtime/core/schema/graph-schema'

/** A node binding to a video resource id inside a graph scope. */
export interface VideoReference {
  /** Graph scope id: `main` for the main blueprint or pack id for sub-blueprints. */
  graphId: string
  /** Human-readable graph label for confirm dialogs. */
  graphLabel: string
  nodeId: string
  nodeName: string
  graphPath?: string[]
}

export interface FindVideoReferencesOptions {
  /** Editor blueprint library (`manifest.packs`); when omitted, only `scenario.graph` is scanned. */
  blueprints?: Record<string, BlueprintDoc>
  /** Main blueprint id — scanned as `main` / `主图` to match delete-dialog copy. */
  mainPackId?: string
}

function refKey(graphId: string, nodeId: string): string {
  return `${graphId}\0${nodeId}`
}

function scanGraph(
  graph: GameGraph,
  graphId: string,
  graphLabel: string,
  resourceId: string,
  seen: Set<string>,
  out: VideoReference[],
  path: string[] = [],
): void {
  for (const node of graph.nodes) {
    const ref = node.data.media?.ref
    if (ref === resourceId) {
      const key = refKey(graphId, node.id)
      if (!seen.has(key)) {
        seen.add(key)
        out.push({
          graphId,
          graphLabel,
          nodeId: node.id,
          nodeName: node.data.name || node.id,
          ...(path.length > 0 ? { graphPath: [...path] } : {}),
        })
      }
    }
    const process = getSubProcess(node.data)
    if (process) {
      scanGraph(
        process.graph,
        graphId,
        `${graphLabel} / ${node.data.name || node.id}`,
        resourceId,
        seen,
        out,
        [...path, node.id],
      )
    }
  }
}

/**
 * Collect perf-node bindings that reference `resourceId` via exact `media.ref` match.
 * Scans the main graph and every blueprint pack graph; does not mutate schema or guess aliases.
 */
export function findVideoReferences(
  scenario: GameScenario,
  resourceId: string,
  options: FindVideoReferencesOptions = {},
): VideoReference[] {
  if (!resourceId) {
    return []
  }

  const seen = new Set<string>()
  const out: VideoReference[] = []
  const { blueprints, mainPackId } = options

  if (blueprints && Object.keys(blueprints).length > 0) {
    for (const pack of Object.values(blueprints)) {
      const isMain = mainPackId ? pack.id === mainPackId : false
      scanGraph(
        pack.graph,
        isMain ? 'main' : pack.id,
        isMain ? '主图' : (pack.title?.trim() || pack.id),
        resourceId,
        seen,
        out,
      )
    }
    return out
  }

  scanGraph(scenario.graph, 'main', '主图', resourceId, seen, out)
  return out
}
