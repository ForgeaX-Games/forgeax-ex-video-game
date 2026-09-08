import { t as translateUi } from '../../../i18n'
/**
 * 界面分区 —— 覆盖物挂载 + 每挂载的组件参数与事件响应。
 * 外观按 Figma「1.3 造化工坊国内版」15635:81582（有挂载）/ 15635:81242（空态）。
 */
import { Fragment, useEffect, useState } from 'react'
import type { Entity, GameGraph, GameNode, GameNodeData, Overlay, RoutingSettlement, Variable } from '@/runtime/core/schema/graph-schema'
import { authoringOptionLabel } from '@/authoring/formulas/authoring-option-label'
import type { NodeAction, OverlayReaction, Reaction, OverlayEventRef } from '@/runtime/core/schema/node-config-schema'
import { createOverlayMount, overlayMountId } from '@/runtime/core/schema/node-config-schema'
import { aggregateOverlayEvents, resolveEventReactionDo } from '@/runtime/core/schema/overlay-events'
import { resolveMountChildren } from '@/runtime/core/schema/expand-overlay'
import { getComponentManifest } from '@/runtime/core/registry/component-registry'
import {
  disconnect,
  updateEventRouteTiming,
  updateNodeData,
  upsertBranchEdge,
  type NodeDataPatch,
} from '@/authoring/graph/graph-edit'
import type { EditorPickerCtx } from '../editors'
import type {
  EntityAttributeCreateHandler,
  EntityCreateHandler,
  FormulaCreateHandler,
  VariableCreateHandler,
} from '../component-form-fields'
import { ComponentInputsDisclosure } from '../ComponentInputsDisclosure'
import type { KeyBindingConflict } from '../keyBindingConflicts'
import { overlayDisplayLabel } from '../schemeOverlays'
import { ComponentEventsEditor } from '../ComponentEventsEditor'
import { resolveMountLayoutForChildren } from '@/runtime/core/schema/layout'
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import { NI_ROOT_CLASS, NiAddMenu, NiChip, NiDivider, NiIcon, NiIconButton, NiSection } from '../ni-ui'
import {
  AdvanceTargetRow,
  OVERLAY_CONFIG_CONTROL_WIDTH,
  overlayConfigLabelWidth,
  RouteTimingEditor,
  type OptItem,
} from './shared'

/**
 * 界面分区的新壳（Figma 15635:81582 / 81242）。
 *
 * 只补 ni-ui 里没有的两样东西：挂载标题行与「组件」胶囊行。
 * 「＋ 添加界面」直接用通用的 NiAddMenu（与其它分区同一只控件）。
 */
const NI_OV_CSS = `
.${NI_ROOT_CLASS} .ni-ov-mounts { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.${NI_ROOT_CLASS} .ni-ov-mount { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.${NI_ROOT_CLASS} .ni-ov-mount-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.${NI_ROOT_CLASS} .ni-ov-mount-caret { flex: none; display: inline-flex; color: var(--ni-w-40); }
.${NI_ROOT_CLASS} .ni-ov-mount-title {
  font-size: var(--ni-fs-label);
  color: var(--ni-w-100);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.${NI_ROOT_CLASS} .ni-ov-mount-trash { flex: none; margin-left: auto; display: inline-flex; }
/* 组件胶囊行：稿子是一条 27px 的输入壳；组件多到装不下时换行而不是裁掉。 */
.${NI_ROOT_CLASS} .ni-control.ni-ov-children {
  gap: 8px;
  height: auto;
  min-height: var(--ni-control-h);
  flex-wrap: wrap;
}
.${NI_ROOT_CLASS} .ni-ov-children-label { flex: none; color: var(--ni-w-60); }
.${NI_ROOT_CLASS} .ni-ov-children-chips { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-width: 0; }
.${NI_ROOT_CLASS} .ni-ov-sublabel { font-size: var(--ni-fs-meta); color: var(--ni-w-60); }
.${NI_ROOT_CLASS} .ni-ov-params { display: flex; flex-direction: column; gap: 8px; min-width: 0; }

`

