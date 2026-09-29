import { randomUUID } from 'node:crypto'
import type {
  EdgeRouting,
  GameGraph,
  GameNode,
  GraphLibraryDocument,
  NodeBgm,
  OverlayChild,
  OverlayNode,
} from '@/runtime/core/schema/graph-schema'
import { normalizeDocument } from '@/authoring/blueprint/blueprint-project'
import {
  createBlueprint as createBlueprintInLibrary,
  deleteBlueprint as deleteBlueprintInLibrary,
  renameBlueprint as renameBlueprintInLibrary,
  setMainBlueprint as setMainBlueprintInLibrary,
  withBlueprintLibrary,
} from '@/authoring/blueprint/blueprint-library-edit'
import {
  attachSubProcess,
  duplicateNodes,
  insertNodeAfter,
  insertNodeBefore,
  patchNodeData,
  type ConnectSpec,
  type NodeDataPatch,
} from '@/authoring/graph/graph-edit'
import {
  addOverlayChild,
  ensureNodeOverlay,
  patchOverlayChild,
  patchOverlayChildParams,
  patchOverlayMount,
  removeOverlayChild,
  resetOverride,
} from '@/authoring/graph/overlay-edit'
import { wouldCreateCycle } from '@/authoring/graph/blueprint-refs'
import { patchNodeBgm } from '@/authoring/audio/bgm-authoring'
import {
  executeBlueprintGraphCommands,
  type BlueprintGraphCommand,
} from '@/authoring/commands/blueprint-graph-command'

export type PatchGraphInput = {
  blueprintId?: string
  ops: Array<Record<string, unknown>>
}

export type PatchGraphApplyResult =
  | { ok: true; document: GraphLibraryDocument; applied: number }
  | { ok: false; errors: string[]; failedOpIndex?: number }

