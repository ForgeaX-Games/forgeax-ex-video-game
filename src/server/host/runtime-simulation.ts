import type { ExtensionContext } from '@forgeax/extension-host/node'
import { GraphSession } from '@/runtime/core/engine/session'
import type { GameEdge, GameGraph, GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import { ensureBuiltinSchemes } from '@/authoring/demo/builtin-schemes'
import { toRuntimeScenario } from '@/authoring/blueprint/formula-authoring'
import type { ValidationEvidence, ValidationIssue, VideoGameActivity } from '../../workflow/contracts'
import { inspectProject } from './project-inspection'

interface BlueprintSimulation {
  blueprintId: string
  entryNodeId: string
  reachableNodeIds: string[]
  terminalNodeIds: string[]
  restNodeIds: string[]
  sampledPaths: string[][]
  sampledEdgePaths: string[][]
  runtimeVisitedNodeIds: string[]
  runtimeTraversedEdgeIds: string[]
  issues: ValidationIssue[]
}

function analyzeGraph(blueprintId: string, entry: string, graph: GameGraph): BlueprintSimulation {
  const outgoing = new Map<string, string[]>()
  const automaticOutgoing = new Map<string, string[]>()
  const reverse = new Map<string, string[]>()
  graph.edges.forEach((edge) => {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target])
    if (edge.sourceHandle === undefined || edge.sourceHandle === 'default') {
      automaticOutgoing.set(edge.source, [...(automaticOutgoing.get(edge.source) ?? []), edge.target])
    }
    reverse.set(edge.target, [...(reverse.get(edge.target) ?? []), edge.source])
  })
  const reachable = new Set<string>()
  const queue = [entry]
  while (queue.length) {
    const nodeId = queue.shift()!
    if (reachable.has(nodeId)) continue
    reachable.add(nodeId)
    queue.push(...(outgoing.get(nodeId) ?? []))
  }
  const terminals = [...reachable].filter((nodeId) => (outgoing.get(nodeId) ?? []).length === 0)
  // 没有默认出边就会停下来：无任何出边是终局，只有事件出边则等待玩家输入。
  // 两种都是一次“人工模拟 runtime”可以安全停住的状态。
  const restPoints = [...reachable].filter((nodeId) => (automaticOutgoing.get(nodeId) ?? []).length === 0)
  const restPointSet = new Set(restPoints)
  const canReachRest = new Set(restPoints)
  const reverseQueue = [...restPoints]
  while (reverseQueue.length) {
    const nodeId = reverseQueue.shift()!
    for (const prior of reverse.get(nodeId) ?? []) {
      if (!reachable.has(prior) || canReachRest.has(prior)) continue
      canReachRest.add(prior)
      reverseQueue.push(prior)
    }
  }
  const issues: ValidationIssue[] = []
  for (const nodeId of reachable) {
    if (!canReachRest.has(nodeId)) issues.push({
      level: 'error',
      code: 'playtest.path.non-terminating',
      message: `节点 ${nodeId} 所在路径无法到达终局或等待玩家输入的停留点`,
      location: { kind: 'blueprint', blueprintId, nodeId },
    })
  }
  const edgesBySource = new Map<string, GameEdge[]>()
  graph.edges.forEach((edge) => edgesBySource.set(edge.source, [...(edgesBySource.get(edge.source) ?? []), edge]))
  const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]))
  const shortestEdgePath = (from: string, accepts: (nodeId: string) => boolean): string[] | null => {
    const searchQueue: Array<{ nodeId: string; edgeIds: string[] }> = [{ nodeId: from, edgeIds: [] }]
    const seen = new Set<string>()
    while (searchQueue.length) {
      const current = searchQueue.shift()!
      if (seen.has(current.nodeId)) continue
      seen.add(current.nodeId)
      if (accepts(current.nodeId)) return current.edgeIds
      for (const edge of edgesBySource.get(current.nodeId) ?? []) {
        searchQueue.push({ nodeId: edge.target, edgeIds: [...current.edgeIds, edge.id] })
      }
    }
    return null
  }
  const sampledEdgePaths = [...reachable].flatMap((source) => (
    (edgesBySource.get(source) ?? []).map((edge) => {
      const prefix = shortestEdgePath(entry, (nodeId) => nodeId === source)
      const suffix = shortestEdgePath(edge.target, (nodeId) => restPointSet.has(nodeId))
      return prefix && suffix ? [...prefix, edge.id, ...suffix] : null
    }).filter((path): path is string[] => path !== null)
  ))
  if (sampledEdgePaths.length === 0 && restPointSet.has(entry)) sampledEdgePaths.push([])
  const uniqueEdgePaths = [...new Map(sampledEdgePaths.map((path) => [path.join('\u0000'), path])).values()]
  const sampledPaths = uniqueEdgePaths.map((edgePath) => {
    const nodes = [entry]
    edgePath.forEach((edgeId) => nodes.push(edgeById.get(edgeId)!.target))
    return nodes
  })
  return {
    blueprintId,
    entryNodeId: entry,
    reachableNodeIds: [...reachable],
    terminalNodeIds: terminals,
    restNodeIds: restPoints,
    sampledPaths,
    sampledEdgePaths: uniqueEdgePaths,
    runtimeVisitedNodeIds: [],
    runtimeTraversedEdgeIds: [],
    issues,
  }
}

function advanceThroughEdge(session: GraphSession, edge: GameEdge): void {
  const before = session.snapshot
  let after = before
  const handle = edge.sourceHandle ?? 'default'
  if (handle === 'default') {
    after = session.performanceEnd()
  } else {
    const interactiveElement = before.overlayMounts.flatMap((mount) => mount.children)[0]
    if (!interactiveElement) {
      throw new Error(`节点 ${edge.source} 的出口 ${handle} 没有可接收选择输入的界面元素`)
    }
    after = session.emitEvent(interactiveElement.elementId, handle)
  }
  if (!after.traversedEdgeIds.includes(edge.id)) {
    throw new Error(`真实运行时没有沿目标边 ${edge.id} (${edge.source} -> ${edge.target}) 推进`)
  }
}