/** 与引擎 resolveEventReactions 同序查找挂载 event 反应的 do（兼容 A / panelA:A 等写法）。 */
function eventReactionDo(reactions: Reaction[] | undefined, ev: OverlayEventRef): NodeAction[] {
  return resolveEventReactionDo(reactions, ev.localEventId, ev.childId, ev.mountId) ?? []
}

/** 清理节点挂载 reaction 的全部历史别名；目录 reaction 的稳定 key 由 ComponentEventsEditor 单独维护。 */
function eventKeySet(ev: OverlayEventRef): Set<string> {
  const keys = new Set<string>([ev.localEventId, ev.eventId])
  keys.add(`${ev.childId}:${ev.localEventId}`)
  keys.add(`${ev.mountId}:${ev.localEventId}`)
  keys.add(`${ev.mountId}:${ev.childId}:${ev.localEventId}`)
  return keys
}

function upsertEventReaction(
  reactions: Reaction[] | undefined,
  ev: OverlayEventRef,
  doActions: NodeAction[],
): Reaction[] | undefined {
  const keys = eventKeySet(ev)
  const rest = (reactions ?? []).filter((r) => !(r.when.type === 'event' && keys.has(r.when.id)))
  if (doActions.length) rest.push({ when: { type: 'event', id: ev.localEventId }, do: doActions })
  return rest.length ? rest : undefined
}

/** 本节点上某交互出口（sourceHandle = localEventId）的出边。 */
function handleEdges(graph: GameGraph, nodeId: string, handle: string) {
  return graph.edges.filter((e) => e.source === nodeId && (e.sourceHandle ?? 'default') === handle)
}

/**
 * 「覆盖物事件 → 目标节点」捷径：upsert `sourceHandle=localEventId` 的边，并把 advance 写到**当前挂载**。
 * 同 handle 已有多条边（加权边池）时不改边，仅提示走「出边」。
 * 清空目标 = 拆掉该 handle 下出边（disconnect 会清掉指向它们的 advance）。
 */
function routeMountEventToNode(
  graph: GameGraph,
  nodeId: string,
  mountIndex: number,
  ev: OverlayEventRef,
  targetId: string,
): GameGraph {
  const handle = ev.localEventId
  const pool = handleEdges(graph, nodeId, handle)
  if (!targetId) {
    let g = graph
    for (const e of pool) g = disconnect(g, e.id)
    return g
  }
  if (pool.length > 1) return graph

  let g = upsertBranchEdge(graph, { source: nodeId, sourceHandle: handle, target: targetId })
  const edge = handleEdges(g, nodeId, handle).find((e) => e.target === targetId)
    ?? handleEdges(g, nodeId, handle)[0]
  if (!edge) return g

  const node = g.nodes.find((n) => n.id === nodeId)
  if (!node?.data.overlayNodes?.[mountIndex]) return g

  // 保留本事件已有的 effect/spawn（任一挂载上的），只换成指向新边的 advance；收拢到当前挂载。
  let preserved: NodeAction[] = []
  for (const m of node.data.overlayNodes) {
    const doList = eventReactionDo(m.reactions, ev)
    if (doList.length) {
      preserved = doList.filter((a) => a.kind !== 'advance')
      break
    }
  }
  const keys = eventKeySet(ev)
  const strip = (rs: Reaction[] | undefined): Reaction[] | undefined => {
    const next = (rs ?? []).filter((r) => !(r.when.type === 'event' && keys.has(r.when.id)))
    return next.length ? next : undefined
  }
  const mounts = node.data.overlayNodes.map((m, i) => {
    let reactions = strip(m.reactions)
    if (i === mountIndex) {
      const doActions: NodeAction[] = [...preserved, { kind: 'advance', edgeId: edge.id }]
      reactions = [...(reactions ?? []), { when: { type: 'event', id: handle }, do: doActions }]
    }
    return { ...m, reactions }
  })
  const dataReactions = strip(node.data.reactions)
  return updateNodeData(g, nodeId, { overlayNodes: mounts, reactions: dataReactions })
}

