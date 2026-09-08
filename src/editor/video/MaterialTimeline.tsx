import { t as translateUi } from '../../i18n'
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'

import { injectStyleOnce } from '@/editor/styles/injectStyle'
import { AudioWaveform } from './audioWaveform'
import { VideoFilmstrip } from './videoFilmstrip'
import { resolveSnapGridMs, snapMs } from './timelineMath'
import {
  type AudioItem,
  type MaterialItem,
  type TimelineConditionMarker,
  type TimelinePointMarker,
  type TimelineSegment,
  type TimelineSpawnGroup,
  TIMELINE_LAYER_STEP,
  TIMELINE_LAYER_TOP,
  TIMELINE_MIN_TRACKS,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  buildMaterialTicks,
  canDeleteMaterial,
  clampMs,
  clampZoom,
  fmtDur,
  initialViewportWidthLatch,
  latchViewportWidth,
  layerFromPointerY,
  layerTop,
  materialClass,
  materialDisplayLabel,
  spawnBarTrack,
  spawnGroupsMaxRow,
} from './materialTimelineShared'

/** 素材库卡片 → 时间轴拖放时携带的模板类型 MIME。 */
export const MATERIAL_DND_MIME = 'application/x-fx-material'

/** 缩放控件缩小图标（Figma 14935:70530 导出矢量：放大镜 + 减号，stroke 1.093）。 */
function ZoomOutIcon(): JSX.Element {
  return (
    <svg width="12.5" height="12.5" viewBox="0 0 12.4943 12.4943" fill="none" aria-hidden>
      <path
        d="M5.46621 9.37054C7.6226 9.37054 9.37069 7.62245 9.37069 5.46606C9.37069 3.30968 7.6226 1.56158 5.46621 1.56158C3.30983 1.56158 1.56173 3.30968 1.56173 5.46606C1.56173 7.62245 3.30983 9.37054 5.46621 9.37054Z"
        stroke="currentColor"
        strokeWidth="1.09325"
      />
      <path d="M8.19935 8.1992L10.9325 10.9323M3.90442 5.46606H7.028" stroke="currentColor" strokeWidth="1.09325" strokeLinecap="round" />
    </svg>
  )
}

/** 缩放控件放大图标（Figma 14935:70530 导出矢量：放大镜 + 加号）。 */
function ZoomInIcon(): JSX.Element {
  return (
    <svg width="12.5" height="12.5" viewBox="0 0 12.4943 12.4943" fill="none" aria-hidden>
      <path
        d="M5.46642 9.37054C7.6228 9.37054 9.3709 7.62245 9.3709 5.46606C9.3709 3.30968 7.6228 1.56158 5.46642 1.56158C3.31003 1.56158 1.56194 3.30968 1.56194 5.46606C1.56194 7.62245 3.31003 9.37054 5.46642 9.37054Z"
        stroke="currentColor"
        strokeWidth="1.09325"
      />
      <path d="M8.19955 8.1992L10.9327 10.9323M5.46642 3.90427V7.02785M3.90463 5.46606H7.02821" stroke="currentColor" strokeWidth="1.09325" strokeLinecap="round" />
    </svg>
  )
}

/**
 * 游标把手（Figma 14935:70530 的 czstag：tag 旋转 135° → 直角尖端朝下）。
 * 缩放滑轨把手与播放头头部共用这一个形状，两处不各画一份尖角。
 * 颜色由调用方给：滑轨用设计的白，播放头传 `currentColor` 交给 CSS 定色。
 */
function ScrubCursorIcon({ fill = '#fff' }: { fill?: string }): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10.0018 10.002" fill="none" aria-hidden style={{ transform: 'rotate(135deg)', display: 'block' }}>
      <path d="M4.8201 10.002L0 5.18198L5.18144 0.00889066L10.0016 0.000511834V4.82899L4.8201 10.002Z" fill={fill} />
    </svg>
  )
}

/** 条件结算行的循环图标（Figma 14947:80583 cphrefresh 导出矢量，stroke 1.215）。 */
function CondRefreshIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 12.8114 12.7546" fill="none" aria-hidden style={{ flex: 'none', display: 'block' }}>
      <path
        d="M12.1441 6.98468C11.8406 9.88587 9.38732 12.1473 6.40578 12.1473C4.08703 12.1473 2.08774 10.7795 1.1707 8.80677M0.635822 11.5399V8.50309H2.45791M0.667259 5.76995C0.970753 2.86878 3.4241 0.607364 6.40565 0.607364C8.72439 0.607364 10.7236 1.97513 11.6407 3.94786M12.1756 1.21473V4.25155H10.3535"
        stroke="currentColor"
        strokeWidth="1.21473"
        strokeLinecap="square"
      />
    </svg>
  )
}

/** 条件结算行「条件 → 动作」的分隔箭头（Figma 14947:80590 aeqarrow-right 导出矢量）。 */
function CondArrowIcon(): JSX.Element {
  return (
    <svg width="11" height="9" viewBox="0 0 10.1212 8.39888" fill="none" aria-hidden style={{ flex: 'none', display: 'block' }}>
      <path d="M5.92179 7.53994L9.26229 4.19944L5.92179 0.858942M8.50309 4.19944H0.607364" stroke="currentColor" strokeWidth="1.21473" strokeLinecap="square" />
    </svg>
  )
}

/**
 * 材料条渲染最小宽度（px）。= 左手柄 8 + 中间可拖区 ≥6 + 右手柄 8。
 * 极短窗口（几十 ms）按真实比例只有几 px 宽时，两个手柄会叠在一起、起点抓不到，
 * 所以宽度取真实跨度与本下限的较大者——牺牲一点比例真实性，换回可操作性。
 */
const CLIP_MIN_PX = 22
/** 窄于此宽度就不渲染条内文字（文字会压住两侧手柄的可点区；标签仍在 title 里）。 */
const CLIP_LABEL_MIN_PX = 56
/** 旋转后的菱形半宽约 9px；仅偏移两端的头部，时刻竖线仍精确落在 0/max。 */
const POINT_EDGE_OFFSET_PX = 9
/** 为横向滚动条预留空间，避免它挤占第 6 轨后误触发纵向滚动条。 */
const TIMELINE_SCROLLBAR_RESERVE_PX = 18
/** 视频轨（第 0 轨）比普通轨（34px）高出的像素：轨高 48px，帧画面条 40px。 */
const VIDEO_ROW_EXTRA_PX = 14
function pointHeadOffsetPx(ms: number, maxMs: number): number {
  if (ms <= 0) return POINT_EDGE_OFFSET_PX
  if (ms >= maxMs) return -POINT_EDGE_OFFSET_PX
  return 0
}

/**
 * 视频 tab 与剧情树抽屉共享的「材料时间轴」——
 *   · zIndex 堆叠的材料条（字幕 / 结算 / QTE / 选项 / QTE 窗口）
 *   · Ctrl/⌘ 锚点缩放 + Shift 横滚 + 普通滚轮纵向滚动
 *   · ruler 刻度 + 平滑播放头（宿主每帧喂 playheadMs）
 *   · 拖动 move/start/end（吸附 0.01s=10ms；Alt=0.1s）
 *   · 无限纵向轨：轨数由数据 zIndex 派生并多留一条空投放轨
 *
 * 组件本身**不碰 scenario**：材料由宿主 `collectMaterials(scene)` 传入，编辑经
 * `onPatchMaterial` 回写。gating 由宿主通过 props 决定（如剧情树关掉某些交互）。
 */
