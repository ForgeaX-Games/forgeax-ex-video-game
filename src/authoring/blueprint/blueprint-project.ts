/**
 * 蓝图库文档纯函数（无 fs）：单文件 SSOT = 原 scenario 形状 + `manifest`（含 main 与全部子蓝图）。
 * - 根上 `graph` = 运行开跑入口（主图）；variables / entities / … 与 nodia 同构。
 * - `manifest.packs` 含主蓝图（编辑库）+ 子蓝图；engine 执行中遇依赖从此表取；无根级 `packs` 数组。
 */
import type {
  BlueprintDoc, BlueprintManifest, GameGraph, GameScenario, GraphLibraryDocument, ScenarioMetaFields, SubFlowPackDef,
} from '@/runtime/core/schema/graph-schema'
import { getSubFlowPack, getSubProcess, resolveGraphEntry } from '@/runtime/core/schema/graph-schema'
import type { EditorScenarioDocument } from '@/authoring/blueprint/formula-authoring'
import { findReferenceCycle } from '@/authoring/graph/blueprint-refs'
import { validateNodeVideoGenerationPreset } from '@/runtime/core/schema/node-video-preset'
import { validateGraph } from '@/runtime/core/validate/validate'

export const MAIN_ID = 'bp-main'

let _seq = 0
export function newBlueprintId(): string {
  _seq += 1
  return `bp-${Date.now().toString(36)}-${_seq}`
}

/** Titles are supplied by the caller so this pure domain does not read UI locale state. */
export function emptyBlueprintDoc(opts: { id?: string; title: string }): BlueprintDoc {
  const id = opts.id ?? newBlueprintId()
  const entry = 'entry'
  return {
    id, title: opts.title, entry,
    graph: { nodes: [{ id: entry, type: 'perf', position: { x: 80, y: 80 }, inputs: [], outputs: [], data: { name: '新演出节点' } }], edges: [] },
  }
}

/**
 * 无草稿 / 无磁盘时的空库：仅主蓝图、零节点。不灌内置 demo。
 * entities/variables 显式 `{}`，避免加载链把 undefined 回落成 demo meta。
 */
export function emptyLibraryDocument(
  options: { mainTitle: string },
  meta: ScenarioMetaFields = {},
): GraphLibraryDocument {
  const main: BlueprintDoc = {
    id: MAIN_ID,
    title: options.mainTitle,
    entry: 'entry',
    graph: { nodes: [], edges: [] },
  }
  return documentFromBlueprints(
    { [MAIN_ID]: main },
    MAIN_ID,
    { entities: {}, variables: {}, ...meta },
  )
}

/** 从 scenario 根摘出共享 meta（不含 graph / manifest）。 */
export function metaFromDocument(scn: GameScenario | EditorScenarioDocument | GraphLibraryDocument): ScenarioMetaFields {
  const m: ScenarioMetaFields = {}
  if (scn.variables !== undefined) m.variables = scn.variables
  if (scn.entities !== undefined) m.entities = scn.entities
  if (scn.ui !== undefined) m.ui = scn.ui
  if (scn.textStylePresets !== undefined) m.textStylePresets = scn.textStylePresets
  if (scn.bgm !== undefined) m.bgm = scn.bgm
  const formulas = (scn as EditorScenarioDocument).formulas
  if (formulas !== undefined) m.formulas = formulas
  const uiTree = (scn as GraphLibraryDocument).uiTree
  if (uiTree !== undefined) m.uiTree = uiTree
  return m
}

export function packToDoc(p: SubFlowPackDef): BlueprintDoc {
  return { id: p.id, title: p.title ?? p.id, version: p.version, entry: p.entry, graph: p.graph, requires: p.requires }
}
export function docToPack(d: BlueprintDoc): SubFlowPackDef {
  const entry = resolveGraphEntry(d.graph, d.entry) ?? d.entry
  return { id: d.id, version: d.version ?? '1', title: d.title, entry, graph: d.graph, requires: d.requires }
}

export function buildManifest(blueprints: Record<string, BlueprintDoc>, mainId: string): BlueprintManifest {
  // 写入前对齐各图 entry（悬空 entry 回退到根节点）。
  const next: Record<string, BlueprintDoc> = {}
  for (const [id, d] of Object.entries(blueprints)) {
    const entry = resolveGraphEntry(d.graph, d.entry) ?? d.entry
    next[id] = entry === d.entry ? d : { ...d, entry }
  }
  return {
    version: 'game-video.blueprint-manifest.v1',
    mainPackId: mainId,
    packs: next,
  }
}

