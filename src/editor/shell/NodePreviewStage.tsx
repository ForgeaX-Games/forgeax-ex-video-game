import { t as translateUi } from '../../i18n'
/**
 * NodePreviewStage —— 蓝图节点配置面板左侧的「演出预览台」（编辑 + 预览二合一）。
 *
 * 复用编辑器预览台的底层件，数据全程走 graph，不引入任何
 * schema/协议新字段：
 *   - 视频舞台：`gc-frame` / `computeVideoContentRect` 锚定 object-fit:contain 实际画面；
 *   - 皮肤层：`previewSkinChildrenInWindow` + `renderOverlayChildPreview` + PreviewClock
 *     （暂停冻结 CSS 动画）；滤镜/特效走 `resolveVideoFxForNode` 旁路；
 *   - 叠层操作框：节点视频画布只允许移动整份 overlay，写回挂载 `layout.left/top`；
 *   - 时间轴：第 0 轨投影只读视频条，其后按挂载级投影（`collectMountItemsFromNode`：
 *     一份挂载 = 一条）；循环视频另有仅限视频轨高度的媒体局部指针，节点逻辑播放头保持单调。
 *     拖动挂载条整体平移挂载内子件、删除移除整份挂载，写回
 *     `patchMaterialGraph`（mount 分支 → shiftMountWindowGraph）/`deleteMaterialGraph`；
 *   - 「添加控件」条 = **覆盖物挂载入口**：前 5 个未挂载的预设覆盖物点击直接挂载，
 *     第 6 个「更多」展开完整列表（等价 NodeInspector 的「＋挂载」）。
 *
 * 选中联动：点预览叠层 / 时间轴挂载条 → 上抛 `onFocusMount(mountId)`，右侧 NodeInspector
 * 据此只聚焦展开该覆盖物的配置卡片（其余折叠）。
 *
 * 切视频/挂载/组件参数的联动**不在这里写**——右侧表单走既有
 * `patchData → onChange → store` 数据流，本组件只多一个订阅者，天然实时；也不自动回写
 * `durationMs`（只影响本地播放头与时间轴上限，对齐 `videoDurationCapReached` 契约）。
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { GameNode, GameScenario, Layout, OverlayInstanceChild } from '@/runtime/core/schema/graph-schema'
import type { SkinCtx } from '@/runtime/react/component-host/rendererRegistry'
import { bootEditorSkins } from '../init'
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import { createCoreSkinRegistry } from '@/runtime/react/component-host'
import { resolveVideoFxForNode } from '@/runtime/core/fx/video-fx'
import { CATALOG_CSS } from './catalogCss'
import { renderOverlayChildPreview } from './overlayChildPreview'
import { advancePreviewMediaClock, PreviewClockProvider, previewClockLayerClassName, type PreviewMediaClock } from './previewClock'
import { NodePreviewRuntimeProjector, projectNodePreviewState, projectSelectedSettlementSpawns } from './nodePreviewState'
import { resolveCatalogMediaSrc } from './media'
import { useAssetCatalog } from '@/editor/assets/asset-catalog'
import { videoDurationCapReached } from '@/runtime/react/play/videoTiming'
import { resolveMountLayoutForChildren } from '@/runtime/core/schema/layout'
import { MATERIAL_DND_MIME, MaterialTimeline } from '../video/MaterialTimeline'
import { settlementInsertMsBeforePlayhead, type MaterialItem } from '../video/materialTimelineShared'
import { collectNodeTimelineMarkers } from '../video/nodeTimelineMarkers'
import { useVideoContentRect } from '@/runtime/react/play/useVideoContentRect'
import { overlayDisplayLabel } from './schemeOverlays'
import { listSchemeAndBaseOverlayIds } from '@/authoring/demo/builtin-schemes'
import {
  overlayMountId,
} from '@/runtime/core/schema/node-config-schema'
import { expandNodeChildren, resolveMountChildren } from '@/runtime/core/schema/expand-overlay'
import {
  patchSettlementSpawnLayout,
  removeSettlementSpawn,
  setRoutingSettlementMs,
  setSettlementReactionMs,
  setSettlementSpawnTtlMs,
} from '@/authoring/graph/graph-edit'
import { SETTLEMENT_SPAWN_ID_PREFIX, collectSettlementSpawnGroups, settlementSpawnAddress } from '../video/settlementSpawnGroups'
import { overlayFitTargets } from './overlay-fit-targets'
import {
  OverlayCanvasInteraction,
  type CanvasBox,
  type CanvasInteractionItem,
} from './OverlayCanvasInteraction'
import {
  collectMountItemsFromNode,
  deleteMaterialGraph,
  mountOverlayGraph,
  patchMaterialGraph,
  patchOverlayMountLayoutGraph,
  childVisibleSpan,
  previewSkinChildrenInWindow,
  shiftMountWindowGraph,
} from '../video/graphMaterialOps'
import { FlowNodePreviewStage, type FlowNodePreviewState } from './FlowNodePreviewStage'
import {
  formatPreviewTime,
  PreviewPauseIcon,
  PreviewPlayIcon,
  PreviewRefreshIcon,
  PreviewVolumeIcon,
} from './nodePreviewControls'

export type { FlowNodePreviewState } from './FlowNodePreviewStage'

/**
 * `--gc-*` 变量在 CATALOG_CSS 里挂 `.gc-tab` 作用域；
 * 蓝图面板没有 gc-tab 祖先，这里自持一份同值变量，保证 gc-frame/gc-preview-* 类渲染一致。
 */
