/**
 * 新引擎（graph）场景的**共享状态 store** —— 让「蓝图·新 / 实体 / 变量 / 规则 / 场景 / 试玩·新」
 * 这些并行视图共用**同一份 graph + 场景级 meta + 持久化**。
 *
 * 持久化模型：SSOT = 远端 tip（`blueprint.json` + Host package）。
 * 进入只信 tip；平时 debounce Flush tip；关页 Flush tip + 内部 checkpoint。
 * 用户版本仅主动打 tag；恢复旧版走 restore 写回 tip。
 */
import { create, useStore } from 'zustand'
import { temporal } from 'zundo'
import type { TemporalState, ZundoOptions } from 'zundo'
import { t as translateUi } from '../../i18n'
import type {
  BlueprintDoc, GameGraph, GameScenario, GraphLibraryDocument, GraphTextStylePreset, Overlay, ScenarioMetaFields, UiTree, UiTreeNode,
} from '@/runtime/core/schema/graph-schema'
import type { TextStyleGroup } from '../text/text-style'
import { loadStore, saveProject, clearDraft, loadDraft, commitVersion, checkpointTip, currentVersion, listVersions, restoreVersionToTip, type VersionEntry, type GameVersion } from './persist-client'
import { computeGraphLayout } from '@/authoring/graph/graph-layout'
import { validateGraph } from '@/runtime/core/validate/validate'
import { ensureBuiltinSchemes } from '@/authoring/demo/builtin-schemes'
import { recompileFormulaUsages } from '@/authoring/formulas/formula-apply'
import type { Formula } from '@/authoring/blueprint/formula-authoring'
import { toEditorScenarioDocument, toRuntimeScenario } from '@/authoring/blueprint/formula-authoring'
import { renameScenarioId, type ScenarioIdRename } from './scenario-id'
import {
  documentFromBlueprints, documentFromScenario, emptyBlueprintDoc,
  metaFromDocument, normalizeDocument as normalizeAuthoringDocument, playDocument,
} from '@/authoring/blueprint/blueprint-project'
import { isBlueprintTitleTaken } from './blueprint-title'
import { resolveGraphEntry } from '@/runtime/core/schema/graph-schema'
import { blueprintsReferencing, findReferenceCycle } from '@/authoring/graph/blueprint-refs'
import { resolveEntryAfterGraphChange } from '@/authoring/graph/graph-scope'
import { bootComponents } from '@/runtime/react/component-host'
import { NODIA_DEMO_PROJECT } from '@/authoring/demo/demo'
import {
  addUiTreeFolder as addTreeFolder,
  addUiTreeScheme as addTreeScheme,
  BASIC_UI_FOLDER_ID,
  collectUiTreeNodeIds,
  ensureUiTree,
  findUiTreeNode,
  moveUiTreeNode as moveTreeNode,
  removeUiTreeNode as removeTreeNode,
  renameUiTreeFolder as renameTreeFolder,
} from './ui-tree'
import { broadcastBlueprintIntent } from './graphBlueprintSync'
import { broadcastUiTreeIntent } from './graphUiTreeSync'
import { nextUniqueOverlayTitle, overlayTitleExists } from '../shell/overlay-title'
import { useUiSelection } from './uiSelectionStore'
import { removeProjectComponentReferences } from './project-component-delete'


export type BlueprintTitleActionOk = { ok: true; id?: string }
export type BlueprintTitleActionErr = { ok: false; reason: 'duplicate_title' | 'not_found' }
export type BlueprintTitleActionResult = BlueprintTitleActionOk | BlueprintTitleActionErr
export type ScenarioIdRenameActionResult = { ok: true } | { ok: false; reason: 'empty_id' | 'duplicate_id' | 'not_found' }
export type TipSyncResult = 'applied' | 'skipped' | 'unchanged' | 'error'

function normalizeDocument(
  document: Parameters<typeof normalizeAuthoringDocument>[0],
): GraphLibraryDocument {
  return normalizeAuthoringDocument(document, {
    legacyMainTitle: translateUi('ui.object.ecd1fd7c870b'),
  })
}

/** 载入 demo / 文档时保证基础覆盖物存在——用于 reset()/首次落座。 */
function withBuiltinSchemes<T extends GameScenario>(s: T): T {
  const overlays = ensureBuiltinSchemes(s.ui?.overlays)
  return {
    ...s,
    ui: { ...s.ui, overlays },
    uiTree: ensureUiTree((s as T & { uiTree?: UiTree }).uiTree, overlays),
  } as T
}

/** 位置全 0（未布局）→ dagre 自动排一版；只对当前蓝图根图生效。 */
function layoutIfUnset<T extends GameScenario>(s: T): T {
  const allZero = s.graph.nodes.every((n) => !n.position || (n.position.x === 0 && n.position.y === 0))
  if (!allZero) return s
  const pos = computeGraphLayout(s.graph)
  return { ...s, graph: { ...s.graph, nodes: s.graph.nodes.map((n) => ({ ...n, position: pos[n.id] ?? n.position })) } } as T
}

const EMPTY_GRAPH: GameGraph = { nodes: [], edges: [] }

/**
 * 取当前选中蓝图文档 —— 所有「读/写活跃蓝图图」的动作的唯一入口。缺失（activeBlueprintId
 * 无效/过期）时返回 undefined，调用方据此把 `graph` 缓存与 `blueprints` 一并 no-op，杜绝派生
 * `graph` 与真相 `blueprints` 脱钩（Task 8 增删蓝图 + 撤销时必踩的 desync 类，机制上关死）。
 */
function resolveActiveDoc(state: Pick<GraphScenarioStore, 'blueprints' | 'activeBlueprintId'>): BlueprintDoc | undefined {
  return state.blueprints[state.activeBlueprintId]
}

/** 生成 `${prefix}${index}` 且不与已用 id 冲突的下一个 id。 */
function nextUiId(prefix: string, used: Set<string>): string {
  let index = used.size
  let id = `${prefix}${index}`
  while (used.has(id)) id = `${prefix}${++index}`
  return id
}

/** 收集一个 uiTree 节点子树下的所有 overlay id（scheme 节点）。 */
function collectOverlayIdsFrom(node: UiTreeNode): string[] {
  if (node.kind === 'scheme') return [node.overlayId]
  return node.children.flatMap(collectOverlayIdsFrom)
}

/** 收集一个 uiTree 节点子树下的所有节点 id（含自身）。 */
function collectNodeIdsFrom(node: UiTreeNode): string[] {
  if (node.kind === 'scheme') return [node.id]
  return [node.id, ...node.children.flatMap(collectNodeIdsFrom)]
}

