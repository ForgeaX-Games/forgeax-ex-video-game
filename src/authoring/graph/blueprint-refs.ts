/** 跨蓝图引用图谱：收集 subFlowPack 引用、找引用者、加边前的成环检测。 */
import type { BlueprintDoc, GameGraph, GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import { getSubFlowPack, getSubProcess } from '@/runtime/core/schema/graph-schema'

export type BlueprintMap = Record<string, BlueprintDoc>

export function collectPackRefs(graph: GameGraph): Set<string> {
  const out = new Set<string>()
  for (const n of graph.nodes) {
    const p = getSubFlowPack(n.data)
    if (p) out.add(p.id)
    const process = getSubProcess(n.data)
    if (process) for (const ref of collectPackRefs(process.graph)) out.add(ref)
  }
  return out
}

function asMap(src: BlueprintMap | GraphLibraryDocument): BlueprintMap {
  // BlueprintMap 是 Record，不能靠 `'manifest' in src` 判别（可能刚好有 id=manifest 的条目）。
  const doc = src as GraphLibraryDocument
  if (doc.manifest?.packs && typeof doc.graph === 'object') return doc.manifest.packs
  return src as BlueprintMap
}

export function blueprintsReferencing(src: BlueprintMap | GraphLibraryDocument, targetId: string): string[] {
  const blueprints = asMap(src)
  const out: string[] = []
  for (const [id, doc] of Object.entries(blueprints)) {
    if (id === targetId) continue
    if (collectPackRefs(doc.graph).has(targetId)) out.push(id)
  }
  return out.sort()
}

/**
 * 成环检测（存量扫描）。命中环时返回路径（如 `['a','b','a']`），否则 null。
 */
export function findReferenceCycle(src: BlueprintMap | GraphLibraryDocument): string[] | null {
  const blueprints = asMap(src)
  const path: string[] = []
  const onPath = new Set<string>()
  const done = new Set<string>()

  function visit(id: string): string[] | null {
    if (onPath.has(id)) return [...path.slice(path.indexOf(id)), id]
    if (done.has(id)) return null
    const doc = blueprints[id]
    if (!doc) return null
    path.push(id)
    onPath.add(id)
    for (const ref of collectPackRefs(doc.graph)) {
      const cyc = visit(ref)
      if (cyc) return cyc
    }
    path.pop()
    onPath.delete(id)
    done.add(id)
    return null
  }

  for (const id of Object.keys(blueprints)) {
    const cyc = visit(id)
    if (cyc) return cyc
  }
  return null
}

export function wouldCreateCycle(src: BlueprintMap | GraphLibraryDocument, fromId: string, toId: string): boolean {
  if (fromId === toId) return true
  const blueprints = asMap(src)
  const seen = new Set<string>()
  const stack = [toId]
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === fromId) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    const doc = blueprints[cur]
    if (!doc) continue
    for (const ref of collectPackRefs(doc.graph)) stack.push(ref)
  }
  return false
}
