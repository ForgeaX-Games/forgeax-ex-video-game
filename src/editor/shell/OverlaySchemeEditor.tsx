import { t as translateUi, tf as formatUi, useLocale } from '../../i18n'
/**
 * OverlaySchemeEditor —— 单个「界面方案」（overlay）的展示 + 编辑。
 * 中栏 = 标题 + 画布 + 控件库/图层 tabs；右栏 = 选中组件的参数与事件。
 * 组件增删改经回调交给持有 scenario.ui.overlays 的上层（GraphConfigView）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, JSX } from 'react'
import { createPortal } from 'react-dom'
import { getInspectorMountOptions } from '@/editor/host-init'
import type { Entity, Layout, Overlay, OverlayReaction, Variable } from '@/runtime/core/schema/graph-schema'
import { OverlayCatalogPreview } from './OverlayCatalogPreview'
import { ComponentLibrary } from './ComponentLibrary'
import { CatalogSearchInput } from './CatalogSearchInput'
import { componentTypeLabel } from './editors'
import type { Formula } from '@/authoring/blueprint/formula-authoring'
import {
  type EntityAttributeCreateHandler,
  type EntityCreateHandler,
  type FormulaCreateHandler,
  type VariableCreateHandler,
} from './component-form-fields'
import { ComponentPropertyPanel } from './ComponentPropertyPanel'
import {
  collectCurrentOverlayKeyBindingSites,
  findKeyBindingConflicts,
  keyConflictChildIds,
} from './keyBindingConflicts'
import { injectStyleOnce } from '@/editor/styles/injectStyle'

const WORKSPACE_CSS = `
.ose-root {
  display:flex; overflow:hidden; flex:1; min-width:0; min-height:0; height:100%;
  font-size:12px; background:#2c2c2c; color:#d2d2d2;
}
.ose-workspace {
  position:relative; display:flex; flex:1; flex-direction:column; min-width:0; min-height:0;
  overflow:hidden; background:#2c2c2c; container-type:inline-size;
}
.ose-stage {
  position:relative; flex:none; min-height:180px;
  max-height:min(calc(100% - 190px), 56.25cqw);
  overflow:hidden; background:#000;
}
.ose-bottom {
  display:flex; flex:1 1 0; flex-direction:column; min-height:184px; overflow:hidden;
  background:#2c2c2c;
}
.ose-bottom.is-library { gap:16px; box-sizing:border-box; padding:16px; background:#333; }
.ose-bottom.is-library .ose-panel,
.ose-bottom.is-library .ocl-root { display:contents; }
.ose-bottom.is-library .ocl-grid { padding:0; }
.ose-bottom.is-library .ose-layers { padding:0; }
.ose-stage-resizer {
  position:absolute; z-index:90; top:var(--ose-stage-height); right:0; left:0;
  width:100%; height:8px; padding:0; transform:translateY(-50%); border:0;
  background:transparent; cursor:ns-resize; touch-action:none;
}
.ose-stage-resizer:focus-visible { outline:2px solid #ff9c2a; outline-offset:-2px; }
.ose-bottom-header {
  display:flex; flex:none; align-items:center; height:31px; padding:0; box-sizing:border-box;
}
.ose-tabs {
  display:flex; align-self:stretch; align-items:stretch; gap:18px;
}
.ose-tabs button {
  position:relative; border:0; padding:0 2px; background:transparent; color:#a4a4a4;
  font:inherit; font-size:14px; cursor:pointer;
}
.ose-tabs button:hover { background:transparent; }
.ose-tabs button[aria-selected="true"] { color:#ff9c2a; }
.ose-bottom-header .catalog-search { margin-left:auto; }
.ose-panel { flex:1; min-height:0; overflow:hidden; }
.ose-layers { height:100%; padding:12px 14px 16px; box-sizing:border-box; overflow:auto; }
.ose-layer-list { display:flex; flex-direction:column; gap:0; padding:0; }
.ose-layer {
  display:flex; width:100%; gap:8px; align-items:center; box-sizing:border-box; min-height:32px;
  padding:5px 8px; border:1px solid transparent; border-bottom-color:rgba(255,255,255,.1);
  border-radius:0; cursor:pointer;
  text-align:left; background:transparent; color:#bbb;
}
.ose-layers.is-sortable .ose-layer { min-height:0; height:auto; padding:8px; cursor:grab; touch-action:none; user-select:none; }
.ose-layers.is-dragging .ose-layer { cursor:grabbing; }
.ose-layer.is-dragging { opacity:.55; }
.ose-layer.is-drop-before,.ose-layer.is-drop-after { position:relative; }
.ose-layer.is-drop-before::before,.ose-layer.is-drop-after::after {
  content:''; position:absolute; z-index:1; left:0; right:0; height:2px; background:#ff9c2a;
  box-shadow:0 0 0 1px rgba(255,156,42,.18); pointer-events:none;
}
.ose-layer.is-drop-before::before { top:-1px; }
.ose-layer.is-drop-after::after { bottom:-1px; }
.ose-layer:hover { background:rgba(255,255,255,.1); }
.ose-layer:focus-visible { outline:2px solid #ff9c2a; outline-offset:-2px; }
.ose-layer[aria-pressed="true"] { border-color:#ff9c2a; background:rgba(255,156,42,.1); color:#f1f1f1; }
.ose-layer-dot { flex:none; width:7px; height:7px; border-radius:50%; background:#686868; }
.ose-layer[aria-pressed="true"] .ose-layer-dot { background:#ff9c2a; box-shadow:0 0 0 3px rgba(255,156,42,.16); }
.ose-layer-label { flex:1; min-width:0; height:26px; padding:2px 0; overflow:hidden; font-size:16px; text-overflow:ellipsis; white-space:nowrap; }
.ose-layer-id { opacity:.42; margin-left:6px; }
.ose-sr-only {
  position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden;
  clip:rect(0,0,0,0); white-space:nowrap; border:0;
}
.ose-root > [data-testid="component-property-panel"] {
  flex:0 1 480px !important; width:39.3% !important; max-width:480px !important; min-width:280px !important;
  border-left-color:#1f1f1f !important; background:#2c2c2c !important;
}
`

function topmostChildId(children: Overlay['children']): string {
  return children.reduce<{ id: string; zIndex: number; index: number } | null>((top, child, index) => {
    const zIndex = typeof child.layout?.zIndex === 'number' ? child.layout.zIndex : 0
    if (!top || zIndex > top.zIndex || (zIndex === top.zIndex && index > top.index)) {
      return { id: child.id, zIndex, index }
    }
    return top
  }, null)?.id ?? ''
}

const LAYER_LONG_PRESS_MS = 300
const LAYER_PRESS_CANCEL_PX = 8

function visualLayerOrder(children: Overlay['children']): Overlay['children'] {
  return children
    .map((child, index) => ({ child, index }))
    .sort((a, b) => {
      const zDiff = (b.child.layout?.zIndex ?? 0) - (a.child.layout?.zIndex ?? 0)
      return zDiff || b.index - a.index
    })
    .map(({ child }) => child)
}

function moveLayerId(
  orderedIds: readonly string[],
  activeId: string,
  targetId: string,
  edge: 'before' | 'after',
): string[] {
  if (activeId === targetId) return [...orderedIds]
  const withoutActive = orderedIds.filter((id) => id !== activeId)
  const targetIndex = withoutActive.indexOf(targetId)
  if (targetIndex < 0) return [...orderedIds]
  const insertAt = targetIndex + (edge === 'after' ? 1 : 0)
  return [
    ...withoutActive.slice(0, insertAt),
    activeId,
    ...withoutActive.slice(insertAt),
  ]
}

const MIN_STAGE_PERCENT = 30
const MIN_BOTTOM_HEIGHT_PX = 190

/** 舞台拉伸上限：既保留底部工作区，又不超过当前可用宽度对应的完整 16:9 高度。 */
export function overlayStageMaxPercent(
  workspace: Pick<DOMRect, 'width' | 'height'> | undefined,
): number {
  if (!workspace || workspace.width <= 0 || workspace.height <= 0) return 100
  const aspectHeight = workspace.width * 9 / 16
  const bottomLimitedHeight = Math.max(0, workspace.height - MIN_BOTTOM_HEIGHT_PX)
  const maxHeight = Math.min(aspectHeight, bottomLimitedHeight)
  return Math.max(MIN_STAGE_PERCENT, Math.min(100, maxHeight / workspace.height * 100))
}