export interface MaterialTimelineProps {
  materials: MaterialItem[]
  maxMs: number
  playheadMs: number
  /** 独立于节点逻辑播放头的媒体局部指针；循环视频回绕时只在对应视频条内回绕。 */
  mediaPlayhead?: { materialKey: string; localMs: number }
  selectedMaterialKey: string | null
  isTimedQteNode?: boolean
  /** 视频 tab（全交互）或剧情树抽屉（可 gating）。目前仅用于文案，交互差异由下面的开关控制。 */
  context?: 'video' | 'story'
  /** 是否允许拖动编辑材料（剧情树只读预览时可关）。默认 true。 */
  editable?: boolean
  /** 是否允许点选材料/结算标记。默认 true；流程预览关闭以避免联动编辑表单。 */
  selectable?: boolean
  /** 全流程预览的节点片段背景与边界；省略时保持单节点时间轴外观。 */
  segments?: TimelineSegment[]
  /** fit=总时长始终铺满视口；append=首段铺满视口，后续片段按同一 px/ms 向右追加。 */
  widthMode?: 'fit' | 'append'
  emptyHint?: string
  /** 提供时，点击/拖动 ruler 或画布空白处即 seek 播放头到该时刻（宿主据此暂停播放并同步 <video>）。 */
  onSeek?: (ms: number) => void
  /** 一次手动拖拽（scrub）开始时触发一次 —— 宿主用它把正在播放的视频自动暂停。 */
  onScrubStart?: () => void
  /** 一次手动拖拽结束时触发一次 —— 宿主恢复播放头的自动滚动策略。 */
  onScrubEnd?: () => void
  /** 持续拖动播放头的灵敏度；1 = 指针与时间轴等比例，默认 1。按下定位不受影响。 */
  seekDragSensitivity?: number
  onSelectMaterial: (key: string) => void
  onPatchMaterial: (
    item: MaterialItem,
    patch: { startMs?: number; endMs?: number; zIndex?: number; markerMs?: number },
  ) => void
  /** 提供时，选中可删材料后按 Delete/Backspace 或点击控件上的 × 即删除。 */
  onDeleteMaterial?: (item: MaterialItem) => void
  /** 提供时，从素材库把控件卡片拖入时间轴 → 在落点时刻 atMs / 轨 zIndex 新增该模板。 */
  onDropTemplate?: (template: string, atMs: number, zIndex: number) => void
  /** 当前时间轴模式：组件（material）/ 音频（audio）。默认 material。 */
  mode?: 'material' | 'audio'
  /** 提供时，materialbar 出现「组件 / 音频」切换段控件。 */
  onModeChange?: (mode: 'material' | 'audio') => void
  /** 音频模式下展示的音轨条（当前仅显示 + 拖动，不做实际音频编辑）。 */
  audioItems?: AudioItem[]
  /** 音频模式下拖动音轨条的回写（移动 / 换轨）。 */
  onPatchAudio?: (item: AudioItem, patch: { startMs?: number; endMs?: number; zIndex?: number }) => void
  /**
   * 节点级时刻点（定时结算 / 由界面窗口推导的结算时刻）——见 `TimelinePointMarker`。
   * 空数组或省略 = 不画。刻意不走 MaterialItem/`markerMs`：这些时刻不属于任何材料。
   */
  pointMarkers?: TimelinePointMarker[]
  /** 无确定毫秒坐标的结算条件，以贯穿节点时长的条件条显示。 */
  conditionMarkers?: TimelineConditionMarker[]
  /** 拖时刻标记的回写（按 marker.id 路由到各自的落盘字段）。 */
  onPointMarkerChange?: (id: string, ms: number) => void
  /** 当前选中的时刻标记 id（与右侧表单双向联动：这里点亮，那边高亮对应配置块）。 */
  selectedPointMarkerId?: string | null
  /** 点中时刻标记时上抛（按下即选，不必等拖动结束）。 */
  onSelectPointMarker?: (id: string) => void
  /**
   * 结算**绑定界面**组：从属于 lifecycle 菱形，分布在菱形轨正上方。
   * 起始由宿主结算派生（不可单独编辑），因此这些条只有右手柄。
   */
  spawnGroups?: TimelineSpawnGroup[]
  /** 拖绑定界面右端的回写（id = `settlement-spawn:${settlementIndex}:${actionIndex}`）。 */
  onSpawnBarEndChange?: (id: string, endMs: number) => void
  /** 点中绑定界面时上抛（宿主结算的选中由 `onSelectPointMarker` 一并触发）。 */
  onSelectSpawnBar?: (id: string) => void
  /** 当前选中的绑定界面 id。 */
  selectedSpawnBarId?: string | null
  /** 提供时，选中的绑定界面上出现解除绑定控件。 */
  onDeleteSpawnBar?: (id: string) => void
  /** 第 0 轨视频条的可播地址（帧画面层 VideoFilmstrip 用）；省略时视频条保持纯色媒体条。 */
  videoSrc?: string
}

/** 时刻标记的拖拽 sentinel 前缀（与 `__seek__` 同一手法：借指针管线，不占材料 key）。 */
const POINT_DRAG_PREFIX = '__point:'
/** 绑定界面「拖右端」的拖拽 sentinel 前缀；这类条没有起点拖动，所以只需要一个前缀。 */
const SPAWN_END_DRAG_PREFIX = '__spawnend:'
/** 绑定界面的最短可见跨度：一个吸附格，保证结束永不落到宿主结算时刻或它之前。 */
const MIN_SPAWN_SPAN_MS = 10
/** 绑定界面组虚线框相对组内条的留白，避免框线贴着条边。 */
const SPAWN_GROUP_PAD_X = 5
/**
 * 纵向留白只能取 1px：轨距 34、条高 32，相邻两行之间只有 2px 空隙，两组的框各分 1px 才刚好
 * 平铺不压线。要更多纵向留白就得给每组额外占一行，那是作者不愿付的代价。
 */
const SPAWN_GROUP_PAD_Y = 1

interface DragState {
  key: string
  mode: 'move' | 'start' | 'end' | 'marker'
  pointerX: number
  startMs: number
  endMs: number
  zIndex: number
}

