import { t as translateUi, tf as formatUi } from '../../i18n'
/**
 * GraphStudio —— 调试用「编辑 + 试玩 + 运行时可视化」一体表面。
 *
 * 左：可编辑蓝图画布（GraphCanvas），实时高亮当前执行节点 + 点亮已走边，点节点可 jump。
 * 右：试玩面板（演出/HUD/交互/结局），与画布共享**同一个 GraphSession**，所以执行到哪、画布就亮哪。
 * 编辑图后可从节点「从此试玩」打开浮层；浮层内「重开」用最新图重建 session。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { GameGraph, GameScenario, SubFlowPackDef } from '@/runtime/core/schema/graph-schema'
import { getSubFlowPack, getSubProcess } from '@/runtime/core/schema/graph-schema'
import { GraphSession, type SessionSnapshot } from '@/runtime/core/engine/session'
import { createSessionSeed } from '@/runtime/react/play/sessionSeed'
import {
  getInspectorActive,
  getInspectorMountOptions,
  subscribeInspectorActive,
} from '@/editor/host-init'
import { GraphCanvas } from '@/editor/graph/canvas/GraphCanvas'
import { NodeInspector, type VideoOption } from './NodeInspector'
import { NodePanelTabBar, type NodePanelTab } from './NodePanelTabBar'
import { NodePreviewStage } from './NodePreviewStage'
import { VersionPicker } from './VersionPicker'
import { PlayerRootContext } from '@/runtime/react/component-host/rendererRegistry'
import { createCoreSkinRegistry } from '@/runtime/react/component-host'
import { claimPlayerFocus, releasePlayerFocus } from '@/runtime/react/input/playerFocus'
import { bootEditorSkins } from '../init'
import { BgmPlayer, GameStage, PlaybackClockProvider, useControlledPlaybackTimeout, VideoAudioToggle } from '@/runtime/react/play'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { dropOverlayIfUnreferenced } from '@/authoring/graph/overlay-edit'
import { removeMountGraph } from '../video/graphMaterialOps'
import { resolveCatalogMediaSrc } from './media'
import { catalogEntityOptions, useAssetCatalog } from '@/editor/assets/asset-catalog'
import { useClipPerformanceEnd, videoDurationCapReached, MissingVideoNotice } from '@/runtime/react/play'
import { addNode } from '@/authoring/graph/graph-edit'
import type { GameNode, NodeMedia } from '@/runtime/core/schema/graph-schema'
import type { Formula } from '@/authoring/blueprint/formula-authoring'
import { docToPack, metaFromDocument, packToDoc } from '@/authoring/blueprint/blueprint-project'
import { wouldCreateCycle } from '@/authoring/graph/blueprint-refs'
import { useRevealOnScopeChange } from './useRevealOnScopeChange'
import { blueprintSidebarPath } from './blueprintNav'
import {
  graphPathLabels, resolveGraphAtPath, resolveGraphEntryAtPath, updateGraphAtPath, validGraphPath,
} from '@/authoring/graph/graph-scope'
import { computeGraphLayout } from '@/authoring/graph/graph-layout'
import { forgeaxHost } from '../../platform/HostSdkBridge'
import { buildNodeContextReference } from './node-agent-context'
import { runtimeRuleSignature } from './runtime-rule-signature'
import { videoOptionsFromCatalog } from './videoOptionsFromCatalog'
import { pluginFetch } from '../../lib/plugin-http'
import { openNodeVideoGeneration } from '../assets/generation/videoGenerationNavigation'
import { useVideoGenerationPanel } from '../persist/videoGenerationPanelStore'
import { assetCatalogClient } from '@/editor/assets/asset-catalog-client'
import {
  ensureEntity,
  ensureEntityAttribute,
  ensureFormula,
  ensureVariable,
  type EntityAttributeCreateRequest,
  type EntityCreateRequest,
  type FormulaCreateRequest,
  type VariableCreateRequest,
} from '@/authoring/formulas/meta-catalog'
import { RenderErrorBoundary } from '../diagnostics'

interface PlayAnchor {
  nodeId: string
  blueprintId: string
  graphPath: string[]
}

/** 工具条暖色皮肤（对齐旧 gc- 目录风格）。 */
function ensureToolbarStyle(): void {
  if (typeof document === 'undefined') return
  let s = document.getElementById('gv-graph-toolbar-style') as HTMLStyleElement | null
  if (!s) {
    s = document.createElement('style')
    s.id = 'gv-graph-toolbar-style'
    document.head.appendChild(s)
  }
  // 每次写回，避免 HMR 后旧 CSS 残留。
  s.textContent = `
    .gv-graph-toolbar{position:relative;z-index:2;flex-shrink:0;background:#1b1713;border-bottom:1px solid #2e2924;color:#f6f1e9}
    .gv-graph-toolbar button,.gv-graph-toolbar select{background:#252019;border:1px solid #403830;color:#f6f1e9;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer}
    .gv-graph-toolbar button:hover,.gv-graph-toolbar select:hover{background:#2f2923;border-color:#f08840}
    .gv-node-panel{
      /* 配置列宽与预览开合无关；预览内容始终保持 target 宽度，只有裁切轨道 0 ↔ target 在动。 */
      --gv-form-w:clamp(${FORM_W_MIN}px,28vw,500px);
      --gv-preview-target-w:calc(var(--gv-form-w) * 711 / 500);
      --gv-preview-w:0px;
      /* 与画布的分隔线是两列之外的额外一像素，不算进设计宽度，否则右列会跟着差 1px。 */
      border-left:1px solid #2e2924;
      width:calc(var(--gv-form-w) + var(--gv-preview-w) + 1px);
      will-change:width;
      transition:width var(--motion-duration-panel,220ms) var(--motion-ease-out,cubic-bezier(0,0,.2,1));
    }
    .gv-node-panel[data-preview-open="true"]{--gv-preview-w:var(--gv-preview-target-w)}
    .gv-node-panel-columns{
      transition:grid-template-columns var(--motion-duration-panel,220ms) var(--motion-ease-out,cubic-bezier(0,0,.2,1));
    }
    .gv-node-preview-column{position:relative;overflow:hidden}
    @media (prefers-reduced-motion:reduce){
      .gv-node-panel,.gv-node-panel-columns{transition-duration:1ms!important}
    }
  `
}

/** 节点面板分栏：Figma 设计宽度为预览 711px + 表单 500px，窄屏保持同比缩放。 */
const FORM_W_MIN = 280
const PREVIEW_OPEN_KEY = 'game-video.nodePanel.previewOpen'
const PREVIEW_DRAWER_MOTION_MS = 220
/** 开关拉片的宽度；贴画布右内缘时，右上角的浮层要按它让位。 */
const PREVIEW_TOGGLE_PILL_W = 34
/** 画布顶栏高度（面包屑 + 右侧三按钮）；右上角的浮层要落在它下方。 */
const CANVAS_TOP_BAR_H = 58
/** 试玩浮层默认宽 + 演出区默认高（缩放的起点，也是每次 mount 的初值）。 */
const PLAY_OVERLAY_W = 320
const PLAY_STAGE_H = 180
/** 缩放下限：再小演出区就看不出画面、标题栏的按钮也开始互相挤。 */
const PLAY_OVERLAY_MIN_W = 260
const PLAY_STAGE_MIN_H = 120

/**
 * 预览区开关拉片（Figma 14597:20050）：#2C2C2C 左尖拉片 + 向左渐亮的白描边 + 视频库图标，
 * 骑在节点面板左缘（向左探出 34px）、顶边与页签栏底（58px）对齐——收起态贴着配置列左缘，
 * 展开态随面板左扩贴着预览区左缘（Figma 14597:20310）。矢量数据取自 Figma 导出 SVG。
 * 预览弹出时图标与描边高亮：白 40% → 全白（Figma 14597:20069）。
 */
function PreviewTogglePill({ open, onToggle, anchor = 'panel-edge' }: {
  open: boolean
  onToggle: () => void
  /**
   * `panel-edge` 骑在节点面板左缘外侧（面板内两列形态）。
   * `canvas-edge` 贴画布右内缘——宿主拆走预览列后拉片必须悬空压在画布上，
   * 否则收起态要给它留一条导轨，会吃掉画布宽度、挡住底下的蓝图节点。
   */
  anchor?: 'panel-edge' | 'canvas-edge'
}): JSX.Element {
  const highlight = open ? 1 : 0.4
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? translateUi('ui.copy.af708061a766') : translateUi('ui.copy.f3e3f2c9f756')}
      title={open ? translateUi('ui.copy.3f621220eb39') : translateUi('ui.copy.00d162271b46')}
      style={{
        position: 'absolute',
        ...(anchor === 'canvas-edge' ? { right: 0 } : { left: -34 }),
        top: 58,
        width: 34,
        height: 103,
        padding: 0,
        border: 'none',
        borderRadius: 0,
        background: 'none',
        cursor: 'pointer',
        zIndex: 7,
      }}
    >
      <svg width="34" height="103" viewBox="0 0 33.8388 102.818" fill="none" aria-hidden style={{ position: 'absolute', inset: 0 }}>
        <path
          d="M33.3173 102.098L7.32024 93.5449C3.26272 92.2097 0.520404 88.421 0.520437 84.1494L0.521413 18.668C0.521651 14.3965 3.26366 10.6074 7.32122 9.27246L33.3173 0.71875V102.098Z"
          fill="#2C2C2C"
          stroke="url(#gvPreviewToggleStroke)"
          strokeWidth="1.04119"
        />
        <defs>
          <linearGradient id="gvPreviewToggleStroke" x1="33.8388" y1="51.409" x2="0" y2="51.409" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFFFFF" stopOpacity="0" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity={highlight} />
          </linearGradient>
        </defs>
      </svg>
      <svg
        width="21.16"
        height="20.82"
        viewBox="0 0 21.1595 20.8239"
        fill="none"
        aria-hidden
        style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
      >
        <path
          d="M3.29141 4.16478H17.8681M5.3738 1.04119H15.7857M1.20902 7.28836H19.9505L18.0764 19.7827H3.08317L1.20902 7.28836Z"
          stroke="#FFFFFF"
          strokeOpacity={highlight}
          strokeWidth="2.08239"
          strokeLinecap="square"
        />
        <path
          d="M12.1416 13.5355L10.0592 15.0973V11.9737L12.1416 13.5355Z"
          stroke="#FFFFFF"
          strokeOpacity={highlight}
          strokeWidth="2.08239"
        />
      </svg>
    </button>
  )
}