/**
 * 引用角标：被 N 个节点挂载引用；0 = 未被引用（灰）。
 * - `compact`（左栏窄列表用）：仅在被引用时渲一个 `⇢N` 迷你 pill；未引用时不占位（空 pill 只是噪音，
 *   还挤占标题宽度）。完整语义仍在 title 里。
 * - 非 compact（方案编辑头部，横向空间充足）：显示完整「被 N 个节点引用 / 未被引用」文案。
 */
export function UsageBadge({ count, compact = false }: { count: number; compact?: boolean }): JSX.Element | null {
  const used = count > 0
  if (compact && !used) return null
  const title = used ? `被 ${count} 个节点的 overlayNodes 引用` : '资源池里的闲置界面包（可保留）'
  return (
    <span
      style={{
        fontSize: 10,
        padding: '1px 6px',
        borderRadius: 8,
        whiteSpace: 'nowrap',
        background: used ? 'rgba(80,180,120,0.16)' : 'rgba(255,255,255,0.06)',
        color: used ? '#7fdda6' : '#8a8a8a',
        border: `1px solid ${used ? 'rgba(80,180,120,0.4)' : 'rgba(255,255,255,0.12)'}`,
      }}
      title={title}
    >
      {compact ? `⇢${count}` : used ? `${translateUi('ui.template.18bcdbc44f66')}${count}${translateUi('ui.template.fb98c262e764')}` : translateUi('ui.copy.453714541c33')}
    </span>
  )
}