function OverlayReactionsEditor({
  events,
  catalogReactions,
  reactions,
  edgeOptions,
  routeHints,
  spawnOptions,
  overlays,
  pickers,
  labelWidth,
  entities,
  variables,
  nodeOptions,
  graph,
  nodeId,
  onChange,
  onRouteTo,
  routingSettlement,
  onSetRouteTiming,
  onCreateEntityAttribute,
  onCreateEntity,
  onCreateVariable,
  onCreateFormula,
}: {
  events: OverlayEventRef[]
  catalogReactions?: OverlayReaction[]
  reactions: Reaction[] | undefined
  edgeOptions: OptItem[]
  /** eventId → 出边目标摘要（有 advance 或默认推进时都能看见去哪）。 */
  routeHints?: Record<string, string>
  spawnOptions: OptItem[]
  overlays?: Record<string, Overlay>
  pickers?: EditorPickerCtx
  labelWidth: string
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  /** 目标节点下拉（不含当前节点）。 */
  nodeOptions: OptItem[]
  graph: GameGraph
  nodeId: string
  onChange: (next: Reaction[] | undefined) => void
  /** 选目标节点：upsert 边 + 本挂载 advance；空串 = 清除该出口边。 */
  onRouteTo: (ev: OverlayEventRef, targetId: string) => void
  routingSettlement?: RoutingSettlement
  onSetRouteTiming: (
    ev: OverlayEventRef,
    transition: 'immediate' | 'onSettlement',
    settlement?: RoutingSettlement,
  ) => void
  onCreateEntityAttribute?: EntityAttributeCreateHandler
  onCreateEntity?: EntityCreateHandler
  onCreateVariable?: VariableCreateHandler
  onCreateFormula?: FormulaCreateHandler
}): JSX.Element | null {
  if (!events.length) return null
  const catalog = pickers ?? { entities, variables }
  return (
    <>
      <ComponentEventsEditor
        mode="mount"
        events={events}
        catalogReactions={catalogReactions}
        mountReactions={reactions}
        edgeOptions={edgeOptions}
        spawnOptions={spawnOptions}
        overlays={overlays}
        pickers={catalog}
        labelWidth={labelWidth}
        allowSpawn={false}
        onCreateEntityAttribute={onCreateEntityAttribute}
        onCreateEntity={onCreateEntity}
        onCreateVariable={onCreateVariable}
        onCreateFormula={onCreateFormula}
        onMountActionsChange={(event, actions) => onChange(upsertEventReaction(reactions, event, actions))}
        renderRoute={(event) => {
          const actions = eventReactionDo(reactions, event)
          const pool = handleEdges(graph, nodeId, event.localEventId)
          const advance = actions.find((action): action is Extract<NodeAction, { kind: 'advance' }> => action.kind === 'advance')
          const advanceEdge = advance ? graph.edges.find((edge) => edge.id === advance.edgeId) : undefined
          const multiPool = pool.length > 1
          const currentTarget = multiPool ? '' : (advanceEdge?.target ?? (pool.length === 1 ? pool[0]!.target : ''))
          const routeEdge = advanceEdge ?? pool[0]
          const hint = routeHints?.[event.localEventId] ?? routeHints?.[event.eventId]
          const sourceNode = graph.nodes.find((candidate) => candidate.id === nodeId)
          const sourceLabel = sourceNode ? authoringOptionLabel(sourceNode.data.name, sourceNode.id) : nodeId
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              {multiPool ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 12 }}>
                  <span style={{ color: 'var(--ni-w-60)', flexShrink: 0 }}>{translateUi('ui.copy.8ab977960a69')}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sourceLabel}>{sourceLabel}</span>
                  <span style={{ color: 'var(--ni-w-60)', flexShrink: 0 }}>{translateUi('ui.copy.792bbe6e08f5')}</span>
                  <span style={{ color: '#ce9178', minWidth: 0 }}>{translateUi('ui.copy.710cbf364ce6')}{pool.length}{translateUi('ui.copy.94be287ad1f3')}{hint ?? ''}</span>
                </div>
              ) : (
                <AdvanceTargetRow
                  sourceLabel={sourceLabel}
                  currentTarget={currentTarget}
                  nodeOptions={nodeOptions}
                  onChange={(targetId) => onRouteTo(event, targetId)}
                />
              )}
              {routeEdge ? (
                <RouteTimingEditor
                  edge={routeEdge}
                  routingSettlement={routingSettlement}
                  onChange={(transition, settlement) => onSetRouteTiming(event, transition, settlement)}
                />
              ) : null}
            </div>
          )
        }}
      />
    </>
  )
}