const NPS_CSS = `
.nps-shell { display: flex; flex: 1; min-height: 0; flex-direction: column; background: var(--work, #0e0c09); }
.nps-root {
  --gc-bg: var(--work, #0e0c09);
  --gc-panel: var(--panel, #1b1713);
  --gc-panel2: var(--panel2, #252019);
  --gc-panel3: var(--panel3, #2f2923);
  --gc-line: var(--line, #403830);
  --gc-line-soft: var(--line-soft, #2e2924);
  --gc-text: var(--txt, #f6f1e9);
  --gc-muted: var(--muted, #b8aea0);
  --gc-faint: var(--faint, #8c8377);
  --gc-accent: var(--accent, #f08840);
  --gc-accent-soft: var(--accent-soft, rgba(240,136,64,.16));
  --gc-accent-line: var(--accent-line, rgba(240,136,64,.42));
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px; min-height: 0; overflow-y: auto; flex: 1; background: #2C2C2C;
}
.nps-frame { flex: none; }
/* Figma 14935:70362：节点编辑与全流程预览共用浅灰半透圆角视频面。
   .nps-frame-edit 是这套视觉壳的历史类名，不表示可编辑能力；交互权限仍由各模式自身控制。 */
.nps-frame-edit {
  background: rgba(217,217,217,0.1);
  border: none;
  border-radius: 10px;
}
/* Figma 15635:84858：视频控制卡 = 帧下方独立卡片（#292625 + 白 6% 描边，圆角 4），
   左：暂停/重播/音量（图标 15px，间距 12）；右：时长。不再使用帧内渐变 HUD。 */
.nps-video-controls {
  display: flex; align-items: center; justify-content: space-between; flex: none;
  background: #292625; border: 1px solid rgba(255,255,255,0.06); border-radius: 4px;
  padding: 4.5px 10px;
}
.nps-video-controls-left { display: flex; align-items: center; gap: 12px; height: 15px; }
.nps-video-controls-right { display: flex; align-items: center; gap: 8px; }
.nps-video-controls button {
  flex: none; width: 15px; height: 15px; padding: 0; border: none; border-radius: 0;
  background: none; color: #fff; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
}
.nps-video-controls button:hover { background: none; }
.nps-hud-btn-dim { opacity: .4; }
.nps-hud-time {
  font-size: 12px; font-weight: 500; color: rgba(255,255,255,0.8);
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.nps-hud-time > span { color: rgba(255,255,255,0.4); }
.nps-video-controls .nps-timeline-toggle { color: rgba(255,255,255,.6); }
.nps-video-controls .nps-timeline-toggle:hover { color: #fff; }
.nps-stage-empty {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 4px;
  color: rgba(246,241,233,.45); font-size: 11px; pointer-events: none; padding: 0 16px; text-align: center;
}
.nps-timeline-toggle-icon {
  position: relative; flex: none; width: 16px; height: 16px; display: block;
}
.nps-timeline-toggle-icon::before {
  content: ""; position: absolute; left: 50%; top: 50%; width: 7px; height: 7px;
  box-sizing: border-box; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor;
  transform: translate(-50%, -50%) rotate(45deg); transform-origin: center;
}
.nps-timeline-toggle-icon.is-collapse::before { transform: translate(-50%, -50%) rotate(225deg); }
.nps-fx-layer { position: absolute; inset: 0; pointer-events: none; overflow: hidden; border-radius: inherit; }
.nps-fx-layer > div { position: absolute; inset: 0; }
.nps-addbar { position: relative; display: flex; align-items: center; gap: 5px; flex-wrap: wrap; flex: none; }
.nps-addbar-label { font-size: 10px; letter-spacing: .08em; color: var(--gc-faint); margin-right: 2px; }
.nps-addbar button {
  display: inline-flex; align-items: center; gap: 4px;
  border: 1px solid var(--gc-line-soft); background: var(--gc-panel2); color: var(--gc-text);
  border-radius: 7px; padding: 3px 8px; font-size: 11px; cursor: pointer;
}
.nps-addbar button:hover:not(:disabled) { border-color: var(--gc-accent); background: var(--gc-accent-soft); }
.nps-addbar button:disabled { opacity: .38; cursor: default; }
.nps-addbar .nps-add-chip::before { content: "＋"; opacity: .7; }
.nps-addbar-empty { font-size: 10px; color: var(--gc-faint); opacity: .8; }
.nps-more-pop {
  position: absolute; top: calc(100% + 4px); right: 0; z-index: 40;
  min-width: 200px; max-width: 280px; max-height: 260px; overflow-y: auto;
  background: var(--gc-panel); border: 1px solid var(--gc-line); border-radius: 9px;
  box-shadow: 0 8px 24px rgba(0,0,0,.45); padding: 5px; display: flex; flex-direction: column; gap: 2px;
}
.nps-more-pop button { justify-content: flex-start; width: 100%; border-color: transparent; background: transparent; }
.nps-more-pop button:hover { background: var(--gc-accent-soft); border-color: var(--gc-accent-line); }
.nps-more-empty { font-size: 11px; color: var(--gc-faint); padding: 6px 8px; }
/* 时间轴宿主列：占满预览列剩余竖直空间（flex 链定界），轨道超出时滚动发生在时间轴视口内部，
   而不是顶高整列。mtl-root 沿链接力；视口自身地板高度由 --gc-timeline-h 保底。 */
.nps-root .nps-timeline-host { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.nps-root .nps-timeline-host > .mtl-root { flex: 1 1 auto; min-height: 0; }
`

const NODE_VIDEO_TRACK_KEY = '__node-video__'

const DEFAULT_MOUNT_W = 0.25
const DEFAULT_MOUNT_H = 0.15

function isFullStageMountLayout(layout: Layout | undefined): boolean {
  return (
    layout?.width === 1
    && layout.height === 1
    && layout.right == null
    && layout.bottom == null
    && layout.translateX == null
    && layout.translateY == null
  )
}

/**
 * 代表帧取窗口的 40% 处：自计时组件此时已过入场、尚未开始淡出，是最成形的一帧。
 * 这个比例沿用飘字原有取值，别改成 50%——那会让所有飘字的预览定帧整体后移。
 */
const FOCUSED_PREVIEW_FRAME_RATIO = 0.4

/**
 * 选中某个界面时用哪一刻定帧。
 *
 * 播放头在该子件可见窗内就用播放头本身；不在窗内则取窗口中段——自计时组件（飘字、转场、QTE）
 * 的第 0 帧通常是「还没出现」，直接按播放头定帧会让作者看到一个空白框，没法摆位。
 * 只在暂停且该挂载被选中时用，播放中一律跟随播放头（见调用点的 `isVideoPlaying` 判断）。
 */
function focusedPreviewTimeMs(child: OverlayInstanceChild, playheadMs: number, maxMs: number): number {
  const span = childVisibleSpan(child, maxMs)
  if (!span) return playheadMs
  if (playheadMs > span.start && playheadMs < span.end) return playheadMs
  const localMs = (span.end - span.start) * FOCUSED_PREVIEW_FRAME_RATIO
  return span.start + Math.round(localMs * 1000) / 1000
}

export interface NodePreviewStageProps {
  /** 读投影场景：canvasGraph（主图或下钻包图）+ ui.overlays + entities/variables。 */
  scenario: GameScenario
  /** 当前选中节点（canvasGraph 内；随编辑实时换引用）。 */
  node: GameNode
  game: string
  /** GraphStudio 统一持有的节点预览静音状态，切换节点时保持。 */
  muted: boolean
  focusedMountId?: string | null
  focusedLifecycleIndex?: number | null
  onEditScenario: (fn: (s: GameScenario, n: GameNode) => GameScenario) => void
  onMutedChange: (muted: boolean) => void
  onSelectedTimeChange?: (ms: number, selection: NodePreviewTimeSelection) => void
  onFocusMount?: (mountId: string | null) => void
  onFocusLifecycle?: (lifecycleIndex: number | null) => void
  /** 通用组件只消费模式；切换模式的控件由宿主提供。默认 edit。 */
  mode?: 'edit' | 'preview'
  /** 时间轴展开/收起配置。默认隐藏切换按钮，时间轴初始展开。 */
  timelineDisclosure?: NodePreviewTimelineDisclosure
  flow?: FlowNodePreviewState
}

export interface NodePreviewTimeSelection {
  /** 按当前 px/ms 比例与播放头错开的建议结算时刻；优先在左侧，起点空间不足时放右侧。 */
  settlementInsertMs: number
}