/**
 * 内容重复角标：本方案与另外 N 份界面方案**内容等价**（component + 位置 + 参数一致，见
 * overlay-dedup.ts）。只提示、不自动处理——作者自行决定删哪份。`others` 为空则不渲染。
 * `compact`（左栏窄列表用）：仅一个 `⧉` 图标；完整重复对象列表仍在 title 里。
 */
export function DuplicateBadge({
  others,
  compact = false,
}: {
  others: readonly string[]
  compact?: boolean
}): JSX.Element | null {
  if (others.length === 0) return null
  return (
    <span
      style={{
        fontSize: 10,
        padding: compact ? '1px 5px' : '1px 6px',
        borderRadius: 8,
        whiteSpace: 'nowrap',
        background: 'rgba(200,149,90,0.16)',
        color: '#e0a35f',
        border: '1px solid rgba(200,149,90,0.45)',
      }}
      title={`${translateUi('ui.template.ea354071b94c')}${others.join('、')}${translateUi('ui.template.8188d1aae2a9')}`}
    >
      {compact ? '⧉' : translateUi('ui.copy.75dc7ff71662')}
    </span>
  )
}

export interface OverlaySchemeEditorProps {
  overlayId: string
  overlay: Overlay
  overlays?: Record<string, Overlay>
  entities: Record<string, Entity>
  variables: Record<string, Variable>
  formulas?: Record<string, Formula>
  itemIds?: readonly string[]
  usageCount: number
  /**
   * 结构锁定态（基础覆盖物单组件方案）：
   * 可编辑 inputs 和目录事件动作；组件只读居中预览，不可删除方案、增删组件或拖动。
   */
  locked?: boolean
  /** 与本方案内容重复的其它方案 id（component+位置+参数等价，见 overlay-dedup.ts）；空 = 无重复。 */
  duplicateOf?: readonly string[]
  onRename: (title: string) => void
  onRemove: () => void
  /** 组件库拖到画布落地：presetId（可选带初始 place）；返回新 child id（用于选中 + 拖入吸附）。 */
  onAddChild: (
    presetId: string,
    place?: { inputs?: Record<string, unknown>; layout?: Partial<Layout> },
  ) => string | undefined | void
  onRemoveChild: (childId: string) => void
  onPatchChild: (
    childId: string,
    patch: { inputs?: Record<string, unknown>; component?: string; layout?: Partial<Layout> },
  ) => void
  /** 图层面板按视觉前后顺序（最前在首位）提交一次性重排。 */
  onReorderChildren?: (orderedChildIds: string[]) => void
  onReactionsChange: (reactions: OverlayReaction[] | undefined) => void
  onCreateEntityAttribute?: EntityAttributeCreateHandler
  onCreateEntity?: EntityCreateHandler
  onCreateVariable?: VariableCreateHandler
  onCreateFormula?: FormulaCreateHandler
}

