import { createHash } from 'node:crypto'
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import type { OutlineDesignSnapshot } from '@/workflow/contracts'

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
    .join(',')}}`
}

export function outlineDesignSurface(project: GraphLibraryDocument): OutlineDesignSnapshot['blueprints'] {
  return Object.fromEntries(Object.entries(project.manifest.packs)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([blueprintId, blueprint]) => [blueprintId, {
      nodes: blueprint.graph.nodes
        .map((node) => ({
          id: node.id,
          type: node.type,
          ...(node.data.chapterSummary ? { chapterSummary: node.data.chapterSummary } : {}),
          ...(node.data.interaction ? { interaction: node.data.interaction } : {}),
          ...(node.data.outcomeEvidence ? { outcomeEvidence: node.data.outcomeEvidence } : {}),
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      edges: blueprint.graph.edges
        .map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
          ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
          ...(edge.data?.design ? { design: edge.data.design } : {}),
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    }]))
}

export function captureOutlineDesignSnapshot(
  project: GraphLibraryDocument,
  projectRevision: number,
  capturedAt = new Date().toISOString(),
): OutlineDesignSnapshot {
  const blueprints = outlineDesignSurface(project)
  return {
    schemaVersion: 1,
    projectRevision,
    digest: createHash('sha256').update(stable(blueprints)).digest('hex'),
    capturedAt,
    blueprints,
  }
}

export function outlineDesignDrift(
  project: GraphLibraryDocument,
  snapshot: OutlineDesignSnapshot | undefined,
): string[] {
  if (!snapshot) return ['缺少 blueprint.outline 设计快照，不能在后续活动修改图拓扑']
  return outlineDesignSurfaceDrift(snapshot.blueprints, outlineDesignSurface(project))
}

function outlineDesignSurfaceDrift(
  beforeSurface: OutlineDesignSnapshot['blueprints'],
  current: OutlineDesignSnapshot['blueprints'],
): string[] {
  if (stable(current) === stable(beforeSurface)) return []
  const issues: string[] = []
  const blueprintIds = new Set([...Object.keys(beforeSurface), ...Object.keys(current)])
  for (const blueprintId of blueprintIds) {
    const before = beforeSurface[blueprintId]
    const after = current[blueprintId]
    if (!before || !after) {
      issues.push(`蓝图集合发生变化：${blueprintId}`)
      continue
    }
    if (stable(before.nodes) !== stable(after.nodes)) issues.push(`${blueprintId} 的节点/章节/interaction/outcomeEvidence 发生变化`)
    if (stable(before.edges) !== stable(after.edges)) issues.push(`${blueprintId} 的边端点/handle/design 发生变化`)
  }
  return issues
}

/** 旧 workflow 没有持久化快照时，只判断当前 mutation 是否造成设计漂移。 */
export function outlineDesignMutationDrift(
  before: GraphLibraryDocument,
  after: GraphLibraryDocument,
): string[] {
  return outlineDesignSurfaceDrift(outlineDesignSurface(before), outlineDesignSurface(after))
}