export interface NodePreviewTimelineDisclosure {
  /** 是否在播放控制条展示展开/收起按钮。默认 false。 */
  showToggle?: boolean
  /** 受控展开状态；省略时使用组件内部状态。 */
  expanded?: boolean
  /** 非受控初始状态。默认 true。 */
  defaultExpanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  /** 根据当前展开状态替换按钮图标。 */
  renderToggleIcon?: (expanded: boolean) => ReactNode
}

export function NodePreviewStage(props: NodePreviewStageProps): JSX.Element {
  bootEditorSkins()
  injectStyleOnce('graph-catalog', CATALOG_CSS)
  injectStyleOnce('node-preview-stage', NPS_CSS)
  const mode = props.mode ?? 'edit'
  const timelineId = useId()
  const disclosure = props.timelineDisclosure
  const [uncontrolledTimelineExpanded, setUncontrolledTimelineExpanded] = useState(
    disclosure?.defaultExpanded ?? true,
  )
  const timelineExpanded = disclosure?.expanded ?? uncontrolledTimelineExpanded
  const showTimelineToggle = disclosure?.showToggle ?? false
  const toggleTimeline = (): void => {
    const next = !timelineExpanded
    setUncontrolledTimelineExpanded(next)
    disclosure?.onExpandedChange?.(next)
  }
  const timelineToggle = showTimelineToggle ? (
    <button
      type="button"
      className="nps-timeline-toggle"
      aria-label={timelineExpanded ? translateUi('ui.copy.3fdd286e5eb8') : translateUi('ui.copy.592c7831d340')}
      title={timelineExpanded ? translateUi('ui.copy.3fdd286e5eb8') : translateUi('ui.copy.592c7831d340')}
      aria-expanded={timelineExpanded}
      aria-controls={timelineId}
      onClick={toggleTimeline}
    >
      {disclosure?.renderToggleIcon?.(timelineExpanded) ?? (
        <span className={`nps-timeline-toggle-icon${timelineExpanded ? ' is-collapse' : ''}`} aria-hidden />
      )}
    </button>
  ) : null
  return (
    <div className="nps-shell">
      {mode === 'preview' && props.flow
        ? (
            <FlowNodePreviewStage
              flow={props.flow}
              timelineId={timelineId}
              timelineExpanded={timelineExpanded}
              timelineToggle={timelineToggle}
            />
          )
        : (
            <EditableNodePreviewStage
              {...props}
              timelineId={timelineId}
              timelineExpanded={timelineExpanded}
              timelineToggle={timelineToggle}
            />
          )}
    </div>
  )
}

interface EditableNodePreviewStageProps extends NodePreviewStageProps {
  timelineId: string
  timelineExpanded: boolean
  timelineToggle: ReactNode
}