/** 由蓝图表 + 根 meta 拼出完整落盘文档（graph=主图镜像，manifest 含 main+子）。 */
export function documentFromBlueprints(
  blueprints: Record<string, BlueprintDoc>,
  mainId: string,
  meta: ScenarioMetaFields,
): GraphLibraryDocument {
  const manifest = buildManifest(blueprints, mainId)
  const main = manifest.packs[mainId]
  return {
    version: 'game-video.graph.v1',
    ...meta,
    graph: main?.graph ?? { nodes: [], edges: [] },
    manifest,
  }
}

/**
 * 单图 scenario（如内置 demo json）→ 库文档：根 graph 变主蓝图写入 manifest。
 * 子蓝图须已在 `manifest.packs` 或另行 `documentFromBlueprints`。
 */
export function documentFromScenario(
  scn: EditorScenarioDocument,
  opts: { mainId?: string; mainTitle: string },
): GraphLibraryDocument {
  const mainId = opts.mainId ?? MAIN_ID
  const main: BlueprintDoc = {
    id: mainId,
    title: opts.mainTitle,
    entry: resolveGraphEntry(scn.graph, scn.graph.nodes[0]?.id) ?? scn.graph.nodes[0]?.id ?? 'entry',
    graph: scn.graph,
  }
  return documentFromBlueprints({ [mainId]: main }, mainId, metaFromDocument(scn))
}

/**
 * 规范化：以 manifest.packs 为准同步根 graph；缺 manifest 时把根 graph 收成仅含 main 的库文档。
 * 不读旧字段（mainBlueprintId / blueprints / schemaVersion）。
 */
export function normalizeDocument(
  doc: GraphLibraryDocument | EditorScenarioDocument,
  options: { legacyMainTitle?: string } = {},
): GraphLibraryDocument {
  const any = doc as GraphLibraryDocument
  if (any.manifest?.packs && any.manifest.mainPackId) {
    const mainId = any.manifest.mainPackId
    const bps = { ...any.manifest.packs }
    // 双源：编辑库以 manifest 内 main 为准，再镜像到根 graph。
    const main = bps[mainId]
    if (main) bps[mainId] = { ...main, graph: main.graph, entry: resolveGraphEntry(main.graph, main.entry) ?? main.entry }
    return documentFromBlueprints(bps, mainId, metaFromDocument(any))
  }
  return documentFromScenario(doc as EditorScenarioDocument, {
    mainTitle: options.legacyMainTitle ?? 'Main blueprint',
  })
}

function formulaUsageRefs(
  value: unknown,
  path = 'document',
  out: Array<{ formulaId: string; path: string }> = [],
): Array<{ formulaId: string; path: string }> {
  if (Array.isArray(value)) {
    value.forEach((item, index) => formulaUsageRefs(item, `${path}[${index}]`, out))
    return out
  }
  if (typeof value !== 'object' || value === null) return out
  const record = value as Record<string, unknown>
  const pick = record.pick
  if (typeof pick === 'object' && pick !== null && !Array.isArray(pick)) {
    const candidate = pick as Record<string, unknown>
    if (candidate.mode === 'formula' && typeof candidate.formulaId === 'string') {
      out.push({ formulaId: candidate.formulaId, path })
    }
  }
  for (const [key, child] of Object.entries(record)) {
    formulaUsageRefs(child, `${path}.${key}`, out)
  }
  return out
}

/**
 * 试玩用：开跑图换成指定蓝图（默认主蓝图）；保留完整 manifest 供执行中解析依赖。
 */
export function playDocument(doc: GraphLibraryDocument, rootBlueprintId?: string): GraphLibraryDocument {
  const normalized = normalizeDocument(doc)
  const mainId = normalized.manifest.mainPackId
  const rootId = rootBlueprintId ?? mainId
  const root = normalized.manifest.packs[rootId]
  return {
    ...normalized,
    graph: root?.graph ?? { nodes: [], edges: [] },
  }
}