export function GraphStudio({ scenario }: { scenario: GameScenario }): JSX.Element {
  bootEditorSkins()
  ensureToolbarStyle()
  const {
    inspectorEl,
    previewEl,
    onNodeSelect,
    onPreviewOpenChange,
    onInspectorTabChange,
  } = getInspectorMountOptions()
  const externalInspector = !!inspectorEl
  // 预览拆分只在宿主同时给出两个 slot 时生效；只给 inspectorEl 的宿主保持原两列形态。
  const externalPreview = externalInspector && !!previewEl
  const inspectorActive = useSyncExternalStore(
    subscribeInspectorActive,
    getInspectorActive,
    getInspectorActive,
  )
  const playRootRef = useRef<HTMLDivElement | null>(null)
  const [playRootEl, setPlayRootEl] = useState<HTMLElement | null>(null)
  const bindPlayRoot = (el: HTMLDivElement | null) => {
    playRootRef.current = el
    setPlayRootEl(el)
    if (el) claimPlayerFocus(el)
    else releasePlayerFocus(playRootEl)
  }

  // 共享场景 store（蓝图/实体/变量/规则/场景/试玩 并行视图共用同一份 graph+meta+持久化）。
  const graph = useGraphScenario((s) => s.graph)
  const game = useGraphScenario((s) => s.game)
  const isDraft = useGraphScenario((s) => s.isDraft)
  const fitSignal = useGraphScenario((s) => s.fitSignal)
  const loadEpoch = useGraphScenario((s) => s.loadEpoch)
  const runKey = useGraphScenario((s) => s.runKey)
  const setGraph = useGraphScenario((s) => s.setGraph)
  const setMeta = useGraphScenario((s) => s.setMeta)
  const createEntityAttribute = useCallback((request: EntityAttributeCreateRequest) => {
    setMeta((current) => {
      const entities = ensureEntityAttribute(current.entities, request)
      return entities && entities !== current.entities ? { ...current, entities } : current
    })
  }, [setMeta])
  const createEntity = useCallback((request: EntityCreateRequest) => {
    setMeta((current) => {
      const entities = ensureEntity(current.entities, request)
      return entities !== current.entities ? { ...current, entities } : current
    })
  }, [setMeta])
  const createVariable = useCallback((request: VariableCreateRequest) => {
    setMeta((current) => {
      const variables = ensureVariable(current.variables, request)
      return variables !== current.variables ? { ...current, variables } : current
    })
  }, [setMeta])
  const createFormula = useCallback((request: FormulaCreateRequest) => {
    setMeta((current) => {
      const currentFormulas = current.formulas as Record<string, Formula> | undefined
      const formulas = ensureFormula(currentFormulas, request, {
        entities: current.entities,
        variables: current.variables,
      })
      return formulas !== currentFormulas ? { ...current, formulas } : current
    })
  }, [setMeta])
  // 节点配置「引用蓝图」下拉：由 blueprints 派生为 SubFlowPackDef 列表（不落盘 packs）；
  // 含 main（子蓝图可引用主蓝图），自引用/成环由 isRefAllowed 过滤。
  const blueprints = useGraphScenario((s) => s.blueprints)
  const mainBlueprintId = useGraphScenario((s) => s.mainBlueprintId)
  const activeBlueprintId = useGraphScenario((s) => s.activeBlueprintId)
  const selectBlueprint = useGraphScenario((s) => s.selectBlueprint)
  const importBlueprint = useGraphScenario((s) => s.importBlueprint)
  const packs = useMemo(
    () => Object.values(blueprints).map(docToPack),
    [blueprints],
  )
  /** 某蓝图 id 能否被当前活跃蓝图引用：排除自引用 + 会成环的候选。传给 NodeInspector 的
   * 「子蓝图包」下拉，堵上画布「添加引用」按钮之外唯一还没成环校验的挂包路径。 */
  const isRefAllowed = useCallback(
    (packId: string) =>
      packId !== activeBlueprintId
      && !wouldCreateCycle(useGraphScenario.getState().authoringProject(), activeBlueprintId, packId),
    [activeBlueprintId],
  )
  const overlays = useGraphScenario((s) => s.meta.ui?.overlays)
  const entities = useGraphScenario((s) => s.meta.entities)
  const variables = useGraphScenario((s) => s.meta.variables)
  // meta.formulas 在 schema 里存为 `Record<string, unknown>`（runtime ↛ editor）；编辑器侧窄化回 Formula。
  const formulas = useGraphScenario((s) => s.meta.formulas) as Record<string, Formula> | undefined
  // 保存 = 打版本：一次性存 blueprint + 组件（服务端钩子）+ git tag vN。
  const doCommit = useGraphScenario((s) => s.commit)
  const reset = useGraphScenario((s) => s.reset)
  const bumpRun = useGraphScenario((s) => s.bumpRun)

  // 选中节点走共享 store（视频/界面等其它视图据此编辑同一节点）。
  const selected = useGraphScenario((s) => s.selectedNodeId)
  const setSelected = useGraphScenario((s) => s.setSelectedNode)
  const videoGenerationOpen = useVideoGenerationPanel((s) => s.open)
  const setVideoGenerationTarget = useVideoGenerationPanel((s) => s.setNodeTarget)
  const closeVideoGeneration = useVideoGenerationPanel((s) => s.close)
  // 宿主用 onNodeSelect 驱动它自己的面板切换（如 Agent ↔ 节点编辑），所以只能上报
  // 真实的「选中态迁移」。`undefined` = 还没报过；挂载时若本来就没选中节点，那不是
  // 一次清空，不能上报 null —— 否则用户手动切到「节点编辑」空态就会被踢回 Agent。
  const notifyHostNodeSelect = useCallback((nodeId: string | null) => {
    if (!onNodeSelect) return
    try {
      onNodeSelect(nodeId)
    } catch (err) {
      console.error('[game-video] onNodeSelect failed', err)
    }
  }, [onNodeSelect])
  const notifiedNodeRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (!onNodeSelect) return
    const previous = notifiedNodeRef.current
    if (previous === selected) return
    notifiedNodeRef.current = selected
    if (previous === undefined && selected == null) return
    notifyHostNodeSelect(selected)
  }, [selected, onNodeSelect, notifyHostNodeSelect])
  // 一级页签：Agent（预留空态）｜{节点名}调试面板。纯 UI 展示态，不进蓝图协议与持久化。
  const [nodePanelTab, setNodePanelTab] = useState<NodePanelTab>('config')
  // 节点配置面板：预览台选中的挂载覆盖物 id（联动右侧表单聚焦该卡片）；换节点自动清空。
  const [focusedMountId, setFocusedMountId] = useState<string | null>(null)
  // 节点配置面板：时间轴上选中的生命周期效果（子集序号，见 isLifecycleReaction 注释）。
  const [focusedLifecycleIndex, setFocusedLifecycleIndex] = useState<number | null>(null)
  // 时间轴按当前 px/ms 比例算出的结算插入时刻；未选择、切节点或预览卸载时为 null。
  const [settlementInsertTimeMs, setSettlementInsertTimeMs] = useState<number | null>(null)
  // 独立于选中值：重复点击同一个时间轴条目也要再次把右侧锚点滚进可视区。
  const [focusAnchorRevision, setFocusAnchorRevision] = useState(0)
  useEffect(() => {
    setFocusedMountId(null)
    setFocusedLifecycleIndex(null)
    setSettlementInsertTimeMs(null)
  }, [selected])
  // 面板里同一时刻只该有一个聚焦对象：选覆盖物就松开效果，反之亦然。
  // 右侧表单只更新选中态；只有左侧预览 / 时间轴发起的联动才递增滚动定位版本。
  const selectMount = useCallback((id: string | null) => {
    setFocusedMountId(id)
    if (id != null) setFocusedLifecycleIndex(null)
  }, [])
  const selectLifecycle = useCallback((index: number | null) => {
    setFocusedLifecycleIndex(index)
    if (index != null) setFocusedMountId(null)
  }, [])
  const focusMountFromPreview = useCallback((id: string | null) => {
    selectMount(id)
    if (id != null) setFocusAnchorRevision((revision) => revision + 1)
  }, [selectMount])
  const focusLifecycleFromPreview = useCallback((index: number | null) => {
    selectLifecycle(index)
    if (index != null) setFocusAnchorRevision((revision) => revision + 1)
  }, [selectLifecycle])
  const clearPreviewFocusFromPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (focusedMountId == null && focusedLifecycleIndex == null) return
    const target = event.target instanceof Element ? event.target : null
    const mountAnchor = target?.closest('[data-focus-anchor]')
    if (focusedMountId != null && mountAnchor?.getAttribute('data-focus-anchor') === `mount:${focusedMountId}`) return
    const settlementAnchor = target?.closest('[data-settlement-index]')
    if (focusedLifecycleIndex != null && settlementAnchor?.getAttribute('data-settlement-index') === String(focusedLifecycleIndex)) return
    // 条件结算的显示界面进入预览画布后仍属于当前结算；画布自己负责切换到挂载或清空焦点。
    if (focusedLifecycleIndex != null && target?.closest('[aria-label="节点视频覆盖物画布"]')) return
    if (target?.closest('.gc-mclip.is-selected, .gc-point-mark.is-selected, .gc-condition-band.is-selected')) return
    setFocusedMountId(null)
    setFocusedLifecycleIndex(null)
  }, [focusedLifecycleIndex, focusedMountId])
  // 已有节点间切换沿用上次状态并跨会话记忆；只有新建节点时强制收起（见 addPerfNode）。
  const [previewOpen, setPreviewOpen] = useState(
    () => typeof window !== 'undefined' && window.localStorage.getItem(PREVIEW_OPEN_KEY) === '1',
  )
  // 节点预览共享同一静音偏好；只属于当前编辑器会话，不写入蓝图协议或本地持久化。
  const [isNodePreviewMuted, setIsNodePreviewMuted] = useState(true)
  const setPreviewOpenPersisted = useCallback((open: boolean) => {
    setPreviewOpen(open)
    if (typeof window !== 'undefined') window.localStorage.setItem(PREVIEW_OPEN_KEY, open ? '1' : '0')
  }, [])
  const togglePreview = useCallback(() => {
    setPreviewOpen((open) => {
      const next = !open
      if (typeof window !== 'undefined') window.localStorage.setItem(PREVIEW_OPEN_KEY, next ? '1' : '0')
      return next
    })
  }, [])
  // 试玩浮层可拖动：默认贴画布右上，拖过一次后改用 left/top 记住位置。
  // 调试时经常要把它挪开看底下的蓝图树，所以位置只存在会话里，不落盘。
  const playOverlayRef = useRef<HTMLDivElement | null>(null)
  const playDragRef = useRef<{ dx: number, dy: number } | null>(null)
  /**
   * 位置只存 ref + 直接写 DOM，完全不进 state：GraphStudio 每重渲染一次，
   * ReactFlow 就要把所有节点重新度量一遍（期间 visibility:hidden），整张图会闪一下。
   * 拖拽是高频操作，走 state 等于每帧闪一次。
   */
  const playPosRef = useRef<{ x: number, y: number } | null>(null)
  const writePlayPos = useCallback((pos: { x: number, y: number }) => {
    const overlay = playOverlayRef.current
    if (!overlay) return
    overlay.style.left = `${pos.x}px`
    overlay.style.top = `${pos.y}px`
    overlay.style.right = 'auto'
  }, [])
  /** 夹在画布可视区内：拖出去就再也抓不回来了。 */
  const clampPlayPos = useCallback((x: number, y: number): { x: number, y: number } => {
    const host = canvasHostRef.current
    const overlay = playOverlayRef.current
    if (!host || !overlay) return { x, y }
    const maxX = Math.max(0, host.clientWidth - overlay.offsetWidth)
    const maxY = Math.max(0, host.clientHeight - overlay.offsetHeight)
    return {
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY),
    }
  }, [])
  const beginPlayDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    // 标题栏上的暂停/倍速/重开/关闭仍要能点，不能被拖拽吞掉。
    if ((event.target as HTMLElement).closest('button, select, input')) return
    const host = canvasHostRef.current
    const overlay = playOverlayRef.current
    if (!host || !overlay) return
    const hostRect = host.getBoundingClientRect()
    const rect = overlay.getBoundingClientRect()
    playDragRef.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top }
    // 首次拖拽把右上角锚点换算成 left/top，之后跟手不跳。
    const start = clampPlayPos(rect.left - hostRect.left, rect.top - hostRect.top)
    playPosRef.current = start
    writePlayPos(start)
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }, [clampPlayPos, writePlayPos])
  const movePlayDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = playDragRef.current
    const host = canvasHostRef.current
    if (!drag || !host) return
    const hostRect = host.getBoundingClientRect()
    const next = clampPlayPos(
      event.clientX - hostRect.left - drag.dx,
      event.clientY - hostRect.top - drag.dy,
    )
    playPosRef.current = next
    writePlayPos(next)
  }, [clampPlayPos, writePlayPos])
  const endPlayDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    playDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])
  /**
   * 尺寸与位置同理：只存 ref + 直接写 DOM。缩放改的是浮层宽 + 演出区高，
   * 标题栏保持自身高度，所以视觉上就是「演出画面变大变小」。
   */
  const playSizeRef = useRef<{ w: number, h: number }>({ w: PLAY_OVERLAY_W, h: PLAY_STAGE_H })
  const playResizeRef = useRef<{ sx: number, sy: number, sw: number, sh: number } | null>(null)
  const writePlaySize = useCallback((size: { w: number, h: number }) => {
    const overlay = playOverlayRef.current
    if (overlay) overlay.style.width = `${size.w}px`
    const stage = playRootRef.current
    if (stage) stage.style.height = `${size.h}px`
  }, [])
  /**
   * 下限恒生效；上限只在画布量出尺寸后才卡——刚挂载/容器还没布局时 clientWidth 是 0，
   * 拿它当上限会把浮层压到下限。
   */
  const clampPlaySize = useCallback((w: number, h: number): { w: number, h: number } => {
    const host = canvasHostRef.current
    const maxW = host && host.clientWidth > 0 ? host.clientWidth : Number.POSITIVE_INFINITY
    const maxH = host && host.clientHeight > 0 ? host.clientHeight : Number.POSITIVE_INFINITY
    return {
      w: Math.min(Math.max(PLAY_OVERLAY_MIN_W, w), maxW),
      h: Math.min(Math.max(PLAY_STAGE_MIN_H, h), maxH),
    }
  }, [])
  const beginPlayResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const { w, h } = playSizeRef.current
    playResizeRef.current = { sx: event.clientX, sy: event.clientY, sw: w, sh: h }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
    // 把手在标题栏之外，但仍要防止手势冒到画布上变成平移。
    event.stopPropagation()
  }, [])
  const movePlayResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = playResizeRef.current
    if (!resize) return
    const next = clampPlaySize(
      resize.sw + (event.clientX - resize.sx),
      resize.sh + (event.clientY - resize.sy),
    )
    playSizeRef.current = next
    writePlaySize(next)
  }, [clampPlaySize, writePlaySize])
  const endPlayResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    playResizeRef.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])
  // 位置/尺寸不在 state 里，重渲染会把 style 打回默认右上角锚点与默认尺寸——每次提交后补写回去。
  // 用 layout effect 在绘制前落笔，看不到中间态。
  useLayoutEffect(() => {
    if (playPosRef.current) writePlayPos(playPosRef.current)
    writePlaySize(playSizeRef.current)
  })
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [panelW, setPanelW] = useState(0)
  const canvasHostRef = useRef<HTMLDivElement | null>(null)
  const [playOpen, setPlayOpen] = useState(false)
  const togglePreviewSurface = useCallback(() => {
    if (videoGenerationOpen) {
      closeVideoGeneration()
      setPreviewOpenPersisted(false)
      return
    }
    if (playOpen) {
      setPlayOpen(false)
      setPreviewOpenPersisted(true)
      return
    }
    togglePreview()
  }, [closeVideoGeneration, playOpen, setPreviewOpenPersisted, togglePreview, videoGenerationOpen])
  const [videoAudioEnabled, setVideoAudioEnabled] = useState(true)
  /** 「从此试玩」钉住的入口；浮层「重开」始终回到此节点（可随后沿边/事件前进）。 */
  const [playFrom, setPlayFrom] = useState<PlayAnchor | null>(null)
  // 读 ref 而不是进依赖：节点菜单的「从此试玩」可以在没有选中节点时钉住锚点，
  // playFrom 一进依赖，这次钉住自己就会触发下面的收起。
  const playFromRef = useRef(playFrom)
  playFromRef.current = playFrom
  /**
   * 节点试玩浮层属于节点配置面板，取消选中就跟着收起。
   * 「试玩当前蓝图」没有钉住节点，它是整张图的一局，点空白处不该把它收掉。
   */
  useEffect(() => {
    if (selected == null && playFromRef.current) setPlayOpen(false)
  }, [selected])
  /** 每次 start / 从此试玩 递增，强制 <video> remount——末节点同 id 再 jump 时否则 key 不变、播完不重开。 */
  const [playEpoch, setPlayEpoch] = useState(0)
  /**
   * 只随 session 重建递增，用来重挂 `BgmPlayer`。新会话的 `bgm` 快照从 `null` 起，而「还没发过
   * 指令」不是停播令（见 SessionSnapshot.bgm）——不重挂就会把上一局的曲子拖进新局。
   * 刻意**不**复用 `playEpoch`：那个还会在画布 jump 时递增，跟着重挂会让床轨每次点节点都从头起播。
   */
  const [bgmRunKey, setBgmRunKey] = useState(0)
  const [videoOptions, setVideoOptions] = useState<VideoOption[]>([])
  const [videoOptionsError, setVideoOptionsError] = useState<string | null>(null)
  const { catalog: assetCatalog, error: assetCatalogError } = useAssetCatalog(game)
  const audioOptions = useMemo(
    () => catalogEntityOptions(assetCatalog, 'audio').map(({ id, label }) => ({ id, label })),
    [assetCatalog],
  )
  useEffect(() => {
    setVideoOptions(videoOptionsFromCatalog(assetCatalog))
    setVideoOptionsError(assetCatalogError)
  }, [assetCatalog, assetCatalogError])

  // NodeInspector「新建并挂载子蓝图」：`onPacksChange` 契约是"给出完整下一份列表"（历史遗留，
  // 实际全部调用点只会追加恰好一个新建的包）；蓝图库改版后 packs 由 blueprints 派生，这里按 id
  // 差集把新增项各自落成一个子蓝图文档，已存在的 id 不重复导入。
  const setPacks = useCallback((next: SubFlowPackDef[]) => {
    const cur = useGraphScenario.getState().blueprints
    for (const p of next) if (!cur[p.id]) importBlueprint(packToDoc(p))
  }, [importBlueprint])

  // 子流程下钻：每一段是当前层直属 subProcess 容器 id。
  const [drillStack, setDrillStack] = useState<string[]>([])
  const [layoutEpoch, setLayoutEpoch] = useState(0)

  useEffect(() => {
    if (!selected) {
      if (videoGenerationOpen) setVideoGenerationTarget(null)
      return
    }
    setVideoGenerationTarget({
      gameId: game,
      blueprintId: activeBlueprintId,
      nodeId: selected,
      ...(drillStack.length ? { graphPath: [...drillStack] } : {}),
    })
  }, [activeBlueprintId, drillStack, game, selected, setVideoGenerationTarget, videoGenerationOpen])

  const canvasGraph = useMemo(() => resolveGraphAtPath(graph, drillStack) ?? graph, [graph, drillStack])
  const canvasEntryId = useMemo(
    () => resolveGraphEntryAtPath(graph, blueprints[activeBlueprintId]?.entry, drillStack),
    [graph, blueprints, activeBlueprintId, drillStack],
  )
  const setCanvasGraph = useCallback(
    (update: GameGraph | ((current: GameGraph) => GameGraph)) => {
      setGraph((root) => {
        const current = resolveGraphAtPath(root, drillStack)
        if (!current) return root
        const next = typeof update === 'function' ? update(current) : update
        const entry = resolveGraphEntryAtPath(root, blueprints[activeBlueprintId]?.entry, drillStack)
        if (entry && current.nodes.some((node) => node.id === entry) && next.nodes.length === 0) {
          alert('入口是当前图唯一的业务节点，不能删除。')
          return root
        }
        return updateGraphAtPath(root, drillStack, next)
      })
    },
    [setGraph, drillStack, blueprints, activeBlueprintId],
  )
  const applyCanvasLayout = useCallback(() => {
    setCanvasGraph((current) => {
      const positions = computeGraphLayout(current)
      return {
        ...current,
        nodes: current.nodes.map((node) => ({ ...node, position: positions[node.id] ?? node.position })),
      }
    })
    setLayoutEpoch((value) => value + 1)
  }, [setCanvasGraph])

  useEffect(() => {
    setDrillStack([])
  }, [activeBlueprintId, loadEpoch])

  // 撤销删除祖先容器后，路径必须回到仍然存在的最长前缀。
  useEffect(() => {
    setDrillStack((path) => {
      const valid = validGraphPath(graph, path)
      return valid.length === path.length ? path : valid
    })
  }, [graph])

  // ── 节点配置面板 · 左侧预览台（NodePreviewStage）──────────────────────────
  const selectedNode = useMemo(
    () => canvasGraph.nodes.find((n) => n.id === selected) ?? null,
    [canvasGraph, selected],
  )
  const setCanvasGraphWithCatalogVideo = useCallback((next: GameGraph | ((current: GameGraph) => GameGraph)) => {
    if (!selected) {
      setCanvasGraph(next)
      return
    }
    const resolvedNext = typeof next === 'function' ? next(canvasGraph) : next
    const currentNode = canvasGraph.nodes.find((node) => node.id === selected)
    const nextNode = resolvedNext.nodes.find((node) => node.id === selected)
    const isVideoMedia = (media: NodeMedia | undefined): boolean =>
      media?.kind === 'video' || media?.kind === 'VIDEO'
    const currentRef = isVideoMedia(currentNode?.data.media) ? currentNode?.data.media?.ref : undefined
    const nextRef = isVideoMedia(nextNode?.data.media) ? nextNode?.data.media?.ref : undefined
    const selectedAsset = nextRef ? assetCatalog.assets[nextRef] : undefined
    if (!nextRef || nextRef === currentRef || selectedAsset?.kind !== 'video') {
      setCanvasGraph(resolvedNext)
      return
    }
    const scenario = useGraphScenario.getState()
    if (scenario.isDraft) {
      setVideoOptionsError('请先保存蓝图，再切换节点视频')
      return
    }
    const target = {
      kind: 'node-video' as const,
      blueprintId: activeBlueprintId,
      nodeId: selected,
      ...(drillStack.length ? { graphPath: [...drillStack] } : {}),
    }
    void assetCatalogClient.apply({
      operationId: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `node-video-select-${Date.now()}`,
      assetId: nextRef,
      tabKind: 'video',
      mode: 'blueprint',
      target,
    }).then(async () => {
      const result = await useGraphScenario.getState().syncTipIfClean()
      if (result !== 'applied' && result !== 'unchanged') throw new Error('蓝图未能同步到已选择视频，请重试')
      setVideoOptionsError(null)
    }).catch((error: unknown) => {
      setVideoOptionsError(error instanceof Error ? error.message : String(error))
    })
  }, [activeBlueprintId, assetCatalog.assets, canvasGraph.nodes, drillStack, selected, setCanvasGraph])
  const selectedCanConfigurePerformance = !!selectedNode
    && !getSubProcess(selectedNode.data)
    && !getSubFlowPack(selectedNode.data)
  /**
   * 拉片是否悬在画布右内缘。它 z-index 高于画布浮层，右上角的试玩浮层得据此让位，
   * 否则被压掉右边一条（浮层自身仍要能开，所以不是把拉片藏掉）。
   */
  const canvasEdgePillVisible = externalPreview
    && selectedCanConfigurePerformance
    && inspectorActive
  /** 一级页签文案（Figma 14947:80051 的「节点名称1调试面板」），内嵌与宿主插槽共用。 */
  const nodeConfigLabel = selectedNode
    ? formatUi('nodePanel.config', { name: selectedNode.data.name || selectedNode.id })
    : translateUi('nodePanel.emptyConfig')
  // 宿主的插槽页签是通用的，蓝图得自己报名字——否则只能拿到 handleNodeSelect 的兜底
  // 文案「节点编辑」。改节点名时也要跟着变，所以依赖 label 本身而不是选中 id。
  // 挂载时本来就没选中，不上报：那不是一次「取消选中」，别去动宿主页签。
  const reportedTabRef = useRef(false)
  useEffect(() => {
    if (!onInspectorTabChange) return
    if (!selected && !reportedTabRef.current) return
    reportedTabRef.current = true
    try {
      onInspectorTabChange({ label: nodeConfigLabel, selected: !!selected })
    } catch (err) {
      console.error('[game-video] onInspectorTabChange failed', err)
    }
  }, [nodeConfigLabel, selected, onInspectorTabChange])
  // 试玩浮层与节点预览互斥显示，但不改 previewOpen：关闭试玩后恢复用户原有预览状态。
  // 宿主切到 Agent 页签时同理：节点面板不可见，抽屉与拉片一起收起，切回来再恢复。
  const effectivePreviewOpen = previewOpen
    && !playOpen
    && selectedCanConfigurePerformance
    && inspectorActive
  // 关闭时让预览内容保留到抽屉动画结束再卸载；只控制视觉生命周期，不改变预览业务状态。
  const [previewDrawerMounted, setPreviewDrawerMounted] = useState(effectivePreviewOpen)
  useEffect(() => {
    if (effectivePreviewOpen) {
      setPreviewDrawerMounted(true)
      return
    }
    const reducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const timer = window.setTimeout(
      () => setPreviewDrawerMounted(false),
      reducedMotion ? 0 : PREVIEW_DRAWER_MOTION_MS,
    )
    return () => window.clearTimeout(timer)
  }, [effectivePreviewOpen])
  useEffect(() => {
    if (!effectivePreviewOpen) setSettlementInsertTimeMs(null)
  }, [effectivePreviewOpen])
  // 宿主预览列是画布的兄弟列，开合会把画布挤窄/放宽，选中节点可能就此落到视口外。
  // 内嵌形态靠 panelRatio 变化顺带重定位，外置形态 ratio 恒为 0，得显式发信号。
  // 抽屉一开始动就发：画布跟着它逐帧重定位，两者一起滑，而不是末尾跳一下。
  // 抽屉开合会改画布宽度，拖到右侧的试玩浮层可能因此半个身子在视口外。
  // 等动画结束夹一次；相等就返回原对象，免得 setState 自己把自己叫醒。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const current = playPosRef.current
      if (!current) return
      const next = clampPlayPos(current.x, current.y)
      if (next.x === current.x && next.y === current.y) return
      playPosRef.current = next
      writePlayPos(next)
    }, PREVIEW_DRAWER_MOTION_MS)
    return () => window.clearTimeout(timer)
  }, [effectivePreviewOpen, clampPlayPos, writePlayPos])
  const [previewRevealSignal, setPreviewRevealSignal] = useState(0)
  // 挂载那一次不算「抽屉开合」，跳过：否则一进画布就先被平移一下。
  const previewOpenSettledRef = useRef(false)
  useEffect(() => {
    if (!externalPreview) return
    if (!previewOpenSettledRef.current) {
      previewOpenSettledRef.current = true
      return
    }
    setPreviewRevealSignal((value) => value + 1)
  }, [effectivePreviewOpen, externalPreview])
  // 宿主拥有 previewEl 时由它控列宽，所以展开态必须回报出去；拉片本身仍归本组件。
  useEffect(() => {
    if (!onPreviewOpenChange) return
    try {
      onPreviewOpenChange(effectivePreviewOpen)
    } catch (err) {
      console.error('[game-video] onPreviewOpenChange failed', err)
    }
  }, [effectivePreviewOpen, onPreviewOpenChange])
  // 离开蓝图（切到界面/规则等视图）时把插槽交还给宿主：预览列否则带着上次的展开
  // 宽度留在那挤窄别的视图，页签否则变成点进去空白的死页签。
  // 用 ref 拿回调，避免依赖变化时误触发释放。
  const releaseHostSlotsRef = useRef({ onPreviewOpenChange, onInspectorTabChange })
  useEffect(() => {
    releaseHostSlotsRef.current = { onPreviewOpenChange, onInspectorTabChange }
  }, [onPreviewOpenChange, onInspectorTabChange])
  useEffect(() => () => {
    const { onPreviewOpenChange: reportPreview, onInspectorTabChange: reportTab } = releaseHostSlotsRef.current
    try {
      reportPreview?.(false)
      reportTab?.({ label: '', selected: false })
    } catch (err) {
      console.error('[game-video] host slot release failed', err)
    }
  }, [])
  /** 预览台读投影场景：canvasGraph（下钻时为包内图）+ 目录 overlays + 实体/变量（meta 缺省回落 demo）。 */
  const previewScenario = useMemo<GameScenario>(
    () => ({
      version: 'game-video.graph.v1',
      graph: canvasGraph,
      ui: { overlays: overlays ?? scenario.ui?.overlays ?? {} },
      entities: entities ?? scenario.entities,
      variables: variables ?? scenario.variables,
    }),
    [canvasGraph, overlays, entities, variables, scenario],
  )
  /**
   * 预览台写回通道：authoringScenario 的 graph 是主蓝图，换成当前选中蓝图图（st.graph）再交给
   * 编辑函数；setScenario 把 graph 写回 activeBlueprintId、meta 字段浅合并。
   */
  const editPreviewScenario = useCallback(
    (fn: (s: GameScenario, n: GameNode) => GameScenario) => {
      const st = useGraphScenario.getState()
      const s: GameScenario = { ...st.authoringScenario(), graph: canvasGraph }
      const n = s.graph.nodes.find((x) => x.id === selected)
      if (!n) return
      const next = fn(s, n)
      setCanvasGraph(next.graph)
      st.setMeta(metaFromDocument(next))
    },
    [canvasGraph, selected, setCanvasGraph],
  )
  // 面板实际宽度跟随测量（clamp 宽度 + 窗口缩放都会变），用于夹住预览区上限。
  // 外置模式下面板不压画布、panelRatio 恒为 0，这两个测量只会在抽屉动画的每一帧
  // 触发 setState → 整棵画布逐帧重渲染（节点看起来在闪），所以直接不订阅。
  useEffect(() => {
    if (externalInspector) return
    const el = panelRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setPanelW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [selected, externalInspector])
  // 画布容器宽度跟随测量，用于算 panelRatio（选中节点平移可见区偏移用）。
  useEffect(() => {
    if (externalInspector) return
    const el = canvasHostRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setCanvasW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [externalInspector])
  /** 面板宽度 ÷ 画布容器宽度（0~1），传给 GraphCanvas 让选中节点平移到左侧可见区中心。 */
  const [canvasW, setCanvasW] = useState(0)
  const panelRatio = externalInspector
    ? 0
    : canvasW > 0 ? Math.min(0.8, panelW / canvasW) : 0

  const addPerfNode = (position: { x: number; y: number }) => {
    const id = `n-${Date.now().toString(36)}`
    const node: GameNode = {
      id,
      type: 'perf',
      position,
      inputs: [],
      outputs: [],
      data: { name: '新演出节点' },
    }
    setCanvasGraph((g) => addNode(g, node))
    // 新节点还没有预览内容，首次配置时只展示表单；后续手动展开会重新成为全局偏好。
    setPreviewOpenPersisted(false)
    setSelected(id)
  }

  // 规则的运行时字段变化后重建 session：新试玩读取最新模板，不把新值热灌进旧运行态。
  const runtimeRulesSig = useGraphScenario((s) => runtimeRuleSignature(
    s.meta.entities ?? s.demo?.entities,
    s.meta.variables ?? s.demo?.variables,
  ))
  /**
   * 试玩 session 以**当前选中蓝图**为根（`playScn`），不是永远主蓝图——子蓝图可独立跑，
   * 「从此试玩」才能 jump 到该图节点。`playNonce`：从此试玩/钉住重开时强制吃最新图。
   */
  const [playNonce, setPlayNonce] = useState(0)
  const [playPaused, setPlayPaused] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const pendingJumpRef = useRef<PlayAnchor | null>(null)
  const session = useMemo(
    () => {
      const st = useGraphScenario.getState()
      return new GraphSession(st.playScn(), {
        rootBlueprintId: st.activeBlueprintId,
        rngSeed: createSessionSeed(),
      })
    },
    // runKey：工具条整局重开；activeBlueprintId：切库；playNonce：从此试玩吃最新图
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runKey, runtimeRulesSig, activeBlueprintId, playNonce],
  )
  const sessionRef = useRef(session)
  sessionRef.current = session
  const [snap, setSnap] = useState<SessionSnapshot>(() => session.start())
  const playRootGraph = blueprints[snap.activeBlueprintId]?.graph
  const executingGraph = playRootGraph
    ? (resolveGraphAtPath(playRootGraph, snap.activeGraphPath) ?? playRootGraph)
    : canvasGraph
  const playGraph = playOpen ? executingGraph : canvasGraph
  // 试玩落进被引用的子蓝图时，画布改为只读执行视图；同图试玩仍保持原本的编辑/下钻体验。
  const showingForeignPlayGraph = playOpen && (
    snap.activeBlueprintId !== activeBlueprintId
    || snap.activeGraphPath.join('/') !== drillStack.join('/')
  )
  // 进/出子蓝图时把视口挪到当前播放节点；同图推进不抢手动平移。未试玩时仍用编辑选中 reveal。
  const playRevealNodeId = useRevealOnScopeChange(
    playOpen ? `${snap.activeBlueprintId}:${snap.activeGraphPath.join('/')}` : null,
    playOpen ? snap.currentNodeId : null,
  )
  // clipSeq 区分每次实际开演；playEpoch 继续覆盖 jump / session 重建。
  const endPerformance = useClipPerformanceEnd(sessionRef, setSnap, snap.clipSeq, `${runKey}:${playEpoch}`)

  // 切到另一张蓝图：关掉浮层、清掉节点钉住。下一张图要自己再点「试玩」——
  // 否则旧局还挂着，session 根已经换成新图，看起来像「自动接着播」。
  useEffect(() => {
    setPlayFrom(null)
    setPlayOpen(false)
  }, [activeBlueprintId])

  useEffect(() => {
    const pending = pendingJumpRef.current
    pendingJumpRef.current = null
    const latestRoot = pending ? useGraphScenario.getState().blueprints[pending.blueprintId]?.graph : undefined
    const targetGraph = latestRoot && pending
      ? (resolveGraphAtPath(latestRoot, pending.graphPath) ?? latestRoot)
      : undefined
    setSnap(pending ? sessionRef.current.jump(pending.nodeId, {
      resetGlobals: true,
      blueprintId: pending.blueprintId,
      graph: targetGraph,
      graphPath: pending.graphPath,
    }) : sessionRef.current.start())
    setPlayEpoch((n) => n + 1)
    setBgmRunKey((n) => n + 1)
  }, [session])

  const videoSrc = resolveCatalogMediaSrc(snap.clip?.mediaId, assetCatalog, game)
  const preloadVideos = useMemo(
    () => session.preloadClips().map((candidate) => ({
      videoSrc: resolveCatalogMediaSrc(candidate.mediaId, assetCatalog, game),
      clip: candidate,
      videoKey: `${candidate.nodeId}-${playEpoch}`,
    })),
    [session, snap.currentNodeId, game, playEpoch, assetCatalog],
  )
  /** 床轨解析器（引擎只抛音频实体 id，URL 归壳层）；稳定引用，避免每帧让 BgmPlayer 重跑 effect。 */
  const resolveBgm = useCallback(
    (id: string | undefined) => resolveCatalogMediaSrc(id, assetCatalog, game),
    [assetCatalog, game],
  )

  useControlledPlaybackTimeout(
    endPerformance,
    snap.clip?.durationMs,
    { paused: playPaused, rate: playbackRate },
    snap.phase === 'ended' || !!snap.clip?.mediaId,
    `${runKey}:${playEpoch}:${snap.clipSeq}`,
  )

  /** 从此试玩：钉住入口 + 打开浮层 + 以当前蓝图最新图重建 session 再 seek。 */
  const jump = useCallback((nodeId: string) => {
    setPlayPaused(false)
    const anchor = { nodeId, blueprintId: activeBlueprintId, graphPath: [...drillStack] }
    setPlayFrom(anchor)
    setPlayOpen(true)
    pendingJumpRef.current = anchor
    setPlayNonce((n) => n + 1)
  }, [activeBlueprintId, drillStack])
  /**
   * 试玩当前蓝图：松开节点钉住 + 打开浮层 + 重建 session，从本蓝图 `entry` 开跑。
   * session 的根已经是 `activeBlueprintId`，所以这里只要不带 jump 锚点，`start()` 自己会落到入口。
   */
  const playCurrentBlueprint = useCallback(() => {
    setPlayPaused(false)
    setPlayFrom(null)
    pendingJumpRef.current = null
    setPlayOpen(true)
    setPlayNonce((n) => n + 1)
  }, [])
  /** 浮层重开：回到钉住的入口节点；无钉住时回退整局 bumpRun。 */
  const restartPlayFrom = useCallback(() => {
    setPlayPaused(false)
    if (!playFrom) {
      bumpRun()
      return
    }
    pendingJumpRef.current = playFrom
    setPlayNonce((n) => n + 1)
  }, [playFrom, bumpRun])
  const traversed = useMemo(() => new Set(snap.traversedEdgeIds), [snap.traversedEdgeIds])

  const drillFitKey = useMemo(() => `root:${drillStack.join('/')}:${layoutEpoch}`, [drillStack, layoutEpoch])
  const drillLabels = useMemo(() => graphPathLabels(graph, drillStack), [graph, drillStack])

  /**
   * 节点菜单「生成本节点视频」：把该节点记为生成目标并切到视频生成页，由它按
   * NodeProductionContext 预填章节概览、视频 prompt 和角色参考图。子流程下钻中的
   * 节点不给入口——生成目标按主蓝图 NodeRef 定位。
   */
  const handleGenerateVideo = useCallback(
    (nodeId: string) => {
      openNodeVideoGeneration({ gameId: game, blueprintId: activeBlueprintId, nodeId })
    },
    [activeBlueprintId, game],
  )

  /** 节点菜单「引用到聊天」：把当前节点引用插入 Studio 侧边 Chat 输入区。 */
  const handleReference = useCallback(
    (nodeId: string) => {
      const node = canvasGraph.nodes.find((n) => n.id === nodeId)
      if (!node || !forgeaxHost.available) return
      forgeaxHost.composer.insertReference(
        buildNodeContextReference({
          gameId: game,
          blueprintId: activeBlueprintId,
          blueprintTitle: blueprints[activeBlueprintId]?.title,
          graphPath: drillLabels,
          graph: canvasGraph,
          node,
          scenario: previewScenario,
        }),
      )
    },
    [canvasGraph, game, activeBlueprintId, blueprints, drillLabels, previewScenario],
  )

  // 下钻导航和「重开」锚点属于正在编辑的蓝图；试玩状态行才解析执行图节点。
  const playNameOf = (id: string) => playGraph.nodes.find((n) => n.id === id)?.data.name ?? id
  /** 双击容器：跨蓝图引用（`subFlowPack`）→ 平级切库选中项（selectBlueprint），不是嵌套下钻；
   * 私有内嵌子流程（`subProcess`）沿当前图路径下钻。 */
  const onDrill = (id: string) => {
    const n = canvasGraph.nodes.find((x) => x.id === id)
    if (!n) return
    const pack = getSubFlowPack(n.data)
    if (pack) {
      selectBlueprint(pack.id)
      return
    }
    if (getSubProcess(n.data)) {
      setSelected(null)
      setDrillStack((s) => [...s, id])
    }
  }

  const leaveToRoot = () => {
    setDrillStack([])
    setSelected(null)
  }
  /** 画布面包屑 = 该蓝图在侧栏里的位置（蓝图根 → …文件夹 → 蓝图）+ 蓝图内的下钻层。 */
  const crumbs: { id: string; label: string; onClick?: () => void }[] = [
    ...blueprintSidebarPath(blueprints, activeBlueprintId).map((crumb) => ({
      id: crumb.id,
      label: crumb.label,
      // 侧栏文件夹层在画布里无落点；只有「蓝图本体」这层可点（退出下钻回到该蓝图根图）。
      onClick: crumb.id === activeBlueprintId ? leaveToRoot : undefined,
    })),
    ...drillLabels.map((item, i) => ({
      id: item.id,
      label: item.name,
      onClick: () => setDrillStack(drillStack.slice(0, i + 1)),
    })),
  ]
  return (
    <div
      onPointerDownCapture={clearPreviewFocusFromPointer}
      style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#0e0c09', color: '#f6f1e9', isolation: 'isolate' }}
    >
      {/* 顶部工具条：历史版本 → 保存 → 重置 → 草稿提示；产品侧栏已接管导航，先隐藏不删。 */}
      <div className="gv-graph-toolbar" style={{ padding: 8, display: 'none', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <VersionPicker />
        <button type="button" onClick={() => void doCommit()} title={translateUi('ui.copy.969fe32704ff')}>{translateUi('ui.copy.ec9aa4b72673')}</button>
        <button
          type="button"
          style={{ display: 'none' }}
          onClick={() => { if (confirm('重置为内置 demo 数据？当前未保存的编辑将丢失。')) reset() }}
          title={translateUi('ui.copy.b4f06adfb3f8')}
        >
          {translateUi('ui.copy.2a5b22d041a6')}</button>
        {isDraft ? (
          <span
            style={{ opacity: 0.85, fontSize: 12, color: '#ffc53d' }}
            title={translateUi('ui.copy.d1d7db12a381')}
          >
            {translateUi('ui.copy.4c13956c7150')}</span>
        ) : null}
      </div>

      {videoOptionsError ? (
        <div role="alert" style={{ flex: 'none', padding: '6px 10px', color: '#ff8f8f', fontSize: 11 }}>
          {translateUi('ui.copy.96b8be23b47c')}{videoOptionsError}
        </div>
      ) : null}

      {/* 主体：画布命中区必须裁在本层内（WebKit 上 RF transform 层会把 hit-test 渗到工具条） */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative', zIndex: 0, overflow: 'hidden', isolation: 'isolate' }}>
      {/* 左：可编辑画布 + 运行时高亮（点节点=选中编辑；双击子流程容器下钻） */}
      <div ref={canvasHostRef} className="gv-canvas-host" style={{ flex: 1, minWidth: 0, borderRight: '1px solid #2e2924', position: 'relative', overflow: 'hidden', contain: 'paint' }}>
        {/* 画布顶部 bar（58px，#2C2C2C）常驻。左侧面包屑；
  右侧三按钮由 GraphCanvas 的 .gv-canvas-chrome 用 CSS 定位到本 bar 右侧对齐。 */}
        <div
  style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: CANVAS_TOP_BAR_H, zIndex: 5,
            display: 'flex', gap: 8, alignItems: 'center', padding: '0 10px',
     background: '#2C2C2C',
   fontSize: 14, pointerEvents: 'none',
          }}
        >
          {/* 面包屑本体需要可点击；bar 整体 pointerEvents:none 让空白区不挡画布，交互元素单独开启。
       Figma 18683_77409：层间用向右 chevron（白 60%）分隔，最后一层用品牌橙 #FF9C2A。 */}
          <span style={{ display: 'flex', gap: 2, alignItems: 'center', pointerEvents: 'auto' }}>
            {crumbs.map((crumb, i) => {
              const color = i === crumbs.length - 1 ? '#FF9C2A' : '#FFFFFF'
              return (
                <span key={crumb.id} style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                  {i > 0 ? (
                    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flex: 'none' }}>
                      <path d="M6.1665 12.3333L10.1665 8.33325L6.1665 4.33325" stroke="white" strokeOpacity={0.6} strokeWidth={1.06667} strokeLinecap="square" />
                    </svg>
                  ) : null}
                  {crumb.onClick ? (
                    <button
                      onClick={crumb.onClick}
                      style={{ background: 'none', border: 'none', color, cursor: 'pointer', padding: 0, fontSize: 14, fontWeight: 400 }}
                    >
                      {crumb.label}
                    </button>
                  ) : (
                    <span style={{ color }}>{crumb.label}</span>
                  )}
                </span>
              )
            })}
          </span>
        </div>
        {/* 宿主接管预览列后拉片挂在画布右内缘：收起态画布右缘就是聊天栏左缘，
            展开态预览列入流把画布顶窄、右缘正好变成预览左缘——两种状态都自动对位，
            且拉片纯悬浮，不占布局宽度。 */}
        {canvasEdgePillVisible ? (
          <PreviewTogglePill
            open={effectivePreviewOpen || videoGenerationOpen}
            onToggle={togglePreviewSurface}
            anchor="canvas-edge"
          />
        ) : null}
        <RenderErrorBoundary
          region="graph-canvas"
          variant="panel"
          resetKeys={[activeBlueprintId, drillStack.join('/')]}
          context={{ blueprintId: activeBlueprintId }}
        >
          <GraphCanvas
          // 切蓝图 remount：清掉画布本地 selectedIds（store 已清 selectedNodeId，本地不跟会残留旧 id）。
          // 节点剪贴板在 GraphCanvas 模块级，不跟 remount 走，故主↔子蓝图可粘贴。
          key={`${activeBlueprintId}:${drillStack.join('/')}`}
          graph={playGraph}
          onChange={setCanvasGraph}
          entryNodeId={showingForeignPlayGraph ? undefined : canvasEntryId}
          overlays={overlays}
          videoOptions={videoOptions}
          entities={entities}
          variables={variables}
          // 试玩游标与编辑选中共用橙色描边；未开浮层时勿把 session 当前节点画成「选中」——
          // 新建子蓝图后 session.start() 停在「入口」，否则入口会像永远选不掉。
          activeNodeId={playOpen ? snap.currentNodeId : null}
          traversedEdgeIds={playOpen ? traversed : undefined}
          readOnly={showingForeignPlayGraph}
          // 配置面板打开时禁用 Delete/Backspace，避免作者改表单时误删当前节点；关闭后恢复。
          keyboardDeleteEnabled={!selected}
          fitSignal={fitSignal + layoutEpoch}
          drillFitKey={drillFitKey}
          // 试玩浮层宽 320 + 边距（拉片在时浮层整体左移，预留也跟着让）；
          // 传稳定 number，避免每帧新 object 触发反复 fitView。
          fitReserveRightPx={playOpen ? (canvasEdgePillVisible ? 340 + PREVIEW_TOGGLE_PILL_W : 340) : 0}
          // 内嵌形态选中就自动居中（面板会盖住画布右半边）；宿主外置形态下面板在聊天栏、
          // 选中不改画布尺寸，再平移整张图只会让人失去方位感，所以只留试玩跳转。
          revealNodeId={externalPreview ? playRevealNodeId ?? null : playRevealNodeId ?? selected}
          revealFollowNodeId={playRevealNodeId ?? selected}
          revealPanelRatio={panelRatio}
          revealSignal={previewRevealSignal}
          onJump={(nodeId) => {
            if (!showingForeignPlayGraph) {
              const alreadySelected = useGraphScenario.getState().selectedNodeId === nodeId
              setSelected(nodeId)
              if (alreadySelected) notifyHostNodeSelect(nodeId)
              return
            }
            setSnap(sessionRef.current.jump(nodeId, {
              blueprintId: snap.activeBlueprintId,
              graph: playGraph,
              graphPath: snap.activeGraphPath,
            }))
            setPlayEpoch((n) => n + 1)
          }}
          onDrill={showingForeignPlayGraph ? undefined : onDrill}
          onPaneClick={() => setSelected(null)}
          onAddNode={showingForeignPlayGraph ? undefined : addPerfNode}
          onFitLayout={showingForeignPlayGraph ? undefined : applyCanvasLayout}
          onPlayBlueprint={
            showingForeignPlayGraph || activeBlueprintId === mainBlueprintId
              ? undefined
              : playCurrentBlueprint
          }
          onPlay={showingForeignPlayGraph ? undefined : jump}
          onReference={showingForeignPlayGraph ? undefined : handleReference}
            onGenerateVideo={showingForeignPlayGraph || drillStack.length > 0 ? undefined : handleGenerateVideo}
          />
        </RenderErrorBoundary>

        {/* 试玩浮层：画布右上角（原独立试玩面板搬来） */}
        {/* 试玩浮层落在顶栏下方、并给拉片让开一条：否则会压住
            「新建节点 / 定位当前节点 / 自适应」和预览开关拉片。 */}
        {playOpen && (
          <div
            ref={playOverlayRef}
            data-testid="play-overlay"
            style={{
              position: 'absolute',
              zIndex: 6,
              width: PLAY_OVERLAY_W,
              borderRadius: 10,
              overflow: 'hidden',
              border: '1px solid #403830',
              background: 'rgba(27,23,19,0.94)',
              boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
              // 默认锚点；拖过之后由 layout effect 覆写成 left/top。
              top: CANVAS_TOP_BAR_H + 8,
              right: canvasEdgePillVisible ? PREVIEW_TOGGLE_PILL_W + 8 : 8,
            }}
          >
            {/* 标题栏兼作拖拽把手：调试时能把浮层挪开去看底下的蓝图树。
                按钮/下拉排除在外，否则拖拽会吃掉它们的点击。 */}
            <div
              data-testid="play-overlay-handle"
              onPointerDown={beginPlayDrag}
              onPointerMove={movePlayDrag}
              onPointerUp={endPlayDrag}
              onPointerCancel={endPlayDrag}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', background: '#252019', borderBottom: '1px solid #2e2924', fontSize: 11, color: '#c9d1e0', gap: 8, cursor: 'move', touchAction: 'none', userSelect: 'none' }}
            >
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={snap.currentNodeId ? `${snap.phase} · ${playNameOf(snap.currentNodeId)}` : snap.phase}>
                {formatUi('play.status', { phase: snap.phase })}
                {snap.currentNodeId ? ` · ${snap.clip?.name || playNameOf(snap.currentNodeId)}` : ''}
              </span>
              <span style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button
                  onClick={() => setPlayPaused((value) => !value)}
                  title={playPaused ? translateUi('ui.copy.4a25a87a775a') : translateUi('ui.copy.68229a924327')}
                  aria-label={playPaused ? translateUi('ui.copy.4a25a87a775a') : translateUi('ui.copy.68229a924327')}
                  style={{ background: 'none', border: 'none', color: playPaused ? '#f5bd75' : '#c9d1e0', cursor: 'pointer', padding: 0 }}
                >
                  {playPaused ? '▶' : 'Ⅱ'}
                </button>
                <select
                  aria-label={translateUi('ui.copy.7aabf295e7b5')}
                  value={playbackRate}
                  onChange={(event) => setPlaybackRate(Number(event.target.value))}
                  style={{ border: '1px solid #403830', borderRadius: 4, background: '#1b1713', color: '#c9d1e0', fontSize: 10, padding: '1px 2px' }}
                >
                  {[0.5, 1, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}{translateUi('ui.copy.11f6ad8ec52a')}</option>)}
                </select>
                <VideoAudioToggle
                  compact
                  enabled={videoAudioEnabled}
                  onToggle={() => setVideoAudioEnabled((enabled) => !enabled)}
                />
                <button onClick={restartPlayFrom} title={playFrom ? `${translateUi('ui.template.ec2f49119622')}${playFrom.nodeId}` : translateUi('ui.copy.6a77bc83ab3b')} style={{ background: 'none', border: 'none', color: '#f08840', cursor: 'pointer', padding: 0 }}>{translateUi('ui.copy.71f28662c722')}</button>
                <button onClick={() => setPlayOpen(false)} title={translateUi('ui.copy.bb0e7e01aa8d')} style={{ background: 'none', border: 'none', color: '#9aa2b1', cursor: 'pointer', padding: 0 }}>✕</button>
              </span>
            </div>
            <PlaybackClockProvider value={{ paused: playPaused, rate: playbackRate }}>
            <PlayerRootContext.Provider value={playRootEl}>
            <div
              ref={bindPlayRoot}
              data-testid="play-overlay-stage"
              tabIndex={0}
              onPointerDown={() => claimPlayerFocus(playRootRef.current)}
              onFocus={() => claimPlayerFocus(playRootRef.current)}
              style={{ position: 'relative', height: PLAY_STAGE_H, background: '#000', outline: 'none' }}
            >
              {/* 床轨：独立音频通道，与视频共用试玩声音开关。挂在浮层里 → 关掉试玩即随卸载停播；
                  key 随 session 重建换 → 重开不把上一局的曲子拖进新局（同 GraphPlaySurface）。 */}
              <BgmPlayer key={bgmRunKey} bgm={snap.bgm} resolveAsset={resolveBgm} paused={playPaused} playbackRate={playbackRate} active={snap.phase !== 'ended'} muted={!videoAudioEnabled} />

              {/* 演出 + 叠层：clipSeq 区分同名/重入节点，playEpoch 区分 jump 和 session 重建。 */}
              <GameStage
                videoSrc={videoSrc}
                videoKey={`${snap.clipSeq}-${playEpoch}`}
                overlayKey={`${snap.clipSeq}-${playEpoch}`}
                clip={snap.clip}
                preloadVideos={preloadVideos}
                overlayMounts={snap.overlayMounts}
                skins={createCoreSkinRegistry()}
                skinCtx={{
                  hud: snap.hud,
                  condition: { state: session.runtime.state, visited: session.runtime.state.visited },
                }}
                onEmit={(elementId, key) => { if (!playPaused) setSnap(sessionRef.current.emitEvent(elementId, key)) }}
                onTick={(nowMs) => setSnap(sessionRef.current.tick(nowMs))}
                onPerformanceEnd={endPerformance}
                paused={playPaused}
                playbackRate={playbackRate}
                videoAudioEnabled={videoAudioEnabled}
              />
            </div>
            </PlayerRootContext.Provider>
            </PlaybackClockProvider>
            {/* 右下角缩放把手（同 GraphPlaySurface 的浮层）：拖它改浮层宽 + 演出区高。 */}
            <div
              data-testid="play-overlay-resize"
              title={translateUi('ui.copy.b8e25986d9d8')}
              onPointerDown={beginPlayResize}
              onPointerMove={movePlayResize}
              onPointerUp={endPlayResize}
              onPointerCancel={endPlayResize}
              style={{
                position: 'absolute',
                right: 2,
                bottom: 2,
                width: 16,
                height: 16,
                cursor: 'nwse-resize',
                borderRight: '2px solid #f08840',
                borderBottom: '2px solid #f08840',
                borderRadius: '0 0 5px 0',
                touchAction: 'none',
              }}
            />
          </div>
        )}
      </div>

      {/* 右：节点配置面板 —— 默认隐藏，点画布节点才出现；✕ 或点画布空白处关闭。
          左预览（NodePreviewStage：视频+覆盖物+时间轴，可编辑）｜右表单（NodeInspector 原样）。
          宿主传入 inspectorEl 时改为 portal 到外部 slot，画布内不再嵌面板。 */}
      {(() => {
        // 拉片与预览台在「面板内两列」和「宿主双 slot」两种形态下是同一份内容，
        // 只有外层容器不同，抽出来避免两处各写一遍。
        const previewToggle = selectedCanConfigurePerformance ? (
          <PreviewTogglePill open={effectivePreviewOpen || videoGenerationOpen} onToggle={togglePreviewSurface} />
        ) : null
        const previewStage = selectedNode && selectedCanConfigurePerformance && previewDrawerMounted ? (
          <RenderErrorBoundary
            region="node-preview"
            variant="panel"
            resetKeys={[selectedNode.id]}
            context={{ nodeId: selectedNode.id, blueprintId: activeBlueprintId }}
          >
            <NodePreviewStage
              scenario={previewScenario}
              node={selectedNode}
              game={game}
              muted={isNodePreviewMuted}
              focusedMountId={focusedMountId}
              focusedLifecycleIndex={focusedLifecycleIndex}
              onEditScenario={editPreviewScenario}
              onMutedChange={setIsNodePreviewMuted}
              onSelectedTimeChange={(_ms, selection) => setSettlementInsertTimeMs(selection.settlementInsertMs)}
              onFocusMount={focusMountFromPreview}
              onFocusLifecycle={focusLifecycleFromPreview}
            />
          </RenderErrorBoundary>
        ) : null

        const nodePanel = selected ? (
          <div
            ref={panelRef}
            className="gv-node-panel"
            data-testid="node-inspector-root"
            data-preview-open={effectivePreviewOpen}
            data-external-preview={externalPreview ? 'true' : undefined}
            style={{
              // 宽度 = 配置列 + 预览列，两者由 .gv-node-panel 的 CSS 变量给出：
              // 满宽时是 Figma 14597:20310 的 711 + 500 = 1211，窄屏两列同比缩小。
              // 宿主接管预览后本板只剩配置列，宽度整个交给宿主容器（可拖拽）。
              maxWidth: externalInspector ? '100%' : '90%',
              width: externalInspector ? '100%' : undefined,
              height: externalInspector ? '100%' : undefined,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              // 给预览区拉片定位：它骑在面板左缘（向左探出 34px 压在画布上），面板自身不裁剪。
              position: 'relative',
            }}
          >
            {/* 预览区开关拉片：始终贴面板左缘——收起态即配置列左缘，展开态面板左扩后
                自然落在预览区左缘（Figma 14597:20310）；展开时图标与描边高亮（14597:20069）。
                宿主接管预览列时拉片跟着预览走，不再留在配置表单这一侧。 */}
            {externalPreview ? null : previewToggle}
            {/* 展开态固定 711:500（Figma 14597:20310 预览区:配置列），窄屏同比缩放。 */}
            <div
              data-testid="node-panel-columns"
              data-preview-open={effectivePreviewOpen}
              className="gv-node-panel-columns"
              style={{
                flex: 1,
                minHeight: 0,
                display: selectedCanConfigurePerformance && !externalPreview ? 'grid' : 'flex',
                gridTemplateColumns: selectedCanConfigurePerformance && !externalPreview
                  ? externalInspector
                    ? 'minmax(0, var(--gv-preview-w)) minmax(0, 1fr)'
                    : 'minmax(0, var(--gv-preview-w)) minmax(0, var(--gv-form-w))'
                  : undefined,
                overflowX: 'hidden',
              }}
            >
              {!externalPreview && previewStage ? (
                <div
                  data-testid="node-preview-column"
                  className="gv-node-preview-column"
                  style={{
                    // 本层只负责从右向左扩大裁切窗口；内部内容从第一帧起就是最终宽度。
                    gridColumn: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    data-testid="node-preview-content"
                    style={{
                      position: 'absolute',
                      top: 0,
                      right: 0,
                      bottom: 0,
                      width: 'var(--gv-preview-target-w)',
                      display: 'flex',
                      flexDirection: 'column',
                      // Figma 14597:20633：左侧预览是独立区域，底色与右列页签栏同色。
                      background: '#2C2C2C',
                    }}
                  >
                    {previewStage}
                  </div>
                </div>
              ) : null}
              {/* 右列：一级页签栏是本列头部（预览展开时不再横跨整板），下方配置内容独立滚动。
                  固定占第 2 栏——预览列在收起动画结束后会卸载，不锁死列号它会掉进宽度为 0 的第 1 栏。
                  长下拉文案会把表单撑到 ~880px，中等宽度也出现不必要的横向滚动。 */}
              <div
                data-testid="node-inspector-column"
                style={externalPreview
                  // 宿主容器（vag-chat-panel）可拖拽，表单必须跟着它缩放，
                  // 不能被 FORM_W_MIN 顶出横向滚动。
                  ? { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
                  : { gridColumn: 2, flex: `1 0 ${FORM_W_MIN}px`, minWidth: FORM_W_MIN, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
              >
                {/* 一级页签栏（Figma 14597:21458）：Agent（预留空态）｜{节点名}调试面板，✕ 关闭右置。
                    宿主传入 inspectorEl 时由宿主 chrome 托管 Agent｜节点编辑，这里不再重复。 */}
                {externalInspector ? null : (
                  <NodePanelTabBar
                    activeTab={nodePanelTab}
                    configLabel={nodeConfigLabel}
                    onTabChange={setNodePanelTab}
                    onClose={() => setSelected(null)}
                  />
                )}
                {/* Agent 页签内容区：暂留空，仅占位撑满本列。外置模式下不渲染。 */}
                {!externalInspector && nodePanelTab === 'agent' ? (
                  <div data-testid="node-panel-agent" style={{ flex: 1, minHeight: 0 }} />
                ) : null}
                {/* 配置页签内容：切到 Agent 时仅 display:none 隐藏、保持挂载，组件本地状态不丢。
                    外置模式始终展示配置（宿主 tab 已分流 Agent）。 */}
                <div data-testid="node-config-tab-content" style={{ display: (externalInspector || nodePanelTab === 'config') ? 'contents' : 'none' }}>
                  <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                    <RenderErrorBoundary
                      region="node-inspector"
                      variant="panel"
                      resetKeys={[selected]}
                      context={{ nodeId: selected, blueprintId: activeBlueprintId }}
                    >
                      <NodeInspector
                        graph={canvasGraph}
                        nodeId={selected}
                        videoOptions={videoOptions}
                        audioOptions={audioOptions}
                        packs={packs}
                        isRefAllowed={isRefAllowed}
                        overlays={overlays}
                        entities={entities}
                        variables={variables}
                        formulas={formulas}
                        focusedMountId={focusedMountId}
                        focusedLifecycleIndex={focusedLifecycleIndex}
                        settlementInsertMs={effectivePreviewOpen ? settlementInsertTimeMs ?? undefined : undefined}
                        focusAnchorRevision={focusAnchorRevision}
                        onFocusMount={selectMount}
                        onFocusLifecycle={selectLifecycle}
                        onChange={setCanvasGraphWithCatalogVideo}
                        onPacksChange={setPacks}
                        onDropOverlayIfOrphan={(oid) => {
                          // 卸载已同步写入 store；用完整库文档（根 graph + manifest.packs）判孤儿后只改共享 meta。
                          const st = useGraphScenario.getState()
                          const scn = st.authoringScenario()
                          const cleaned = dropOverlayIfUnreferenced(scn, oid)
                          if (cleaned !== scn) st.setMeta(metaFromDocument(cleaned))
                        }}
                        onRemoveMount={(mountId) => {
                          editPreviewScenario((s, n) => removeMountGraph(s, n, mountId))
                        }}
                        onCreateEntityAttribute={createEntityAttribute}
                        onCreateEntity={createEntity}
                        onCreateVariable={createVariable}
                        onCreateFormula={createFormula}
                        onJump={jump}
                      />
                    </RenderErrorBoundary>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null

        if (externalInspector && inspectorEl) {
          // 宿主自己管页签时（onInspectorTabChange），取消选中会把页签整个撤掉，
          // 空态就没有入口了——此时不再往插槽塞内容，避免留下点不到的死 DOM。
          const inspectorEmpty = onInspectorTabChange ? null : (
            <div
              data-testid="node-inspector-empty"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                minHeight: 120,
                padding: 24,
                color: 'rgba(246,241,233,0.55)',
                fontSize: 13,
                textAlign: 'center',
                background: '#1b1713',
              }}
            >
              {translateUi('ui.copy.e9e8a2bfb264')}</div>
          )
          const inspectorPortal = createPortal(
            selected ? nodePanel : inspectorEmpty,
            inspectorEl,
          )
          if (!externalPreview || !previewEl) return inspectorPortal
          // 预览 slot 归宿主定位：它是配置表单的左兄弟，宽度由宿主按 onPreviewOpenChange 控。
          // 拉片不在这里——它悬浮在画布右内缘，见上面的 canvas-edge 分支。
          return (
            <>
              {inspectorPortal}
              {createPortal(
                previewStage ? (
                  <div
                    data-testid="node-preview-column"
                    className="gv-node-preview-column"
                    style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
                  >
                    <div
                      data-testid="node-preview-content"
                      style={{
                        position: 'absolute',
                        top: 0,
                        right: 0,
                        bottom: 0,
                        // 收合动画期间内容保持目标宽度，只有裁切窗口在动——宽度值由宿主写在 slot 上。
                        width: 'var(--gv-preview-external-w, 100%)',
                        display: 'flex',
                        flexDirection: 'column',
                        // Figma 14597:20633：左侧预览是独立区域，底色与右列页签栏同色。
                        background: '#2C2C2C',
                      }}
                    >
                      {previewStage}
                    </div>
                  </div>
                ) : null,
                previewEl,
              )}
            </>
          )
        }
        return nodePanel
      })()}
      </div>
    </div>
  )
}