function EditableNodePreviewStage({
  scenario,
  node,
  game,
  muted,
  focusedMountId,
  focusedLifecycleIndex,
  onEditScenario,
  onMutedChange,
  onSelectedTimeChange,
  onFocusMount,
  onFocusLifecycle,
  timelineId,
  timelineExpanded,
  timelineToggle,
}: EditableNodePreviewStageProps): JSX.Element {
  const { catalog: assetCatalog } = useAssetCatalog(game)
  const contentAnchorRef = useRef<HTMLDivElement | null>(null)
  const timelineHostRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const mediaClockRef = useRef<PreviewMediaClock | null>(null)
  const [playheadMs, setPlayheadMs] = useState(0)
  const [mediaPlayheadMs, setMediaPlayheadMs] = useState(0)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null)
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null)
  const [selectedSettlementSpawnId, setSelectedSettlementSpawnId] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const mountPreviewRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const settlementSpawnPreviewRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [mountContentBoxes, setMountContentBoxes] = useState<Record<string, { left: number; top: number; width: number; height: number }>>({})
  const [settlementSpawnContentBoxes, setSettlementSpawnContentBoxes] = useState<Record<string, { left: number; top: number; width: number; height: number }>>({})
  const mountBoxSigRef = useRef('')
  const settlementSpawnBoxSigRef = useRef('')

  const mediaRef = node.data.media?.ref ?? ''
  const playMode = node.data.mediaPlayMode ?? 'once'
  const previewSrc = resolveCatalogMediaSrc(mediaRef || undefined, assetCatalog, game)
  // 资产可在不改 media ref 的情况下换 URL（替换上传 / 目录刷新）。预览身份必须包含最终 src，
  // 否则 React 会复用旧 video DOM，继承上次的 currentTime。
  const previewIdentity = `${node.id}:${mediaRef}:${previewSrc ?? ''}`
  const { contentRect, recomputeRect } = useVideoContentRect(videoRef, [node.id, mediaRef, previewSrc])

  // 当前聚焦挂载（受控于右侧表单 / 本组件选中）。
  const selectedMountId = focusedMountId ?? null
  function focusMount(id: string | null): void {
    onFocusMount?.(id)
  }

  // 播放时长上限（cap）：对齐 videoDurationCapReached 契约——>0 且 ≤ 视频本身长度才生效。
  const capMs = (() => {
    const cap = node.data.durationMs
    if (!cap || cap <= 0) return undefined
    if (videoDurationMs != null && cap > videoDurationMs) return undefined
    return cap
  })()
  // 无 cap 时，总时长下限取已观测播放头：metadata 未就绪（videoDurationMs 仍为 null）真实时长未知，
  // 播放头（由 video.currentTime 驱动）是唯一可信下界——避免 HUD 出现 current > total。
  // cap 存在时仍以 cap 为准，不被播放头抬高。
  const maxMs = capMs != null
    ? Math.max(1000, capMs)
    : Math.max(1000, videoDurationMs ?? 0, playheadMs)

  const overlays = scenario.ui?.overlays
  // 视频固定占第 0 轨；挂载从第 1 轨开始，保持与全流程 preview 时间轴相同的层级心智。
  const mountMaterials = useMemo(
    () => collectMountItemsFromNode(scenario, node, maxMs),
    [scenario, node, maxMs],
  )
  const timelineMaterials = useMemo<MaterialItem[]>(() => {
    const shiftedMounts = mediaRef
      ? mountMaterials.map((material) => ({ ...material, zIndex: material.zIndex + 1 }))
      : mountMaterials
    if (!mediaRef) return shiftedMounts
    return [{
      key: NODE_VIDEO_TRACK_KEY,
      id: NODE_VIDEO_TRACK_KEY,
      kind: 'video',
      label: node.data.name?.trim() || mediaRef,
      startMs: 0,
      endMs: maxMs,
      zIndex: 0,
      locked: true,
    }, ...shiftedMounts]
  }, [maxMs, mediaRef, mountMaterials, node.data.name])
  const previewSkinChildren = useMemo(() => {
    const visible = previewSkinChildrenInWindow(scenario, node, playheadMs, maxMs)
    if (isVideoPlaying || !selectedMountId) return visible
    // 选中即强制可见：作者点了某个界面就是要摆它，不能因为播放头不在它的窗口内就让它消失
    // （改用这条替代原先「选中即把播放头拖到窗口中段」，播放头归作者掌握）。
    const visibleIds = new Set(visible.map((child) => child.id))
    const focused = expandNodeChildren(scenario, node).filter((child) => (
      child.source.mountId === selectedMountId && !visibleIds.has(child.id)
    ))
    return focused.length ? [...visible, ...focused] : visible
  }, [isVideoPlaying, maxMs, node, playheadMs, scenario, selectedMountId])
  const runtimeProjector = useMemo(
    () => new NodePreviewRuntimeProjector(scenario, node),
    [scenario, node],
  )
  const runtimeProjection = useMemo(() => {
    const spawns = runtimeProjector.project(playheadMs)
    return { spawns, configuredMountIds: new Set(runtimeProjector.visibleConfiguredMountIds()) }
  }, [playheadMs, runtimeProjector])
  const previewSpawns = runtimeProjection.spawns
  const runtimeVisibleMountIds = runtimeProjection.configuredMountIds
  const selectedSettlementSpawns = useMemo(
    () => projectSelectedSettlementSpawns(scenario, node, focusedLifecycleIndex),
    [focusedLifecycleIndex, node, scenario],
  )
  const activeSettlementSpawnId = selectedSettlementSpawns.some((preview) => preview.id === selectedSettlementSpawnId)
    ? selectedSettlementSpawnId
    : selectedSettlementSpawns[0]?.id ?? null
  // 选中条件结算时使用稳定作者投影，避免与播放头真实触发的动态实例重叠。
  const visibleRuntimeSpawns = selectedSettlementSpawns.length ? [] : previewSpawns
  const authorVisibleMountIds = useMemo(() => {
    const ids = new Set(runtimeVisibleMountIds)
    if (!isVideoPlaying && selectedMountId) ids.add(selectedMountId)
    return ids
  }, [isVideoPlaying, runtimeVisibleMountIds, selectedMountId])
  const previewMountGroups = useMemo(() => {
    const groups = new Map<string, {
      mount: NonNullable<GameNode['data']['overlayNodes']>[number]
      children: typeof previewSkinChildren
    }>()
    const mountsById = new Map(
      (node.data.overlayNodes ?? []).map((mount) => [overlayMountId(mount), mount] as const),
    )
    for (const child of previewSkinChildren) {
      const mountId = child.source.mountId
      if (!authorVisibleMountIds.has(mountId)) continue
      const mount = mountsById.get(mountId)
      if (!mount) continue
      const group = groups.get(mountId)
      if (group) group.children.push(child)
      else groups.set(mountId, { mount, children: [child] })
    }
    return [...groups.entries()].map(([mountId, value]) => ({
      mountId,
      ...value,
      layout: resolveMountLayoutForChildren(
        value.mount.layout,
        resolveMountChildren(overlays, value.mount).map((child) => child.layout),
      ) ?? {},
    }))
  }, [authorVisibleMountIds, overlays, previewSkinChildren, node])
  const videoFx = useMemo(
    () => resolveVideoFxForNode(node, overlays, playheadMs, maxMs),
    [node, overlays, playheadMs, maxMs],
  )
  // 与 bootComponents / Session 同源：共享默认皮肤表。
  const previewSkinReg = useMemo(() => createCoreSkinRegistry(), [])
  const previewSkinCtx = useMemo((): SkinCtx => {
    const st = projectNodePreviewState(scenario, node, playheadMs, maxMs)
    const toHudEnt = (
      attrs: Record<string, number>,
      attrMeta?: Record<string, { max?: number; initial?: number }>,
      name?: string,
    ) => {
      const attrMax: Record<string, number> = {}
      const initialAttrs: Record<string, number> = {}
      for (const [k, v] of Object.entries(attrs)) {
        attrMax[k] = attrMeta?.[k]?.max ?? v
        initialAttrs[k] = attrMeta?.[k]?.initial ?? attrMeta?.[k]?.max ?? v
      }
      return {
        name,
        hp: attrs.hp ?? 0,
        maxHp: attrMeta?.hp?.max ?? attrs.hp ?? 0,
        attrs: { ...attrs },
        attrMax,
        initialAttrs,
      }
    }
    const hudEntities: SkinCtx['hud']['entities'] = Object.fromEntries(
      Object.entries(st.entities).map(([id, e]) => [
        id,
        toHudEnt(e.attrs, e.attrMeta, scenario.entities?.[id]?.name?.trim() || id),
      ]),
    )
    // 与目录预览一致：缺实体时给常见战斗 id 兜底，避免血条 bind 后渲成 null。
    if (!hudEntities['ent-player']) hudEntities['ent-player'] = toHudEnt({ hp: 72 }, { hp: { max: 100 } }, 'ent-player')
    if (!hudEntities['ent-boss']) hudEntities['ent-boss'] = toHudEnt({ hp: 58 }, { hp: { max: 100 } }, 'ent-boss')
    return {
      hud: { entities: hudEntities, vars: { qi: 3, ...st.vars }, score: st.score, flags: st.flags },
      // 编辑器预览：用初始态做门控求值（无 visited）
      condition: { state: st, visited: new Set<string>() },
    }
  }, [scenario, node, playheadMs, maxMs])
  const previewClockValue = useMemo(() => ({ playing: isVideoPlaying, playheadMs }), [isVideoPlaying, playheadMs])

  // 「添加控件」= 覆盖物挂载入口：候选与界面 tab 同一份（自定义覆盖物 + 基础覆盖物，打平；
  // 见 builtin-schemes），已挂载的排除，前 5 直接列出，其余进「更多」。
  const mountedOverlayIds = useMemo(
    () => new Set((node.data.overlayNodes ?? []).map((m) => m.overlay)),
    [node.data.overlayNodes],
  )
  const mountCandidateIds = useMemo(
    () => listSchemeAndBaseOverlayIds(overlays).filter((id) => !mountedOverlayIds.has(id)),
    [overlays, mountedOverlayIds],
  )
  const primaryCandidateIds = mountCandidateIds.slice(0, 5)
  const moreCandidateIds = mountCandidateIds.slice(5)

  useEffect(() => {
    setSelectedOverlayId(selectedMountId)
    if (selectedMountId) setSelectedSettlementSpawnId(null)
  }, [selectedMountId])

  // 换节点、换视频或同 ref 刷新 URL：重置所有时钟，并显式把新元素拨回起点。
  // 不只依赖 key remount：浏览器可能在 URL 更新时复用媒体状态，且旧 rAF 会在边界帧读到新 ref。
  useLayoutEffect(() => {
    mediaClockRef.current = null
    setPlayheadMs(0)
    setMediaPlayheadMs(0)
    setIsVideoPlaying(false)
    setVideoDurationMs(null)
    setLoadError(false)
    setMoreOpen(false)
    setSelectedOverlayId(focusedMountId ?? null)
    const video = videoRef.current
    if (video) {
      try { video.currentTime = 0 } catch { /* metadata 未就绪时由新 video 从零开始加载 */ }
    }
  }, [previewIdentity])

  useEffect(() => {
    if (selectedMountId) pauseForScrub()
  }, [selectedMountId])

  // 播放期间 rAF 每帧推进播放头（平滑）；到 cap 提前收演出（once 语义，loop 不截断）。
  useEffect(() => {
    if (!isVideoPlaying) return
    let raf = 0
    const tick = (): void => {
      const el = videoRef.current
      if (el) {
        const nowMs = Math.round((el.currentTime || 0) * 1000)
        setMediaPlayheadMs(nowMs)
        if (playMode !== 'loop' && videoDurationCapReached(nowMs, node.data.durationMs, el.duration)) {
          try { el.pause() } catch { /* ignore */ }
          setIsVideoPlaying(false)
          setPlayheadMs(capMs ?? maxMs)
          return
        }
        const nextClock = advancePreviewMediaClock(mediaClockRef.current, nowMs, maxMs, playMode === 'loop')
        mediaClockRef.current = nextClock
        setPlayheadMs(nextClock.playheadMs)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isVideoPlaying, maxMs, capMs, playMode, node.data.durationMs])

  function seekTo(ms: number): void {
    const target = Math.max(0, Math.min(maxMs, Math.round(ms)))
    mediaClockRef.current = { mediaMs: target, playheadMs: target }
    const v = videoRef.current
    if (v) { try { v.currentTime = target / 1000 } catch { /* metadata 未就绪 */ } }
    setPlayheadMs(target)
    setMediaPlayheadMs(target)
    const timelineCanvas = timelineHostRef.current?.querySelector<HTMLElement>('.gc-mtimeline-canvas')
    const canvasPx = timelineCanvas?.getBoundingClientRect().width ?? 0
    onSelectedTimeChange?.(target, {
      settlementInsertMs: settlementInsertMsBeforePlayhead(target, maxMs, canvasPx),
    })
  }
  function pauseForScrub(): void {
    const v = videoRef.current
    if (v && !v.paused) { try { v.pause() } catch { /* ignore */ } }
    setIsVideoPlaying(false)
  }
  function togglePlay(): void {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      // 已播到末尾再点播放 = 从头重播。
      if (playMode !== 'loop' && playheadMs >= maxMs - 40) seekTo(0)
      void v.play().catch(() => { /* autoplay 限制 */ })
    } else {
      v.pause()
    }
  }
  function toggleMute(): void {
    if (!videoRef.current) return
    onMutedChange(!muted)
  }

  /** 从头重播（控制卡刷新钮）：播放头归零并起播；无视频时仅归零播放头。 */
  function replayFromStart(): void {
    seekTo(0)
    const v = videoRef.current
    if (v) void v.play().catch(() => { /* autoplay 限制 */ })
  }

  // ── 写回（全部走 graphMaterialOps 既有映射，无新协议字段） ─────────────────
  /** 时间轴挂载条整体平移（patchMaterialGraph 的 mount 分支）。 */
  function patchMaterial(item: MaterialItem, patch: { startMs?: number; endMs?: number; zIndex?: number; markerMs?: number }): void {
    if (item.locked || item.kind === 'video') return
    onEditScenario((s, n) => patchMaterialGraph(s, n, maxMs, item, patch))
  }
  /** 时间轴删除挂载条 = 移除整份挂载；挂载上有「添加」进来的子件时二次确认（连带删除）。 */
  function deleteMaterial(item: MaterialItem): void {
    const mount = (node.data.overlayNodes ?? []).find((m) => overlayMountId(m) === item.id)
    const addedCount = mount?.added?.length ?? 0
    if (addedCount > 0 && typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (!window.confirm(`将同时删除 ${addedCount} 个添加到此覆盖物的组件，是否确认移除挂载「${item.label}」？`)) return
    }
    onEditScenario((s, n) => deleteMaterialGraph(s, n, item))
    if (selectedMountId === item.id) focusMount(null)
  }

  const settlementTimeline = useMemo(
    () => collectNodeTimelineMarkers(scenario, node),
    [node, scenario],
  )
  const { pointMarkers, conditionMarkers } = settlementTimeline
  const spawnGroups = useMemo(
    () => collectSettlementSpawnGroups(scenario, node, maxMs),
    [maxMs, node, scenario],
  )

  /** 拖绑定界面右端 → 显示时长；起点仍由宿主结算的 at.ms 决定。 */
  const resizeSpawnBar = (id: string, endMs: number): void => {
    const address = settlementSpawnAddress(id)
    const bar = spawnGroups.flatMap((group) => group.bars).find((candidate) => candidate.id === id)
    if (!address || !bar) return
    onEditScenario((scenarioToEdit, nodeToEdit) => ({
      ...scenarioToEdit,
      graph: setSettlementSpawnTtlMs(
        scenarioToEdit.graph,
        nodeToEdit.id,
        address.settlementIndex,
        address.actionIndex,
        endMs - bar.startMs,
      ),
    }))
  }

  const unbindSpawnBar = (id: string): void => {
    const address = settlementSpawnAddress(id)
    if (!address) return
    if (selectedSettlementSpawnId === id) setSelectedSettlementSpawnId(null)
    onEditScenario((scenarioToEdit, nodeToEdit) => ({
      ...scenarioToEdit,
      graph: removeSettlementSpawn(
        scenarioToEdit.graph,
        nodeToEdit.id,
        address.settlementIndex,
        address.actionIndex,
      ),
    }))
  }

  const lifecycleIndexOf = (id: string): number | null => {
    if (!id.startsWith('life:')) return null
    const index = Number(id.slice('life:'.length))
    return Number.isInteger(index) ? index : null
  }

  const movePointMarker = (id: string, ms: number): void => {
    if (id === 'settlement') {
      onEditScenario((scenarioToEdit, nodeToEdit) => ({
        ...scenarioToEdit,
        graph: setRoutingSettlementMs(scenarioToEdit.graph, nodeToEdit.id, ms),
      }))
      return
    }
    const lifecycleIndex = lifecycleIndexOf(id)
    if (lifecycleIndex == null) return
    onEditScenario((scenarioToEdit, nodeToEdit) => ({
      ...scenarioToEdit,
      graph: setSettlementReactionMs(scenarioToEdit.graph, nodeToEdit.id, lifecycleIndex, ms),
    }))
  }
  /** 「添加控件」点击 / 拖入：挂载一张覆盖物（可带落点 ms → 整体平移到该时刻）。 */
  function mountOverlay(overlayId: string, atMs?: number): void {
    onEditScenario((s, n) => {
      const s1 = mountOverlayGraph(s, n, overlayId)
      if (atMs == null) return s1
      const n1 = s1.graph.nodes.find((x) => x.id === n.id) ?? n
      return shiftMountWindowGraph(s1, n1, maxMs, overlayId, { startMs: atMs })
    })
    focusMount(overlayId)
    setMoreOpen(false)
  }

  // ── 预览叠层画布（共享 OverlayCanvasInteraction）──────────────────────────
  function patchMountPosition(mountId: string, position: { x: number; y: number }): void {
    onEditScenario((s, n) => patchOverlayMountLayoutGraph(s, n, mountId, {
      left: position.x,
      top: position.y,
      right: undefined,
      bottom: undefined,
    }))
  }
  function patchSettlementSpawnPosition(
    preview: (typeof selectedSettlementSpawns)[number],
    position: { x: number; y: number },
  ): void {
    const effectiveLayout = preview.mount.mountLayout ?? {}
    onEditScenario((s, n) => ({
      ...s,
      graph: patchSettlementSpawnLayout(
        s.graph,
        n.id,
        preview.settlementIndex,
        preview.actionIndex,
        {
          ...effectiveLayout,
          left: position.x,
          top: position.y,
          right: undefined,
          bottom: undefined,
        },
      ),
    }))
  }
  function reorderMount(mountId: string, direction: 'front' | 'back'): void {
    const zValues = previewMountGroups.map(({ mount }) =>
      typeof mount.layout?.zIndex === 'number' ? mount.layout.zIndex : 0)
    const zIndex = direction === 'front'
      ? Math.max(0, ...zValues) + 1
      : Math.min(0, ...zValues) - 1
    onEditScenario((s, n) => patchOverlayMountLayoutGraph(s, n, mountId, { zIndex }))
  }
  function reorderSettlementSpawn(
    preview: (typeof selectedSettlementSpawns)[number],
    direction: 'front' | 'back',
  ): void {
    const zValues = allInteractionItems.map((item) => item.zIndex)
    const zIndex = direction === 'front'
      ? Math.max(0, ...zValues) + 1
      : Math.min(0, ...zValues) - 1
    const effectiveLayout = preview.mount.mountLayout ?? {}
    onEditScenario((s, n) => ({
      ...s,
      graph: patchSettlementSpawnLayout(
        s.graph,
        n.id,
        preview.settlementIndex,
        preview.actionIndex,
        { ...effectiveLayout, zIndex },
      ),
    }))
  }

  useLayoutEffect(() => {
    const stage = contentAnchorRef.current
    if (!stage) return
    const stageRect = stage.getBoundingClientRect()
    if (!stageRect.width || !stageRect.height) return
    const next: Record<string, { left: number; top: number; width: number; height: number }> = {}
    for (const { mountId } of previewMountGroups) {
      const wrap = mountPreviewRefs.current[mountId]
      if (!wrap) continue
      let left = Infinity
      let top = Infinity
      let right = -Infinity
      let bottom = -Infinity
      for (const element of overlayFitTargets(wrap)) {
        const rect = element.getBoundingClientRect()
        if (!rect.width || !rect.height) continue
        left = Math.min(left, rect.left)
        top = Math.min(top, rect.top)
        right = Math.max(right, rect.right)
        bottom = Math.max(bottom, rect.bottom)
      }
      if (!(right > left && bottom > top)) {
        const fallback = wrap.getBoundingClientRect()
        left = fallback.left
        top = fallback.top
        right = fallback.right
        bottom = fallback.bottom
      }
      next[mountId] = {
        left: (left - stageRect.left) / stageRect.width,
        top: (top - stageRect.top) / stageRect.height,
        width: (right - left) / stageRect.width,
        height: (bottom - top) / stageRect.height,
      }
    }
    const sig = Object.entries(next)
      .map(([id, box]) => `${id}:${box.left.toFixed(3)},${box.top.toFixed(3)},${box.width.toFixed(3)},${box.height.toFixed(3)}`)
      .join('|')
    if (sig !== mountBoxSigRef.current) {
      mountBoxSigRef.current = sig
      setMountContentBoxes(next)
    }

    const nextSettlementSpawns: Record<string, { left: number; top: number; width: number; height: number }> = {}
    for (const { id } of selectedSettlementSpawns) {
      const wrap = settlementSpawnPreviewRefs.current[id]
      if (!wrap) continue
      let left = Infinity
      let top = Infinity
      let right = -Infinity
      let bottom = -Infinity
      for (const element of overlayFitTargets(wrap)) {
        const rect = element.getBoundingClientRect()
        if (!rect.width || !rect.height) continue
        left = Math.min(left, rect.left)
        top = Math.min(top, rect.top)
        right = Math.max(right, rect.right)
        bottom = Math.max(bottom, rect.bottom)
      }
      if (!(right > left && bottom > top)) {
        const fallback = wrap.getBoundingClientRect()
        left = fallback.left
        top = fallback.top
        right = fallback.right
        bottom = fallback.bottom
      }
      nextSettlementSpawns[id] = {
        left: (left - stageRect.left) / stageRect.width,
        top: (top - stageRect.top) / stageRect.height,
        width: (right - left) / stageRect.width,
        height: (bottom - top) / stageRect.height,
      }
    }
    const conditionSig = Object.entries(nextSettlementSpawns)
      .map(([id, box]) => `${id}:${box.left.toFixed(3)},${box.top.toFixed(3)},${box.width.toFixed(3)},${box.height.toFixed(3)}`)
      .join('|')
    if (conditionSig !== settlementSpawnBoxSigRef.current) {
      settlementSpawnBoxSigRef.current = conditionSig
      setSettlementSpawnContentBoxes(nextSettlementSpawns)
    }
  }, [previewMountGroups, selectedSettlementSpawns, playheadMs, contentRect])

  const interactionItems = useMemo<CanvasInteractionItem[]>(() =>
    previewMountGroups.map(({ mountId, mount, children, layout }) => {
      const content = mountContentBoxes[mountId]
      const explicitBox: CanvasBox | null =
        !isFullStageMountLayout(layout)
        && typeof layout?.left === 'number'
        && typeof layout.top === 'number'
        && typeof layout.width === 'number'
        && typeof layout.height === 'number'
        && layout.translateX == null
        && layout.translateY == null
          ? {
              left: layout.left,
              top: layout.top,
              width: layout.width,
              height: layout.height,
            }
          : null
      const box: CanvasBox = explicitBox ?? {
        left: content?.left ?? 0,
        top: content?.top ?? 0,
        width: content?.width ?? DEFAULT_MOUNT_W,
        height: content?.height ?? DEFAULT_MOUNT_H,
      }
      return {
        id: mountId,
        label: overlays?.[mount.overlay]?.title?.trim() || mountId,
        position: {
          x: typeof layout?.left === 'number' ? layout.left : 0,
          y: typeof layout?.top === 'number' ? layout.top : 0,
        },
        frame: { kind: 'box', ...box },
        zIndex: typeof mount.layout?.zIndex === 'number'
          ? mount.layout.zIndex
          : Math.max(0, ...children.map((child) => typeof child.layout?.zIndex === 'number' ? child.layout.zIndex : 0)),
        movable: true,
        resizable: false,
      }
    }), [mountContentBoxes, overlays, previewMountGroups])

  const settlementSpawnInteractionItems = useMemo<CanvasInteractionItem[]>(() =>
    selectedSettlementSpawns.map((preview) => {
      const layout = preview.mount.mountLayout
      const content = settlementSpawnContentBoxes[preview.id]
      const explicitBox: CanvasBox | null =
        !isFullStageMountLayout(layout)
        && typeof layout?.left === 'number'
        && typeof layout.top === 'number'
        && typeof layout.width === 'number'
        && typeof layout.height === 'number'
        && layout.translateX == null
        && layout.translateY == null
          ? { left: layout.left, top: layout.top, width: layout.width, height: layout.height }
          : null
      const box: CanvasBox = explicitBox ?? {
        left: content?.left ?? (typeof layout?.left === 'number' ? layout.left : 0),
        top: content?.top ?? (typeof layout?.top === 'number' ? layout.top : 0),
        width: content?.width ?? DEFAULT_MOUNT_W,
        height: content?.height ?? DEFAULT_MOUNT_H,
      }
      return {
        id: preview.id,
        label: preview.label,
        position: {
          x: typeof layout?.left === 'number' ? layout.left : 0,
          y: typeof layout?.top === 'number' ? layout.top : 0,
        },
        frame: { kind: 'box', ...box },
        zIndex: typeof layout?.zIndex === 'number' ? layout.zIndex : 0,
        movable: true,
        resizable: false,
      }
    }), [settlementSpawnContentBoxes, selectedSettlementSpawns])

  const allInteractionItems = useMemo(
    () => [...interactionItems, ...settlementSpawnInteractionItems],
    [settlementSpawnInteractionItems, interactionItems],
  )

  const previewContentStyle: CSSProperties | undefined = contentRect
    ? { left: `${contentRect.left}px`, top: `${contentRect.top}px`, width: `${contentRect.width}px`, height: `${contentRect.height}px` }
    : undefined

  return (
    <div className="nps-root">
      <div className="gc-frame nps-frame nps-frame-edit" data-type="video">
        {previewSrc && !loadError ? (
          <video
            key={previewIdentity}
            ref={videoRef}
            className="gc-video"
            src={previewSrc}
            style={{ filter: videoFx.filter, transform: videoFx.transform }}
            autoPlay
            muted={muted}
            playsInline
            loop={playMode === 'loop'}
            onLoadedMetadata={(e) => {
              const dur = e.currentTarget.duration
              if (Number.isFinite(dur) && dur > 0) setVideoDurationMs(Math.round(dur * 1000))
              setMediaPlayheadMs(Math.round(e.currentTarget.currentTime * 1000))
              recomputeRect()
            }}
            onDurationChange={(e) => {
              // 部分视频 loadedmetadata 时 duration 仍为 Infinity/NaN（流式 MP4 等），
              // 真实时长在随后的 durationchange 才就绪——补采一次，保证 HUD 总时长正确。
              const dur = e.currentTarget.duration
              if (Number.isFinite(dur) && dur > 0) setVideoDurationMs(Math.round(dur * 1000))
            }}
            onPlay={() => setIsVideoPlaying(true)}
            onPause={() => setIsVideoPlaying(false)}
            onSeeked={(e) => {
              // 自定义时间轴 seekTo 已同步重置语义时钟；播放中的原生 loop seek 不得让结算倒带。
              setMediaPlayheadMs(Math.round(e.currentTarget.currentTime * 1000))
              if (!e.currentTarget.paused) return
              const target = Math.max(0, Math.min(maxMs, Math.round(e.currentTarget.currentTime * 1000)))
              mediaClockRef.current = { mediaMs: target, playheadMs: target }
              setPlayheadMs(target)
            }}
            onEnded={() => {
              mediaClockRef.current = { mediaMs: maxMs, playheadMs: maxMs }
              setIsVideoPlaying(false)
              setPlayheadMs(maxMs)
              setMediaPlayheadMs(maxMs)
            }}
            onError={() => { setLoadError(true); setIsVideoPlaying(false) }}
          />
        ) : (
          <div className="nps-stage-empty">
            <span>{loadError ? translateUi('ui.copy.aaac7115643a') : translateUi('ui.copy.35a830a7f56c')}</span>
            <span style={{ opacity: 0.7 }}>{translateUi('ui.copy.a9b15774318a')}</span>
          </div>
        )}
        {videoFx.overlays.length > 0 ? (
          <div className="nps-fx-layer" aria-hidden>
            {videoFx.overlays.map((o) => (
              <div key={o.id} style={o.style as CSSProperties} />
            ))}
          </div>
        ) : null}
        <div ref={contentAnchorRef} className="gc-content-anchor" style={previewContentStyle}>
          <div className="gc-preview-overlays" data-node-preview-overlay-scale="none">
            {previewSkinChildren.length > 0 || visibleRuntimeSpawns.length > 0 || selectedSettlementSpawns.length > 0 ? (
              <PreviewClockProvider value={previewClockValue}>
                <div className={`gc-preview-skin-layer ${previewClockLayerClassName(isVideoPlaying)}`} aria-hidden>
                  {previewMountGroups.map(({ mountId, children, layout }) => (
                    <div
                      key={mountId}
                      ref={(element) => { mountPreviewRefs.current[mountId] = element }}
                      data-preview-mount-id={mountId}
                      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
                    >
                      {children.map((child) => (
                        <span key={child.id} style={{ display: 'contents' }}>
                          {renderOverlayChildPreview(
                            child,
                            previewSkinReg,
                            previewSkinCtx,
                            !isVideoPlaying
                              && child.source.mountId === selectedMountId
                              ? focusedPreviewTimeMs(child, playheadMs, maxMs)
                              : playheadMs,
                            layout,
                            isVideoPlaying,
                          )}
                        </span>
                      ))}
                    </div>
                  ))}
                  {visibleRuntimeSpawns.map(({ mount, startedAtMs }) => (
                    <div
                      key={mount.mountId}
                      data-preview-spawn-id={mount.mountId}
                      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
                    >
                      {previewSkinReg.renderOverlayMount(
                        mount,
                        undefined,
                        previewSkinCtx,
                        { timeMs: Math.max(0, playheadMs - startedAtMs), playing: isVideoPlaying },
                      )}
                    </div>
                  ))}
                  {selectedSettlementSpawns.map((preview) => (
                    <div
                      key={preview.id}
                      ref={(element) => { settlementSpawnPreviewRefs.current[preview.id] = element }}
                      data-preview-settlement-spawn-id={preview.id}
                      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
                    >
                      {previewSkinReg.renderOverlayMount(
                        preview.mount,
                        undefined,
                        previewSkinCtx,
                        { timeMs: 0, playing: false },
                      )}
                    </div>
                  ))}
                </div>
              </PreviewClockProvider>
            ) : null}
            <OverlayCanvasInteraction
              stageRef={contentAnchorRef}
              items={allInteractionItems}
              selectedId={activeSettlementSpawnId ?? selectedOverlayId}
              // 同结算的其它界面画陪衬虚框：看得见才点得中（选中态是实线+发光，两者一眼可分）。
              highlightedIds={selectedSettlementSpawns.map((preview) => preview.id)}
              frameVisibility="active"
              ariaLabel="节点视频覆盖物画布"
              onSelect={(id) => {
                if (id?.startsWith(SETTLEMENT_SPAWN_ID_PREFIX)) {
                  setSelectedSettlementSpawnId(id)
                  setSelectedOverlayId(null)
                  if (focusedLifecycleIndex != null) onFocusLifecycle?.(focusedLifecycleIndex)
                  return
                }
                setSelectedOverlayId(id)
                setSelectedSettlementSpawnId(null)
                focusMount(id)
                if (id == null) onFocusLifecycle?.(null)
              }}
              onMove={(id, position) => {
                pauseForScrub()
                const settlementPreview = selectedSettlementSpawns.find((preview) => preview.id === id)
                if (settlementPreview) {
                  patchSettlementSpawnPosition(settlementPreview, position)
                  return
                }
                patchMountPosition(id, position)
              }}
              onInteractionChange={(active) => {
                if (active) pauseForScrub()
              }}
              onReorder={(id, direction) => {
                pauseForScrub()
                const settlementPreview = selectedSettlementSpawns.find((preview) => preview.id === id)
                if (settlementPreview) {
                  reorderSettlementSpawn(settlementPreview, direction)
                  return
                }
                reorderMount(id, direction)
              }}
            />
          </div>
        </div>
      </div>

      {/* 视频控制卡（Figma 15635:84858）：帧下方独立卡片——左：暂停/重播/音量；右：时长。
          重播复用既有 seekTo + play（togglePlay 播完重开的同源动作），无视频时按钮行为同前为空值守卫。 */}
      <div className="nps-video-controls">
        <div className="nps-video-controls-left">
          <button type="button" onClick={togglePlay} title={isVideoPlaying ? translateUi('ui.copy.130448bce675') : translateUi('ui.copy.21925350deba')} aria-label={isVideoPlaying ? translateUi('ui.copy.130448bce675') : translateUi('ui.copy.21925350deba')}>
            {isVideoPlaying ? <PreviewPauseIcon /> : <PreviewPlayIcon />}
          </button>
          <button type="button" onClick={replayFromStart} title={translateUi('ui.copy.ba47d71e75cf')} aria-label={translateUi('ui.copy.ba47d71e75cf')}>
            <PreviewRefreshIcon />
          </button>
          <button type="button" className={muted ? 'nps-hud-btn-dim' : undefined} onClick={toggleMute} title={muted ? translateUi('ui.copy.59bc75cad0d0') : translateUi('ui.copy.afdbd1ddecd8')} aria-label={muted ? translateUi('ui.copy.59bc75cad0d0') : translateUi('ui.copy.afdbd1ddecd8')}>
            <PreviewVolumeIcon />
          </button>
        </div>
        <div className="nps-video-controls-right">
          <span className="nps-hud-time">{formatPreviewTime(playheadMs)}<span> / {formatPreviewTime(maxMs)}</span></span>
          {timelineToggle}
        </div>
      </div>

      {/* 「添加控件」= 覆盖物挂载入口：前 5 个未挂载覆盖物点击直接挂载，「更多」展开完整列表。 先暂时隐藏 */}
      <div className="nps-addbar" style={{ display: 'none' }}>
        <span className="nps-addbar-label">{translateUi('ui.copy.4e9017ca7a1e')}</span>
        {primaryCandidateIds.length === 0 && moreCandidateIds.length === 0 ? (
          <span className="nps-addbar-empty">{translateUi('ui.copy.f1489c98049a')}</span>
        ) : null}
        {primaryCandidateIds.map((id) => (
          <button
            key={id}
            type="button"
            className="nps-add-chip"
            title={`${translateUi('ui.template.53b2a4c635b4')}${overlayDisplayLabel(id, overlays)}${translateUi('ui.template.9808568a716a')}`}
            draggable
            onClick={() => mountOverlay(id)}
            onDragStart={(e) => {
              e.dataTransfer.setData(MATERIAL_DND_MIME, id)
              e.dataTransfer.effectAllowed = 'copy'
            }}
          >
            {overlays?.[id]?.title?.trim() || id}
          </button>
        ))}
        {moreCandidateIds.length > 0 ? (
          <button
            type="button"
            className="nps-add-chip"
            title={translateUi('ui.copy.4842599ef521')}
            onClick={() => setMoreOpen((v) => !v)}
          >
            {translateUi('ui.copy.1d0df48b77d4')}</button>
        ) : null}
        {moreOpen ? (
          <div className="nps-more-pop" onPointerLeave={() => setMoreOpen(false)}>
            {moreCandidateIds.length === 0 ? (
              <div className="nps-more-empty">{translateUi('ui.copy.643069829da6')}</div>
            ) : (
              moreCandidateIds.map((id) => (
                <button key={id} type="button" onClick={() => mountOverlay(id)}>
                  {overlayDisplayLabel(id, overlays)}
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>

      {timelineExpanded ? (
        <div id={timelineId} ref={timelineHostRef} className="nps-timeline-host">
          {/* key=node.id：切节点整体重挂载——zoom（1× 默认）等时间轴本地状态随之重置，
              避免上一个节点的 20× 残留到下一个节点（滚动条莫名变长）。 */}
          <MaterialTimeline
            key={node.id}
            materials={timelineMaterials}
            maxMs={maxMs}
            playheadMs={playheadMs}
            videoSrc={previewSrc}
            mediaPlayhead={playMode === 'loop' && mediaRef
              ? { materialKey: NODE_VIDEO_TRACK_KEY, localMs: mediaPlayheadMs }
              : undefined}
            selectedMaterialKey={selectedMountId ? `mount:${selectedMountId}` : null}
            pointMarkers={pointMarkers}
            conditionMarkers={conditionMarkers}
            selectedPointMarkerId={focusedLifecycleIndex != null ? `life:${focusedLifecycleIndex}` : null}
            spawnGroups={spawnGroups}
            // 时间轴用作者真正点中的那条，而不是画布的 activeSettlementSpawnId ——
            // 后者在未命中时会回落到组内首条，会在焦点传播完成前点亮错误的界面。
            selectedSpawnBarId={selectedSettlementSpawnId}
            onSpawnBarEndChange={resizeSpawnBar}
            onDeleteSpawnBar={unbindSpawnBar}
            onSelectSpawnBar={(id) => {
              setSelectedSettlementSpawnId(id)
              setSelectedOverlayId(null)
            }}
            context="video"
            editable
            emptyHint={translateUi('ui.copy.767987639002')}
            onSeek={seekTo}
            onScrubStart={pauseForScrub}
            onSelectMaterial={(key) => {
              const mid = key.startsWith('mount:') ? key.slice('mount:'.length) : null
              focusMount(mid)
              // 只暂停，不动播放头：选中界面不该改作者当前停在的时刻（与结算绑定界面一致）。
              // 该界面即使不在此刻的窗口内也会被强制渲染并按代表帧定帧，见 previewSkinChildren。
              pauseForScrub()
            }}
            onPatchMaterial={patchMaterial}
            onPointMarkerChange={movePointMarker}
            onSelectPointMarker={(id) => {
              const lifecycleIndex = lifecycleIndexOf(id)
              if (lifecycleIndex != null) {
                pauseForScrub()
                onFocusLifecycle?.(lifecycleIndex)
              }
            }}
            onDeleteMaterial={deleteMaterial}
            onDropTemplate={(template, atMs) => mountOverlay(template, atMs)}
          />
        </div>
      ) : null}
    </div>
  )
}