function executeTopologyCommand(
  graph: GameGraph,
  command: BlueprintGraphCommand,
  opIndex: number,
): GameGraph {
  const result = executeBlueprintGraphCommands(graph, [command])
  if (!result.ok) throw new Error(`op[${opIndex}] ${result.errors.join('; ')}`)
  return result.graph
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function overlayNodesWrittenByOp(op: Record<string, unknown>): unknown | undefined {
  const kind = String(op.op ?? '')
  if (kind === 'set-node-data') {
    const patch = recordOrNull(op.patch)
    return patch && Object.hasOwn(patch, 'overlayNodes') ? patch.overlayNodes : undefined
  }
  if (kind === 'add-node' || kind === 'insert-node-after' || kind === 'insert-node-before') {
    const node = recordOrNull(op.node)
    const data = recordOrNull(node?.data)
    return data && Object.hasOwn(data, 'overlayNodes') ? data.overlayNodes : undefined
  }
  return undefined
}

/** UI writes include helper ops and direct writes through NodeData.overlayNodes. */
export function graphOpTouchesUi(op: Record<string, unknown>): boolean {
  const kind = String(op.op ?? '')
  return kind.includes('overlay') || kind === 'duplicate-nodes' || overlayNodesWrittenByOp(op) !== undefined
}

/** 支柱到总脉络的玩法设计只允许在 blueprint.outline 写入；后续活动只能编译和接线。 */
export function graphOpTouchesInteractionDesign(op: Record<string, unknown>): boolean {
  const kind = String(op.op ?? '')
  if (kind === 'set-node-data') return Object.hasOwn(recordOrNull(op.patch) ?? {}, 'interaction')
  if (kind === 'add-node' || kind === 'insert-node-after' || kind === 'insert-node-before') {
    return Object.hasOwn(recordOrNull(recordOrNull(op.node)?.data) ?? {}, 'interaction')
  }
  if (kind === 'connect' || kind === 'update-edge-data') {
    return Object.hasOwn(recordOrNull(op.data) ?? {}, 'design')
  }
  return kind === 'duplicate-nodes'
}

/**
 * Agent UI authoring may mount and configure any overlay that already exists
 * in the `ui.overlays` catalog — `base:*` single-component schemes (控件目录),
 * author-built reusable templates (模板目录), and per-node `node:*` content
 * containers alike. It may not create new catalog entries or local children
 * through the patch surface.
 */
export function agentUiPatchErrors(
  document: GraphLibraryDocument,
  ops: Array<Record<string, unknown>>,
): string[] {
  const errors: string[] = []
  const overlays = document.ui?.overlays ?? {}

  ops.forEach((op, opIndex) => {
    const kind = String(op.op ?? '')
    if (kind.includes('overlay')) {
      errors.push(
        `op[${opIndex}] ${kind} 不允许用于 Agent 界面整装；`
        + '只能用 set-node-data 写完整 overlayNodes，并挂载已有 base:* 控件、自定义模板或 node:* 节点内容容器',
      )
      return
    }

    const value = overlayNodesWrittenByOp(op)
    if (value === undefined) return
    if (!Array.isArray(value)) {
      errors.push(`op[${opIndex}] overlayNodes 必须是完整数组`)
      return
    }

    value.forEach((rawMount, mountIndex) => {
      const mount = recordOrNull(rawMount)
      if (!mount) {
        errors.push(`op[${opIndex}] overlayNodes[${mountIndex}] 必须是对象`)
        return
      }
      const overlayId = typeof mount.overlay === 'string' ? mount.overlay : ''
      const prototype = overlays[overlayId]
      if (!prototype) {
        errors.push(
          `op[${opIndex}] 引用了界面目录里不存在的模板、控件或节点内容容器 ${overlayId || '(empty)'}；请先用 get_graph 读取 ui.overlays 目录`,
        )
        return
      }
      if (Object.hasOwn(mount, 'added') || Object.hasOwn(mount, 'removed')) {
        errors.push(
          `op[${opIndex}] ${overlayId} 挂载不得写 added/removed；只能配置模板、控件或节点内容容器已有 childId`,
        )
      }

      const overrides = mount.overrides
      if (overrides === undefined) return
      const overrideMap = recordOrNull(overrides)
      if (!overrideMap) {
        errors.push(`op[${opIndex}] ${overlayId}.overrides 必须是 childId 到配置补丁的对象`)
        return
      }
      const childIds = new Set(prototype.children.map((child) => child.id))
      Object.entries(overrideMap).forEach(([childId, rawPatch]) => {
        if (!childIds.has(childId)) {
          errors.push(`op[${opIndex}] ${overlayId} 不存在 childId ${childId}，不得新增节点本地控件`)
          return
        }
        const childPatch = recordOrNull(rawPatch)
        if (!childPatch) {
          errors.push(`op[${opIndex}] ${overlayId}/${childId} override 必须是对象`)
          return
        }
        if (Object.hasOwn(childPatch, 'id') || Object.hasOwn(childPatch, 'component')) {
          errors.push(`op[${opIndex}] ${overlayId}/${childId} 不得覆盖 id/component，只能配置模板或控件参数`)
        }
      })
    })
  })

  return errors
}

function resolvePackId(doc: GraphLibraryDocument, blueprintId?: string): string {
  return blueprintId ?? doc.manifest.mainPackId
}

function withPackGraph(
  doc: GraphLibraryDocument,
  packId: string,
  nextGraph: GameGraph,
): GraphLibraryDocument {
  const pack = doc.manifest.packs[packId]
  if (!pack) throw new Error(`blueprint not found: ${packId}`)
  const packs = {
    ...doc.manifest.packs,
    [packId]: { ...pack, graph: nextGraph },
  }
  return normalizeDocument({
    ...doc,
    manifest: { ...doc.manifest, packs },
  })
}

function requireString(op: Record<string, unknown>, key: string, index: number): string {
  const value = String(op[key] ?? '')
  if (!value) throw new Error(`op[${index}] missing ${key}`)
  return value
}

/**
 * 编辑 helper 对缺失目标一律 no-op（画布手势需要这种宽容），但工具批次必须硬失败：
 * 否则 AI 拿着错 id 也能收到 ok，改动静默丢失。
 */
function requireNode(graph: GameGraph, nodeId: string): void {
  if (!graph.nodes.some((node) => node.id === nodeId)) {
    throw new Error(`node not found: ${nodeId}`)
  }
}

function requireEdge(graph: GameGraph, edgeId: string): void {
  if (!graph.edges.some((edge) => edge.id === edgeId)) {
    throw new Error(`edge not found: ${edgeId}`)
  }
}

function applyOverlayOp(
  doc: GraphLibraryDocument,
  packId: string,
  nodeId: string,
  edit: (scenario: GraphLibraryDocument) => GraphLibraryDocument,
): GraphLibraryDocument {
  const graph = doc.manifest.packs[packId]!.graph
  requireNode(graph, nodeId)
  const scenario = edit({ ...doc, graph })
  return withPackGraph({ ...doc, ui: scenario.ui }, packId, scenario.graph)
}

export function applyPatchGraphOps(
  inputDoc: GraphLibraryDocument,
  input: PatchGraphInput,
): PatchGraphApplyResult {
  if (!Array.isArray(input.ops) || input.ops.length === 0) {
    return { ok: false, errors: ['ops must be a non-empty array'] }
  }

  let doc = normalizeDocument(structuredClone(inputDoc))
  const packId = resolvePackId(doc, input.blueprintId)
  if (!doc.manifest.packs[packId]) {
    return { ok: false, errors: [`blueprint not found: ${packId}`], failedOpIndex: 0 }
  }

  for (let i = 0; i < input.ops.length; i++) {
    const op = input.ops[i]!
    const kind = String(op.op)
    try {
      let graph = doc.manifest.packs[packId]!.graph
      if (kind === 'set-node-field') {
        const nodeId = String(op.nodeId ?? '')
        const field = String(op.field ?? '')
        if (!nodeId || !field) throw new Error(`op[${i}] missing nodeId/field`)
        const node = graph.nodes.find((n) => n.id === nodeId)
        if (!node) throw new Error(`node not found: ${nodeId}`)
        if (field === 'name') {
          graph = patchNodeData(graph, nodeId, { name: String(op.value) })
        } else if (field === 'type') {
          graph = {
            ...graph,
            nodes: graph.nodes.map((n) =>
              n.id === nodeId ? { ...n, type: String(op.value) as typeof n.type } : n,
            ),
          }
        } else if (field === 'position') {
          const pos = op.value as { x: number; y: number }
          if (!Number.isFinite(pos?.x) || !Number.isFinite(pos?.y)) {
            throw new Error(`op[${i}] position must contain finite x/y`)
          }
          graph = executeTopologyCommand(graph, {
            op: 'set-node-position',
            nodeId,
            position: { x: pos.x, y: pos.y },
          }, i)
        } else {
          throw new Error(`unsupported field: ${field}`)
        }
        doc = withPackGraph(doc, packId, graph)
      } else if (kind === 'set-node-data') {
        const nodeId = requireString(op, 'nodeId', i)
        requireNode(graph, nodeId)
        const patch = { ...(op.patch as Record<string, unknown>) }
        for (const [key, value] of Object.entries(patch)) {
          if (value === null) patch[key] = undefined
        }
        graph = patchNodeData(graph, nodeId, patch as NodeDataPatch)
        doc = withPackGraph(doc, packId, graph)
      } else if (kind === 'add-node') {
        const node = structuredClone(op.node) as GameNode
        if (!node || typeof node !== 'object') throw new Error(`op[${i}] missing node`)
        if (!node.id) node.id = `n-${randomUUID()}`
        doc = withPackGraph(doc, packId, executeTopologyCommand(graph, { op: 'add-node', node }, i))
      } else if (kind === 'remove-node') {
        const nodeId = requireString(op, 'nodeId', i)
        requireNode(graph, nodeId)
        doc = withPackGraph(doc, packId, executeTopologyCommand(graph, { op: 'remove-node', nodeId }, i))
      } else if (kind === 'insert-node-after') {
        const afterId = requireString(op, 'afterId', i)
        requireNode(graph, afterId)
        const inserted = insertNodeAfter(graph, afterId, {
          name: typeof op.name === 'string' ? op.name : undefined,
          gapX: typeof op.gapX === 'number' ? op.gapX : undefined,
          gapY: typeof op.gapY === 'number' ? op.gapY : undefined,
          sourceHandle: typeof op.sourceHandle === 'string' ? op.sourceHandle : undefined,
          position: op.position as { x: number; y: number } | undefined,
          node: op.node as GameNode | undefined,
        })
        doc = withPackGraph(doc, packId, inserted.graph)
      } else if (kind === 'insert-node-before') {
        const beforeId = requireString(op, 'beforeId', i)
        requireNode(graph, beforeId)
        const inserted = insertNodeBefore(graph, beforeId, {
          name: typeof op.name === 'string' ? op.name : undefined,
          gapX: typeof op.gapX === 'number' ? op.gapX : undefined,
          gapY: typeof op.gapY === 'number' ? op.gapY : undefined,
          position: op.position as { x: number; y: number } | undefined,
          node: op.node as GameNode | undefined,
        })
        doc = withPackGraph(doc, packId, inserted.graph)
      } else if (kind === 'duplicate-nodes') {
        const copies = op.copies as Array<{ sourceId?: unknown; targetId?: unknown }>
        if (!Array.isArray(copies) || copies.length === 0) throw new Error(`op[${i}] missing copies`)
        const sourceIds: string[] = []
        const nodeIdForSource: Record<string, string> = {}
        const targetIds = new Set<string>()
        for (const [copyIndex, copy] of copies.entries()) {
          const sourceId = String(copy?.sourceId ?? '')
          const targetId = String(copy?.targetId ?? '')
          if (!sourceId || !targetId) throw new Error(`op[${i}].copies[${copyIndex}] missing sourceId/targetId`)
          requireNode(graph, sourceId)
          if (sourceId in nodeIdForSource) throw new Error(`op[${i}] duplicate sourceId: ${sourceId}`)
          if (targetIds.has(targetId) || graph.nodes.some((node) => node.id === targetId)) {
            throw new Error(`node already exists: ${targetId}`)
          }
          sourceIds.push(sourceId)
          targetIds.add(targetId)
          nodeIdForSource[sourceId] = targetId
        }
        const offset = op.offset as { x?: unknown; y?: unknown } | undefined
        if (offset && (!Number.isFinite(offset.x) || !Number.isFinite(offset.y))) {
          throw new Error(`op[${i}] offset must contain finite x/y`)
        }
        const duplicated = duplicateNodes(graph, sourceIds, {
          ...(offset ? { offset: { x: Number(offset.x), y: Number(offset.y) } } : {}),
          nodeIdForSource,
        })
        doc = withPackGraph(doc, packId, duplicated.graph)
      } else if (kind === 'connect') {
        const spec: ConnectSpec = {
          source: requireString(op, 'source', i),
          target: requireString(op, 'target', i),
          sourceHandle: typeof op.sourceHandle === 'string' ? op.sourceHandle : undefined,
          targetHandle: typeof op.targetHandle === 'string' ? op.targetHandle : undefined,
          data: op.data as EdgeRouting | undefined,
          id: typeof op.id === 'string' ? op.id : undefined,
        }
        requireNode(graph, spec.source)
        requireNode(graph, spec.target)
        doc = withPackGraph(doc, packId, executeTopologyCommand(graph, { op: 'connect', spec }, i))
      } else if (kind === 'reconnect') {
        const edgeId = requireString(op, 'edgeId', i)
        requireEdge(graph, edgeId)
        const patch = {
          ...(typeof op.source === 'string' ? { source: op.source } : {}),
          ...(typeof op.target === 'string' ? { target: op.target } : {}),
          ...(typeof op.sourceHandle === 'string' ? { sourceHandle: op.sourceHandle } : {}),
          ...(typeof op.targetHandle === 'string' ? { targetHandle: op.targetHandle } : {}),
        }
        if (Object.keys(patch).length === 0) throw new Error(`op[${i}] reconnect patch is empty`)
        const before = graph.edges.find((edge) => edge.id === edgeId)!
        requireNode(graph, patch.source ?? before.source)
        requireNode(graph, patch.target ?? before.target)
        doc = withPackGraph(doc, packId, executeTopologyCommand(graph, {
          op: 'reconnect', edgeId, patch,
        }, i))
      } else if (kind === 'disconnect') {
        const edgeId = requireString(op, 'edgeId', i)
        requireEdge(graph, edgeId)
        doc = withPackGraph(doc, packId, executeTopologyCommand(graph, { op: 'disconnect', edgeId }, i))
      } else if (kind === 'update-edge-data') {
        const edgeId = requireString(op, 'edgeId', i)
        requireEdge(graph, edgeId)
        doc = withPackGraph(doc, packId, executeTopologyCommand(graph, {
          op: 'update-edge-data', edgeId, data: op.data as EdgeRouting,
        }, i))
      } else if (kind === 'patch-node-bgm') {
        const nodeId = requireString(op, 'nodeId', i)
        const node = graph.nodes.find((item) => item.id === nodeId)
        if (!node) throw new Error(`node not found: ${nodeId}`)
        const bgm = patchNodeBgm(node.data.bgm, op.patch as Partial<NodeBgm>)
        doc = withPackGraph(doc, packId, patchNodeData(graph, nodeId, { bgm }))
      } else if (kind === 'ensure-node-overlay') {
        const nodeId = requireString(op, 'nodeId', i)
        doc = applyOverlayOp(doc, packId, nodeId, (scenario) =>
          ensureNodeOverlay(scenario, nodeId) as GraphLibraryDocument)
      } else if (kind === 'add-overlay-child') {
        const nodeId = requireString(op, 'nodeId', i)
        doc = applyOverlayOp(doc, packId, nodeId, (scenario) =>
          addOverlayChild(scenario, nodeId, op.child as OverlayChild) as GraphLibraryDocument)
      } else if (kind === 'remove-overlay-child') {
        const nodeId = requireString(op, 'nodeId', i)
        const childId = requireString(op, 'childId', i)
        doc = applyOverlayOp(doc, packId, nodeId, (scenario) =>
          removeOverlayChild(scenario, nodeId, childId) as GraphLibraryDocument)
      } else if (kind === 'patch-overlay-child') {
        const nodeId = requireString(op, 'nodeId', i)
        const childId = requireString(op, 'childId', i)
        doc = applyOverlayOp(doc, packId, nodeId, (scenario) =>
          patchOverlayChild(
            scenario,
            nodeId,
            childId,
            op.patch as Partial<OverlayChild>,
          ) as GraphLibraryDocument)
      } else if (kind === 'patch-overlay-child-params') {
        const nodeId = requireString(op, 'nodeId', i)
        const childId = requireString(op, 'childId', i)
        doc = applyOverlayOp(doc, packId, nodeId, (scenario) =>
          patchOverlayChildParams(
            scenario,
            nodeId,
            childId,
            op.inputs as Record<string, unknown>,
          ) as GraphLibraryDocument)
      } else if (kind === 'patch-overlay-mount') {
        const nodeId = requireString(op, 'nodeId', i)
        const mountId = requireString(op, 'mountId', i)
        doc = applyOverlayOp(doc, packId, nodeId, (scenario) =>
          patchOverlayMount(
            scenario,
            nodeId,
            mountId,
            op.patch as Partial<OverlayNode>,
          ) as GraphLibraryDocument)
      } else if (kind === 'reset-overlay-override') {
        const nodeId = requireString(op, 'nodeId', i)
        const childId = requireString(op, 'childId', i)
        doc = applyOverlayOp(doc, packId, nodeId, (scenario) =>
          resetOverride(scenario, nodeId, childId) as GraphLibraryDocument)
      } else if (kind === 'set-formula') {
        const formulaId = requireString(op, 'formulaId', i)
        const formula = op.formula as { id?: unknown; name?: unknown; description?: unknown; ast?: unknown } | undefined
        if (!formula || typeof formula !== 'object') throw new Error(`op[${i}] missing formula`)
        if (typeof formula.id !== 'string' || !formula.id) throw new Error(`op[${i}] formula.id must be a non-empty string`)
        if (formula.id !== formulaId) throw new Error(`op[${i}] formula.id must match formulaId`)
        if (formula.ast === undefined) throw new Error(`op[${i}] formula.ast is required`)
        const formulas = { ...(doc.formulas ?? {}) }
        formulas[formulaId] = {
          id: formulaId,
          ...(typeof formula.name === 'string' ? { name: formula.name } : {}),
          ...(typeof formula.description === 'string' ? { description: formula.description } : {}),
          ast: structuredClone(formula.ast),
        }
        doc = normalizeDocument({ ...doc, formulas })
      } else if (kind === 'remove-formula') {
        const formulaId = requireString(op, 'formulaId', i)
        const formulas = { ...(doc.formulas ?? {}) }
        if (!(formulaId in formulas)) throw new Error(`formula not found: ${formulaId}`)
        delete formulas[formulaId]
        doc = normalizeDocument({ ...doc, formulas })
      } else if (kind === 'create-blueprint' || kind === 'make-empty-sub-flow-pack') {
        const title = typeof op.title === 'string'
          ? op.title
          : kind === 'make-empty-sub-flow-pack'
            ? 'Sub blueprints'
            : '新蓝图'
        const created = createBlueprintInLibrary(doc.manifest.packs, {
          title,
          ...(typeof op.id === 'string' ? { id: op.id } : {}),
        })
        if (!created.ok) throw new Error(`cannot create blueprint: ${created.reason}`)
        const version = typeof op.version === 'string'
          ? op.version
          : kind === 'make-empty-sub-flow-pack'
            ? '1'
            : undefined
        const blueprint = version ? { ...created.blueprint, version } : created.blueprint
        doc = withBlueprintLibrary(doc, {
          ...created.blueprints,
          [blueprint.id]: blueprint,
        })
      } else if (kind === 'rename-blueprint') {
        const targetId = requireString(op, 'id', i)
        const title = requireString(op, 'title', i)
        const renamed = renameBlueprintInLibrary(doc.manifest.packs, targetId, title)
        if (!renamed.ok) throw new Error(`cannot rename blueprint ${targetId}: ${renamed.reason}`)
        doc = withBlueprintLibrary(doc, renamed.blueprints)
      } else if (kind === 'delete-blueprint') {
        const targetId = requireString(op, 'id', i)
        if (targetId === packId) {
          throw new Error(`cannot delete mutation context blueprint ${targetId}; use another blueprintId`)
        }
        const deleted = deleteBlueprintInLibrary(
          doc.manifest.packs,
          doc.manifest.mainPackId,
          targetId,
        )
        if (!deleted.ok) {
          const blockers = deleted.blockedBy?.length ? ` (${deleted.blockedBy.join(', ')})` : ''
          throw new Error(`cannot delete blueprint ${targetId}: ${deleted.reason}${blockers}`)
        }
        doc = withBlueprintLibrary(doc, deleted.blueprints)
      } else if (kind === 'set-main-blueprint') {
        const targetId = requireString(op, 'id', i)
        const selected = setMainBlueprintInLibrary(doc.manifest.packs, targetId)
        if (!selected.ok) throw new Error(`cannot set main blueprint ${targetId}: ${selected.reason}`)
        doc = withBlueprintLibrary(doc, doc.manifest.packs, selected.mainBlueprintId)
      } else if (kind === 'attach-sub-process') {
        const nodeId = requireString(op, 'nodeId', i)
        requireNode(graph, nodeId)
        doc = withPackGraph(doc, packId, attachSubProcess(graph, nodeId))
      } else if (kind === 'set-sub-flow-pack') {
        const nodeId = requireString(op, 'nodeId', i)
        requireNode(graph, nodeId)
        const targetId = requireString(op, 'packId', i)
        const target = doc.manifest.packs[targetId]
        if (!target) throw new Error(`blueprint not found: ${targetId}`)
        if (op.version !== undefined && op.version !== target.version) {
          throw new Error(
            `op[${i}] version ${String(op.version)} does not match blueprint ${targetId} (${String(target.version)})`,
          )
        }
        if (wouldCreateCycle(doc.manifest.packs, packId, targetId)) {
          throw new Error(`op[${i}] referencing ${targetId} from ${packId} creates a blueprint reference cycle`)
        }
        const entry = typeof op.entry === 'string' && op.entry ? op.entry : undefined
        if (entry && !target.graph.nodes.some((node) => node.id === entry)) {
          throw new Error(`entry not found in blueprint ${targetId}: ${entry}`)
        }
        doc = withPackGraph(doc, packId, patchNodeData(graph, nodeId, {
          subProcess: undefined,
          subFlowPack: { id: targetId, version: target.version, ...(entry ? { entry } : {}) },
        }))
      } else {
        throw new Error(`unsupported op: ${kind}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        errors: [message],
        failedOpIndex: i,
      }
    }
  }

  return { ok: true, document: doc, applied: input.ops.length }
}