/** ui.overlays 缺失基础覆盖物则补（作用于共享 meta，不覆盖已有）。 */
function withBuiltinSchemesMeta(m: ScenarioMetaFields): ScenarioMetaFields {
  const overlays = ensureBuiltinSchemes(m.ui?.overlays)
  return { ...m, ui: { ...m.ui, overlays }, uiTree: ensureUiTree(m.uiTree, overlays) }
}

/**
 * 只挑「有值」的 meta 字段回填：草稿/磁盘常只带 graph，entities/variables 为 undefined——
 * 若原样使用，血条 bind 全空。不覆盖用户显式清空后的 `{}`。导出供回归测试直接验证（见
 * `__tests__/withDemoMetaFallback.test.ts`）。
 */
export function withDemoMetaFallback(m: ScenarioMetaFields, demo: GameScenario): ScenarioMetaFields {
  return {
    ...m,
    entities: m.entities ?? demo.entities,
    variables: m.variables ?? demo.variables,
  }
}

/** 主蓝图未布局则自动排版；根 meta 缺字段回落 demo；ui 方案补全。 */
function normalizeLoadedDocument(doc: GraphLibraryDocument, demo: GameScenario): GraphLibraryDocument {
  const normalized = normalizeDocument(doc)
  const mainId = normalized.manifest.mainPackId
  const main = normalized.manifest.packs[mainId]
  let blueprints = normalized.manifest.packs
  if (main) {
    const laid = layoutIfUnset({ version: 'game-video.graph.v1', graph: main.graph } as GameScenario)
    if (laid.graph !== main.graph) {
      blueprints = { ...blueprints, [mainId]: { ...main, graph: laid.graph } }
    }
  }
  const meta = withBuiltinSchemesMeta(withDemoMetaFallback(metaFromDocument(normalized), demo))
  return documentFromBlueprints(blueprints, mainId, meta)
}

function isLibraryDocument(v: unknown): v is GraphLibraryDocument {
  const d = v as GraphLibraryDocument | null
  return !!d && typeof d === 'object' && !!d.manifest?.packs && typeof d.manifest.mainPackId === 'string'
}

/** 出厂 demo → 库文档。已是库文档则规范化；否则把根 graph 收成仅含 main 的 manifest。 */
function seedDocumentFromDemo(demo: GameScenario): GraphLibraryDocument {
  if (isLibraryDocument(demo)) return normalizeLoadedDocument(demo, demo)
  const laid = withBuiltinSchemes(layoutIfUnset(structuredClone(demo)))
  return documentFromScenario(toEditorScenarioDocument(laid)!, {
    mainTitle: translateUi('ui.object.ecd1fd7c870b'),
  })
}

interface GraphScenarioStore {
  game: string
  demo: GameScenario | null
  /** 蓝图库：id → 蓝图文档（主蓝图 + 全部子蓝图）。唯一真相，graph/authoringScenario 均由此派生。 */
  blueprints: Record<string, BlueprintDoc>
  /** 当前游戏入口蓝图 id。 */
  mainBlueprintId: string
  /** 当前编辑/选中的蓝图 id（库 UI 切换目标；未切换时=主蓝图）。 */
  activeBlueprintId: string
  /** 当前选中蓝图的图（= `blueprints[activeBlueprintId].graph`，随选中/编辑同步维护）。 */
  graph: GameGraph
  meta: ScenarioMetaFields
  versions: VersionEntry[]
  /** 当前基于的已保存版本 id（草稿态时仍指其基版本，供下拉高亮"当前"）。 */
  currentVersionId: string | null
  /** 游戏仓当前最新版本 tag（game-host git，如 `v3`）；无仓/无版本为 null。 */
  currentTag: string | null
  /** 该游戏所有 git 版本（vN，最新在前）；供版本下拉。 */
  gameVersions: GameVersion[]
  isDraft: boolean
  booted: boolean
  /** 每次「载入内容」（boot / 切版本 / 重置）自增；宿主据此清空撤销历史，避免撤销穿越版本。 */
  loadEpoch: number
  savedTip: string
  fitSignal: number
  runKey: number
  /** 当前选中的节点 id（跨视图共享：蓝图选中 → 视频/界面等据此编辑该节点）。 */
  selectedNodeId: string | null
  setSelectedNode: (id: string | null) => void
  /** 作者态完整文档（原 scenario + manifest，落盘/校验用）。 */
  authoringProject: () => GraphLibraryDocument
  /** 作者态完整文档（= authoringProject / GraphLibraryDocument），供编辑视图消费。 */
  authoringScenario: () => GraphLibraryDocument
  /** 去除 editor sidecar 后的执行场景（全量试玩 / 保存校验：根 graph=主蓝图）。 */
  scn: () => GameScenario
  /**
   * 编辑器内试玩：开跑图换为指定蓝图（默认当前选中）；依赖仍从 manifest.packs 解析。
   * 落盘不要用这个。
   */
  playScn: (rootBlueprintId?: string) => GameScenario
  /** 首次进入某 game 时载入远端 tip；已 boot 同 game 则跳过。demo 仅供「重置」。 */
  ensureBoot: (game: string, demo?: GameScenario) => Promise<void>
  setGraph: (g: GameGraph | ((g: GameGraph) => GameGraph)) => void
  setMeta: (m: ScenarioMetaFields | ((m: ScenarioMetaFields) => ScenarioMetaFields)) => void
  setUiTree: (tree: UiTree | ((tree: UiTree) => UiTree)) => void
  addUiTreeFolder: (parentId: string | null, folder: { id: string; name: string }, index?: number) => void
  addUiTreeScheme: (parentId: string | null, scheme: { id: string; overlayId: string }, index?: number) => void
  removeUiTreeNode: (id: string) => void
  moveUiTreeNode: (id: string, parentId: string | null, index?: number) => void
  renameUiTreeFolder: (id: string, name: string) => void
  /** 新建一个界面方案（建树节点 + 建 overlay + 选中）一次原子写入；返回新节点/overlay id 或 null。 */
  createUiScheme: (parentId: string, name?: string) => { nodeId: string; overlayId: string } | null
  /** 新建一个界面文件夹（建树节点 + 选中）一次原子写入；返回新节点 id 或 null。 */
  createUiFolder: (parentId: string | null, name?: string) => string | null
  /** 重命名界面树节点：文件夹走 uiTree，方案走 overlay 标题。返回是否成功。 */
  renameUiNode: (nodeId: string, name: string) => boolean
  /** 删除界面树节点及其下 overlay；选中若被删则清空。返回是否成功。 */
  removeUiNode: (nodeId: string) => boolean
  renameScenarioId: (rename: ScenarioIdRename) => ScenarioIdRenameActionResult
  /** 原子写回整份 scenario（graph + meta 一次 set，避免拆两次 set 产生额外历史步）；写主蓝图。 */
  setScenario: (s: GameScenario) => void
  /** 标记未保存 + 防抖 Flush tip（撤销/重做后调用）。 */
  touchDraft: () => void
  /** 新增/覆盖一个用户自定义文字预设（按 subtitle/overlay 分组持久化）。 */
  addTextStylePreset: (group: TextStyleGroup, preset: GraphTextStylePreset) => void
  /** 删除一个用户自定义文字预设。 */
  removeTextStylePreset: (group: TextStyleGroup, presetId: string) => void
  /** 新建一个空子蓝图并选中它；标题冲突时不改状态。 */
  createBlueprint: (title?: string) => BlueprintTitleActionResult
  /** 重命名一个蓝图（主/子皆可）；标题冲突时不改状态。 */
  renameBlueprint: (id: string, title: string) => BlueprintTitleActionResult
  /** 删除一个子蓝图；主蓝图或仍被引用中的蓝图会被拦截。 */
  deleteBlueprint: (id: string) => { ok: boolean; blockedBy?: string[] }
  /** 切换当前编辑/选中的蓝图（库 UI 用）。 */
  selectBlueprint: (id: string) => void
  /** 改变游戏入口蓝图。 */
  setMainBlueprint: (id: string) => void
  /** 插入一个既有蓝图文档（不改变当前选中）——供画布内联新建子蓝图包（`subFlowPack` 容器）用。 */
  importBlueprint: (doc: BlueprintDoc) => void
  /** 改写指定蓝图的图（不要求它是当前选中）——供画布下钻编辑子蓝图包用。 */
  updateBlueprintGraph: (id: string, g: GameGraph | ((g: GameGraph) => GameGraph)) => void
  save: () => number
  /** 保存并对游戏仓打新版本（annotated tag vN）；返回新 tag 或 null。 */
  commit: (message?: string) => Promise<string | null>
  /** 刷新版本列表（游戏仓 git tags）。 */
  refreshVersions: () => Promise<void>
  /** 将用户版本 restore 写回 tip，再载入编辑器（SSOT 变为该内容）。 */
  loadVersion: (tag: string) => Promise<void>
  pick: (value: string) => void
  reset: () => void
  applyLayout: () => void
  bumpRun: () => void
  /** Reload Host tip into the store when clean and revision changed (agent patch_graph). */
  syncTipIfClean: () => Promise<TipSyncResult>
  /** Add base:<id> overlays for components registered after the editor booted. */
  refreshComponentSchemes: () => void
  /** Remove one generated component from every authoring surface and flush the new tip. */
  removeProjectComponentReferences: (componentId: string) => Promise<boolean>
}

