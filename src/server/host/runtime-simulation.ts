import type { ExtensionContext } from '@forgeax/extension-host/node'
import { GraphSession } from '@/runtime/core/engine/session'
import type { GameEdge, GameGraph, GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import { eventsFromParams } from '@/runtime/core/schema/graph-schema'
import { expandNodeOverlays } from '@/runtime/core/schema/expand-overlay'
import { ensureBuiltinSchemes } from '@/authoring/overlays/builtin-schemes'
import { toRuntimeScenario } from '@/authoring/blueprint/formula-authoring'
import type { ValidationEvidence, ValidationIssue, VideoGameActivity } from '../../workflow/contracts'
import { inspectProject } from './project-inspection'
import { componentContractMap } from './component-catalog'

const REPRESENTATIVE_RNG_SEEDS = [0, 1, 7] as const

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
  runtimeSeeds: number[]
  runtimeRunCount: number
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
    runtimeSeeds: [],
    runtimeRunCount: 0,
    issues,
  }
}

function advanceThroughEdge(
  session: GraphSession,
  edge: GameEdge,
  project: GraphLibraryDocument,
  blueprintId: string,
): void {
  const before = session.snapshot
  let after = before
  const handle = edge.sourceHandle ?? 'default'
  if (handle === 'default') {
    after = session.performanceEnd()
  } else {
    const node = project.manifest.packs[blueprintId]?.graph.nodes.find((candidate) => candidate.id === edge.source)
    const producerRef = edge.data?.design?.producer.kind === 'component-event'
      ? edge.data.design.producer.ref
      : undefined
    const separator = producerRef?.lastIndexOf('.') ?? -1
    const producerComponent = separator > 0 ? producerRef!.slice(0, separator) : undefined
    const eventId = separator > 0 ? producerRef!.slice(separator + 1) : handle
    const contracts = componentContractMap()
    const authoringChildren = node
      ? expandNodeOverlays(project.ui?.overlays ?? {}, node).flatMap((mount) => mount.children)
      : []
    const exactChild = authoringChildren.find((child) => {
        if (producerComponent && child.component !== producerComponent) return false
        const dynamic = eventsFromParams(child.inputs).map((event) => event.id)
        const events = dynamic.length > 0 ? dynamic : (contracts.get(child.component)?.events.map((event) => event.id) ?? [])
        return events.includes(eventId)
      })
    // 旧蓝图没有 edge.data.design，历史 TextOption 还可能使用任意 handle；只对这种存量数据
    // 保留首元素回放。新蓝图一旦声明 producer，就必须精确命中组件和事件。
    const authoringChild = exactChild ?? (!producerRef ? authoringChildren[0] : undefined)
    if (authoringChild?.window && !before.overlayMounts.flatMap((mount) => mount.children)
      .some((child) => child.elementId === authoringChild.id)) {
      after = session.tick(authoringChild.window.startMs ?? 0)
    }
    const interactiveElement = after.overlayMounts.flatMap((mount) => mount.children)
      .find((child) => child.elementId === authoringChild?.id)
    if (!interactiveElement) {
      throw new Error(`节点 ${edge.source} 的出口 ${handle} 没有与 producer 对齐的可交互界面元素`)
    }
    after = session.emitEvent(interactiveElement.elementId, eventId)
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
      for (const rngSeed of REPRESENTATIVE_RNG_SEEDS) {
      const session = new GraphSession(scenario, { rootBlueprintId: simulation.blueprintId, rngSeed })
      simulation.runtimeSeeds.push(rngSeed)
      simulation.runtimeRunCount += 1
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
        advanceThroughEdge(session, edge, authoringScenario, simulation.blueprintId)
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
    }
    simulation.runtimeVisitedNodeIds = [...new Set(simulation.runtimeVisitedNodeIds)]
    simulation.runtimeTraversedEdgeIds = [...new Set(simulation.runtimeTraversedEdgeIds)]
    simulation.runtimeSeeds = [...new Set(simulation.runtimeSeeds)]
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
  qualityMetrics: Awaited<ReturnType<typeof inspectProject>>['qualityMetrics']
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
    status: issues.some((entry) => entry.level === 'error') ? 'fail' : 'pass',
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
      rngSeeds: REPRESENTATIVE_RNG_SEEDS,
      runtimeRunCount: simulations.reduce((sum, item) => sum + item.runtimeRunCount, 0),
      qualityMetrics: inspected.qualityMetrics,
    },
    ...(issues.length ? { issues } : {}),
  }
  return {
    schemaVersion: 1,
    ok: evidence.status === 'pass',
    projectRevision: inspected.projectRevision,
    simulations,
    qualityMetrics: inspected.qualityMetrics,
    evidence,
  }
}