function runGraphSessions(
  project: GraphLibraryDocument,
  simulation: BlueprintSimulation,
): void {
  const pack = project.manifest.packs[simulation.blueprintId]!
  const authoringScenario: GraphLibraryDocument = {
    ...project,
    graph: pack.graph,
    manifest: { ...project.manifest, mainPackId: simulation.blueprintId },
    ui: {
      ...(project.ui ?? {}),
      overlays: ensureBuiltinSchemes(project.ui?.overlays),
    },
  }
  const scenario = toRuntimeScenario(authoringScenario)
  try {
    const edgesById = new Map(pack.graph.edges.map((edge) => [edge.id, edge]))
    for (const edgePath of simulation.sampledEdgePaths) {
      const session = new GraphSession(scenario, { rootBlueprintId: simulation.blueprintId, rngSeed: 0 })
      let snapshot = session.start()
      // `start()` 会沿默认出口自动推进若干节点（例如 entry → n1 → n2），而采样路径是
      // 从入口开始逐边枚举的。两者天然错位：重放到第一条边时运行时已经在下游了。
      // 之前把这种错位判成失败，还报「预期进入 entry」，把 Agent 引向反方向——
      // 实测整装阶段因此陷入「改边 → 试玩失败 → 再改同样的边」的死循环。
      const visited = new Set<string>(snapshot.visited)
      simulation.runtimeVisitedNodeIds.push(...snapshot.visited)
      for (const edgeId of edgePath) {
        const edge = edgesById.get(edgeId)
        if (!edge) throw new Error(`simulation edge ${edgeId} is missing`)
        if (snapshot.currentNodeId !== edge.source) {
          // 自动推进已经走过这条边：跳过，不是错误。
          if (visited.has(edge.target)) continue
          throw new Error(
            `运行时停在 ${snapshot.currentNodeId ?? 'ended'}，`
            + `但采样路径的下一条边 ${edgeId} 要求从 ${edge.source} 出发；`
            + `请检查该节点的出口条件或 reaction 是否让运行时提前离开了这条路径`,
          )
        }
        advanceThroughEdge(session, edge)
        snapshot = session.snapshot
        for (const nodeId of snapshot.visited) visited.add(nodeId)
        simulation.runtimeVisitedNodeIds.push(...snapshot.visited)
        simulation.runtimeTraversedEdgeIds.push(...snapshot.traversedEdgeIds)
      }
      if (snapshot.phase !== 'ended') {
        snapshot = session.performanceEnd()
      }
      if (
        snapshot.phase !== 'ended'
        && (!snapshot.currentNodeId || !simulation.restNodeIds.includes(snapshot.currentNodeId))
      ) {
        throw new Error(`路径 ${edgePath.join(' -> ')} 未到达终局或等待玩家输入的停留点`)
      }
    }
    simulation.runtimeVisitedNodeIds = [...new Set(simulation.runtimeVisitedNodeIds)]
    simulation.runtimeTraversedEdgeIds = [...new Set(simulation.runtimeTraversedEdgeIds)]
  } catch (cause) {
    simulation.issues.push({
      level: 'error',
      code: 'playtest.runtime.error',
      message: cause instanceof Error ? cause.message : String(cause),
      location: { kind: 'blueprint', blueprintId: simulation.blueprintId },
    })
  }
}

export async function simulatePassA(
  context: ExtensionContext,
  activityRevision: number,
  activity: VideoGameActivity = 'playtest.validating',
): Promise<{
  schemaVersion: 1
  ok: boolean
  projectRevision: number
  simulations: BlueprintSimulation[]
  evidence: ValidationEvidence
}> {
  const inspected = await inspectProject(context)
  const simulations = inspected.project
    ? Object.entries(inspected.project.manifest.packs).map(([blueprintId, pack]) => {
      const simulation = analyzeGraph(blueprintId, pack.entry, pack.graph)
      runGraphSessions(inspected.project!, simulation)
      return simulation
    })
    : []
  const issues = [
    ...inspected.issues,
    ...simulations.flatMap((simulation) => simulation.issues),
  ]
  if (simulations.length === 0) issues.push({
    level: 'error', code: 'playtest.blueprint.missing', message: '没有可执行的蓝图',
  })
  const evidence: ValidationEvidence = {
    schemaVersion: 1,
    activity,
    activityRevision,
    projectRevision: inspected.projectRevision,
    checkId: 'playtest.all-required-paths-reach-terminal',
    status: 'pass',
    observedAt: new Date().toISOString(),
    details: {
      engine: 'GraphSession',
      mode: 'blueprint-logic-only',
      mediaRequired: false,
      blueprintCount: simulations.length,
      runtimeVisitedNodeCount: simulations.reduce((sum, item) => sum + item.runtimeVisitedNodeIds.length, 0),
      runtimeTraversedEdgeCount: simulations.reduce((sum, item) => sum + item.runtimeTraversedEdgeIds.length, 0),
      terminalPathSampleCount: simulations.reduce((sum, item) => sum + item.sampledPaths.length, 0),
      restPathSampleCount: simulations.reduce((sum, item) => sum + item.sampledPaths.length, 0),
      restPointCount: simulations.reduce((sum, item) => sum + item.restNodeIds.length, 0),
    },
    ...(issues.length ? { issues } : {}),
  }
  return { schemaVersion: 1, ok: true, projectRevision: inspected.projectRevision, simulations, evidence }
}