let draftTimer: ReturnType<typeof setTimeout> | null = null
const clearDraftTimer = () => { if (draftTimer) { clearTimeout(draftTimer); draftTimer = null } }

/** A single in-flight package load is shared by all boot callers (including StrictMode replays). */
let bootPromise: Promise<void> | null = null
let bootGame: string | null = null
let bootAttemptId = 0

/**
 * Last clean tip fingerprint. `isDraft` means editor content ≠ this baseline.
 */
let cleanFingerprint: string | null = null
/** Host tip revision token for optimistic PUT locking. */
let tipRevision: string | null = null
/** Serialize tip mutations so an older request can never finish after a newer one. */
let tipWriteTail: Promise<void> | null = null
let unloadHooksInstalled = false

function enqueueTipWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = tipWriteTail ? tipWriteTail.then(operation, operation) : operation()
  const tail = result.then(
    () => undefined,
    () => undefined,
  )
  tipWriteTail = tail
  void tail.then(() => {
    if (tipWriteTail === tail) tipWriteTail = null
  })
  return result
}

/** Stable serialize of the library document for dirty checks. */
export function projectFingerprint(doc: GraphLibraryDocument): string {
  return JSON.stringify(doc)
}

/** Test hook: reset clean baseline (avoid cross-test bleed). */
export function resetCleanFingerprintForTests(): void {
  cleanFingerprint = null
  tipRevision = null
  tipWriteTail = null
}

/** Test hook: set Host tip revision without a save round-trip. */
export function setTipRevisionForTests(revision: string | null): void {
  tipRevision = revision
}

function tipWriteInFlight(): boolean {
  return tipWriteTail !== null
}

// ── 撤销/重做（zundo）─────────────────────────────────────────────────────────
/** 仅这两片进历史：蓝图库 + 场景级 meta（选中/草稿标记/版本索引/graph 缓存字段等瞬态不追踪）。 */
type TrackedState = Pick<GraphScenarioStore, 'blueprints' | 'meta'>
const HISTORY_LIMIT = 100
// 连续 set（拖拽每帧 / 连续打字）合并进同一步的时间窗；超过则另起一步。
const HISTORY_COALESCE_MS = 400
let historyLastAt = 0

const HISTORY_OPTIONS: ZundoOptions<GraphScenarioStore, TrackedState> = {
  partialize: (s): TrackedState => ({ blueprints: s.blueprints, meta: s.meta }),
  limit: HISTORY_LIMIT,
  equality: (a, b) => a.blueprints === b.blueprints && a.meta === b.meta,
  handleSet: (record) => (pastState, replace, currentState, deltaState) => {
    const ps = pastState as unknown as Partial<TrackedState>
    const cs = currentState as unknown as Partial<TrackedState>
    // 蓝图库/meta 没变 → 是瞬态 set（选中/草稿标记/graph 缓存/版本索引…），不占历史、不占合并窗。
    if (ps.blueprints === cs.blueprints && ps.meta === cs.meta) return
    const now = Date.now()
    if (now - historyLastAt < HISTORY_COALESCE_MS) return
    historyLastAt = now
    void deltaState
    record(pastState, replace)
  },
}