export function MaterialTimeline({
  materials,
  maxMs,
  playheadMs,
  mediaPlayhead,
  selectedMaterialKey,
  isTimedQteNode = false,
  editable = true,
  selectable = true,
  segments,
  widthMode = 'fit',
  emptyHint = '打开素材库，把控件加入当前节点时间轴',
  onSeek,
  onScrubStart,
  onScrubEnd,
  seekDragSensitivity = 1,
  onSelectMaterial,
  onPatchMaterial,
  onDeleteMaterial,
  onDropTemplate,
  mode,
  onModeChange,
  audioItems,
  onPatchAudio,
  pointMarkers,
  conditionMarkers,
  onPointMarkerChange,
  selectedPointMarkerId,
  onSelectPointMarker,
  spawnGroups,
  onSpawnBarEndChange,
  onSelectSpawnBar,
  selectedSpawnBarId,
  onDeleteSpawnBar,
  videoSrc,
}: MaterialTimelineProps) {
  injectStyleOnce('material-timeline', MATERIAL_TIMELINE_CSS)
  const activeMode: 'material' | 'audio' = mode ?? 'material'
  const audioList = audioItems ?? []
  // 当前活动条目列表（几何 + key 通用；只有它们的字段被 drag/render 用到）。
  const activeList: Array<{ key: string; startMs: number; endMs: number; zIndex: number; markerMs?: number; fixedWidthPx?: number; locked?: boolean }> =
    activeMode === 'audio' ? audioList : materials
  const mediaPlayheadMaterial = mediaPlayhead
    ? materials.find((material) => material.key === mediaPlayhead.materialKey)
    : undefined
  const mediaPlayheadTimelineMs = mediaPlayheadMaterial && mediaPlayhead
    ? mediaPlayheadMaterial.startMs + Math.max(
      0,
      Math.min(mediaPlayheadMaterial.endMs - mediaPlayheadMaterial.startMs, mediaPlayhead.localMs),
    )
    : null
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const timelineViewportRef = useRef<HTMLDivElement | null>(null)
  const seekDragActiveRef = useRef(false)
  const normalizedSeekDragSensitivity = Number.isFinite(seekDragSensitivity)
    ? Math.max(0, seekDragSensitivity)
    : 1
  const [zoom, setZoom] = useState(1)
  // 视口宽经闩锁采纳：滚动条显隐引起的来回抖动会被收敛掉（见 latchViewportWidth）。
  const [viewportWidthLatch, setViewportWidthLatch] = useState(initialViewportWidthLatch)
  const viewportW = viewportWidthLatch.width
  const [drag, setDrag] = useState<DragState | null>(null)
  const [dropHint, setDropHint] = useState<{ ms: number; zIndex: number } | null>(null)

  // 视频轨（第 0 轨，locked 媒体条）加高到 60px 放帧画面；其下轨道整体下移 VIDEO_ROW_EXTRA_PX。
  // rowTop = layerTop + 视频轨之后的偏移；命中换算（拖轨/投放）在 rowFromPointerY 里做逆运算。
  const hasVideoTrack = activeMode === 'material' && materials.some((m) => m.kind === 'video')
  const videoRowExtraPx = hasVideoTrack ? VIDEO_ROW_EXTRA_PX : 0
  const rowTop = (zIndex: number): number => layerTop(zIndex) + (zIndex >= 1 ? videoRowExtraPx : 0)
  const rowFromPointerY = (clientY: number, rect: DOMRect, maxLayer: number): number => {
    const firstShiftedRowTop = rect.top + rowTop(1)
    const adjustedY = videoRowExtraPx > 0 && clientY >= firstShiftedRowTop ? clientY - videoRowExtraPx : clientY
    return layerFromPointerY(adjustedY, rect, maxLayer)
  }

  // 无限轨：可见轨数由数据里最大 zIndex 派生，并永远多留一条空轨用于「拖到新轨=新增一轨」。
  const dataMaxLayer = activeList.reduce((mx, it) => Math.max(mx, it.zIndex), 0)
  // 结算独占一轨（排在材料轨之后）：它是"何时执行动作"，与界面窗口是不同维度。
  // 无确定时间的条件结算每个各占一轨；最后仍留一条空投放轨。
  const settlementMarkers = (pointMarkers ?? []).filter((m) => m.kind === 'settlement')
  const lifecycleMarkers = (pointMarkers ?? []).filter((m) => m.kind === 'lifecycle' || m.kind === 'derived')
  // 绑定界面组占据材料轨与菱形轨之间的若干行，因此菱形轨要整体下移让出空间。
  const spawnGroupList = activeMode === 'material' ? spawnGroups ?? [] : []
  const spawnRowCount = spawnGroupsMaxRow(spawnGroupList)
  const lifecycleTrack = dataMaxLayer + 1 + spawnRowCount
  const conditionTrack = lifecycleTrack + (lifecycleMarkers.length ? 1 : 0)
  const conditionCount = conditionMarkers?.length ?? 0
  const trackCount = Math.max(
    TIMELINE_MIN_TRACKS,
    dataMaxLayer + 2,
    lifecycleMarkers.length || spawnRowCount ? lifecycleTrack + 2 : 0,
    conditionCount ? conditionTrack + conditionCount + 1 : 0,
  )
  // 流程预览锁定首段建立的 px/ms；后续片段等比例追加，视口通过横向滚动跟随。
  const firstSegmentMs = segments?.[0]
    ? Math.max(1, segments[0].endMs - segments[0].startMs)
    : maxMs
  const durationWidthScale = widthMode === 'append' ? maxMs / firstSegmentMs : 1
  const canvasPx = Math.max(1, (viewportW || 1) * zoom * durationWidthScale)
  const pxPerMs = canvasPx / maxMs
  const canvasHeight = TIMELINE_LAYER_TOP + trackCount * TIMELINE_LAYER_STEP + 8 + videoRowExtraPx
  // 视口下限高度（≈6 轨）：宿主给了 flex 定界时视口继续生长填满剩余空间，此值只作地板。
  const viewportMinHeight = TIMELINE_LAYER_TOP
    + TIMELINE_MIN_TRACKS * TIMELINE_LAYER_STEP
    + 8
    + TIMELINE_SCROLLBAR_RESERVE_PX
    + videoRowExtraPx
  const ruleTicks = useMemo(() => buildMaterialTicks(maxMs, pxPerMs), [maxMs, pxPerMs])

  // 视口宽度 → canvasPx 基准。ResizeObserver 跟随布局变化。
  // 刻意不回读 clientHeight：见画布 style 处注释（会与滚动条互相触发形成自激振荡）。
  useEffect(() => {
    const vp = timelineViewportRef.current
    if (!vp) return
    const measure = () => {
      setViewportWidthLatch((state) => latchViewportWidth(state, vp.clientWidth))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(vp)
    return () => ro.disconnect()
  }, [])

  // 滚轮：Ctrl/⌘ = 以光标为锚点缩放；Shift = 横向滚动；普通滚轮 = 原生纵向滚动（轨多时）。
  useEffect(() => {
    const vp = timelineViewportRef.current
    if (!vp) return
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const rect = vp.getBoundingClientRect()
        const localX = e.clientX - rect.left
        const anchorX = localX + vp.scrollLeft
        const ratio = canvasPx > 0 ? anchorX / canvasPx : 0
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
        setZoom((z) => {
          const next = clampZoom(z * factor)
          const nextCanvas = Math.max(1, (viewportW || 1) * next * durationWidthScale)
          requestAnimationFrame(() => {
            if (timelineViewportRef.current) {
              timelineViewportRef.current.scrollLeft = ratio * nextCanvas - localX
            }
          })
          return next
        })
      } else if (e.shiftKey) {
        e.preventDefault()
        vp.scrollLeft += e.deltaY
      }
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [canvasPx, viewportW, durationWidthScale])

  // 把当前拖拽的 patch 派发给对应回写（组件→onPatchMaterial / 音频→onPatchAudio）。
  function dispatchPatch(key: string, patch: { startMs?: number; endMs?: number; zIndex?: number; markerMs?: number }): void {
    if (activeMode === 'audio') {
      const a = audioList.find((x) => x.key === key)
      if (a) onPatchAudio?.(a, patch)
      return
    }
    const m = materials.find((x) => x.key === key)
    if (m) onPatchMaterial(m, patch)
  }

  function onPointerDown(
    e: React.PointerEvent,
    item: { key: string; startMs: number; endMs: number; zIndex: number; markerMs?: number; fixedWidthPx?: number; locked?: boolean },
    dragMode: 'move' | 'start' | 'end' | 'marker',
  ): void {
    e.preventDefault()
    e.stopPropagation()
    if (item.locked) {
      if (onSeek) beginSeek(e)
      return
    }
    // 调时间不进选中态：拖左右手柄改的是「什么时候出现/消失」，不是「我要编辑这个界面」，
    // 不该顺带把它选中并在预览画布上点亮（与结算绑定界面的右手柄一致）。仍要暂停播放，
    // 否则播放头会在拖动中继续走。
    const timingOnly = dragMode === 'start' || dragMode === 'end'
    // 音频条仅显示 + 拖动，不进 material 选中/检视器流。
    if (activeMode === 'material' && selectable && !timingOnly) onSelectMaterial(item.key)
    if (timingOnly) onScrubStart?.()
    if (!editable && !selectable && onSeek) {
      beginSeek(e)
      return
    }
    // 让视口拿到焦点，Delete/Backspace 键删除才有落点（不滚动画面）。
    timelineViewportRef.current?.focus({ preventScroll: true })
    if (!editable) return
    if (item.fixedWidthPx != null && (dragMode === 'start' || dragMode === 'end')) return
    timelineRef.current?.setPointerCapture(e.pointerId)
    const anchorMs = dragMode === 'marker' ? (item.markerMs ?? item.startMs) : item.startMs
    setDrag({ key: item.key, mode: dragMode, pointerX: e.clientX, startMs: anchorMs, endMs: item.endMs, zIndex: item.zIndex })
  }

  // 选中可删材料后，按 Delete/Backspace 删除（焦点在时间轴视口内时生效）。
  function onViewportKeyDown(e: React.KeyboardEvent): void {
    if (activeMode !== 'material') return
    if (e.key !== 'Delete' && e.key !== 'Backspace') return
    if (!onDeleteMaterial || !selectedMaterialKey) return
    const item = materials.find((m) => m.key === selectedMaterialKey)
    if (!item || !canDeleteMaterial(item.kind)) return
    e.preventDefault()
    onDeleteMaterial(item)
  }

  function onPointerMove(e: React.PointerEvent): void {
    if (!drag) return
    if (drag.key === '__seek__') {
      const rect = e.currentTarget.getBoundingClientRect()
      if (rect.width <= 0 || !onSeek) return
      const deltaMs = ((e.clientX - drag.pointerX) / rect.width) * maxMs * normalizedSeekDragSensitivity
      onSeek(clampMs(drag.startMs + deltaMs, 0, maxMs))
      return
    }
    if (drag.key.startsWith(POINT_DRAG_PREFIX)) {
      const rect = e.currentTarget.getBoundingClientRect()
      if (rect.width <= 0) return
      const deltaMs = ((e.clientX - drag.pointerX) / rect.width) * maxMs
      const grid = resolveSnapGridMs({ shift: e.shiftKey, alt: e.altKey })
      const id = drag.key.slice(POINT_DRAG_PREFIX.length)
      onPointMarkerChange?.(id, clampMs(snapMs(drag.startMs + deltaMs, grid), 0, maxMs))
      return
    }
    if (drag.key.startsWith(SPAWN_END_DRAG_PREFIX)) {
      const rect = e.currentTarget.getBoundingClientRect()
      if (rect.width <= 0) return
      const deltaMs = ((e.clientX - drag.pointerX) / rect.width) * maxMs
      const grid = resolveSnapGridMs({ shift: e.shiftKey, alt: e.altKey })
      const id = drag.key.slice(SPAWN_END_DRAG_PREFIX.length)
      // 起点归菱形所有：结束只能往后夹，永不越过宿主结算时刻。
      onSpawnBarEndChange?.(
        id,
        clampMs(snapMs(drag.endMs + deltaMs, grid), drag.startMs + MIN_SPAWN_SPAN_MS, maxMs),
      )
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    const activeItem = activeList.find((m) => m.key === drag.key)
    if (!activeItem) return
    const deltaMs = ((e.clientX - drag.pointerX) / rect.width) * maxMs
    const nextLayer = drag.mode === 'move' ? rowFromPointerY(e.clientY, rect, trackCount - 1) : drag.zIndex
    // 吸附：默认 0.01s（10ms）；Alt=0.1s 粗粒度。
    const grid = resolveSnapGridMs({ shift: e.shiftKey, alt: e.altKey })
    if (drag.mode === 'marker') {
      // 段内命中判定点（菱形）：只改 markerMs，宿主夹回 [出现, 消失] 内。
      dispatchPatch(drag.key, { markerMs: clampMs(snapMs(drag.startMs + deltaMs, grid), 0, maxMs) })
      return
    }
    const span = drag.endMs - drag.startMs
    if (drag.mode === 'move') {
      // 固定宽度条表达触发时刻，不表达占用跨度。即使旧数据的 endMs 落在视频末尾，
      // 也必须允许拖动起点；实际动画结束由组件时长决定并在写回层夹到视频范围内。
      const fixedWidth = activeItem.fixedWidthPx != null
      const start = clampMs(
        snapMs(drag.startMs + deltaMs, grid),
        0,
        fixedWidth ? maxMs : Math.max(0, maxMs - span),
      )
      dispatchPatch(drag.key, {
        startMs: start,
        endMs: fixedWidth ? Math.min(maxMs, start + span) : start + span,
        zIndex: nextLayer,
      })
    } else if (drag.mode === 'start') {
      dispatchPatch(drag.key, { startMs: snapMs(drag.startMs + deltaMs, grid), endMs: drag.endMs })
    } else {
      dispatchPatch(drag.key, { startMs: drag.startMs, endMs: snapMs(drag.endMs + deltaMs, grid) })
    }
  }

  function onPointerUp(): void {
    if (seekDragActiveRef.current) {
      seekDragActiveRef.current = false
      onScrubEnd?.()
    }
    setDrag(null)
  }

  function seekMsFromPointer(clientX: number): number | null {
    const canvas = timelineRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0) return null
    return clampMs(((clientX - rect.left) / rect.width) * maxMs, 0, maxMs)
  }

  // 按下先绝对定位；随后以较低灵敏度围绕该点微调，避免几像素就跨过大量视频时刻。
  function beginSeek(e: React.PointerEvent): void {
    if (!onSeek) return
    const anchorMs = seekMsFromPointer(e.clientX)
    if (anchorMs == null) return
    e.preventDefault()
    e.stopPropagation()
    onScrubStart?.() // 宿主据此暂停正在播放的视频
    seekDragActiveRef.current = true
    timelineRef.current?.setPointerCapture(e.pointerId)
    setDrag({ key: '__seek__', mode: 'move', pointerX: e.clientX, startMs: anchorMs, endMs: anchorMs, zIndex: 0 })
    onSeek(anchorMs)
  }

  // 画布空白处（非控件、非 ruler）按下也可拖拽播放头。控件的 pointerdown 会 stopPropagation，
  // 故只有点到画布本体（e.target === 画布）时才起 scrub。
  function onCanvasPointerDown(e: React.PointerEvent): void {
    if (!onSeek) return
    if (e.target !== e.currentTarget) return
    beginSeek(e)
  }

  // 素材库卡片拖入：x → 时刻（吸附 0.01s）、y → 轨。
  function dropPosFromEvent(e: React.DragEvent): { ms: number; zIndex: number } {
    const rect = timelineRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return { ms: 0, zIndex: 0 }
    const ratio = (e.clientX - rect.left) / rect.width
    const ms = clampMs(snapMs(ratio * maxMs, 10), 0, maxMs)
    const zIndex = rowFromPointerY(e.clientY, rect, trackCount - 1)
    return { ms, zIndex }
  }

  function onCanvasDragOver(e: React.DragEvent): void {
    if (!onDropTemplate || !e.dataTransfer.types.includes(MATERIAL_DND_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDropHint(dropPosFromEvent(e))
  }

  function onCanvasDrop(e: React.DragEvent): void {
    if (!onDropTemplate) return
    const template = e.dataTransfer.getData(MATERIAL_DND_MIME)
    setDropHint(null)
    if (!template) return
    e.preventDefault()
    const { ms, zIndex } = dropPosFromEvent(e)
    onDropTemplate(template, ms, zIndex)
  }

  /** 缩放滑轨点按/拖动：轨道比例 → ZOOM_MIN..ZOOM_MAX 线性映射并吸附 ZOOM_STEP（与滚轮缩放同一 zoom 状态）。 */
  function startZoomScrub(e: ReactPointerEvent<HTMLSpanElement>): void {
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const scrub = (clientX: number): void => {
      const rect = el.getBoundingClientRect()
      const ratio = rect.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0
      const raw = ZOOM_MIN + ratio * (ZOOM_MAX - ZOOM_MIN)
      setZoom(clampZoom(Math.round(raw / ZOOM_STEP) * ZOOM_STEP))
    }
    scrub(e.clientX)
    const onMove = (ev: PointerEvent): void => scrub(ev.clientX)
    const onUp = (): void => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }
  /** 缩放填充比例（0..1），驱动滑轨填充与菱形把手位置。 */
  const zoomRatio = (zoom - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)

  return (
    <div
      className={`mtl-root${editable ? '' : ' is-readonly'}`}
      style={{ '--gc-timeline-h': `${viewportMinHeight}px` } as CSSProperties}
    >
      <div className="gc-materialbar">
        <span className="gc-materialbar-meta">{translateUi('ui.copy.74abb015b780')}</span>
        {onModeChange ? (
          <span className="gc-tl-modeseg" role="group" aria-label={translateUi('ui.copy.641c357fdac6')}>
            <button
              type="button"
              className={activeMode === 'material' ? 'is-on' : ''}
              aria-pressed={activeMode === 'material'}
              onClick={() => onModeChange('material')}
            >
              {translateUi('ui.copy.7359f06cca8f')}</button>
            <button
              type="button"
              className={activeMode === 'audio' ? 'is-on' : ''}
              aria-pressed={activeMode === 'audio'}
              onClick={() => onModeChange('audio')}
            >
              {translateUi('ui.copy.461189f186ab')}</button>
          </span>
        ) : null}
        {activeMode === 'material' && isTimedQteNode ? (
          <span className="gc-materialbar-hint">
            {translateUi('ui.copy.5b273cc2122d')}</span>
        ) : null}
        {activeMode === 'audio' ? (
          <span className="gc-materialbar-hint">{translateUi('ui.copy.5dc1c80929af')}</span>
        ) : null}
        {/* 时间轴缩放控件（Figma 14935:70530）：缩小钮 + 滑轨（白 20% 轨 / 白 80% 填充 / 菱形把手）+ 放大钮，
            布局右置；与 Ctrl/⌘ 滚轮共用同一 zoom 状态。 */}
        <span className="gc-zoomchip" title={translateUi('ui.copy.7c595c253f40')}>
          <button
            type="button"
            aria-label={translateUi('ui.copy.a187b4deb4fd')}
            disabled={zoom <= ZOOM_MIN}
            onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
          >
            <ZoomOutIcon />
          </button>
          <span
            className="gc-zoomtrack"
            role="slider"
            aria-label={translateUi('ui.copy.33158b575eaf')}
            aria-valuemin={ZOOM_MIN}
            aria-valuemax={ZOOM_MAX}
            aria-valuenow={Number(zoom.toFixed(1))}
            onPointerDown={startZoomScrub}
          >
            <span className="gc-zoomfill" style={{ width: `${zoomRatio * 100}%` }} />
            <span className="gc-zoomthumb" style={{ left: `${zoomRatio * 100}%` }}><ScrubCursorIcon /></span>
          </span>
          <button
            type="button"
            aria-label={translateUi('ui.copy.a422f52eb5c6')}
            disabled={zoom >= ZOOM_MAX}
            onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
          >
            <ZoomInIcon />
          </button>
        </span>
      </div>
      <div
        className="gc-mtimeline-viewport"
        ref={timelineViewportRef}
        tabIndex={onDeleteMaterial ? 0 : undefined}
        onKeyDown={onDeleteMaterial ? onViewportKeyDown : undefined}
      >
        <div
          ref={timelineRef}
          className={`gc-mtimeline-canvas${onSeek ? ' is-seekable' : ''}`}
          // 高度只写内容高。「内容矮时填满可视区」交给 CSS `min-height: 100%`——
          // 一旦改成 max(内容高, 视口 clientHeight) 就会自激振荡：clientHeight 被横向
          // 滚动条扣掉 10px → 画布变矮/变高 → 纵向滚动条出现/消失 → clientWidth 又变
          // 10px → canvasPx 变 → 回到第一步，每帧抽动一次并重建帧画面位图。
          style={{ width: `${canvasPx}px`, height: `${canvasHeight}px` }}
          onPointerDown={onSeek ? onCanvasPointerDown : undefined}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onLostPointerCapture={onPointerUp}
          onDragOver={onDropTemplate && activeMode === 'material' ? onCanvasDragOver : undefined}
          onDrop={onDropTemplate && activeMode === 'material' ? onCanvasDrop : undefined}
          onDragLeave={onDropTemplate && activeMode === 'material' ? () => setDropHint(null) : undefined}
        >
          <div
            className={`gc-mtimeline-ruler${onSeek ? ' is-seekable' : ''}`}
            style={{ width: `${canvasPx}px` }}
            onPointerDown={onSeek ? beginSeek : undefined}
          >
            {ruleTicks.map((t) => (
              <span key={t.ms} className="gc-mtick" style={{ left: `${t.ms * pxPerMs}px` }}>
                <span className="gc-mtick-mark" aria-hidden />
                <span className="gc-mtick-label">{t.label}</span>
              </span>
            ))}
          </div>
          {Array.from({ length: trackCount }, (_, i) => (
            <div
              key={`trackline-${i}`}
              className="gc-mtrackline"
              style={{ top: `${rowTop(i) - 1}px`, width: `${canvasPx}px` }}
              aria-hidden
            />
          ))}
          {segments?.map((segment) => (
            <div
              key={segment.id}
              className={`gc-flow-segment${segment.active ? ' is-active' : ''}`}
              style={{
                left: `${segment.startMs * pxPerMs}px`,
                width: `${Math.max(1, (segment.endMs - segment.startMs) * pxPerMs)}px`,
                height: `${canvasHeight}px`,
              }}
              title={`${segment.label} · ${fmtDur(segment.startMs)} - ${fmtDur(segment.endMs)}`}
              aria-hidden
            >
              <span>{segment.label}</span>
            </div>
          ))}
          <div
            className="gc-playhead"
            data-playhead-ms={Math.round(playheadMs)}
            style={{ left: `${playheadMs * pxPerMs}px` }}
            aria-hidden
          >
            <span className="gc-playhead-cursor"><ScrubCursorIcon fill="currentColor" /></span>
          </div>
          {mediaPlayheadTimelineMs != null && mediaPlayheadMaterial ? (
            <div
              className="gc-media-playhead"
              data-media-playhead-ms={Math.round(mediaPlayhead?.localMs ?? 0)}
              style={{
                left: `${mediaPlayheadTimelineMs * pxPerMs}px`,
                top: `${rowTop(mediaPlayheadMaterial.zIndex)}px`,
                height: `${TIMELINE_LAYER_STEP - 2}px`,
              }}
              aria-hidden
            />
          ) : null}
          {settlementMarkers.map((mk) => {
            const dragKey = `${POINT_DRAG_PREFIX}${mk.id}`
            return (
              <div
                key={mk.id}
                className={`gc-point-mark is-settlement${drag?.key === dragKey ? ' is-dragging' : ''}`}
                style={{ left: `${mk.ms * pxPerMs}px` }}
                title={`${mk.label} · ${fmtDur(mk.ms)}（${editable ? translateUi('ui.copy.aeecdac084da') : translateUi('ui.copy.ffc1d065fb53')}）`}
              >
                {/* 参考线只画到菱形：继续精确标出时刻，但不穿过下方时间轴行。 */}
                <span
                  className="gc-point-head"
                  style={{ left: `${pointHeadOffsetPx(mk.ms, maxMs)}px` }}
                  role="slider"
                  tabIndex={editable ? 0 : -1}
                  aria-label={mk.label}
                  aria-valuenow={mk.ms}
                  aria-valuemin={0}
                  aria-valuemax={maxMs}
                  onPointerDown={(e) => {
                    if (!editable || !onPointMarkerChange) return
                    e.preventDefault()
                    e.stopPropagation()
                    timelineRef.current?.setPointerCapture(e.pointerId)
                    setDrag({ key: dragKey, mode: 'move', pointerX: e.clientX, startMs: mk.ms, endMs: mk.ms, zIndex: 0 })
                  }}
                />
              </div>
            )
          })}
          {lifecycleMarkers.length ? (
            <div className="gc-life-lane" style={{ top: `${rowTop(lifecycleTrack)}px`, width: `${canvasPx}px` }} aria-hidden>
              <span className="gc-life-lane-tag">{translateUi('ui.copy.4e43eab8a1bb')}</span>
            </div>
          ) : null}
          {lifecycleMarkers.map((mk) => {
            const dragKey = `${POINT_DRAG_PREFIX}${mk.id}`
            const derived = mk.kind === 'derived' || mk.draggable === false
            return (
              // 竖线 + 效果轨菱形是一体的：包裹层零宽、按 ms 定位，竖线只从顶部画到菱形，
              // 让时刻与上方覆盖物条对齐，同时不干扰菱形下方的时间轴行。
              <div
                key={mk.id}
                className={`gc-point-mark is-lifecycle${derived ? ' is-derived' : ''}${drag?.key === dragKey ? ' is-dragging' : ''}${selectedPointMarkerId === mk.id ? ' is-selected' : ''}`}
                style={{
                  left: `${mk.ms * pxPerMs}px`,
                  height: `${rowTop(lifecycleTrack) + 16}px`,
                }}
              >
                <span
                  className={`gc-life-head${derived ? ' is-derived' : ''}`}
                  style={{
                    left: `${pointHeadOffsetPx(mk.ms, maxMs)}px`,
                    top: `${rowTop(lifecycleTrack) + 16}px`,
                  }}
                  role="slider"
                  tabIndex={selectable || editable ? 0 : -1}
                  aria-label={mk.label}
                  aria-valuenow={mk.ms}
                  aria-valuemin={0}
                  aria-valuemax={maxMs}
                  title={`${mk.label} · ${fmtDur(mk.ms)}${derived ? translateUi('ui.copy.8552d054a40a') : editable ? translateUi('ui.copy.4eeeadf4b926') : translateUi('ui.copy.dc3c1843be2b')}`}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    // 按下即选（与材料条一致）：只想让右侧高亮时不必真的拖动。
                    if (selectable) onSelectPointMarker?.(mk.id)
                    if (derived || !editable || !onPointMarkerChange) return
                    timelineRef.current?.setPointerCapture(e.pointerId)
                    setDrag({ key: dragKey, mode: 'move', pointerX: e.clientX, startMs: mk.ms, endMs: mk.ms, zIndex: 0 })
                  }}
                />
              </div>
            )
          })}
          {spawnGroupList.map((grp) => {
            const topRowTrack = spawnBarTrack(lifecycleTrack, grp.uBase, grp.bars.length - 1)
            const barWidth = (bar: { startMs: number; endMs: number }) =>
              Math.max(CLIP_MIN_PX, (bar.endMs - bar.startMs) * pxPerMs)
            // 条自带最小宽度，组框按实际渲染出的最宽一条量，才不会被短条截断。
            const widestBarPx = Math.max(...grp.bars.map(barWidth))
            // 条高 32 落在 34 的轨距里，故垂直跨度 = (n-1)×轨距 + 条高。
            const barsSpanPx = (grp.bars.length - 1) * TIMELINE_LAYER_STEP + 32
            return (
              <Fragment key={grp.markerId}>
                {/* 虚线组框：把同属一个结算的界面圈成一体，四边留白，不贴着条边。
                    选中宿主菱形时整组一起点亮，作者一眼看出这几行归哪个结算。 */}
                <div
                  className={`gc-spawn-group${selectedPointMarkerId === grp.markerId ? ' is-selected' : ''}`}
                  data-spawn-group={grp.markerId}
                  style={{
                    left: `${grp.startMs * pxPerMs - SPAWN_GROUP_PAD_X}px`,
                    width: `${widestBarPx + SPAWN_GROUP_PAD_X * 2}px`,
                    top: `${rowTop(topRowTrack) - SPAWN_GROUP_PAD_Y}px`,
                    height: `${barsSpanPx + SPAWN_GROUP_PAD_Y * 2}px`,
                  }}
                  aria-hidden
                >
                  <span className="gc-spawn-group-tag">{translateUi('ui.copy.a0f1a8a7c314')}{grp.bars.length}</span>
                </div>
                {grp.bars.map((bar) => {
                  const dragKey = `${SPAWN_END_DRAG_PREFIX}${bar.id}`
                  const width = barWidth(bar)
                  const selected = selectedSpawnBarId === bar.id
                  return (
                    <div
                      key={bar.id}
                      // 复用材料条的视觉基座（gc-mclip）：圆角/高度/底色/左侧色条/选中描边与
                      // 挂载界面条一致，只用 is-spawn 区分配色，避免第二套条样式漂移。
                      className={`gc-mclip is-spawn gc-spawn-bar${bar.openEnded ? ' is-open-ended' : ''}${selected ? ' is-selected' : ''}${drag?.key === dragKey ? ' is-dragging' : ''}`}
                      data-spawn-bar={bar.id}
                      style={{
                        left: `${bar.startMs * pxPerMs}px`,
                        width: `${width}px`,
                        top: `${rowTop(spawnBarTrack(lifecycleTrack, grp.uBase, bar.rowInGroup))}px`,
                      }}
                      aria-label={`${translateUi('ui.template.388da66eba7c')}${bar.label}`}
                      title={`${translateUi('ui.template.388da66eba7c')}${bar.label}${translateUi('ui.template.860bad086cef')}${fmtDur(bar.startMs)}${bar.openEnded ? translateUi('ui.copy.bf6d0dc6a48f') : ` - ${fmtDur(bar.endMs)}`}`}
                      onPointerDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        if (!selectable) return
                        // 先点亮宿主结算，再定位到具体这条界面，右侧表单与预览画布同时对齐。
                        onSelectPointMarker?.(grp.markerId)
                        onSelectSpawnBar?.(bar.id)
                      }}
                    >
                      {width >= CLIP_LABEL_MIN_PX ? <span className="gc-mclip-label">{bar.label}</span> : null}
                      {editable && selected && onDeleteSpawnBar ? (
                        <button
                          type="button"
                          className="gc-mdelete"
                          aria-label={translateUi('ui.copy.eb693060c874')}
                          title={translateUi('ui.copy.8b43f201ff74')}
                          onPointerDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            onDeleteSpawnBar(bar.id)
                          }}
                        >
                          ×
                        </button>
                      ) : null}
                      {editable ? (
                        <button
                          type="button"
                          className="gc-mhandle is-right"
                          aria-label={translateUi('ui.copy.b512850511ac')}
                          onPointerDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            // 调时间不选中（同挂载条手柄），但要暂停：否则播放头会在拖动中继续走。
                            onScrubStart?.()
                            timelineRef.current?.setPointerCapture(e.pointerId)
                            setDrag({
                              key: dragKey,
                              mode: 'end',
                              pointerX: e.clientX,
                              startMs: bar.startMs,
                              endMs: bar.endMs,
                              zIndex: 0,
                            })
                          }}
                        />
                      ) : null}
                    </div>
                  )
                })}
              </Fragment>
            )
          })}
          {/* 条件结算：每个条件独占一轨的行条（↻ 条件 chips → 动作 chips），无固定 ms 故左对齐。 */}
          {conditionMarkers?.map((marker, i) => (
            <button
              key={marker.id}
              type="button"
              className={`gc-condition-band${selectedPointMarkerId === marker.id ? ' is-selected' : ''}`}
              style={{ top: `${rowTop(conditionTrack + i)}px` }}
              title={marker.label}
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (selectable) onSelectPointMarker?.(marker.id)
              }}
              tabIndex={selectable ? 0 : -1}
              aria-disabled={!selectable}
            >
              <CondRefreshIcon />
              {marker.conditionChips.map((chip, ci) => (
                <span key={`c${ci}`} className="gc-cond-chip">{chip}</span>
              ))}
              <CondArrowIcon />
              {marker.actionChips.map((chip, ai) => (
                <span key={`a${ai}`} className="gc-cond-chip">{chip}</span>
              ))}
            </button>
          ))}
          {dropHint ? (
            <div
              className="gc-mdrop"
              style={{ left: `${dropHint.ms * pxPerMs}px`, top: `${rowTop(dropHint.zIndex)}px` }}
              aria-hidden
            >
              <span className="gc-mdrop-time">{fmtDur(dropHint.ms)}</span>
            </div>
          ) : null}
          {activeMode === 'audio'
            ? audioList.map((a) => {
                const left = a.startMs * pxPerMs
                const width = Math.max(6, (a.endMs - a.startMs) * pxPerMs)
                // 音频条：仅显示 + 整体拖动（换轨 / 移时刻），无裁剪把手 / 删除 / marker。
                return (
                  <div
                    key={a.key}
                    className={`gc-mclip is-audio${a.builtin ? ' is-builtin' : ''}`}
                    style={{ left: `${left}px`, width: `${width}px`, top: `${rowTop(a.zIndex)}px` }}
                    onPointerDown={(e) => onPointerDown(e, a, 'move')}
                    title={`${a.label} · ${fmtDur(a.startMs)} - ${fmtDur(a.endMs)}`}
                  >
                    <AudioWaveform src={a.src} width={width} height={TIMELINE_LAYER_STEP - 2} />
                    <span className="gc-audio-label">
                      <span className="gc-audio-ico" aria-hidden>♪</span>
                      {a.label}
                    </span>
                  </div>
                )
              })
            : materials.map((m) => {
                const left = m.startMs * pxPerMs
                const fixedWidth = m.fixedWidthPx != null
                // 下限必须容得下「左手柄 + 中间可拖区 + 右手柄」，否则两个 8px 手柄在窄条上完全重叠，
                // 只有 DOM 靠后的右手柄能被抓到 → 起点永远调不了（CLIP_MIN_PX 见常量注释）。
                const width = fixedWidth
                  ? Math.max(CLIP_MIN_PX, m.fixedWidthPx ?? CLIP_MIN_PX)
                  : Math.max(CLIP_MIN_PX, (m.endMs - m.startMs) * pxPerMs)
                const selected = selectedMaterialKey === m.key
                return (
                  <Fragment key={m.key}>
                    <div
                      className={`gc-mclip ${materialClass(m.kind)}${selected ? ' is-selected' : ''}${m.overridden ? ' is-overridden' : ''}${fixedWidth ? ' is-fixed-width' : ''}${m.locked ? ' is-locked' : ''}`}
                      style={{ left: `${left}px`, width: `${width}px`, top: `${rowTop(m.zIndex)}px` }}
                      onPointerDown={(e) => onPointerDown(e, m, 'move')}
                      aria-label={`${materialDisplayLabel(m)}${m.label ? ` · ${m.label}` : ''}`}
                      title={`${materialDisplayLabel(m)}${m.label ? ` · ${m.label}` : ''} · ${fmtDur(m.startMs)}${fixedWidth ? translateUi('ui.copy.2773f2973ec6') : ` - ${fmtDur(m.endMs)}`}${m.overridden ? translateUi('ui.copy.af171ed1db86') : ''}`}
                    >
                      {editable && !fixedWidth && !m.locked ? (
                        <button className="gc-mhandle is-left" onPointerDown={(e) => onPointerDown(e, m, 'start')} aria-label={translateUi('ui.copy.609664aaf7fc')} />
                      ) : null}
                      {/* 视频条的帧画面层（剪映同款）：左右让出 5.6px 露出双端把手，帧与刻度尺对位。
                          片段级 videoSrc 优先（Flow 多段），否则回落宿主统一 videoSrc（单节点编辑预览）。 */}
                      {m.kind === 'video' ? (
                        <VideoFilmstrip src={m.videoSrc ?? videoSrc} width={width} maxMs={m.endMs - m.startMs} height={40} />
                      ) : null}
                      {/* 窄条上不渲染文字：否则会盖住两侧手柄的点击区（文案仍在 title 里可悬停看）。 */}
                      {width >= CLIP_LABEL_MIN_PX ? (
                        <span className="gc-mclip-label">
                          {materialDisplayLabel(m)}{m.label ? ` · ${m.label}` : ''}
                        </span>
                      ) : null}
                      {editable && !m.locked && selected && onDeleteMaterial && canDeleteMaterial(m.kind) ? (
                        <button
                          type="button"
                          className="gc-mdelete"
                          aria-label={translateUi('ui.copy.5608b1caf5c1')}
                          title={translateUi('ui.copy.c60e283ad48c')}
                          onPointerDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            onDeleteMaterial(m)
                          }}
                        >
                          ×
                        </button>
                      ) : null}
                      {editable && !fixedWidth && !m.locked ? (
                        <button className="gc-mhandle is-right" onPointerDown={(e) => onPointerDown(e, m, 'end')} aria-label={translateUi('ui.copy.9e5a92becbe5')} />
                      ) : null}
                    </div>
                    {m.markerMs != null ? (
                      <button
                        type="button"
                        className={`gc-mmarker${selected ? ' is-selected' : ''}`}
                        style={{ left: `${m.markerMs * pxPerMs}px`, top: `${rowTop(m.zIndex) + 16}px` }}
                        title={`${translateUi('ui.template.3ce593397ecb')}${fmtDur(m.markerMs)}`}
                        aria-label={translateUi('ui.copy.bb4c7cf98404')}
                        onPointerDown={(e) => {
                          if (editable) onPointerDown(e, m, 'marker')
                          else if (selectable) onSelectMaterial(m.key)
                        }}
                      />
                    ) : null}
                  </Fragment>
                )
              })}
          {activeList.length === 0 && <div className="gc-mempty">{activeMode === 'audio' ? translateUi('ui.copy.7cb2804263ff') : emptyHint}</div>}
        </div>
      </div>
    </div>
  )
}

