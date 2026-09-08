import { t as translateUi } from '../../i18n'
/**
 * NodeInspector —— 节点配置面板。选中画布节点后编辑其 `node.data`、overlay reactions 与出边。
 * Overlay 事件作者 SSOT = 各挂载 `overlayNodes[].reactions`；走向经 do 内 advance + 边。
 *
 * 各配置分区（演出 / 界面 / 结算 / 出边 / BGM）住在 `./node-inspector/`；本文件只留
 * 组件签名、状态与派生值计算，再把它们显式传给分区。
 */
import { useEffect, useRef, useState } from 'react'
import type { Entity, GameGraph, Overlay, OverlayChild, SubFlowPackDef, Variable } from '@/runtime/core/schema/graph-schema'
import type { Formula } from '@/authoring/blueprint/formula-authoring'
import { authoringOptionLabel } from '@/authoring/formulas/authoring-option-label'
import { getSubFlowPack, getSubProcess } from '@/runtime/core/schema/graph-schema'
import type { AudioOption } from '@/authoring/audio/bgm-authoring'
import { overlayMountId } from '@/runtime/core/schema/node-config-schema'
import { resolveMountChildren } from '@/runtime/core/schema/expand-overlay'
import { deriveOutputs, getComponentManifest } from '@/runtime/core/registry/component-registry'
import {
  updateNodeData,
  makeEmptySubFlowPack,
  attachSubProcess,
  type NodeDataPatch,
} from '@/authoring/graph/graph-edit'
import { mergeFlowHandles, flowHandleDisplay } from '@/authoring/graph/flow-handle-labels'
import type { EditorPickerCtx } from './editors'
import type {
  EntityAttributeCreateHandler,
  EntityCreateHandler,
  FormulaCreateHandler,
  VariableCreateHandler,
} from './component-form-fields'
import {
  collectCurrentNodeKeyBindingSites,
  findKeyBindingConflicts,
} from './keyBindingConflicts'
import { overlayDisplayLabel } from './schemeOverlays'
import { scrollIntoViewWithin } from './focus-scroll'
import { listSchemeAndBaseOverlayIds } from '@/authoring/demo/builtin-schemes'
import { buildFieldTree, sparseOverlayInputOverride, type OptItem, type VideoOption } from './node-inspector/shared'
import { PerformanceSection } from './node-inspector/PerformanceSection'
import { OverlaySection } from './node-inspector/OverlaySection'
import { SettlementSection } from './node-inspector/SettlementSection'
import { EdgeSection } from './node-inspector/EdgeSection'
import { BgmSection } from './node-inspector/BgmSection'
import { ensureNiUiStyle, NI_ROOT_CLASS } from './ni-ui'

export { sparseOverlayInputOverride }
export type { FieldNode } from './node-inspector/shared'
/** `VideoOption` 住在 shared 里，分区才不用反向 import 本文件；此处仅保留既有的公开路径。 */
export type { VideoOption } from './node-inspector/shared'