export function OverlaySchemeEditor({
  overlayId,
  overlay,
  overlays: overlayCatalog,
  entities,
  variables,
  formulas,
  itemIds = [],
  locked = false,
  onAddChild,
  onRemoveChild,
  onPatchChild,
  onReorderChildren,
  onReactionsChange,
  onCreateEntityAttribute,
  onCreateEntity,
  onCreateVariable,
  onCreateFormula,
}: OverlaySchemeEditorProps): JSX.Element {
  injectStyleOnce('overlay-scheme-workspace', WORKSPACE_CSS)
  const [selectedChildId, setSelectedChildId] = useState('')
  const workspaceRef = useRef<HTMLElement>(null)
  const resizingStageRef = useRef(false)
  const [stagePercent, setStagePercent] = useState(56)
  const [bottomTab, setBottomTab] = useState<'library' | 'layers'>(
    locked || overlay.children.length > 0 ? 'layers' : 'library',
  )
  const [libraryQuery, setLibraryQuery] = useState('')
  const layerPressRef = useRef<{
    childId: string
    pointerId: number
    pointerType: string
    startX: number
    startY: number
    lastY: number
    scrolling: boolean
  } | null>(null)
  const layerLongPressTimerRef = useRef<number | null>(null)
  const suppressNextLayerClickRef = useRef(false)
  const layerDragRef = useRef<{
    activeId: string
    targetId: string
    edge: 'before' | 'after'
  } | null>(null)
  const [layerDrag, setLayerDrag] = useState(layerDragRef.current)
  const [layerAnnouncement, setLayerAnnouncement] = useState<{
    component: Overlay['children'][number]['component']
    position: number
    total: number
  } | null>(null)
  const [keyConflictFocusRequest, setKeyConflictFocusRequest] = useState<
    { childId: string; nonce: number } | undefined
  >()
  // 交互热区重叠冲突（DOM 实测，来自画布回调）——组件清单里对应行标红。
  const [warnIds, setWarnIds] = useState<Set<string>>(() => new Set())
  const overlays = useMemo(
    () => overlayCatalog ?? { [overlayId]: overlay },
    [overlay, overlayCatalog, overlayId],
  )
  const keyConflicts = useMemo(
    () => findKeyBindingConflicts(
      collectCurrentOverlayKeyBindingSites(overlay, overlays),
    ),
    [overlay, overlays],
  )
  const keyConflictIds = useMemo(
    () => keyConflictChildIds(overlayId, keyConflicts),
    [keyConflicts, overlayId],
  )
  const orderedLayers = useMemo(
    () => visualLayerOrder(overlay.children),
    [overlay.children],
  )
  useLocale()
  const layerAnnouncementText = layerAnnouncement
    ? formatUi('overlayLayers.reordered', {
        name: componentTypeLabel(layerAnnouncement.component),
        position: layerAnnouncement.position,
        total: layerAnnouncement.total,
      })
    : ''
  const layerChildOrderKey = overlay.children.map((child) => child.id).join('\u0000')
  const layerChildSetKey = overlay.children.map((child) => child.id).sort().join('\u0000')
  const selectedChild = overlay.children.find((child) => child.id === selectedChildId)
  const { inspectorEl, onInspectorTabChange } = getInspectorMountOptions()
  // 插槽 tab 用当前选中对象命名——没选中组件时退回方案名，和蓝图的「节点编辑」平级。
  const inspectorTabLabel = selectedChild
    ? componentTypeLabel(selectedChild.component)
    : overlay.title || overlayId
  useEffect(() => {
    if (!onInspectorTabChange) return
    try {
      onInspectorTabChange({ label: inspectorTabLabel, selected: !!selectedChild })
    } catch (err) {
      console.error('[game-video] onInspectorTabChange failed', err)
    }
  }, [inspectorTabLabel, selectedChild, onInspectorTabChange])
  // 离开界面视图时交还页签，否则宿主留着一个点进去空白的死页签。
  const releaseInspectorTabRef = useRef(onInspectorTabChange)
  useEffect(() => {
    releaseInspectorTabRef.current = onInspectorTabChange
  }, [onInspectorTabChange])
  useEffect(() => () => {
    try {
      releaseInspectorTabRef.current?.({ label: '', selected: false })
    } catch (err) {
      console.error('[game-video] onInspectorTabChange failed', err)
    }
  }, [])

  useEffect(() => () => {
    if (layerLongPressTimerRef.current != null) {
      window.clearTimeout(layerLongPressTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (layerLongPressTimerRef.current != null) {
      window.clearTimeout(layerLongPressTimerRef.current)
      layerLongPressTimerRef.current = null
    }
    layerPressRef.current = null
    layerDragRef.current = null
    setLayerDrag(null)
  }, [layerChildOrderKey, locked, overlayId])

  useEffect(() => {
    setLayerAnnouncement(null)
  }, [layerChildSetKey, locked, overlayId])

  useEffect(() => {
    setBottomTab(locked || overlay.children.length > 0 ? 'layers' : 'library')
    setLibraryQuery('')
  }, [locked, overlayId])

  // 进入方案时默认选中视觉最上层组件（zIndex 高者优先，同层级后渲染者优先）；
  // 双字幕等完全重叠时，默认选择因此与眼前实际可见的那一层一致。
  // 参数/事件因此始终紧跟画布出现，不要求作者先猜到还需额外点击一次。
  useEffect(() => {
    setSelectedChildId((current) =>
      overlay.children.some((child) => child.id === current)
        ? current
        : topmostChildId(overlay.children))
  }, [overlayId, overlay.children])

  // Backspace/Delete 删除选中组件；经 onRemoveChild→setMeta 天然进 zundo 撤销历史。锁定态（基础覆盖物）不删。
  // 护栏：输入框/下拉/可编辑区、以及焦点在左侧方案列表（.gc-list）内一律放行给它们。
  // 选中组件的方向键 = 微调位置，由画布 OverlayCatalogPreview 处理；切换选中交回鼠标点选 / 左侧列表上下键。
  useEffect(() => {
    if (locked) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return
      if (!selectedChildId) return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return
      if (t?.closest?.('.gc-list')) return
      e.preventDefault()
      onRemoveChild(selectedChildId)
      setSelectedChildId('')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedChildId, onRemoveChild, locked])

  const clearLayerPress = (): void => {
    if (layerLongPressTimerRef.current != null) {
      window.clearTimeout(layerLongPressTimerRef.current)
      layerLongPressTimerRef.current = null
    }
    layerPressRef.current = null
    layerDragRef.current = null
    setLayerDrag(null)
  }

  const startLayerPress = (
    childId: string,
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    if (locked || event.button !== 0) return
    // A new pointer gesture is distinct from the compatibility click emitted for
    // the preceding touch scroll, so it must not inherit that one-shot guard.
    suppressNextLayerClickRef.current = false
    clearLayerPress()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    layerPressRef.current = {
      childId,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      lastY: event.clientY,
      scrolling: false,
    }
    layerLongPressTimerRef.current = window.setTimeout(() => {
      const press = layerPressRef.current
      if (!press || press.childId !== childId) return
      const drag = { activeId: childId, targetId: childId, edge: 'before' as const }
      setSelectedChildId(childId)
      layerDragRef.current = drag
      setLayerDrag(drag)
    }, LAYER_LONG_PRESS_MS)
  }

  const moveLayerPress = (event: React.PointerEvent<HTMLDivElement>): void => {
    const press = layerPressRef.current
    if (!press || press.pointerId !== event.pointerId) return
    if (press.scrolling) {
      event.preventDefault()
      event.currentTarget.scrollTop -= event.clientY - press.lastY
      press.lastY = event.clientY
      return
    }
    if (!layerDragRef.current) {
      if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > LAYER_PRESS_CANCEL_PX) {
        if (layerLongPressTimerRef.current != null) {
          window.clearTimeout(layerLongPressTimerRef.current)
          layerLongPressTimerRef.current = null
        }
        if (press.pointerType === 'touch') {
          event.preventDefault()
          press.scrolling = true
          event.currentTarget.scrollTop -= event.clientY - press.lastY
          press.lastY = event.clientY
          suppressNextLayerClickRef.current = true
        } else {
          clearLayerPress()
        }
      }
      return
    }
    event.preventDefault()
    const pointTarget = document.elementFromPoint?.(event.clientX, event.clientY)
      ?? (event.target as Element | null)
    const target = pointTarget?.closest<HTMLButtonElement>('[data-layer-id]')
    const targetId = target?.dataset.layerId
    if (!target || !targetId) return
    const rect = target.getBoundingClientRect()
    const edge: 'before' | 'after' = event.clientY < rect.top + rect.height / 2
      ? 'before'
      : 'after'
    const next = { activeId: press.childId, targetId, edge }
    layerDragRef.current = next
    setLayerDrag(next)
  }

  const commitLayerOrder = (nextIds: string[], movedId: string): void => {
    if (!onReorderChildren) return
    onReorderChildren(nextIds)
    const child = overlay.children.find((candidate) => candidate.id === movedId)
    if (!child) return
    setLayerAnnouncement({
      component: child.component,
      position: nextIds.indexOf(movedId) + 1,
      total: nextIds.length,
    })
  }

  const finishLayerPress = (event: React.PointerEvent<HTMLDivElement>): void => {
    const press = layerPressRef.current
    if (!press || press.pointerId !== event.pointerId) return
    const drag = layerDragRef.current
    if (drag && onReorderChildren) {
      const orderedIds = orderedLayers.map((child) => child.id)
      const nextIds = moveLayerId(orderedIds, drag.activeId, drag.targetId, drag.edge)
      if (nextIds.some((id, index) => id !== orderedIds[index])) {
        commitLayerOrder(nextIds, drag.activeId)
      }
    }
    clearLayerPress()
  }

  const propertyPanel = (
    <ComponentPropertyPanel
      overlay={overlay}
      overlays={overlayCatalog}
      selectedChild={selectedChild}
      entities={entities}
      variables={variables}
      formulas={formulas}
      itemIds={itemIds}
      locked={locked}
      onRemoveChild={(childId) => {
        onRemoveChild(childId)
        if (selectedChildId === childId) setSelectedChildId('')
      }}
      onPatchChild={onPatchChild}
      onReactionsChange={onReactionsChange}
      onCreateEntityAttribute={onCreateEntityAttribute}
      onCreateEntity={onCreateEntity}
      onCreateVariable={onCreateVariable}
      onCreateFormula={onCreateFormula}
      keyConflicts={keyConflicts}
      keyConflictFocusRequest={keyConflictFocusRequest}
    />
  )

  return (
    <div className="ose-root">
      <main
        ref={workspaceRef}
        data-testid="overlay-scheme-workspace"
        className="ose-workspace"
      >
        <div
          className="ose-stage"
          data-testid="overlay-stage-region"
          style={{ height: `${stagePercent}%` }}
        >
          <OverlayCatalogPreview
            overlay={overlay}
            entities={entities}
            variables={variables}
            selectedChildId={selectedChildId}
            onSelectChild={setSelectedChildId}
            onAddChild={
              locked
                ? undefined
                : (presetId, place) => {
                    const id = onAddChild(presetId, place)
                    if (typeof id === 'string') setSelectedChildId(id)
                    return id
                  }
            }
            onPatchChildLayout={locked
              ? undefined
              : (childId, patch) => onPatchChild(childId, { layout: patch })}
            onWarnChange={locked ? undefined : setWarnIds}
            keyConflictChildIds={keyConflictIds}
            onKeyConflictIconClick={(childId) => {
              setSelectedChildId(childId)
              setKeyConflictFocusRequest((current) => ({
                childId,
                nonce: (current?.nonce ?? 0) + 1,
              }))
            }}
            showDesignCanvas={!locked}
            centerChildren={locked}
            showTimeScrubber={false}
            showSelectionFrames={locked}
            fillAvailableHeight
          />
        </div>

        <button
          type="button"
          className="ose-stage-resizer"
          style={{ '--ose-stage-height': `min(${stagePercent}%, calc(100% - ${MIN_BOTTOM_HEIGHT_PX}px), 56.25cqw)` } as CSSProperties}
          role="separator"
          aria-label={translateUi('ui.copy.c1d794ca8074')}
          aria-orientation="horizontal"
          aria-valuemin={MIN_STAGE_PERCENT}
          aria-valuemax={100}
          aria-valuenow={Math.round(stagePercent)}
          onPointerDown={(event) => {
            resizingStageRef.current = true
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            if (!resizingStageRef.current) return
            const rect = workspaceRef.current?.getBoundingClientRect()
            if (!rect || rect.height <= 0) return
            const next = ((event.clientY - rect.top) / rect.height) * 100
            setStagePercent(Math.max(
              MIN_STAGE_PERCENT,
              Math.min(overlayStageMaxPercent(rect), next),
            ))
          }}
          onPointerUp={(event) => {
            resizingStageRef.current = false
            event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={() => {
            resizingStageRef.current = false
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
            event.preventDefault()
            const max = overlayStageMaxPercent(workspaceRef.current?.getBoundingClientRect())
            setStagePercent((current) => Math.max(
              MIN_STAGE_PERCENT,
              Math.min(max, current + (event.key === 'ArrowDown' ? 2 : -2)),
            ))
          }}
        />

        <section className="ose-bottom is-library" data-testid="overlay-library-region">
          <div className="ose-bottom-header">
            <div role="tablist" aria-label={translateUi('ui.copy.473a19fc85a7')} className="ose-tabs">
              {!locked ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={bottomTab === 'library'}
                  onClick={() => setBottomTab('library')}
                >
                  {translateUi('ui.copy.af222a3bb664')}</button>
              ) : null}
              <button
                type="button"
                role="tab"
                aria-selected={bottomTab === 'layers'}
                onClick={() => setBottomTab('layers')}
              >
                {translateUi('ui.copy.ec4bca7dcc30')}</button>
            </div>
            {!locked && bottomTab === 'library' ? (
              <CatalogSearchInput
                ariaLabel={translateUi('ui.copy.346e069b7cd4')}
                placeholder={translateUi('ui.copy.346e069b7cd4')}
                value={libraryQuery}
                onChange={setLibraryQuery}
              />
            ) : null}
          </div>
          {bottomTab === 'library' && !locked ? (
            <div role="tabpanel" aria-label={translateUi('ui.copy.af222a3bb664')} className="ose-panel">
              <ComponentLibrary
                query={libraryQuery}
                onQueryChange={setLibraryQuery}
                showSearch={false}
              />
            </div>
          ) : (
            <div
              role="tabpanel"
              aria-label={translateUi('ui.copy.ec4bca7dcc30')}
              data-testid="overlay-layers"
              className={`ose-panel ose-layers${locked ? '' : ' is-sortable'}${layerDrag ? ' is-dragging' : ''}`}
              onPointerMove={locked ? undefined : moveLayerPress}
              onPointerUp={locked ? undefined : finishLayerPress}
              onPointerCancel={locked ? undefined : clearLayerPress}
              onLostPointerCapture={locked ? undefined : clearLayerPress}
            >
              {overlay.children.length === 0 ? (
                <div style={{ fontSize: 11, opacity: 0.5 }}>{translateUi('ui.copy.e18f9be2c6df')}</div>
              ) : null}
              <div className="ose-layer-list">
              {orderedLayers.map((child) => {
                const selected = child.id === selectedChildId
                const hotspotWarn = warnIds.has(child.id)
                const keyWarn = keyConflictIds.has(child.id)
                const warn = hotspotWarn || keyWarn
                const warnTitle = keyWarn
                  ? '交互按键与其它界面或控件重复'
                  : '与另一交互控件热区重叠，运行时点击会互相遮挡'
                return (
                  <button
                    type="button"
                    key={child.id}
                    data-layer-id={child.id}
                    onPointerDown={locked ? undefined : (event) => startLayerPress(child.id, event)}
                    onKeyDown={locked ? undefined : (event) => {
                      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
                      const orderedIds = orderedLayers.map((candidate) => candidate.id)
                      const currentIndex = orderedIds.indexOf(child.id)
                      const nextIndex = currentIndex + (event.key === 'ArrowUp' ? -1 : 1)
                      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= orderedIds.length) return
                      event.preventDefault()
                      const nextIds = [...orderedIds]
                      nextIds.splice(currentIndex, 1)
                      nextIds.splice(nextIndex, 0, child.id)
                      setSelectedChildId(child.id)
                      commitLayerOrder(nextIds, child.id)
                    }}
                    onClick={() => {
                      if (suppressNextLayerClickRef.current) {
                        suppressNextLayerClickRef.current = false
                        return
                      }
                      setSelectedChildId(child.id)
                    }}
                    aria-keyshortcuts={locked ? undefined : 'Alt+ArrowUp Alt+ArrowDown'}
                    title={child.id}
                    aria-pressed={selected}
                    className={`ose-layer${layerDrag?.activeId === child.id ? ' is-dragging' : ''}${layerDrag?.targetId === child.id ? ` is-drop-${layerDrag.edge}` : ''}`}
                    style={warn ? { borderColor: '#ff6b6b', background: 'rgba(255,107,107,.08)' } : undefined}
                  >
                    <span className="ose-layer-dot" />
                    <span className="ose-layer-label">
                      {componentTypeLabel(child.component)}
                      <span className="ose-layer-id">· {child.id}</span>
                    </span>
                    {warn ? (
                      <span style={{ flex: 'none', color: '#ff6b6b', fontSize: 11 }} title={warnTitle}>⚠</span>
                    ) : null}
                  </button>
                )
              })}
              </div>
              <div className="ose-sr-only" role="status" aria-live="polite">
                {layerAnnouncementText}
              </div>
            </div>
          )}
        </section>
      </main>
      {/* 宿主给了 inspectorEl 时，参数面板搬到 Agent 右侧那个通用插槽里（本视图自己命名 tab）；
          没有宿主 slot 的形态（standalone / dev host）仍留在中栏右侧。
          宿主自己管页签时没选中组件页签会消失，此时不塞内容，免得留下点不到的死 DOM。 */}
      {inspectorEl
        ? createPortal(
          onInspectorTabChange && !selectedChild ? null : propertyPanel,
          inspectorEl,
        )
        : propertyPanel}
    </div>
  )
}