export const useGraphScenario = create<GraphScenarioStore>()(temporal((set, get) => {
  // Content dirty vs tip baseline → debounce Flush tip (PUT package).
  const scheduleDraft = () => {
    const game = get().game
    const fp = projectFingerprint(get().authoringProject())
    const dirty = cleanFingerprint === null || fp !== cleanFingerprint
    set({ isDraft: dirty })
    clearDraftTimer()
    if (!game) return
    if (!dirty) return
    draftTimer = setTimeout(() => {
      void flushTip(false)
    }, 800)
  }
  /** Flush tip immediately. When `checkpoint` is true, also create an internal git checkpoint. */
  const flushTip = async (checkpoint: boolean): Promise<boolean> => {
    const { game, booted } = get()
    // A split-pane may attempt to boot while the package is still uninitialized.
    // Its pagehide handler must not persist the store's empty pre-boot state over
    // the package another pane has just initialized.
    if (!game || !booted) return false
    const project = get().authoringProject()
    const cycle = findReferenceCycle(project)
    if (cycle) return false
    const savedFp = projectFingerprint(project)
    return enqueueTipWrite(async () => {
      const res = await saveProject(project, game, tipRevision)
      if (!res.ok) return false
      tipRevision = res.revision
      cleanFingerprint = savedFp
      const nowDirty = projectFingerprint(get().authoringProject()) !== savedFp
      set({ isDraft: nowDirty })
      if (!nowDirty) clearDraftTimer()
      if (checkpoint) {
        await checkpointTip(game)
      }
      return true
    })
  }
  const installUnloadHooks = () => {
    if (unloadHooksInstalled || typeof window === 'undefined') return
    unloadHooksInstalled = true
    const onLeave = () => {
      clearDraftTimer()
      void flushTip(true)
    }
    window.addEventListener('pagehide', onLeave)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onLeave()
    })
  }
  // Shared save core (save + commit): cycle check → validate → PUT tip.
  const runSave = (): { blocked: boolean; errs: number; done: Promise<boolean> } => {
    const game = get().game
    if (!game) {
      set({ savedTip: '保存被拦截 · 尚未完成 Host handshake' })
      return { blocked: true, errs: -1, done: Promise.resolve(false) }
    }
    const project = get().authoringProject()
    const cycle = findReferenceCycle(project)
    if (cycle) {
      set({ savedTip: `保存被拦截 · 蓝图引用成环：${cycle.join(' → ')}` })
      return { blocked: true, errs: -1, done: Promise.resolve(false) }
    }
    clearDraftTimer()
    const scn = get().scn()
    const errs = validateGraph(scn.graph, {
      entities: Object.keys(scn.entities ?? {}),
      vars: Object.keys(scn.variables ?? {}),
    }).filter((i) => i.level === 'error')
    const savedFp = projectFingerprint(project)
    set({ isDraft: false, savedTip: errs.length ? `保存中 · ⚠ ${errs.length} 处校验错误` : '保存中…' })
    const done = enqueueTipWrite(async () => {
      const res = await saveProject(project, game, tipRevision)
      if (!res.ok) {
        scheduleDraft()
        set({ savedTip: '保存失败 · tip 未写入，请检查 Host 后重试' })
        return false
      }
      tipRevision = res.revision
      cleanFingerprint = savedFp
      const nowDirty = projectFingerprint(get().authoringProject()) !== savedFp
      set({
        isDraft: nowDirty,
        savedTip: errs.length ? `已保存 · ⚠ ${errs.length} 处校验错误` : `已保存 ${new Date().toLocaleTimeString()}`,
      })
      if (nowDirty) scheduleDraft()
      else clearDraftTimer()
      return true
    })
    // eslint-disable-next-line no-console
    if (errs.length) console.warn('[graph validate] 保存时发现校验错误：', errs)
    return { blocked: false, errs: errs.length, done }
  }
  return {
    game: '',
    demo: null,
    blueprints: {},
    mainBlueprintId: '',
    activeBlueprintId: '',
    graph: EMPTY_GRAPH,
    meta: {},
    versions: [],
    currentVersionId: null,
    currentTag: null,
    gameVersions: [],
    isDraft: false,
    booted: false,
    loadEpoch: 0,
    savedTip: '',
    fitSignal: 0,
    runKey: 0,
    selectedNodeId: null,
    setSelectedNode: (id) => set({ selectedNodeId: id }),

    authoringProject: () => {
      const { blueprints, mainBlueprintId, meta } = get()
      return documentFromBlueprints(blueprints, mainBlueprintId, meta)
    },
    authoringScenario: () => get().authoringProject(),
    scn: () => toRuntimeScenario(get().authoringScenario()),
    playScn: (rootBlueprintId) => {
      const st = get()
      const rootId = rootBlueprintId ?? st.activeBlueprintId
      return toRuntimeScenario(playDocument(st.authoringProject(), rootId))
    },

    ensureBoot: (game, demo = NODIA_DEMO_PROJECT) => {
      const st = get()
      if (st.booted && st.game === game) {
        // 已 boot：补 demo 引用；旧草稿曾把 entities 抹成 undefined 的，从 demo 填回 meta。
        let meta = st.meta
        let dirty = !st.demo
        if (meta.entities === undefined && demo.entities) {
          meta = { ...meta, entities: demo.entities }
          dirty = true
        }
        if (meta.variables === undefined && demo.variables) {
          meta = { ...meta, variables: demo.variables }
          dirty = true
        }
        if (dirty) set({ demo: st.demo ?? demo, meta })
        else if (!st.demo) set({ demo })
        return Promise.resolve()
      }
      if (bootPromise && bootGame === game) return bootPromise
      cleanFingerprint = null
      set({ game, demo, booted: false })
      const attemptId = ++bootAttemptId
      const attempt = (async () => {
        try {
          installUnloadHooks()
          await bootComponents(game)
          const s = await loadStore(game)
          const applyDoc = (doc: GraphLibraryDocument) => {
            const norm = normalizeLoadedDocument(doc, demo)
            const mainId = norm.manifest.mainPackId
            set((cur) => ({
              blueprints: norm.manifest.packs,
              mainBlueprintId: mainId,
              activeBlueprintId: mainId,
              meta: metaFromDocument(norm),
              graph: norm.manifest.packs[mainId]?.graph ?? EMPTY_GRAPH,
              versions: s.versions,
              currentVersionId: s.versions[0]?.id ?? null,
              loadEpoch: cur.loadEpoch + 1,
            }))
          }
          // Tip-only boot: never prefer localStorage draft over remote tip.
          if (!isLibraryDocument(s.project)) {
            throw new TypeError('Host package blueprint is missing or invalid')
          }
          tipRevision = s.revision
          applyDoc(s.project)
          cleanFingerprint = projectFingerprint(get().authoringProject())
          set({ isDraft: false, booted: true })
          void currentVersion(game).then((cv) => set({ currentTag: cv.tag }))
          void listVersions(game).then((vs) => set({ gameVersions: vs }))
        } catch (cause) {
          if (get().game === game) set({ booted: false })
          throw cause
        } finally {
          if (bootAttemptId === attemptId) {
            bootPromise = null
            bootGame = null
          }
        }
      })()
      bootPromise = attempt
      bootGame = game
      return attempt
    },

    setGraph: (g) => {
      let changed = false
      set((st) => {
        const doc = resolveActiveDoc(st)
        if (!doc) return {}
        changed = true
        const next = typeof g === 'function' ? (g as (x: GameGraph) => GameGraph)(doc.graph) : g
        // 删除入口时沿旧图出边自动迁移到首个仍存活的后续节点。
        const entry = resolveEntryAfterGraphChange(doc.graph, next, doc.entry)
        return {
          blueprints: { ...st.blueprints, [st.activeBlueprintId]: { ...doc, graph: next, entry } },
          graph: next,
        }
      })
      if (changed) scheduleDraft()
    },
    setScenario: (s) => {
      // 图编辑只会带回它实际改过的场景字段；与 setMeta 一样浅合并，避免没参与本次
      // 编辑的作者态（如 formulas）被纯 GameScenario 覆盖掉。显式清空字段走 setMeta。
      // `s.graph` = **当前选中蓝图**的图（视频 tab / 素材编辑），写回 activeBlueprintId，不是永远主蓝图。
      set((st) => {
        const activeId = st.activeBlueprintId
        const doc = st.blueprints[activeId]
        const entry = doc ? resolveEntryAfterGraphChange(doc.graph, s.graph, doc.entry) : undefined
        const blueprints = doc
          ? { ...st.blueprints, [activeId]: { ...doc, graph: s.graph, entry: entry! } }
          : st.blueprints
        const meta = { ...st.meta, ...metaFromDocument(s) }
        return { blueprints, meta, graph: s.graph }
      })
      scheduleDraft()
    },
    touchDraft: () => scheduleDraft(),
    setMeta: (m) => {
      set((st) => {
        const nextMeta = typeof m === 'function' ? (m as (x: ScenarioMetaFields) => ScenarioMetaFields)(st.meta) : m
        // 公式库引用变化（增删改一条公式）→ 回溯重新编译所有「应用公式」处的 expr 缓存，让蓝图/时间轴里
        // 已经选好公式的字段跟着公式定义的最新改动走，且这一步并进同一次 undo 历史。遍历全部蓝图（主+子），
        // 不止当前编辑的那份——公式应用处可能藏在任意子蓝图的图里。
        if (nextMeta.formulas !== st.meta.formulas) {
          const formulas = nextMeta.formulas as Record<string, Formula> | undefined
          const recompiled = recompileFormulaUsages({ blueprints: st.blueprints, meta: nextMeta }, formulas, nextMeta.entities ?? st.meta.entities)
          return { blueprints: recompiled.blueprints, meta: recompiled.meta, graph: recompiled.blueprints[st.activeBlueprintId]?.graph ?? st.graph }
        }
        return { meta: nextMeta }
      })
      scheduleDraft()
    },
    setUiTree: (tree) => {
      get().setMeta((meta) => {
        const current = ensureUiTree(meta.uiTree, meta.ui?.overlays)
        const next = typeof tree === 'function' ? tree(current) : tree
        return next === meta.uiTree ? meta : { ...meta, uiTree: next }
      })
    },
    addUiTreeFolder: (parentId, folder, index) => {
      get().setUiTree((tree) => addTreeFolder(tree, parentId, folder, index))
    },
    addUiTreeScheme: (parentId, scheme, index) => {
      get().setUiTree((tree) => addTreeScheme(tree, parentId, scheme, index))
    },
    removeUiTreeNode: (id) => {
      get().setUiTree((tree) => removeTreeNode(tree, id))
    },
    moveUiTreeNode: (id, parentId, index) => {
      get().setUiTree((tree) => moveTreeNode(tree, id, parentId, index))
    },
    renameUiTreeFolder: (id, name) => {
      get().setUiTree((tree) => renameTreeFolder(tree, id, name))
    },
    renameScenarioId: (rename) => {
      const migrated = renameScenarioId(get().meta, get().blueprints, rename)
      if (!migrated.ok) return migrated
      set((st) => {
        const recompiled = recompileFormulaUsages(
          { blueprints: migrated.blueprints, meta: migrated.meta },
          migrated.meta.formulas as Record<string, Formula> | undefined,
          migrated.meta.entities,
        )
        return {
          blueprints: recompiled.blueprints,
          meta: recompiled.meta,
          graph: recompiled.blueprints[st.activeBlueprintId]?.graph ?? st.graph,
        }
      })
      scheduleDraft()
      return { ok: true }
    },
    addTextStylePreset: (group, preset) => {
      set((st) => {
        const presets = st.meta.textStylePresets ?? {}
        const list = (presets[group] ?? []).filter((p) => p.id !== preset.id)
        return { meta: { ...st.meta, textStylePresets: { ...presets, [group]: [...list, preset] } } }
      })
      scheduleDraft()
    },
    removeTextStylePreset: (group, presetId) => {
      set((st) => {
        const presets = st.meta.textStylePresets ?? {}
        const list = (presets[group] ?? []).filter((p) => p.id !== presetId)
        return { meta: { ...st.meta, textStylePresets: { ...presets, [group]: list } } }
      })
      scheduleDraft()
    },

    createBlueprint: (title) => {
      const st = get()
      const resolved = (title ?? '新蓝图').trim() || '新蓝图'
      if (isBlueprintTitleTaken(st.blueprints, resolved)) {
        return { ok: false, reason: 'duplicate_title' }
      }
      const doc = emptyBlueprintDoc({ title: resolved })
      set((s) => ({
        blueprints: { ...s.blueprints, [doc.id]: doc },
        activeBlueprintId: doc.id,
        graph: doc.graph,
        selectedNodeId: null,
        // 新建后框选进视口（子蓝图节点少，不 fit 会停在上一张大图的平移/缩放上）。
        fitSignal: s.fitSignal + 1,
      }))
      scheduleDraft()
      broadcastBlueprintIntent({ type: 'created', doc })
      return { ok: true, id: doc.id }
    },
    renameBlueprint: (id, title) => {
      const st = get()
      if (!st.blueprints[id]) return { ok: false, reason: 'not_found' }
      const nextTitle = title.trim()
      if (!nextTitle) return { ok: false, reason: 'not_found' }
      if (isBlueprintTitleTaken(st.blueprints, nextTitle, id)) {
        return { ok: false, reason: 'duplicate_title' }
      }
      set({ blueprints: { ...st.blueprints, [id]: { ...st.blueprints[id]!, title: nextTitle } } })
      scheduleDraft()
      broadcastBlueprintIntent({ type: 'renamed', id, title: nextTitle })
      return { ok: true }
    },
    selectBlueprint: (id) => {
      const prev = get().activeBlueprintId
      set((st) => {
        if (id === st.activeBlueprintId) return { selectedNodeId: null }
        return {
          activeBlueprintId: id,
          graph: st.blueprints[id]?.graph ?? EMPTY_GRAPH,
          selectedNodeId: null,
          fitSignal: st.fitSignal + 1,
        }
      })
      const next = get()
      if (id !== prev && next.blueprints[id]) {
        broadcastBlueprintIntent({ type: 'select', id })
      }
    },
    setMainBlueprint: (id) => {
      let changed = false
      set((st) => {
        if (!st.blueprints[id] || st.mainBlueprintId === id) return {}
        changed = true
        return { mainBlueprintId: id }
      })
      if (changed) {
        scheduleDraft()
        broadcastBlueprintIntent({ type: 'mainSet', id })
      }
    },
    deleteBlueprint: (id) => {
      const st = get()
      if (id === st.mainBlueprintId) return { ok: false, blockedBy: ['__main__'] }
      const refs = blueprintsReferencing(st.authoringProject(), id)
      if (refs.length) return { ok: false, blockedBy: refs }
      const next = { ...st.blueprints }
      delete next[id]
      const nextActive = st.activeBlueprintId === id ? st.mainBlueprintId : st.activeBlueprintId
      set({ blueprints: next, activeBlueprintId: nextActive, graph: next[nextActive]?.graph ?? EMPTY_GRAPH })
      scheduleDraft()
      broadcastBlueprintIntent({ type: 'deleted', id, nextActive })
      return { ok: true }
    },
    importBlueprint: (doc) => {
      set((st) => ({ blueprints: { ...st.blueprints, [doc.id]: doc } }))
      scheduleDraft()
    },
    updateBlueprintGraph: (id, g) => {
      let changed = false
      set((st) => {
        const doc = st.blueprints[id]
        if (!doc) return {}
        changed = true
        const next = typeof g === 'function' ? (g as (x: GameGraph) => GameGraph)(doc.graph) : g
        const blueprints = { ...st.blueprints, [id]: { ...doc, graph: next } }
        return { blueprints, graph: id === st.activeBlueprintId ? next : st.graph }
      })
      if (changed) scheduleDraft()
    },

    createUiScheme: (parentId, name) => {
      // 一次 set 原子写 uiTree + overlays，再 selectUiNode + 广播——天然无中间态，
      // 取代旧 uiNavSync 的「setMeta + selectUiNode 两次写入 → 两次 snapshot → 闪烁」。
      const st = get()
      const overlays = st.meta.ui?.overlays ?? {}
      const tree = ensureUiTree(st.meta.uiTree, overlays)
      if (findUiTreeNode(tree, parentId)?.kind !== 'folder') return null
      const overlayId = nextUiId('scheme-', new Set(Object.keys(overlays)))
      const nodeId = nextUiId('ui-scheme:', collectUiTreeNodeIds(tree))
      const nextTree = addTreeScheme(tree, parentId, { id: nodeId, overlayId })
      if (nextTree === tree) return null
      const title = name?.trim() || nextUniqueOverlayTitle(overlays)
      const nextOverlay: Overlay = { id: overlayId, title, children: [] }
      set((s) => ({
        meta: {
          ...s.meta,
          ui: { ...s.meta.ui, overlays: { [overlayId]: nextOverlay, ...overlays } },
          uiTree: nextTree,
        },
      }))
      scheduleDraft()
      useUiSelection.getState().selectUiNode(nodeId, overlayId)
      broadcastUiTreeIntent({ type: 'scheme-added', parentId, nodeId, overlayId, title })
      return { nodeId, overlayId }
    },
    createUiFolder: (parentId, name) => {
      const st = get()
      const overlays = st.meta.ui?.overlays ?? {}
      const tree = ensureUiTree(st.meta.uiTree, overlays)
      if (parentId !== null && findUiTreeNode(tree, parentId)?.kind !== 'folder') return null
      const nodeId = nextUiId('ui-folder:', collectUiTreeNodeIds(tree))
      const label = name?.trim() || '新文件夹'
      const nextTree = addTreeFolder(tree, parentId, { id: nodeId, name: label })
      if (nextTree === tree) return null
      set((s) => ({ meta: { ...s.meta, uiTree: nextTree } }))
      scheduleDraft()
      useUiSelection.getState().selectUiNode(nodeId, null)
      broadcastUiTreeIntent({ type: 'folder-added', parentId, nodeId, name: label })
      return nodeId
    },
    renameUiNode: (nodeId, name) => {
      const trimmed = name.trim()
      if (!trimmed) return false
      const st = get()
      const overlays = st.meta.ui?.overlays ?? {}
      const tree = ensureUiTree(st.meta.uiTree, overlays)
      const node = findUiTreeNode(tree, nodeId)
      if (!node || node.id === BASIC_UI_FOLDER_ID) return false
      if (node.kind === 'folder') {
        const nextTree = renameTreeFolder(tree, node.id, trimmed)
        if (nextTree === tree) return false
        set((s) => ({ meta: { ...s.meta, uiTree: nextTree } }))
        scheduleDraft()
        broadcastUiTreeIntent({ type: 'renamed', nodeId, name: trimmed })
        return true
      }
      if (node.overlayId.startsWith('base:') || overlayTitleExists(overlays, trimmed, node.overlayId)) return false
      const overlay = overlays[node.overlayId]
      if (!overlay) return false
      set((s) => ({
        meta: {
          ...s.meta,
          ui: {
            ...s.meta.ui,
            overlays: { ...(s.meta.ui?.overlays ?? {}), [node.overlayId]: { ...overlay, title: trimmed } },
          },
        },
      }))
      scheduleDraft()
      broadcastUiTreeIntent({ type: 'overlay-renamed', overlayId: node.overlayId, title: trimmed })
      return true
    },
    removeUiNode: (nodeId) => {
      const st = get()
      const overlays = st.meta.ui?.overlays ?? {}
      const tree = ensureUiTree(st.meta.uiTree, overlays)
      const node = findUiTreeNode(tree, nodeId)
      if (!node) return false
      const removedOverlayIds = collectOverlayIdsFrom(node)
      const removedNodeIds = collectNodeIdsFrom(node)
      if (node.id === BASIC_UI_FOLDER_ID || removedOverlayIds.some((id) => id.startsWith('base:'))) return false
      const nextTree = removeTreeNode(tree, node.id)
      if (nextTree === tree) return false
      const nextOverlays = { ...overlays }
      for (const overlayId of removedOverlayIds) delete nextOverlays[overlayId]
      set((s) => ({
        meta: {
          ...s.meta,
          ui: { ...s.meta.ui, overlays: nextOverlays },
          uiTree: nextTree,
        },
      }))
      scheduleDraft()
      const sel = useUiSelection.getState()
      if (
        removedNodeIds.includes(sel.selectedTreeNodeId ?? '')
        || removedOverlayIds.includes(sel.selectedOverlayId ?? '')
      ) {
        sel.clearUiSelection()
      }
      broadcastUiTreeIntent({ type: 'removed', nodeId, removedOverlayIds, removedNodeIds })
      return true
    },

    // 引用环是阻塞级错误：一旦落盘运行时会无限下钻栈溢出，必须写盘前挡住（在 runSave 内）。
    save: () => {
      const r = runSave()
      return r.blocked ? -1 : r.errs
    },

    pick: (value) => {
      // 从「未保存草稿」切到别的版本 → 提示会丢失。
      if (get().isDraft && value !== '__draft__' && typeof confirm === 'function') {
        if (!confirm('当前有未保存的修改，切换版本后会丢失。继续？')) return
      }
      const apply = (doc: GraphLibraryDocument | null) => {
        if (!isLibraryDocument(doc)) return
        clearDraftTimer()
        const demo = get().demo
        const norm = demo ? normalizeLoadedDocument(doc, demo) : normalizeDocument(doc)
        const mainId = norm.manifest.mainPackId
        set((st) => ({
          blueprints: norm.manifest.packs,
          mainBlueprintId: mainId,
          activeBlueprintId: mainId,
          meta: metaFromDocument(norm),
          graph: norm.manifest.packs[mainId]?.graph ?? EMPTY_GRAPH,
          loadEpoch: st.loadEpoch + 1,
          ...(value !== '__draft__' ? { currentVersionId: value } : {}),
        }))
        scheduleDraft()
      }
      // game-host 下产品不做版本回退（版本=git tag，入口只用最新）：仅支持回到未保存草稿。
      if (value === '__draft__') apply(loadDraft(get().game))
    },

    // 打一个新版本：先保存当前包（await 落盘完成），再对游戏仓打 annotated tag vN（git add -A 会把
    // 已 seed 的 components/ 一并纳入版本）。产品只用最新，不回退。
    commit: async (message?: string) => {
      const r = runSave()
      if (r.blocked) return null
      const ok = await r.done // 等 blueprint 真落盘，避免 git 提交漏掉最新内容
      if (!ok) {
        set({ savedTip: '打版本中止 · 保存失败' })
        return null
      }
      const cv = await commitVersion(get().game, message)
      if (cv?.tag) {
        set({ currentTag: cv.tag, savedTip: `已打版本 ${cv.tag}` })
        void listVersions(get().game).then((vs) => set({ gameVersions: vs }))
      } else set({ savedTip: '打版本失败 · 请检查 game-host 端点' })
      return cv?.tag ?? null
    },

    refreshVersions: async () => {
      set({ gameVersions: await listVersions(get().game) })
    },

    // Restore user version onto tip, then reload editor from restored tip.
    loadVersion: async (tag: string) => {
      const game = get().game
      const doc = await restoreVersionToTip(game, tag)
      if (!isLibraryDocument(doc)) {
        set({ savedTip: `恢复 ${tag} 失败` })
        return
      }
      clearDraftTimer()
      // Refresh tip revision after restore mutated Host tip.
      try {
        const reloaded = await loadStore(game)
        tipRevision = reloaded.revision
      } catch {
        tipRevision = null
      }
      const demo = get().demo
      const norm = demo ? normalizeLoadedDocument(doc, demo) : normalizeDocument(doc)
      const mainId = norm.manifest.mainPackId
      set((st) => ({
        blueprints: norm.manifest.packs,
        mainBlueprintId: mainId,
        activeBlueprintId: mainId,
        meta: metaFromDocument(norm),
        graph: norm.manifest.packs[mainId]?.graph ?? EMPTY_GRAPH,
        currentTag: tag,
        isDraft: false,
        loadEpoch: st.loadEpoch + 1,
        fitSignal: st.fitSignal + 1,
        savedTip: `已恢复版本 ${tag} 为当前 tip`,
      }))
      cleanFingerprint = projectFingerprint(get().authoringProject())
      void listVersions(game).then((vs) => set({ gameVersions: vs }))
    },

    // 重置：用内置 demo 替换当前内容（含全部子蓝图）。若与当前版本不同则标未保存草稿。
    reset: () => {
      const demo = get().demo
      if (!demo) return
      const seed = seedDocumentFromDemo(demo)
      const mainId = seed.manifest.mainPackId
      clearDraftTimer()
      set((st) => ({
        blueprints: seed.manifest.packs,
        mainBlueprintId: mainId,
        activeBlueprintId: mainId,
        meta: metaFromDocument(seed),
        graph: seed.manifest.packs[mainId]?.graph ?? EMPTY_GRAPH,
        currentVersionId: null,
        savedTip: '已重置为 demo',
        fitSignal: st.fitSignal + 1,
        runKey: st.runKey + 1,
        loadEpoch: st.loadEpoch + 1,
      }))
      scheduleDraft()
    },

    applyLayout: () => {
      let changed = false
      set((st) => {
        const doc = resolveActiveDoc(st)
        // 活跃蓝图缺失 → 两片都 no-op（不能只刷 graph 缓存，否则 graph 与 blueprints 脱钩）。
        if (!doc) return {}
        changed = true
        const pos = computeGraphLayout(doc.graph)
        const next = { ...doc.graph, nodes: doc.graph.nodes.map((n) => ({ ...n, position: pos[n.id] ?? n.position })) }
        return { blueprints: { ...st.blueprints, [st.activeBlueprintId]: { ...doc, graph: next } }, graph: next, fitSignal: st.fitSignal + 1 }
      })
      if (changed) scheduleDraft()
    },

    bumpRun: () => set((st) => ({ runKey: st.runKey + 1, savedTip: st.savedTip })),

    refreshComponentSchemes: () => {
      let changed = false
      set((st) => {
        const currentOverlays = st.meta.ui?.overlays ?? {}
        const overlays = ensureBuiltinSchemes(currentOverlays)
        const added = Object.keys(overlays).some((id) => currentOverlays[id] === undefined)
        if (!added) return {}
        changed = true
        return {
          meta: {
            ...st.meta,
            ui: { ...st.meta.ui, overlays },
            uiTree: ensureUiTree(st.meta.uiTree, overlays),
          },
          loadEpoch: st.loadEpoch + 1,
        }
      })
      if (changed) scheduleDraft()
    },

    removeProjectComponentReferences: async (componentId) => {
      const previous = get().authoringProject()
      const next = removeProjectComponentReferences(previous, componentId)
      const mainId = next.manifest.mainPackId
      set((st) => ({
        blueprints: next.manifest.packs,
        mainBlueprintId: mainId,
        meta: metaFromDocument(next),
        graph: next.manifest.packs[st.activeBlueprintId]?.graph
          ?? next.manifest.packs[mainId]?.graph
          ?? EMPTY_GRAPH,
        loadEpoch: st.loadEpoch + 1,
      }))
      const selection = useUiSelection.getState()
      if (selection.selectedOverlayId === `base:${componentId}`) {
        selection.clearUiSelection()
      }
      scheduleDraft()
      const saved = await flushTip(false)
      if (saved) return true

      const previousMainId = previous.manifest.mainPackId
      set((st) => ({
        blueprints: previous.manifest.packs,
        mainBlueprintId: previousMainId,
        meta: metaFromDocument(previous),
        graph: previous.manifest.packs[st.activeBlueprintId]?.graph
          ?? previous.manifest.packs[previousMainId]?.graph
          ?? EMPTY_GRAPH,
        loadEpoch: st.loadEpoch + 1,
      }))
      scheduleDraft()
      return false
    },

    syncTipIfClean: async (): Promise<TipSyncResult> => {
      const st = get()
      if (!st.booted || !st.game) return 'skipped'
      if (tipWriteInFlight()) return 'skipped'

      // ── clean state：full replace ──────────────────────────────────────
      if (!st.isDraft) {
        let loaded: Awaited<ReturnType<typeof loadStore>>
        try {
          loaded = await loadStore(st.game)
        } catch {
          return 'error'
        }
        if (!isLibraryDocument(loaded.project)) return 'error'
        if (loaded.revision === tipRevision) return 'unchanged'

        const now = get()
        if (!now.booted || now.game !== st.game) return 'skipped'
        if (tipWriteInFlight() || now.isDraft) return 'skipped'

        const demo = now.demo
        const norm = demo
          ? normalizeLoadedDocument(loaded.project, demo)
          : normalizeDocument(loaded.project)
        const mainId = norm.manifest.mainPackId
        const packs = norm.manifest.packs
        const keepActive = packs[now.activeBlueprintId] ? now.activeBlueprintId : mainId
        const nextGraph = packs[keepActive]?.graph ?? EMPTY_GRAPH
        const keepSelected =
          now.selectedNodeId && nextGraph.nodes.some((n) => n.id === now.selectedNodeId)
            ? now.selectedNodeId
            : null

        tipRevision = loaded.revision
        set((cur) => ({
          blueprints: packs,
          mainBlueprintId: mainId,
          activeBlueprintId: keepActive,
          meta: metaFromDocument(norm),
          graph: nextGraph,
          selectedNodeId: keepSelected,
          isDraft: false,
          loadEpoch: cur.loadEpoch + 1,
          fitSignal: cur.fitSignal + 1,
        }))
        cleanFingerprint = projectFingerprint(get().authoringProject())
        graphHistoryClear()
        return 'applied'
      }

      // ── dirty state：AI/external write – merge meta only ───────────────
      // When isDraft=true the user has unsaved blueprint edits. But an AI
      // patch-graph call may have written formulas/overlays/entities to disk.
      // Load the tip, check revision, and merge only the meta fields —
      // formulas, overlays, variables, entities, bgm, textStylePresets,
      // uiTree — without overwriting the user's in-progress blueprint edits.
      let loaded: Awaited<ReturnType<typeof loadStore>>
      try {
        loaded = await loadStore(st.game)
      } catch {
        return 'error'
      }
      if (!isLibraryDocument(loaded.project)) return 'error'
      if (loaded.revision === tipRevision) return 'unchanged'

      const now = get()
      if (!now.booted || now.game !== st.game) return 'skipped'
      if (!now.isDraft) return 'skipped'

      const demo = now.demo
      const norm = demo
        ? normalizeLoadedDocument(loaded.project, demo)
        : normalizeDocument(loaded.project)
      const tipMeta = metaFromDocument(norm)

      // Merge only meta fields that the AI can change, keeping user's
      // in-progress blueprints/graph intact.
      const nextMeta: ScenarioMetaFields = { ...now.meta }
      let metaChanged = false
      const mergeIfChanged = <K extends keyof ScenarioMetaFields>(key: K) => {
        if (tipMeta[key] !== undefined && tipMeta[key] !== now.meta[key]) {
          (nextMeta as Record<K, ScenarioMetaFields[K]>)[key] = tipMeta[key]
          metaChanged = true
        }
      }
      for (const k of ['formulas', 'entities', 'variables', 'bgm', 'textStylePresets'] as const) {
        mergeIfChanged(k)
      }
      // ui / uiTree: deep-compare so we pick up overlay changes without
      // clobbering the whole ui object.
      if (tipMeta.ui && tipMeta.ui !== now.meta.ui) {
        nextMeta.ui = { ...now.meta.ui, ...tipMeta.ui }
        metaChanged = true
      }
      if (tipMeta.uiTree && tipMeta.uiTree !== now.meta.uiTree) {
        nextMeta.uiTree = tipMeta.uiTree
        metaChanged = true
      }

      if (!metaChanged) return 'unchanged'

      tipRevision = loaded.revision

      // Recompile formula usages if formulas changed, so blueprint
      // fields that reference formulas pick up the corrected definition.
      if (nextMeta.formulas !== now.meta.formulas) {
        const formulas = nextMeta.formulas as Record<string, Formula> | undefined
        const recompiled = recompileFormulaUsages(
          { blueprints: now.blueprints, meta: nextMeta },
          formulas,
          nextMeta.entities ?? now.meta.entities,
        )
        set({
          blueprints: recompiled.blueprints,
          meta: recompiled.meta,
          graph: recompiled.blueprints[now.activeBlueprintId]?.graph ?? now.graph,
        })
      } else {
        set({ meta: nextMeta })
      }

      // isDraft stays whatever scheduleDraft would compute next
      // (still true if blueprints differ from tip).
      return 'applied'
    },
  }
}, HISTORY_OPTIONS))