export function NodeInspector({
  graph,
  nodeId,
  videoOptions = [],
  audioOptions = [],
  packs = [],
  isRefAllowed,
  overlays,
  entities,
  variables,
  formulas,
  focusedMountId,
  focusedLifecycleIndex,
  settlementInsertMs,
  focusAnchorRevision,
  onFocusMount,
  onFocusLifecycle,
  onChange,
  onPacksChange,
  onDropOverlayIfOrphan,
  onRemoveMount,
  onCreateEntityAttribute,
  onCreateEntity,
  onCreateVariable,
  onCreateFormula,
  onJump,
}: {
  graph: GameGraph
  nodeId: string | null
  videoOptions?: VideoOption[]
  /** 作用域 BGM 的音频资产候选（Kino media_type=audio，与资产库一致）；与「视频」下拉同款。 */
  audioOptions?: AudioOption[]
  /** 本局子蓝图包（随 scenario 保存）。 */
  packs?: readonly SubFlowPackDef[]
  /**
   * 某个既有蓝图 id 能否被当前编辑的蓝图引用（自引用 + 会成环的候选均应返回 false）——
   * 上层（GraphStudio）有 store 访问权，据此算好再传下来，本组件不深挖 store。
   * 未传则不做任何过滤（兜底旧行为）。
   */
  isRefAllowed?: (packId: string) => boolean
  overlays?: Record<string, Overlay>
  /** 场景实体 / 变量目录（供 effects / condition 下拉、选取式公式与 watch 字段级联下拉）。 */
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  /** 公式库（「规则 → 公式」维护）；供 effects/numberExpr 数值字段开出「应用公式」模式。 */
  formulas?: Record<string, Formula>
  /**
   * 预览台当前聚焦的挂载 id（覆盖物）。非空时右侧只展开该挂载的配置卡片，其余折叠为标题行；
   * 空 = 平铺展开全部挂载（默认）。
   */
  focusedMountId?: string | null
  /** 预览台时间轴当前选中的结算（子集序号）；本区域据此高亮对应配置块。 */
  focusedLifecycleIndex?: number | null
  /** 新增定时结算的插入时刻；没有时间轴选中时省略并回落到 0ms。 */
  settlementInsertMs?: number
  /** 每次从预览/时间轴发起选中都会递增；确保重复选同一项也重新滚动。 */
  focusAnchorRevision?: number
  /** 点击某挂载卡片标题时上抛（与预览台双向联动）；再次点同一张 = 取消聚焦（回到全展开）。 */
  onFocusMount?: (mountId: string | null) => void
  /** 点击某条结算时上抛（与时间轴菱形双向联动）。 */
  onFocusLifecycle?: (lifecycleIndex: number | null) => void
  onChange: (g: GameGraph) => void
  onPacksChange?: (packs: SubFlowPackDef[]) => void
  /**
   * 卸载某挂载后，请上层用完整 scenario（主图 + 所有子蓝图包）判断该 overlay 是否已无人引用，
   * 无引用则清理孤儿副本。本组件只看得到 canvasGraph，无法自行判断跨图引用，故上抛。
   */
  onDropOverlayIfOrphan?: (overlayId: string) => void
  /**
   * 移除覆盖物挂载（优先走 scenario 级 `removeMountGraph`，级联清掉组件跳转边与结算）。
   * 未传则回落为只改 `overlayNodes`（旧行为，边会残留）。
   */
  onRemoveMount?: (mountId: string) => void
  /** 新血条绑定缺失 hp 时，经面板二次确认后补建到场景实体目录。 */
  onCreateEntityAttribute?: EntityAttributeCreateHandler
  /** 新血条没有可选实体时，经面板二次确认后补建到场景实体目录。 */
  onCreateEntity?: EntityCreateHandler
  /** 新组件动态值缺少变量时，经级联确认后补建到场景变量目录。 */
  onCreateVariable?: VariableCreateHandler
  /** 新组件动态值缺少公式时，经级联确认后补建到场景公式目录。 */
  onCreateFormula?: FormulaCreateHandler
  onJump?: (id: string) => void
}): JSX.Element {
  // 「音乐动作」在还没选曲子时也得选得动：没有 ref 的 push / replace 落不了盘（volume-only
  // 配置只表达音量，不携带播放动作），所以空态下下拉会自己弹回「起播」。落不了盘的那一步先记在这儿，等作者选了
  // 曲子再随 ref 一起写进去。换节点 = 换一份草稿。
  const [draftBgmMode, setDraftBgmMode] = useState<'push' | 'replace'>('push')
  const [draftBgmModeNode, setDraftBgmModeNode] = useState(nodeId)
  /** 「嵌套=子蓝图」但尚未挂包：不落盘空指针/不自动建库，只撑住面板模式。 */
  const [packModeUnbound, setPackModeUnbound] = useState(false)
  if (nodeId !== draftBgmModeNode) {
    setDraftBgmModeNode(nodeId)
    setDraftBgmMode('push')
    setPackModeUnbound(false)
  }
  const mountCardRefs = useRef<Record<string, HTMLDivElement | null>>({})
  useEffect(() => {
    if (focusAnchorRevision == null || !focusedMountId) return
    scrollIntoViewWithin(mountCardRefs.current[focusedMountId])
  }, [focusAnchorRevision])
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node || !nodeId) return <div style={{ padding: 10, opacity: 0.6, fontSize: 12 }}>{translateUi('ui.copy.da4bfbabe831')}</div>
  const d = node.data
  const keyConflicts = findKeyBindingConflicts(
    collectCurrentNodeKeyBindingSites(overlays, nodeId, d.overlayNodes),
  )
  const nodeIds = graph.nodes.map((n) => n.id)
  /** 下拉展示：中文名称只显示名称；没有中文名称时保留 id 兜底。 */
  const nodeLabel = (id: string) => {
    const n = graph.nodes.find((x) => x.id === id)
    return authoringOptionLabel(n?.data.name, id)
  }
  // 「默认样式 / ＋ 挂载」与界面 tab 保持同一份列表：自定义覆盖物 + 基础覆盖物（打平），
  // 直接从 live overlays 派生（见 builtin-schemes）。
  const schemeOverlayIds = listSchemeAndBaseOverlayIds(overlays)
  const mediaRef = d.media?.ref ?? ''
  const selectedVideoValue = mediaRef && !videoOptions.some((option) => option.id === mediaRef)
    ? '__unavailable__'
    : mediaRef
  const bgmRef = d.bgm?.ref ?? ''
  const selectedAudioValue = bgmRef && !audioOptions.some((option) => option.id === bgmRef)
    ? '__unavailable__'
    : bgmRef

  const nestProcess = getSubProcess(d)
  const nestPack = getSubFlowPack(d)
  const nestMode: 'none' | 'process' | 'pack' = nestPack
    ? 'pack'
    : nestProcess
      ? 'process'
      : packModeUnbound
        ? 'pack'
        : 'none'
  /** 只有容器不是演出节点；入口仍是可完整配置的第一个业务节点。 */
  const canConfigurePerformance = nestMode === 'none'
  // 作用域 BGM：读原始值（不过 getNodeBgm），与面板下拉一致。
  const bgm = d.bgm
  // 手写/AI 生成的非法 mode 在下拉里显示成 push（validate 会把它判 error），别让 select 变成
  // 「什么都没选」的空框。还没有配置时读本地草稿——见组件顶部 `draftBgmMode`。
  const bgmMode: 'push' | 'replace' | 'stop' = bgm?.mode === 'replace' || bgm?.mode === 'stop'
    ? bgm.mode
    : bgm?.ref ? 'push' : draftBgmMode
  const packKey = nestPack
    ? (nestPack.version ? `${nestPack.id}@${nestPack.version}` : nestPack.id)
    : ''
  const packLabel = (p: SubFlowPackDef) => {
    const key = `${p.id}@${p.version}`
    return authoringOptionLabel(p.title, key)
  }
  /** 下拉候选：排除自引用 + 会成环的候选（`isRefAllowed`）；已挂载的当前包永远保留展示，避免选中项丢失。 */
  const eligiblePacks = packs.filter((p) => p.id === nestPack?.id || !isRefAllowed || isRefAllowed(p.id))

  // 结算选项（带组件中文名 label）：shown/hidden 的界面 = 本节点各挂载 overlay 的 children。
  const compLabel = (component: string) => getComponentManifest(component)?.label ?? component
  const componentOptions: OptItem[] = (d.overlayNodes ?? []).flatMap((m) => {
    const mountId = overlayMountId(m)
    const overlayTitle = overlays?.[m.overlay]?.title?.trim()
    return resolveMountChildren(overlays, m).map((c) => {
      const value = `${mountId}/${c.id}`
      const names = [overlayTitle, compLabel(c.component)].filter((part, index, all) => part && all.indexOf(part) === index)
      return { value, label: authoringOptionLabel(names.join(' · '), value) }
    })
  })
  const hideOverlayOptions: OptItem[] = (d.overlayNodes ?? []).map((mount) => {
    const mountId = overlayMountId(mount)
    return { value: mountId, label: authoringOptionLabel(overlayDisplayLabel(mount.overlay, overlays), mountId) }
  })
  // spawn 模板只列界面方案（排除 node:* 本地内容容器 / 历史 fork）。
  const spawnOptions: OptItem[] = Object.values(overlays ?? {})
    .filter((o) => !o.id.startsWith('node:'))
    .flatMap((o) =>
      o.children.map((c) => {
        const value = `${o.id}/${c.id}`
        const names = [o.title?.trim(), compLabel(c.component)].filter((part, index, all) => part && all.indexOf(part) === index)
        return { value, label: authoringOptionLabel(names.join(' · '), value) }
      }),
    )
  const fieldTree = buildFieldTree(entities, variables)
  const pickers: EditorPickerCtx = { entities, variables, formulas, nodeLabel }
  const flowHandleOptions = (() => {
    const extra = graph.edges
      .filter((e) => e.source === node.id)
      .map((e) => e.sourceHandle ?? 'default')
    return mergeFlowHandles(deriveOutputs(node, overlays), extra)
  })()
  const edgeOptions: OptItem[] = graph.edges
    .filter((e) => e.source === node.id)
    .map((e) => ({
      value: e.id,
      label: `${flowHandleDisplay(e.sourceHandle ?? 'default')} → ${nodeLabel(e.target)}`,
    }))
  /** 每个交互出口 → 目标节点摘要（单边 `→ X`，多边 `→ A | B`）。 */
  const routeHints = (() => {
    const byHandle = new Map<string, string[]>()
    for (const e of graph.edges) {
      if (e.source !== node.id) continue
      const h = e.sourceHandle ?? 'default'
      const list = byHandle.get(h) ?? []
      list.push(nodeLabel(e.target))
      byHandle.set(h, list)
    }
    const out: Record<string, string> = {}
    for (const [h, labels] of byHandle) {
      if (h === 'default') continue
      out[h] = labels.length === 1 ? `→ ${labels[0]}` : `→ ${labels.join(' | ')}（边池）`
    }
    return out
  })()

  const patchData = (p: NodeDataPatch) => onChange(updateNodeData(graph, node.id, p))
  /** added 组件直接改自身；方案原型组件只保存相对方案的字段级差量。 */
  const setChildInputs = (mountIndex: number, childId: string, nextInputs: Record<string, unknown>) => {
    const mounts = [...(d.overlayNodes ?? [])]
    const mount = mounts[mountIndex]
    if (!mount) return
    const addedIndex = mount.added?.findIndex((child) => child.id === childId) ?? -1
    if (addedIndex >= 0) {
      const added = [...(mount.added ?? [])]
      added[addedIndex] = { ...added[addedIndex]!, inputs: nextInputs }
      mounts[mountIndex] = { ...mount, added }
      patchData({ overlayNodes: mounts })
      return
    }

    const base = overlays?.[mount.overlay]?.children.find((child) => child.id === childId)
    if (!base) return
    const sparseInputs = sparseOverlayInputOverride(base.inputs, nextInputs)
    const prev = mount.overrides?.[childId]
    const nextPatch: Partial<OverlayChild> = { ...prev }
    if (Object.keys(sparseInputs).length > 0) nextPatch.inputs = sparseInputs
    else delete nextPatch.inputs

    const overrides = { ...mount.overrides }
    if (Object.keys(nextPatch).length > 0) overrides[childId] = nextPatch
    else delete overrides[childId]
    mounts[mountIndex] = { ...mount, overrides: Object.keys(overrides).length ? overrides : undefined }
    patchData({ overlayNodes: mounts })
  }
  const targetNodeOptions: OptItem[] = nodeIds
    .filter((id) => id !== node.id)
    .map((id) => ({ value: id, label: nodeLabel(id) }))
  const setNestMode = (mode: 'none' | 'process' | 'pack') => {
    if (mode === 'none') {
      if (nestProcess && typeof confirm === 'function' && !confirm('取消内嵌子流程会删除其中的全部节点和连线，继续吗？')) return
      setPackModeUnbound(false)
      patchData({ subProcess: undefined, subFlowPack: undefined })
      return
    }
    if (mode === 'process') {
      setPackModeUnbound(false)
      onChange(attachSubProcess(graph, node.id))
      return
    }
    // 子蓝图：只切模式，不自动建库、不预挂第一个候选；挂包走下拉或「＋ 新建子蓝图」。
    if (nestPack) {
      setPackModeUnbound(false)
      patchData({ subProcess: undefined })
      return
    }
    setPackModeUnbound(true)
    patchData({ subProcess: undefined, subFlowPack: undefined })
  }
  const createAndAttachPack = () => {
    if (!onPacksChange) return
    const pack = makeEmptySubFlowPack({ title: `${d.name || node.id}${translateUi('ui.object.a8ac355bc261')}` })
    setPackModeUnbound(false)
    onPacksChange([...packs, pack])
    patchData({ subProcess: undefined, subFlowPack: { id: pack.id, version: pack.version } })
  }
  ensureNiUiStyle()
  return (
    // 根上刻意不设 overflow：一旦它成为滚动容器，下方吸顶头部条就只相对它定位——而它高度随内容、
    // 永不自己滚动，吸顶会失效。真正的滚动容器是宿主外层（GraphStudio：flex 1 0 400px + overflow:auto）。
    // `ni-root` 是新视觉的作用域根：ni-ui 的规则全挂在它下面，不外溢到扩展其它面板。
    <div className={NI_ROOT_CLASS}>
      <PerformanceSection
        graph={graph}
        node={node}
        d={d}
        patchData={patchData}
        onChange={onChange}
        onJump={onJump}
        canConfigurePerformance={canConfigurePerformance}
        selectedVideoValue={selectedVideoValue}
        videoOptions={videoOptions}
        nestMode={nestMode}
        setNestMode={setNestMode}
        nestProcess={nestProcess}
        nestPack={nestPack}
        packKey={packKey}
        packs={packs}
        eligiblePacks={eligiblePacks}
        packLabel={packLabel}
        isRefAllowed={isRefAllowed}
        setPackModeUnbound={setPackModeUnbound}
        createAndAttachPack={createAndAttachPack}
        onPacksChange={onPacksChange}
      />

      {canConfigurePerformance ? (
        <>
          <OverlaySection
            graph={graph}
            node={node}
            d={d}
            overlays={overlays}
            entities={entities}
            variables={variables}
            patchData={patchData}
            onChange={onChange}
            onDropOverlayIfOrphan={onDropOverlayIfOrphan}
            onRemoveMount={onRemoveMount}
            onFocusMount={onFocusMount}
            focusedMountId={focusedMountId}
            mountCardRefs={mountCardRefs}
            schemeOverlayIds={schemeOverlayIds}
            keyConflicts={keyConflicts}
            pickers={pickers}
            setChildInputs={setChildInputs}
            edgeOptions={edgeOptions}
            routeHints={routeHints}
            spawnOptions={spawnOptions}
            targetNodeOptions={targetNodeOptions}
            onCreateEntityAttribute={onCreateEntityAttribute}
            onCreateEntity={onCreateEntity}
            onCreateVariable={onCreateVariable}
            onCreateFormula={onCreateFormula}
          />

          <SettlementSection
            graph={graph}
            node={node}
            d={d}
            nodeLabel={nodeLabel}
            targetNodeOptions={targetNodeOptions}
            settlementInsertMs={settlementInsertMs}
            focusedLifecycleIndex={focusedLifecycleIndex}
            focusAnchorRevision={focusAnchorRevision}
            onFocusLifecycle={onFocusLifecycle}
            pickers={pickers}
            entities={entities}
            variables={variables}
            componentOptions={componentOptions}
            spawnOptions={spawnOptions}
            hideOverlayOptions={hideOverlayOptions}
            overlays={overlays}
            fieldTree={fieldTree}
            patchData={patchData}
            onChange={onChange}
            onCreateEntityAttribute={onCreateEntityAttribute}
            onCreateEntity={onCreateEntity}
            onCreateVariable={onCreateVariable}
            onCreateFormula={onCreateFormula}
          />
        </>
      ) : null}

      <EdgeSection
        graph={graph}
        node={node}
        nodeIds={nodeIds}
        nodeLabel={nodeLabel}
        flowHandleOptions={flowHandleOptions}
        pickers={pickers}
        entities={entities}
        variables={variables}
        onChange={onChange}
      />

      <BgmSection
        bgm={bgm}
        bgmMode={bgmMode}
        selectedAudioValue={selectedAudioValue}
        audioOptions={audioOptions}
        setDraftBgmMode={setDraftBgmMode}
        patchData={patchData}
      />
    </div>
  )
}