/**
 * 时间轴自带样式。定义自己的 `--gc-*` 变量（带 VAG 主题回落），使得组件在 `.gc-tab`
 * 之外（剧情树抽屉）也能正常上色，不依赖宿主的变量作用域。
 */
const MATERIAL_TIMELINE_CSS = `
.mtl-root {
  --gc-panel2: var(--panel2, #252019);
  --gc-line: var(--line, #403830);
  --gc-line-soft: var(--line-soft, #2e2924);
  --gc-text: var(--txt, #f6f1e9);
  --gc-faint: var(--faint, #8c8377);
  --gc-accent: var(--accent, #f08840);
  --gc-accent-line: var(--accent-line, rgba(240,136,64,.42));
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  min-width: 0;
}
.mtl-root .gc-materialbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
/* Figma 14935:70528：头部标签「控件时间轴」= 白 60%、12px。 */
.mtl-root .gc-materialbar-meta { color: rgba(255,255,255,0.6); font-size: 12px; }
.mtl-root .gc-materialbar-hint { color: rgba(184, 240, 238, 0.72); font-size: 11px; }
.mtl-root .gc-tl-modeseg { display: inline-flex; border: 1px solid var(--gc-accent-line); border-radius: 7px; overflow: hidden; }
.mtl-root .gc-tl-modeseg button {
  border: 0; background: rgba(240,136,64,.12); color: var(--gc-faint);
  padding: 4px 12px; font-size: 11px; line-height: 1; cursor: pointer;
}
.mtl-root .gc-tl-modeseg button + button { border-left: 1px solid var(--gc-accent-line); }
.mtl-root .gc-tl-modeseg button:hover { background: rgba(240,136,64,.24); color: var(--gc-text); }
.mtl-root .gc-tl-modeseg button.is-on { background: var(--gc-accent); color: #1a1206; font-weight: 700; }
.mtl-root .gc-zoomchip {
  display: inline-flex; align-items: center; gap: 4px; margin-left: auto; flex: none;
  height: 21px; padding: 0 10px; box-sizing: border-box;
  border: 1px solid rgba(255,255,255,0.4); border-radius: 4px;
}
.mtl-root .gc-zoomchip button {
  flex: none; width: 16px; height: 16px; padding: 0; border: none; border-radius: 0;
  background: none; color: #fff; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
}
.mtl-root .gc-zoomchip button:hover { background: none; }
.mtl-root .gc-zoomchip button:disabled { opacity: .35; cursor: default; }
/* 滑轨：可视轨 2px（白 20%）+ 填充 3px（白 80%）超出轨道半像素，菱形把手骑填充末端；
   可点区给到 12px 高（设计命中区同理）。 */
.mtl-root .gc-zoomtrack { position: relative; flex: none; width: 112px; height: 12px; cursor: pointer; touch-action: none; }
.mtl-root .gc-zoomtrack::before {
  content: ""; position: absolute; left: 0; right: 0; top: 50%; height: 2px; margin-top: -1px;
  border-radius: 999px; background: rgba(255,255,255,0.2);
}
.mtl-root .gc-zoomfill {
  position: absolute; left: 0; top: 50%; height: 3px; margin-top: -1.5px;
  border-radius: 999px; background: rgba(255,255,255,0.8); pointer-events: none;
}
.mtl-root .gc-zoomthumb {
  position: absolute; top: 50%; transform: translate(-50%, -50%); width: 10px; height: 10px; pointer-events: none;
}
.mtl-root .gc-mtimeline-viewport {
  position: relative;
  /* 默认占满宿主剩余竖直空间（宿主经 flex 链给定界）；轨道内容超出时才出现纵向滚动条。
     无外界定界时回落到 6 轨下限高度，行为与旧固定高度一致。 */
  flex: 1 1 auto;
  min-height: var(--gc-timeline-h, 240px);
  border-radius: 10px;
  border: 1px solid var(--gc-line-soft);
  background: rgba(0,0,0,0.22);
  overflow: auto;
  /* 刻意不用 scrollbar-gutter: stable —— 常驻沟槽会破坏设计稿的时间轴观感。
     滚动条显隐引起的宽度自激振荡改由 latchViewportWidth 在测量侧收敛。 */
  overscroll-behavior: contain;
}
.mtl-root .gc-mtimeline-canvas {
  position: relative;
  min-width: 100%;
  min-height: 100%;
  touch-action: none;
  /* 右缘装饰（播放头游标半个头、绑定界面组标签等）不得挤出可滚动宽度：
     否则播放到结尾时会凭空冒出横向滚动条，再牵动纵向滚动条一起抽动。
     clip 不建立滚动容器，sticky 刻度尺仍以视口为吸附参考。 */
  overflow-x: clip;
  /* 关掉滚动锚定：内容增长（新片段 / 帧画面就绪）时浏览器别自行改 scrollLeft，
     否则会与播放头跟随互相打架。 */
  overflow-anchor: none;
}
.mtl-root .gc-mtimeline-canvas.is-seekable { cursor: text; }
.mtl-root.is-readonly .gc-mtimeline-canvas.is-seekable,
.mtl-root.is-readonly .gc-mtimeline-ruler.is-seekable { cursor: ew-resize; }
.mtl-root .gc-mtimeline-viewport:focus-visible { outline: 1px solid var(--gc-accent-line); outline-offset: -1px; }
.mtl-root .gc-mtimeline-ruler {
  position: sticky;
  left: 0; top: 0; height: 22px;
  /* Figma 15635:85018：暖色 4% 罩层叠 #232323（纵向滚动时仍盖住下方轨道），底边白 4%。 */
  border-bottom: 1px solid rgba(255,255,255,0.04);
  background: linear-gradient(rgba(187,112,65,0.04), rgba(187,112,65,0.04)), #232323;
  z-index: 6;
}
.mtl-root .gc-mtimeline-ruler.is-seekable { cursor: pointer; }
.mtl-root .gc-mtrackline {
  position: absolute;
  left: 0;
  height: 0;
  /* Figma 14597:20814：轨道行底线 = 白 3%。 */
  border-top: 1px solid rgba(255,255,255,0.03);
  pointer-events: none;
  z-index: 1;
}
.mtl-root .gc-flow-segment {
  position: absolute;
  top: 0;
  box-sizing: border-box;
  border-right: 1px solid rgba(184,174,160,.3);
  background: rgba(255,255,255,.018);
  pointer-events: none;
  z-index: 0;
}
.mtl-root .gc-flow-segment:nth-of-type(even) { background: rgba(255,255,255,.032); }
.mtl-root .gc-flow-segment.is-active {
  background: rgba(240,136,64,.065);
  border-right-color: rgba(240,136,64,.45);
}
.mtl-root .gc-flow-segment > span {
  position: absolute;
  top: 23px;
  left: 5px;
  right: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(184,174,160,.72);
  font-size: 9px;
  line-height: 10px;
}
.mtl-root .gc-flow-segment.is-active > span { color: #f5bd75; }
/* Figma 15635:85018：刻度 = 顶部短竖线（白 20%）+ 下方标签（9.5px 白 25%），堆叠结构。 */
.mtl-root .gc-mtick {
  position: absolute;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  pointer-events: none;
  white-space: nowrap;
}
.mtl-root .gc-mtick-mark {
  width: 1px;
  height: 7.5px;
  background: rgba(255,255,255,0.2);
}
.mtl-root .gc-mtick-label {
  margin-left: 2px;
  font-size: 9.5px;
  line-height: 10.5px;
  color: rgba(255,255,255,0.25);
  font-variant-numeric: tabular-nums;
}
/* Figma 14947:80565：竖线 = 1px、rgba(255,198,42,.6)，设计上不带光晕（故显式 box-shadow: none
   压掉 catalogCss 的橙色外发光）。1px 线用 -0.5px 偏移才落在时刻正中。 */
.mtl-root .gc-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  transform: translateX(-0.5px);
  background: rgba(255,198,42,0.6);
  box-shadow: none;
  z-index: 8;
  pointer-events: none;
}
/* 压掉 catalogCss 的橙色圆点头：头部形状改由 .gc-playhead-cursor 里的游标 SVG 承担。 */
.mtl-root .gc-playhead::before { content: none; }
/* 头部游标：设计稿没给播放头头部，沿用缩放滑轨把手的尖角形状（ScrubCursorIcon），
   取竖线同色好读成一个整体——竖线 60% 不透明，头部满色以便抓得住视线。 */
.mtl-root .gc-playhead-cursor {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 10px;
  height: 10px;
  color: #ffc62a;
  pointer-events: none;
}
.mtl-root .gc-media-playhead {
  position: absolute;
  width: 2px;
  transform: translateX(-1px);
  background: #78b7ff;
  box-shadow: 0 0 9px rgba(95,163,247,.9);
  z-index: 9;
  pointer-events: none;
}
.mtl-root .gc-media-playhead::before {
  content: "";
  position: absolute;
  top: -3px;
  left: 50%;
  transform: translateX(-50%);
  width: 7px;
  height: 7px;
  border-radius: 2px;
  background: #78b7ff;
}
/* 节点级时刻标记：菱形上方的竖虚线 + 可拖菱形。与橙色播放头刻意区分——播放头是"现在播到哪"，
   这些是"这一刻会发生一件事"。路由结算=蓝紫，动作结算=嫩绿；两种菱形错开高度，
   同一 ms 上重合时也还能各自抓到。 */
.mtl-root .gc-point-mark {
  position: absolute;
  top: 0;
  height: 10px;
  width: 0;
  z-index: 7;
  pointer-events: none;
  border-left: 1px dashed currentColor;
}
.mtl-root .gc-point-mark.is-settlement { color: rgba(147,163,247,.85); }
/* 动作结算竖线比路由结算淡一档：一个节点可能有多条结算，避免时间轴过于杂乱。
   嫩绿视觉来源 Figma 14947:80568。 */
.mtl-root .gc-point-mark.is-lifecycle { color: rgba(185,215,156,.55); }
.mtl-root .gc-point-head {
  position: absolute;
  left: 0;
  top: 4px;
  width: 11px;
  height: 11px;
  transform: translateX(-50%) rotate(45deg);
  background: currentColor;
  border: 1px solid #1b1713;
  cursor: ew-resize;
  pointer-events: auto;
}
.mtl-root.is-readonly .gc-point-head,
.mtl-root.is-readonly .gc-life-head,
.mtl-root.is-readonly .gc-mclip,
.mtl-root.is-readonly .gc-mmarker,
.mtl-root.is-readonly .gc-condition-band { cursor: default; }
.mtl-root .gc-condition-band[aria-disabled="true"] { pointer-events: none; }
.mtl-root .gc-point-head:hover,
.mtl-root .gc-point-mark.is-dragging .gc-point-head {
  filter: brightness(1.35);
  box-shadow: 0 0 12px currentColor;
}
.mtl-root .gc-point-mark.is-dragging { border-left-style: solid; }

/* 结算绑定界面：组框圈住同一结算下的全部界面，条本身只有右手柄（起点归菱形）。
   与结算菱形同属一个视觉簇，同用嫩绿（Figma 14947:80568）。 */
.mtl-root .gc-spawn-group {
  position: absolute;
  border: 1px dashed rgba(185,215,156,.45);
  border-radius: 6px;
  background: rgba(103,151,58,.06);
  pointer-events: none;
  z-index: 1;
}
/* 宿主菱形被选中：整组连同标签一起提亮，与菱形的选中态同步。 */
.mtl-root .gc-spawn-group.is-selected {
  border-color: rgba(214,237,189,.95);
  background: rgba(103,151,58,.16);
  box-shadow: 0 0 12px rgba(185,215,156,.3);
}
.mtl-root .gc-spawn-group.is-selected .gc-spawn-group-tag { color: #f2f9e8; }
/* 标签放在组框右外侧、纵向居中：框现在上下平铺，标签若压在框顶就会盖住上一组。
   右侧那片区域一定是空的——每行只有一条界面，行也从不共用。 */
.mtl-root .gc-spawn-group-tag {
  position: absolute;
  left: 100%;
  top: 50%;
  transform: translateY(-50%);
  margin-left: 5px;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--gc-panel2);
  color: rgba(214,237,189,.9);
  font-size: 10px;
  white-space: nowrap;
}
/* 绑定界面条：配色与挂载界面条同源（见 .is-mount 规则），只多一个层级压在组框之上。
   它属于「界面」这条视觉线；归属哪个结算由虚线组框和位置表达，不靠改色。 */
.mtl-root .gc-mclip.is-spawn {
  z-index: 2;
  cursor: pointer;
}
.mtl-root .gc-mclip.is-spawn.is-dragging { border-color: var(--gc-accent); }
/* 常驻界面没有确定的结束时刻：右端以虚线 + 渐隐开口表达「一直到节点结束」。 */
.mtl-root .gc-mclip.is-spawn.is-open-ended {
  border-right-style: dashed;
  mask-image: linear-gradient(to right, #000 0%, #000 72%, rgba(0,0,0,.25) 100%);
}
/* 选中态要露出条外的解除绑定按钮，遮罩会把它裁掉，所以选中时撤掉遮罩。 */
.mtl-root .gc-mclip.is-spawn.is-open-ended.is-selected { mask-image: none; }
.mtl-root.is-readonly .gc-mclip.is-spawn { cursor: default; }

/* 结算轨：独占材料轨之后的一行；定时/推导时刻显示菱形。（视觉：Figma 14947:80568） */
.mtl-root .gc-life-lane {
  position: absolute;
  left: 0;
  height: 26px;
  margin-top: 4px;
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 4px;
  background: rgba(103,151,58,.1);
  pointer-events: none;
  z-index: 1;
}
.mtl-root .gc-life-lane-tag {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 10px;
  color: rgba(255,255,255,.6);
  letter-spacing: .04em;
  white-space: nowrap;
  pointer-events: none;
}
.mtl-root .gc-life-head {
  position: absolute;
  left: 0;
  width: 13px;
  height: 13px;
  transform: translate(-50%, -50%) rotate(45deg);
  background: #b9d79c;
  border: 1px solid #1f2416;
  box-shadow: 0 0 8px rgba(185,215,156,.55);
  cursor: ew-resize;
  pointer-events: auto;
  z-index: 6;
}
.mtl-root .gc-life-head:hover,
.mtl-root .gc-point-mark.is-dragging .gc-life-head,
.mtl-root .gc-point-mark.is-selected .gc-life-head {
  background: #d6edbd;
  box-shadow: 0 0 14px rgba(185,215,156,.95);
}
/* 选中：菱形加白边，竖线仍保持虚线，只提高对比度与右侧高亮配置块对应。 */
.mtl-root .gc-point-mark.is-selected .gc-life-head { border-color: #f6f1e9; }
.mtl-root .gc-point-mark.is-selected { border-left-style: dashed; color: rgba(185,215,156,.9); }
.mtl-root .gc-point-mark.is-derived { color: rgba(185,215,156,.62); }
.mtl-root .gc-life-head.is-derived {
  background: rgba(26,32,18,.92);
  border: 2px solid currentColor;
  box-shadow: none;
  cursor: pointer;
}
.mtl-root .gc-point-mark.is-derived:hover .gc-life-head,
.mtl-root .gc-point-mark.is-derived.is-selected .gc-life-head {
  background: rgba(185,215,156,.18);
  border-color: #e9f5d6;
  box-shadow: 0 0 10px rgba(185,215,156,.65);
}
/* 条件结算：每个条件独占一轨的行条——↻ 条件 chips → 动作 chips（视觉 Figma 14947:80577）。
   无固定 ms 坐标，条身按内容宽度左对齐，纵向与 34px 轨距居中。 */
.mtl-root .gc-condition-band {
  position: absolute;
  left: 4px;
  height: 26px;
  margin-top: 4px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: calc(100% - 8px);
  padding: 0 12px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 4px;
  background: rgba(103,151,58,.1);
  color: rgba(255,255,255,.6);
  font-size: 10px;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  z-index: 2;
}
.mtl-root .gc-cond-chip {
  flex: none;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(255,255,255,.05);
  line-height: 1.5;
}
.mtl-root .gc-condition-band:hover,
.mtl-root .gc-condition-band.is-selected {
  border-color: rgba(214,237,189,.95);
  background: rgba(103,151,58,.18);
  color: #f2f9e8;
  box-shadow: 0 0 10px rgba(185,215,156,.28);
}
.mtl-root .gc-mdrop {
  position: absolute;
  width: 3px;
  height: 32px;
  margin-left: -1px;
  border-radius: 2px;
  background: var(--gc-accent);
  box-shadow: 0 0 10px rgba(240,136,64,.85);
  z-index: 9;
  pointer-events: none;
}
.mtl-root .gc-mdrop::before {
  content: "＋";
  position: absolute;
  top: -9px;
  left: 50%;
  transform: translateX(-50%);
  width: 16px;
  height: 16px;
  line-height: 15px;
  text-align: center;
  border-radius: 50%;
  background: var(--gc-accent);
  color: #1b1206;
  font-size: 12px;
  font-weight: 700;
}
.mtl-root .gc-mdrop-time {
  position: absolute;
  bottom: -18px;
  left: 50%;
  transform: translateX(-50%);
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(20,16,12,0.94);
  color: var(--gc-accent);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.mtl-root .gc-mempty {
  position: absolute;
  inset: 22px 0 0;
  display: flex; align-items: center; justify-content: center;
  color: var(--gc-faint);
  font-size: 13px;
}
/* Figma 14597:20860：材料条统一橙族——底 rgba(232,134,74,.25)、白 8% 描边、圆角 4、高 25.5，
   两端 5.6px 橙把手。把手用背景渐变图层绘制：背景被容器 border-radius 裁切，
   外角自然带圆弧、内缘笔直（对齐 14947:80551 的 border-radius: 3.731px 0 0 3.731px）；
   不占伪元素（::after 留给覆盖标记）、无 inset 阴影的角部鼓包。选中态白 80% 描边（14597:20875）。
   translateY(4px)：25.5 的条在 34 轨距里垂直居中。 */
.mtl-root .gc-mclip {
  position: absolute;
  top: 42px;
  height: 25.5px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 0 8px 0 9px;
  color: rgba(255,255,255,0.85);
  font-size: 10.5px;
  font-weight: 500;
  cursor: grab;
  user-select: none;
  background:
    linear-gradient(to right, rgba(232,134,74,0.7), rgba(232,134,74,0.7)) left top / 5.6px 100% no-repeat,
    linear-gradient(to right, rgba(232,134,74,0.7), rgba(232,134,74,0.7)) right top / 5.6px 100% no-repeat,
    linear-gradient(to right, rgba(232,134,74,0.25), rgba(232,134,74,0.25));
  background-clip: padding-box;
  border: 1px solid rgba(255,255,255,0.08);
  overflow: hidden;
  transform: translateY(4px);
}
.mtl-root .gc-mclip:active { cursor: grabbing; }
/* 压住 catalogCss 的默认件：左侧色条伪元素与选中橙色 outline 都属于旧暖色族，全部归零。 */
.mtl-root .gc-mclip::before { content: none; }
.mtl-root .gc-mclip.is-locked { cursor: ew-resize; }
.mtl-root .gc-mclip.is-locked:active { cursor: ew-resize; }
.mtl-root .gc-mclip.is-selected { border-color: rgba(255,255,255,0.8); outline: none; overflow: visible; }
.mtl-root .gc-mclip.is-overridden { overflow: visible; }
.mtl-root .gc-mclip.is-overridden::after {
  content: "";
  position: absolute;
  top: -3px;
  left: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ffd54a;
  box-shadow: 0 0 6px rgba(255,213,74,.85), 0 0 0 1px rgba(0,0,0,.4);
  pointer-events: none;
}
.mtl-root .gc-mmarker {
  position: absolute;
  width: 12px;
  height: 12px;
  margin-left: -6px;
  margin-top: -6px;
  padding: 0;
  transform: rotate(45deg);
  background: #ffd54a;
  border: 1px solid rgba(0,0,0,0.45);
  box-shadow: 0 0 8px rgba(255,213,74,0.75);
  cursor: ew-resize;
  z-index: 7;
}
.mtl-root .gc-mmarker:hover,
.mtl-root .gc-mmarker.is-selected { background: #fff08a; box-shadow: 0 0 10px rgba(255,213,74,0.95); }
.mtl-root .gc-mclip.is-audio {
  border-color: rgba(96,214,196,.55); color: #cdfff4;
  /* 波形未解出/无音轨时的兜底底纹；把手与主体同色（设计未覆盖音频轨，保持原族） */
  background:
    linear-gradient(to right, rgba(79,214,192,.7), rgba(79,214,192,.7)) left top / 5.6px 100% no-repeat,
    linear-gradient(to right, rgba(79,214,192,.7), rgba(79,214,192,.7)) right top / 5.6px 100% no-repeat,
    linear-gradient(rgba(16,34,32,.94), rgba(16,34,32,.94)),
    repeating-linear-gradient(90deg, rgba(20,40,38,.9) 0 6px, rgba(26,52,49,.9) 6px 12px);
  background-clip: padding-box;
  justify-content: flex-start;
  padding: 0 6px;
}
.mtl-root .gc-mclip.is-audio.is-builtin { border-style: dashed; }
/* 视频条与界面块同款结构（双端 5.6 把手 + ⬟ 前缀 + 圆角/高度），色调保持原蓝色媒体族：
   把手 #5fa3f7 70%、底 rgba(38,70,108,.42)；常态不出描边（界面块亦选中态才显边框），
   locked 不可调，把手仅作风格标识。 */
.mtl-root .gc-mclip.is-video:not(.is-selected) {
  border-color: transparent;
  color: #dcecff;
  height: 40px;
  background:
    linear-gradient(to right, rgba(95,163,247,.7), rgba(95,163,247,.7)) left top / 5.6px 100% no-repeat,
    linear-gradient(to right, rgba(95,163,247,.7), rgba(95,163,247,.7)) right top / 5.6px 100% no-repeat,
    linear-gradient(to right, rgba(38,70,108,.42), rgba(38,70,108,.42));
  background-clip: padding-box;
}
.mtl-root .gc-mclip.is-video .gc-mclip-label::before { color: #5fa3f7; }
/* 帧画面层：左右让出 5.6px 露出媒体条双端把手；透明背景（抽帧完成前透出底色）。
   canvas 是 replaced element：width:auto 时 left/right 不拉伸、回退固有尺寸（backing/DPR），
   必须显式 calc 宽度，否则胶片永远只有一小条、缩放也不跟随。 */
.mtl-root .gc-filmstrip {
  position: absolute;
  top: 0; bottom: 0; left: 5.6px;
  width: calc(100% - 11.2px); height: 100%;
  pointer-events: none;
  z-index: 0;
}
/* 标签压胶片：提到胶片之上（把手 z4 之下），加阴影保持可读。 */
.mtl-root .gc-mclip.is-video .gc-mclip-label {
  position: relative;
  z-index: 2;
  text-shadow: 0 1px 3px rgba(0,0,0,.85);
}
.mtl-root .gc-audio-wave {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  pointer-events: none;
  z-index: 1;
}
.mtl-root .gc-audio-label {
  position: relative; z-index: 3;
  display: inline-flex; align-items: center; gap: 5px;
  max-width: calc(100% - 8px);
  padding: 1px 7px; border-radius: 6px;
  background: rgba(6,20,18,.5);
  font-size: 11px; line-height: 1.5;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.mtl-root .gc-audio-ico { font-size: 12px; opacity: .85; }
/* 条内文字自持裁剪（父层 padding 收窄时省略号，而不是溢出压住手柄）。
   Figma 14597:20860：标签前缀 = 五边形 ⬟（#e8864a 7.5px），文案 PingFang Medium 白 85%；
   ⬟ 与文字垂直居中对齐并微偏上（设计：图标中心在文字中心上方 ~1px）。 */
.mtl-root .gc-mclip-label {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  pointer-events: none;
}
.mtl-root .gc-mclip-label::before {
  content: "⬟";
  color: #e8864a;
  font-size: 7.5px;
  margin-right: 3px;
  vertical-align: middle;
  position: relative;
  top: -0.5px;
}
/* 手柄必须压在文字之上（z-index）才保证窄条上也能抓到；把手的橙色由条体 inset 阴影绘出，
   手柄本体只留命中区（透明），hover 微亮给出可拖提示。 */
.mtl-root .gc-mhandle {
  position: absolute;
  top: 0; bottom: 0;
  width: 8px;
  border: 0;
  padding: 0;
  z-index: 4;
  background: transparent;
  cursor: ew-resize;
}
.mtl-root .gc-mhandle:hover { background: rgba(255,255,255,0.18); }
.mtl-root .gc-mhandle.is-left { left: 0; border-radius: 4px 0 0 4px; }
.mtl-root .gc-mhandle.is-right { right: 0; border-radius: 0 4px 4px 0; }
.mtl-root .gc-mdelete {
  position: absolute;
  top: -8px;
  right: -8px;
  z-index: 3;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.4);
  background: #d64545;
  color: #fff;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.4);
}
.mtl-root .gc-mdelete:hover { background: #e35a5a; }
`