export function OverlaySection({
  graph,
  node,
  d,
  overlays,
  entities,
  variables,
  patchData,
  onChange,
  onDropOverlayIfOrphan,
  onRemoveMount,
  onFocusMount,
  focusedMountId,
  mountCardRefs,
  schemeOverlayIds,
  keyConflicts,
  pickers,
  setChildInputs,
  edgeOptions,
  routeHints,
  spawnOptions,
  targetNodeOptions,
  onCreateEntityAttribute,
  onCreateEntity,
  onCreateVariable,
  onCreateFormula,
}: {
  graph: GameGraph
  node: GameNode
  d: GameNodeData
  overlays?: Record<string, Overlay>
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  patchData: (p: NodeDataPatch) => void
  onChange: (g: GameGraph) => void
  onDropOverlayIfOrphan?: (overlayId: string) => void
  onRemoveMount?: (mountId: string) => void
  onFocusMount?: (mountId: string | null) => void
  focusedMountId?: string | null
  mountCardRefs: { current: Record<string, HTMLDivElement | null> }
  schemeOverlayIds: string[]
  keyConflicts: Map<string, KeyBindingConflict>
  pickers: EditorPickerCtx
  setChildInputs: (mountIndex: number, childId: string, nextInputs: Record<string, unknown>) => void
  edgeOptions: OptItem[]
  routeHints: Record<string, string>
  spawnOptions: OptItem[]
  targetNodeOptions: OptItem[]
  onCreateEntityAttribute?: EntityAttributeCreateHandler
  onCreateEntity?: EntityCreateHandler
  onCreateVariable?: VariableCreateHandler
  onCreateFormula?: FormulaCreateHandler
}): JSX.Element {
  injectStyleOnce('ni-overlay', NI_OV_CSS)
  const mounts = d.overlayNodes ?? []
  /**
   * 手风琴：任何时候最多展开一张挂载。
   * `undefined` = 作者还没点过，回落到「预览台聚焦的那张，否则第一张」；
   * `null` = 作者主动收起了当前这张，此时全部折叠（不再摊开全部）。
   */
  const [expandedId, setExpandedId] = useState<string | null | undefined>(undefined)
  const firstMountId = mounts[0] ? overlayMountId(mounts[0]) : null
  const expandedMountId = expandedId !== undefined ? expandedId : (focusedMountId ?? firstMountId)
  // 预览台点中某挂载时，右侧跟着展开它（双向联动的另一半）。
  useEffect(() => {
    if (focusedMountId) setExpandedId(focusedMountId)
  }, [focusedMountId])
  return (
    <NiSection title={translateUi('ui.copy.3c4065adbc5f')}>
      {mounts.length > 0 ? (
        <div className="ni-ov-mounts">
          {mounts.map((mount, i) => {
            const mid = overlayMountId(mount)
            const multi = mounts.length > 1
            // 事件列表跟挂载展开（含 overrides / added），与运行时一致。
            const mountChildren = resolveMountChildren(overlays, mount)
            const labelWidth = overlayConfigLabelWidth(mountChildren)
            const events = aggregateOverlayEvents(
              { id: mount.overlay, title: overlays?.[mount.overlay]?.title, children: mountChildren },
              getComponentManifest,
              { mountId: mid, prefixMount: multi },
            )
            const titleText = overlayDisplayLabel(mount.overlay, overlays)
            const focused = focusedMountId === mid
            const expanded = expandedMountId === mid
            return (
              <Fragment key={`${mid}-${i}`}>
                {/* 分隔线是独立元素而不是挂载自身的 border-top——否则聚焦描边会把它一起圈进去。 */}
                {i > 0 ? <NiDivider /> : null}
              <div
                ref={(element) => { mountCardRefs.current[mid] = element }}
                data-focus-anchor={`mount:${mid}`}
                className="ni-ov-mount"
                // 聚焦描边刻意留在行内：#f08840 是预览台 `--gc-accent` 的同一枚橙，
                // 两侧高亮必须是同一个颜色值。描边半径 = borderRadius + outlineOffset，
                // 取 2+6 让它落在设计语言的 8px 上。
                style={focused ? { outline: '1px solid #f08840', outlineOffset: 6, borderRadius: 2 } : undefined}
              >
                <div
                  className="ni-ov-mount-head"
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    // 收起当前这张 = 全部折叠；展开另一张 = 其余自动收起（一次只开一张）。
                    const next = expanded ? null : mid
                    setExpandedId(next)
                    onFocusMount?.(next)
                  }}
                  title={expanded ? translateUi('ui.copy.3e9b531474a3') : translateUi('ui.copy.9cc34deefedb')}
                >
                  <span className="ni-ov-mount-caret">
                    <NiIcon name="chevron" size={10} rotate={expanded ? -90 : 180} />
                  </span>
                  <span className="ni-ov-mount-title" title={titleText}>{titleText}</span>
                  {mount.id && mount.id !== mount.overlay ? (
                    <NiChip muted title={`${translateUi('ui.template.15bdb8d79c9f')}${mount.overlay}`}>{translateUi('ui.copy.06d0f38dd26c')}{mount.overlay}</NiChip>
                  ) : null}
                  <NiChip muted>{mountChildren.length}{translateUi('ui.copy.7359f06cca8f')}</NiChip>
                  <NiChip muted>{events.length}{translateUi('ui.copy.550e3280629d')}</NiChip>
                  {/* 标题行整行可点（聚焦联动），所以删除按钮得自己拦住冒泡。 */}
                  <span className="ni-ov-mount-trash" onClick={(e) => e.stopPropagation()}>
                    <NiIconButton
                      icon="trash"
                      danger
                      ariaLabel="移除"
                      title={`${translateUi('ui.template.76d7b7320734')}${titleText}`}
                      onClick={() => {
                        const addedCount = mount.added?.length ?? 0
                        // 「添加控件」二级栏拖入的组件落在这份挂载的 added[] 里；移除挂载连带删除它们，先提示。
                        if (addedCount > 0 && typeof window !== 'undefined' && typeof window.confirm === 'function') {
                          const ok = window.confirm(`将同时删除 ${addedCount} 个由此方案添加到时间轴的组件，是否确认移除挂载？`)
                          if (!ok) return
                        }
                        const removed = mount.overlay
                        if (onRemoveMount) {
                          // scenario 级卸挂载：级联清掉應默等组件占用的跳转边与结算（含 node:* 孤儿清理）。
                          onRemoveMount(mid)
                        } else {
                          const next = (d.overlayNodes ?? []).filter((_, j) => j !== i)
                          patchData({ overlayNodes: next.length ? next : undefined })
                          // 卸载节点专属副本（node:*）→ 交上层用完整 scenario 判断并清理孤儿。
                          if (removed.startsWith('node:')) onDropOverlayIfOrphan?.(removed)
                        }
                        if (focused) onFocusMount?.(null)
                      }}
                    />
                  </span>
                </div>
                {expanded ? (
                  <>
                    {mountChildren.length ? (
                      <>
                        <div className="ni-control ni-ov-children">
                          <span className="ni-ov-children-label">{translateUi('ui.copy.7359f06cca8f')}</span>
                          <span className="ni-ov-children-chips">
                            {mountChildren.map((child) => (
                              <NiChip key={child.id} title={`${child.id} · ${child.component}`}>
                                {getComponentManifest(child.component)?.label ?? child.component}
                              </NiChip>
                            ))}
                          </span>
                        </div>
                        <span className="ni-ov-sublabel">{translateUi('ui.copy.daab283ce8c0')}</span>
                        <div className="ni-ov-params">
                          {mountChildren.map((child) => {
                            const inputs = (child.inputs ?? {}) as Record<string, unknown>
                            return (
                              <ComponentInputsDisclosure
                                key={child.id}
                                childId={child.id}
                                componentId={child.component}
                                values={inputs}
                                onChange={(next) => setChildInputs(i, child.id, next)}
                                pickers={pickers}
                                labelWidth={labelWidth}
                                controlWidth={OVERLAY_CONFIG_CONTROL_WIDTH}
                                onCreateEntityAttribute={onCreateEntityAttribute}
                                onCreateEntity={onCreateEntity}
                                onCreateVariable={onCreateVariable}
                                onCreateFormula={onCreateFormula}
                                keyConflicts={{
                                  overlayId: mid,
                                  childId: child.id,
                                  conflicts: keyConflicts,
                                }}
                              />
                            )
                          })}
                        </div>
                      </>
                    ) : null}
                    <OverlayReactionsEditor
                      events={events}
                      catalogReactions={overlays?.[mount.overlay]?.reactions}
                      reactions={mount.reactions}
                      edgeOptions={edgeOptions}
                      routeHints={routeHints}
                      spawnOptions={spawnOptions}
                      overlays={overlays}
                      pickers={pickers}
                      labelWidth={labelWidth}
                      entities={entities}
                      variables={variables}
                      nodeOptions={targetNodeOptions}
                      graph={graph}
                      nodeId={node.id}
                      onChange={(reactions) => {
                        const next = (d.overlayNodes ?? []).map((m, j) => (j === i ? { ...m, reactions } : m))
                        patchData({ overlayNodes: next })
                      }}
                      onRouteTo={(ev, targetId) => onChange(routeMountEventToNode(graph, node.id, i, ev, targetId))}
                      routingSettlement={d.routingSettlement}
                      onCreateEntityAttribute={onCreateEntityAttribute}
                      onCreateEntity={onCreateEntity}
                      onCreateVariable={onCreateVariable}
                      onCreateFormula={onCreateFormula}
                      onSetRouteTiming={(ev, transition, settlement) => onChange(
                        updateEventRouteTiming(graph, node.id, ev.localEventId, transition, settlement),
                      )}
                    />
                  </>
                ) : null}
              </div>
              </Fragment>
            )
          })}
        </div>
      ) : null}
      <NiAddMenu
        label={translateUi('ui.copy.05f9be720346')}
        title={translateUi('ui.copy.f6ecd1b2f726')}
        options={schemeOverlayIds.map((id) => ({ value: id, label: overlayDisplayLabel(id, overlays) }))}
        onSelect={(oid) => {
          if (!oid) return
          const mounts = [...(d.overlayNodes ?? [])]
          const definition = overlays?.[oid]
          const layout = resolveMountLayoutForChildren(
            undefined,
            definition?.children.map((child) => child.layout) ?? [],
          )
          const created = createOverlayMount(mounts, oid)
          const mount = { ...created, ...(layout ? { layout } : {}) }
          mounts.push(mount)
          patchData({ overlayNodes: mounts })
          // 新挂载直接选中并展开（与「添加结算」一致）：手风琴下不这么做，新加的那张是收着的。
          const createdId = overlayMountId(mount)
          setExpandedId(createdId)
          onFocusMount?.(createdId)
        }}
      />
    </NiSection>
  )
}