// ── 撤销/重做对外 API ─────────────────────────────────────────────────────────
/** 订阅撤销历史（past/future 深度等）；用于按钮 disabled 态。 */
export function useGraphHistory<T>(selector: (s: TemporalState<TrackedState>) => T): T {
  return useStore(useGraphScenario.temporal, selector)
}
/** undo/redo 只追踪 `{blueprints, meta}`；zundo 绕过我们的 action 直接 setState，这里手动把
 * 派生的 `graph` 缓存字段跟当前 `activeBlueprintId` 重新对齐，再落草稿。 */
function resyncGraphAfterHistoryJump(): void {
  const st = useGraphScenario.getState()
  useGraphScenario.setState({ graph: st.blueprints[st.activeBlueprintId]?.graph ?? EMPTY_GRAPH })
}
/** 撤销一步并把恢复后的状态落草稿。 */
export function graphUndo(): void {
  useGraphScenario.temporal.getState().undo()
  resyncGraphAfterHistoryJump()
  useGraphScenario.getState().touchDraft()
}
/** 重做一步并落草稿。 */
export function graphRedo(): void {
  useGraphScenario.temporal.getState().redo()
  resyncGraphAfterHistoryJump()
  useGraphScenario.getState().touchDraft()
}
/** 清空撤销历史（载入新内容后调用）。 */
export function graphHistoryClear(): void {
  historyLastAt = 0
  useGraphScenario.temporal.getState().clear()
}