export function validateDocument(doc: GraphLibraryDocument): string[] {
  const normalized = normalizeDocument(doc)
  const errors: string[] = []
  const blueprints = normalized.manifest.packs
  const mainId = normalized.manifest.mainPackId
  for (const [bpId, bp] of Object.entries(blueprints)) {
    const seenNodes = new Set<string>()
    const seenEdges = new Set<string>()
    const validateScope = (graph: GameGraph, path: string): void => {
      const localNodes = new Set(graph.nodes.map((node) => node.id))
      for (const n of graph.nodes) {
        if (seenNodes.has(n.id)) errors.push(`蓝图「${bp.title}」(${bpId}) 内节点 id 重复：'${n.id}' (${path})`)
        seenNodes.add(n.id)
        const raw = n.data as unknown as Record<string, unknown>
        const media = n.data.media
        if (media?.kind === 'video') {
          const hasPrompt = typeof media.prompt === 'string' && media.prompt.trim().length > 0
          if ((media.prompt !== undefined || media.generation !== undefined) && !hasPrompt) {
            errors.push(`蓝图「${bp.title}」(${bpId}) 节点 '${n.id}' 的视频 generation 缺少 media.prompt (${path})`)
          }
          if (media.generation !== undefined) {
            for (const issue of validateNodeVideoGenerationPreset(media.generation)) {
              errors.push(`蓝图「${bp.title}」(${bpId}) 节点 '${n.id}' ${issue} (${path})`)
            }
          }
        }
        if ('subFlow' in raw || 'subFlowRef' in raw) {
          errors.push(`蓝图「${bp.title}」(${bpId}) 节点 '${n.id}' 使用了已移除的 subFlow/subFlowRef`)
        }
        const process = getSubProcess(n.data)
        if (process && getSubFlowPack(n.data)) {
          errors.push(`蓝图「${bp.title}」(${bpId}) 节点 '${n.id}' 的 subProcess 与 subFlowPack 不能同时存在`)
        }
        if ('subProcess' in raw && !process) {
          errors.push(`蓝图「${bp.title}」(${bpId}) 节点 '${n.id}' 的 subProcess 结构无效`)
          continue
        }
        if (!process) continue
        if (!process.graph.nodes.some((child) => child.id === process.entry)) {
          errors.push(`蓝图「${bp.title}」(${bpId}) 节点 '${n.id}' 的 subProcess entry '${process.entry}' 不在直属子图中`)
        }
        validateScope(process.graph, `${path}/${n.id}`)
      }
      for (const e of graph.edges) {
        if (seenEdges.has(e.id)) errors.push(`蓝图「${bp.title}」(${bpId}) 内边 id 重复：'${e.id}' (${path})`)
        seenEdges.add(e.id)
        if (!localNodes.has(e.source)) errors.push(`蓝图「${bp.title}」(${bpId}) 边 '${e.id}' source 指向本层不存在的节点 '${e.source}'`)
        if (!localNodes.has(e.target)) errors.push(`蓝图「${bp.title}」(${bpId}) 边 '${e.id}' target 指向本层不存在的节点 '${e.target}'`)
      }
    }
    validateScope(bp.graph, 'root')
    const referenceIssues = validateGraph(bp.graph, {
      entities: Object.keys(normalized.entities ?? {}),
      vars: Object.keys(normalized.variables ?? {}),
      formulas: Object.keys(normalized.formulas ?? {}),
      overlays: normalized.ui?.overlays,
    }).filter((issue) => issue.level === 'error' && issue.code.startsWith('ref.'))
    for (const issue of referenceIssues) {
      errors.push(
        `蓝图「${bp.title}」(${bpId}) ${issue.msg}${issue.at ? ` (${issue.at})` : ''}`,
      )
    }
    if (bp.graph.nodes.length > 0 && !bp.graph.nodes.some((n) => n.id === bp.entry)) {
      const fallback = resolveGraphEntry(bp.graph) ?? '∅'
      errors.push(`蓝图「${bp.title}」(${bpId}) entry '${bp.entry}' 不在图中（将回退到 ${fallback}）`)
    }
  }
  if (!blueprints[mainId]) {
    errors.push(`manifest.mainPackId '${mainId}' 不在 manifest.packs 中`)
  }
  const cycle = findReferenceCycle(blueprints)
  if (cycle) errors.push(`蓝图引用成环：${cycle.join(' → ')}`)
  const formulas = normalized.formulas ?? {}
  const formulaIds = new Set(Object.entries(formulas).flatMap(([key, value]) => {
    const id = typeof value === 'object'
      && value !== null
      && typeof (value as { id?: unknown }).id === 'string'
      ? (value as { id: string }).id
      : key
    return [key, id]
  }))
  for (const usage of formulaUsageRefs({
    manifest: normalized.manifest,
    ui: normalized.ui,
  })) {
    if (!formulaIds.has(usage.formulaId)) {
      errors.push(`公式应用 '${usage.path}' 引用了不存在的公式 '${usage.formulaId}'`)
    }
  }
  return errors
}

export function emptyGraph(): GameGraph {
  return { nodes: [], edges: [] }
}
