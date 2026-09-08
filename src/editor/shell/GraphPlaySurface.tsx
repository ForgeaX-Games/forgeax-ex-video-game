import { t as translateUi } from '../../i18n'
/**
 * GraphPlaySurface —— 新引擎「试玩」整表面（对齐旧 BlueprintPlayer 的试玩交互，用新引擎渲染）。
 *
 * 主区 = 新引擎（GraphSession）跑出的视频游戏：视频演出 + 表现叠层 + 交互层 + HUD 血条 + 结局横幅。
 * 底部悬浮**控制条**（蓝图 / 暂停 / 重开 / 声音 / 倍速 / 时间 / 全屏）。
 * 「蓝图」是**可拖拽 + 可缩放**浮层（对齐旧 DraggablePanel），复用 GraphCanvas，
 * 实时高亮当前节点/已走边，点节点=jump 执行，只读（不改图、不出节点配置、不出画布视口控件）。
 * 数据来自共享 graphScenario store（与蓝图/视频/界面/规则同源）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import fullscreenIcon from '@/editor/ui-assets/video-control-fullscreen.svg?url'
import type { GameScenario } from '@/runtime/core/schema/graph-schema'
import { GraphSession, type SessionSnapshot } from '@/runtime/core/engine/session'
import { createSessionSeed } from '@/runtime/react/play/sessionSeed'
import { GraphCanvas } from '@/editor/graph/canvas/GraphCanvas'
import { PlayerRootContext, type SkinCtx } from '@/runtime/react/component-host/rendererRegistry'
import { createCoreSkinRegistry } from '@/runtime/react/component-host'
import { claimPlayerFocus, releasePlayerFocus } from '@/runtime/react/input/playerFocus'
import { bootEditorSkins } from '../init'
import { resolveCatalogMediaSrc } from './media'
import { useAssetCatalog } from '@/editor/assets/asset-catalog'
import { BgmPlayer, GameStage, PlaybackClockProvider, useClipPerformanceEnd, useControlledPlaybackTimeout } from '@/runtime/react/play'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { useRevealOnScopeChange } from './useRevealOnScopeChange'
import { getSubFlowPack, getSubProcess } from '@/runtime/core/schema/graph-schema'
import {
  blueprintBreadcrumbs,
  deepestCallerOnBlueprint,
} from './call-stack-view'
import { graphPathLabels, resolveGraphAtPath } from '@/authoring/graph/graph-scope'
import { runtimeRuleSignature } from './runtime-rule-signature'
import { formatPlayClock, resolveClipDurationMs } from './playClipClock'
import { resolveBlueprintPanelBox } from './blueprintPanelBox'
import { videoOptionsFromCatalog } from './videoOptionsFromCatalog'
import { playToggleShowsPlay, resolvePlayToggleAction } from './playToggle'
import { injectStyleOnce } from '@/editor/styles/injectStyle'

const GRAPH_PLAY_SURFACE_CSS = `
.gv-play-control:hover { color: #FF9C2A !important; }
/* 悬浮只提亮底色、文字保持原色：选中橙字是「谁在播」，hover 灰底是「指到哪」，两个信号分开。 */
.gv-play-menu-item:hover { background: rgba(255,255,255,0.20) !important; }
/* 芯片按钮的悬浮只提亮底色：选中与否由文字/图标的橙色说了算，两套信号别打架。 */
.gv-play-chip:hover { background: rgba(255,255,255,0.18) !important; }
/* 竖排 range：新浏览器走 writing-mode，旧 WebKit 只认 -webkit-appearance。 */
.gv-play-volume-slider {
  writing-mode: vertical-lr;
  direction: rtl;
  -webkit-appearance: slider-vertical;
  appearance: slider-vertical;
  width: 6px;
  height: 120px;
  accent-color: #FF9C2A;
  cursor: pointer;
}
`

injectStyleOnce('graph-play-surface-controls', GRAPH_PLAY_SURFACE_CSS)

/** 进场音量：常规播放器口径的一半档位，既不吓人也不用先去找开关。 */
const DEFAULT_VOLUME = 50

/** 默认倍速；触发器只在偏离它时才亮橙，表示「作者动过速度」。 */
const DEFAULT_PLAYBACK_RATE = 1

/** 「蓝图」按钮左侧的两节点连线图标；描边走 `currentColor`，选中态才随文字变橙。 */
function BlueprintChipIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="0.993378" y="1.34192" width="4.37898" height="6.31152" stroke="currentColor" strokeWidth="1.17" />
      <rect x="8.62766" y="6.34656" width="4.37898" height="6.31152" stroke="currentColor" strokeWidth="1.17" />
      <path d="M5.37227 4.49768H7.043V9.50232H8.62769" stroke="currentColor" strokeWidth="1.17" />
    </svg>
  )
}

/** 控制条图标的统一出图口径：设计稿 18683_228810 里三枚都是 24 盒，按 20px 出与喇叭同高，避免小一圈。 */
const PLAY_BAR_ICON_SIZE = 20

/** 播放态实心三角。设计稿只给了暂停柱（1.svg），三角沿用同盒同色实心补齐 toggle 的另一半。 */
function PlayTriangleIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" width={PLAY_BAR_ICON_SIZE} height={PLAY_BAR_ICON_SIZE} viewBox="0 0 24 24" fill="none">
      <path d="M8 5L19 12L8 19Z" fill="currentColor" />
    </svg>
  )
}

/** 设计稿 18683_228810 1.svg：两根实心暂停柱。 */
function PlayPauseBarIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" width={PLAY_BAR_ICON_SIZE} height={PLAY_BAR_ICON_SIZE} viewBox="0 0 24 24" fill="none">
      <path d="M6 3H9V21H6V3Z" fill="currentColor" />
      <path d="M15 3H18V21H15V3Z" fill="currentColor" />
    </svg>
  )
}

/** 设计稿 18683_228810 2.svg：实心环形重播箭头。 */
function PlayReplayIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" width={PLAY_BAR_ICON_SIZE} height={PLAY_BAR_ICON_SIZE} viewBox="0 0 24 24" fill="none">
      <path d="M11.5261 21C16.2345 21 20.0524 16.97 20.0524 12L22.8945 12L19.2093 8.11L19.143 7.97L15.3156 12L18.1577 12C18.1577 15.87 15.1924 19 11.5261 19C7.85979 19 4.89453 15.87 4.89453 12C4.89453 8.13 7.8598 5 11.5261 5C13.3545 5 15.0124 5.79 16.2061 7.06L17.5514 5.64C16.0072 4.01 13.8851 3 11.5261 3C6.81769 3 2.99979 7.03 2.99979 12C2.99979 16.97 6.81769 21 11.5261 21Z" fill="currentColor" />
    </svg>
  )
}

/** 设计稿 18683_228810 3.svg：有声喇叭。橙色悬浮态交给 `.gv-play-control:hover`，描边走 currentColor。 */
function PlayVolumeIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" width={PLAY_BAR_ICON_SIZE} height={PLAY_BAR_ICON_SIZE} viewBox="0 0 24 24" fill="none">
      <path d="M5.99882 16.5H2V7.5H5.99882M5.99882 16.5L14 21V3L5.99882 7.5M5.99882 16.5V7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
      <path d="M17.9902 13.5059C18.3184 13.0719 18.4961 12.5428 18.4963 11.9987C18.4965 11.4546 18.3192 10.9254 17.9913 10.4912M20.7813 15.618C21.5689 14.5765 21.9953 13.3066 21.9957 12.0008C21.9962 10.6951 21.5707 9.42481 20.7838 8.38281" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
    </svg>
  )
}

/** 静音喇叭（音量拖到 0）。 */
function PlayVolumeMutedIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" width={PLAY_BAR_ICON_SIZE} height={PLAY_BAR_ICON_SIZE} viewBox="0 0 24 24" fill="none">
      <path d="M5.99882 16.5H2V7.5H5.99882M5.99882 16.5L14 21V3L5.99882 7.5M5.99882 16.5V7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
      <path d="M22.1215 9.87891L20.0002 12.0002M20.0002 12.0002L17.8789 14.1215M20.0002 12.0002L17.8789 9.87891M20.0002 12.0002L22.1215 14.1215" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
    </svg>
  )
}

// ── 可拖拽 + 可缩放浮层（对齐旧 BlueprintPlayer DraggablePanel）──────────────────
type Gesture = { type: 'move'; ox: number; oy: number } | { type: 'resize'; sx: number; sy: number; sw: number; sh: number }
function DraggablePanel({ title, initial, onClose, children }: { title: ReactNode; initial: { x: number; y: number; w: number; h: number }; onClose: () => void; children: ReactNode }): JSX.Element {
  const [box, setBox] = useState(initial)
  const g = useRef<Gesture | null>(null)
  const [closeHover, setCloseHover] = useState(false)
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const gg = g.current
      if (!gg) return
      if (gg.type === 'move') setBox((b) => ({ ...b, x: Math.max(0, e.clientX - gg.ox), y: Math.max(0, e.clientY - gg.oy) }))
      else setBox((b) => ({ ...b, w: Math.max(280, gg.sw + (e.clientX - gg.sx)), h: Math.max(200, gg.sh + (e.clientY - gg.sy)) }))
    }
    const onUp = () => { g.current = null }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [])
  return (
    <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, zIndex: 20, borderRadius: 8, background: '#232323', boxShadow: '0 10px 40px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div
        onPointerDown={(e) => { g.current = { type: 'move', ox: e.clientX - box.x, oy: e.clientY - box.y } }}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52, padding: '0 10px 0 20px', background: '#2C2C2C', fontSize: 16, color: 'rgba(255,255,255,0.80)', cursor: 'move', userSelect: 'none', flex: 'none' }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>{title}</div>
        <button
          type="button"
          aria-label={translateUi('ui.copy.6c14bd7f6f9e')}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
          onMouseEnter={() => setCloseHover(true)}
          onMouseLeave={() => setCloseHover(false)}
          style={{ flex: 'none', width: 24, height: 24, padding: 0, border: 'none', borderRadius: 4, background: closeHover ? 'rgba(255,255,255,0.1)' : 'none', color: '#FFFFFF', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M16.9503 7.05029L12.0005 12M12.0005 12L7.05078 16.9498M12.0005 12L16.9503 16.9498M12.0005 12L7.05078 7.05029" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
          </svg>
        </button>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>{children}</div>
      <div
        title={translateUi('ui.copy.b8e25986d9d8')}
        onPointerDown={(e) => { e.stopPropagation(); g.current = { type: 'resize', sx: e.clientX, sy: e.clientY, sw: box.w, sh: box.h } }}
        style={{ position: 'absolute', right: 2, bottom: 2, width: 16, height: 16, cursor: 'nwse-resize', borderRight: '2px solid #f08840', borderBottom: '2px solid #f08840', borderRadius: '0 0 5px 0' }}
      />
    </div>
  )
}

export function GraphPlaySurface({ scenario: _scenario }: { scenario: GameScenario }): JSX.Element {
  bootEditorSkins()
  const game = useGraphScenario((s) => s.game)
  const { catalog: assetCatalog } = useAssetCatalog(game)
  // 浮层里的画布和编辑器是同一个 GraphCanvas：不喂这份候选表，「演出」行只能显示 media.ref 原始 id。
  const videoOptions = useMemo(() => videoOptionsFromCatalog(assetCatalog), [assetCatalog])
  const graph = useGraphScenario((s) => s.graph)
  const blueprints = useGraphScenario((s) => s.blueprints)
  const mainBlueprintId = useGraphScenario((s) => s.mainBlueprintId)
  const overlays = useGraphScenario((s) => s.meta.ui?.overlays)
  const entities = useGraphScenario((s) => s.meta.entities)
  const variables = useGraphScenario((s) => s.meta.variables)
  const ready = graph.nodes.length > 0

  const [restartKey, setRestartKey] = useState(0)
  const [playRootBlueprintId, setPlayRootBlueprintId] = useState(mainBlueprintId)
  const [blueprintMenuOpen, setBlueprintMenuOpen] = useState(false)
  const [paused, setPaused] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(DEFAULT_PLAYBACK_RATE)
  const [activeVideo, setActiveVideo] = useState<HTMLVideoElement | null>(null)
  const [videoDurationMs, setVideoDurationMs] = useState<number>()
  const [currentMs, setCurrentMs] = useState(0)
  const currentMsRef = useRef(0)
  const [rateMenuOpen, setRateMenuOpen] = useState(false)
  /** 主音量 0..100。默认 50 = 常规播放器观感：进场就有声，拖到 0 才算静音。 */
  const [volume, setVolume] = useState(DEFAULT_VOLUME)
  const [volumeMenuOpen, setVolumeMenuOpen] = useState(false)
  const [showBlueprint, setShowBlueprint] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [viewMode, setViewMode] = useState<'follow' | 'pinned'>('follow')
  const [pinnedBlueprintId, setPinnedBlueprintId] = useState<string>()
  const [pinnedDrillPath, setPinnedDrillPath] = useState<string[]>([])
  const sessionRef = useRef<GraphSession | null>(null)
  const rootBlueprintIdRef = useRef(mainBlueprintId)
  const [snap, setSnap] = useState<SessionSnapshot | null>(null)
  const skins = createCoreSkinRegistry()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const blueprintMenuRef = useRef<HTMLDivElement | null>(null)
  const rateMenuRef = useRef<HTMLDivElement | null>(null)
  const volumeMenuRef = useRef<HTMLDivElement | null>(null)
  const [rootEl, setRootEl] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const el = rootRef.current
    setRootEl(el)
    if (el) claimPlayerFocus(el)
    return () => releasePlayerFocus(el)
  }, [])
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === rootRef.current)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])
  useEffect(() => {
    setPlayRootBlueprintId(mainBlueprintId)
  }, [mainBlueprintId])

  useEffect(() => {
    if (!blueprintMenuOpen && !rateMenuOpen && !volumeMenuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (blueprintMenuOpen && blueprintMenuRef.current?.contains(target)) return
      if (rateMenuOpen && rateMenuRef.current?.contains(target)) return
      if (volumeMenuOpen && volumeMenuRef.current?.contains(target)) return
      setBlueprintMenuOpen(false)
      setRateMenuOpen(false)
      setVolumeMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [blueprintMenuOpen, rateMenuOpen, volumeMenuOpen])

  // 规则的运行时字段变化后重建 session：新试玩读取最新模板，不把新值热灌进旧运行态。
  const runtimeRulesSig = useGraphScenario((s) => runtimeRuleSignature(
    s.meta.entities ?? s.demo?.entities,
    s.meta.variables ?? s.demo?.variables,
  ))
  useEffect(() => {
    if (!ready) return
    const st = useGraphScenario.getState()
    const scn = st.playScn(playRootBlueprintId)
    rootBlueprintIdRef.current = playRootBlueprintId
    const s = new GraphSession(scn, { rootBlueprintId: playRootBlueprintId, rngSeed: createSessionSeed() })
    sessionRef.current = s
    setSnap(s.start())
  }, [restartKey, ready, runtimeRulesSig, playRootBlueprintId])

  const videoSrc = resolveCatalogMediaSrc(snap?.clip?.mediaId, assetCatalog, game)
  // 素材库里 `status: 'placeholder'` 的资产只是产线还没出成片的近黑占位视频;试玩里当作
  // 「尚未生成」处理,让 GameStage 叠说明卡,而不是真播那段占位造成演出结束后一片黑。
  const currentClipAsset = snap?.clip?.mediaId ? assetCatalog.assets[snap.clip.mediaId] : undefined
  const videoPending = currentClipAsset?.status === 'placeholder'
  const durationMs = resolveClipDurationMs({
    videoDurationMs,
    clipDurationMs: snap?.clip?.durationMs,
  })
  const progressPct = durationMs > 0 ? Math.min(100, (currentMs / durationMs) * 100) : 0
  const setClockCurrentMs = useCallback((nextMs: number) => {
    currentMsRef.current = nextMs
    setCurrentMs((current) => current === nextMs ? current : nextMs)
  }, [])
  useEffect(() => {
    setActiveVideo(null)
    setVideoDurationMs(undefined)
    setClockCurrentMs(0)
  }, [restartKey, snap?.clipSeq, setClockCurrentMs])
  useEffect(() => {
    if (activeVideo) {
      const updateFromVideo = () => {
        const nextMs = Math.max(0, Math.floor(activeVideo.currentTime * 1000))
        setClockCurrentMs(durationMs > 0 ? Math.min(durationMs, nextMs) : nextMs)
      }
      activeVideo.addEventListener('timeupdate', updateFromVideo)
      activeVideo.addEventListener('ended', updateFromVideo)
      updateFromVideo()
      return () => {
        activeVideo.removeEventListener('timeupdate', updateFromVideo)
        activeVideo.removeEventListener('ended', updateFromVideo)
      }
    }
    if (snap?.clip?.mediaId || durationMs <= 0 || paused || snap?.phase === 'ended') return
    let previousNow = performance.now()
    const timer = window.setInterval(() => {
      const now = performance.now()
      const elapsedMs = Math.max(0, now - previousNow) * playbackRate
      previousNow = now
      const nextMs = Math.min(durationMs, currentMsRef.current + elapsedMs)
      setClockCurrentMs(nextMs)
      if (nextMs >= durationMs) window.clearInterval(timer)
    }, 250)
    return () => window.clearInterval(timer)
  }, [activeVideo, durationMs, paused, playbackRate, snap?.clip?.mediaId, snap?.phase, setClockCurrentMs])
  const preloadVideos = useMemo(
    () => sessionRef.current?.preloadClips().map((candidate) => ({
      videoSrc: resolveCatalogMediaSrc(candidate.mediaId, assetCatalog, game),
      clip: candidate,
    })) ?? [],
    [snap?.currentNodeId, game, restartKey, runtimeRulesSig, assetCatalog],
  )
  /** 床轨解析器（引擎只抛音频实体 id，URL 归壳层）；稳定引用，避免每帧让 BgmPlayer 重跑 effect。 */
  const resolveBgm = useCallback(
    (id: string | undefined) => resolveCatalogMediaSrc(id, assetCatalog, game),
    [assetCatalog, game],
  )
  const endPerformance = useClipPerformanceEnd(sessionRef, setSnap, snap?.clipSeq ?? 0, restartKey)

  useControlledPlaybackTimeout(
    endPerformance,
    snap?.clip?.durationMs,
    { paused, rate: playbackRate },
    !snap || snap.phase === 'ended' || !!snap.clip?.mediaId,
    `${restartKey}:${snap?.clipSeq ?? 0}`,
  )

  const rootBlueprintId = rootBlueprintIdRef.current || mainBlueprintId
  const displayBlueprintId =
    viewMode === 'pinned' && pinnedBlueprintId
      ? pinnedBlueprintId
      : (snap?.activeBlueprintId ?? rootBlueprintId)
  const baseDisplayGraph =
    blueprints[displayBlueprintId]?.graph
    ?? blueprints[rootBlueprintId]?.graph
    ?? graph
  const activeNodeId = !snap
    ? null
    : displayBlueprintId === snap.activeBlueprintId
      ? snap.currentNodeId
      : deepestCallerOnBlueprint(snap.callStack, displayBlueprintId, snap.activeBlueprintId)
  const followedDrillPath = snap && displayBlueprintId === snap.activeBlueprintId
    ? snap.activeGraphPath
    : []
  const drillPath = viewMode === 'follow' ? followedDrillPath : pinnedDrillPath
  const displayGraph = resolveGraphAtPath(baseDisplayGraph, drillPath) ?? baseDisplayGraph
  const drillLabels = graphPathLabels(baseDisplayGraph, drillPath)
  const visibleActiveNodeId = activeNodeId && displayGraph.nodes.some((node) => node.id === activeNodeId) ? activeNodeId : null
  const crumbs = snap
    ? blueprintBreadcrumbs(
      rootBlueprintId,
      blueprints[rootBlueprintId]?.title ?? rootBlueprintId,
      snap.callStack,
      snap.activeBlueprintId,
      blueprints[snap.activeBlueprintId]?.title ?? snap.activeBlueprintId,
    )
    : []
  const jumpFromBlueprint = (nodeId: string) => {
    const packNode = displayGraph.nodes.find((node) => node.id === nodeId)
    const packRef = packNode ? getSubFlowPack(packNode.data) : undefined
    if (
      viewMode === 'pinned'
      && displayBlueprintId !== snap?.activeBlueprintId
      && packRef
      && snap?.callStack.some((frame) => frame.callerNodeId === nodeId)
    ) {
      setViewMode('follow')
      setPinnedBlueprintId(undefined)
      setPinnedDrillPath([])
      return
    }
    setSnap(sessionRef.current!.jump(nodeId, {
      blueprintId: displayBlueprintId,
      graph: displayGraph,
      graphPath: [...drillPath],
    }))
    setViewMode('follow')
    setPinnedBlueprintId(undefined)
    setPinnedDrillPath([])
  }
  const pinDrillPath = (path: string[]) => {
    setViewMode('pinned')
    setPinnedBlueprintId(displayBlueprintId)
    setPinnedDrillPath(path)
  }
  const drillIntoNode = (nodeId: string) => {
    const node = displayGraph.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return
    const pack = getSubFlowPack(node.data)
    if (pack && blueprints[pack.id]) {
      setViewMode('pinned')
      setPinnedBlueprintId(pack.id)
      setPinnedDrillPath([])
      return
    }
    if (getSubProcess(node.data)) pinDrillPath([...drillPath, nodeId])
  }
  const traversed = useMemo(() => {
    const merged = new Set(snap?.traversedEdgeIds ?? [])
    const live = sessionRef.current?.runtime.state.traversedEdgeIds
    if (live) for (const id of live) merged.add(id)
    return merged
  }, [snap?.traversedEdgeIds, snap?.currentNodeId, snap?.clipSeq])
  // 进出自蓝图（含面包屑回看）时平移到高亮节点；打开浮层不抢视口（图从 flow 坐标开始，不居中）。
  const revealNodeId = useRevealOnScopeChange(
    showBlueprint ? `${viewMode}:${displayBlueprintId}:${drillPath.join('/')}` : null,
    visibleActiveNodeId,
    true,
  )
  const rt = sessionRef.current?.runtime
  const skinCtx: SkinCtx | undefined = snap && rt
    ? {
      hud: snap.hud,
      condition: { state: rt.state, visited: rt.state.visited },
    }
    : snap
      ? { hud: snap.hud }
      : undefined

  const toolBtn = (on: boolean): CSSProperties => ({
    minWidth: 30, height: 28, borderRadius: 5, cursor: 'pointer', fontSize: 16,
    border: 'none', background: on ? 'rgba(255,149,0,0.14)' : 'transparent',
    color: on ? '#FF9C2A' : '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  })

  const menuPanel: CSSProperties = {
    position: 'absolute', bottom: '100%', marginBottom: 4, zIndex: 30,
    padding: 4, borderRadius: 8, background: '#232323', border: '0.611px solid rgba(255, 255, 255, 0.08)',
  }

  // 选中只靠橙字：底色与常态同档，避免再压一层橙底跟「hover 提亮灰底」抢信号。
  const blueprintMenuItem = (selected: boolean): CSSProperties => ({
    display: 'flex', alignItems: 'center', width: '100%', height: 30, boxSizing: 'border-box',
    padding: '0 8px 0 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13, border: 'none',
    background: 'rgba(255,255,255,0.06)',
    color: selected ? '#FF9C2A' : 'rgba(255, 255, 255, 0.60)',
  })

  // 倍速档位比蓝图名短，行高按设计稿压紧；橙色只标当前档，hover 由 .gv-play-menu-item 只改底色。
  const rateMenuItem = (selected: boolean): CSSProperties => ({
    display: 'block', width: '100%', minHeight: 18, padding: '0 12px', borderRadius: 2,
    cursor: 'pointer', fontSize: 12, border: 'none',
    background: selected ? 'rgba(255,255,255,0.12)' : 'transparent',
    color: selected ? '#FF9C2A' : 'rgba(255,255,255,0.55)',
  })

  const audioMuted = volume === 0
  const audioVolume = volume / 100
  const audioVolumeRef = useRef(audioVolume)
  audioVolumeRef.current = audioVolume
  const sessionEnded = snap?.phase === 'ended'
  const playToggleAction = resolvePlayToggleAction({ paused, ended: !!sessionEnded })
  const showPlayIcon = playToggleShowsPlay(playToggleAction)

  const restartPlayback = useCallback(() => {
    setPaused(false)
    setRestartKey((key) => key + 1)
  }, [])

  const handlePlayToggle = useCallback(() => {
    if (playToggleAction === 'restart') {
      restartPlayback()
      return
    }
    setPaused((value) => !value)
  }, [playToggleAction, restartPlayback])

  // 空格切换：业内视频标配。只在试玩根聚焦时响应，避免抢输入框 / 游戏 overlay 的按键。
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== ' ' && event.code !== 'Space') return
      if (event.target !== root) return
      event.preventDefault()
      handlePlayToggle()
    }
    root.addEventListener('keydown', onKeyDown)
    return () => root.removeEventListener('keydown', onKeyDown)
  }, [handlePlayToggle])

  // `volume` 不是 React 认识的 DOM 属性（只有 property），只能在拿到元素后自己写。
  useEffect(() => {
    if (activeVideo) activeVideo.volume = audioVolume
  }, [activeVideo, audioVolume])

  const handleFullscreenClick = () => {
    const el = rootRef.current
    if (!el) return
    try {
      const request = document.fullscreenElement
        ? document.exitFullscreen?.()
        : el.requestFullscreen?.()
      void request?.catch(() => { })
    } catch {
      // Fullscreen APIs may reject or throw when unavailable or denied.
    }
  }

  // 游戏 overlay 舞台 = 视频实际显示矩形（有黑边时锚在视频那块，不铺满容器）。
  return (
    <PlaybackClockProvider value={{ paused, rate: playbackRate }}>
      <PlayerRootContext.Provider value={rootEl}>
        <div
          ref={rootRef}
          data-testid="play-surface-root"
          tabIndex={0}
          onPointerDown={() => claimPlayerFocus(rootRef.current)}
          onFocus={() => claimPlayerFocus(rootRef.current)}
          style={{ position: 'relative', width: '100%', height: '100%', background: '#000', overflow: 'hidden', outline: 'none' }}
        >
          {/* 床轨：独立音频通道，与视频共用试玩声音开关。按 restartKey 重挂 —— 新会话的 `bgm` 快照从 null 起，
          「还没发过指令」不是停播令，若不重挂，重开会把上一局的曲子拖进新局。 */}
          <BgmPlayer key={restartKey} bgm={snap?.bgm ?? null} resolveAsset={resolveBgm} paused={paused} playbackRate={playbackRate} active={snap?.phase !== 'ended'} muted={audioMuted} masterVolume={audioVolume} />

          {/* 演出画面 + 叠层：共享 runtime/play 的 GameStage（视频舞台锚定内容矩形，HUD/QTE/交互随视频走）。 */}
          <GameStage
            videoSrc={videoSrc}
            videoKey={`${restartKey}:${snap?.clipSeq ?? 0}`}
            overlayKey={`${restartKey}:${snap?.clipSeq ?? 0}`}
            clip={snap?.clip}
            videoPending={videoPending}
            preloadVideos={preloadVideos}
            overlayMounts={snap?.overlayMounts ?? []}
            skins={skins ?? undefined}
            skinCtx={skinCtx}
            onEmit={(elementId, key) => { const s = sessionRef.current; if (!paused && s) setSnap(s.emitEvent(elementId, key)) }}
            onTick={(nowMs) => { const s = sessionRef.current; if (s) setSnap(s.tick(nowMs)) }}
            onPerformanceEnd={endPerformance}
            // 就地落音量：等 effect 那一拍，换片的头几帧会用元素默认的满音量喊出来。
            onActiveVideoChange={(element) => {
              if (element) element.volume = audioVolumeRef.current
              setActiveVideo(element)
            }}
            onDurationChange={setVideoDurationMs}
            paused={paused}
            playbackRate={playbackRate}
            videoAudioEnabled={!audioMuted}
            placeholder={snap ? (snap.clip?.name ?? '（无演出）') : translateUi('ui.copy.300ee3dee4dc')}
          />

          <div
            data-testid="play-bottom-bar"
            style={{
              position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 15,
              display: 'flex', flexDirection: 'column',
              background: 'rgba(20,20,20,0.92)', boxShadow: '0 -6px 24px rgba(0,0,0,0.35)',
              backdropFilter: 'blur(10px)',
            }}
          >
            {/* 进度条压在栏顶沿，通栏无内缩：它是「这一栏的上边」，不是栏里的一个控件。 */}
            <div
              data-testid="play-clip-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPct}
              style={{ width: '100%', height: 3, overflow: 'hidden', background: 'rgba(255,255,255,0.20)' }}
            >
              <div style={{ width: `${progressPct}%`, height: '100%', background: '#FF9C2A' }} />
            </div>
            {/* 56 是控件行自身的高度（不含顶沿那条 3px 进度线），box-sizing 保证 padding 吃在里面。 */}
            <div style={{ width: '100%', height: 55, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '9px 16px' }}>
              <div ref={blueprintMenuRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 16 }}>
                <button
                  type="button"
                  data-testid="play-blueprint-trigger"
                  className="gv-play-chip"
                  // 交互色与旁边「蓝图」芯片同一套：常态白字，展开列表时才转橙，hover 只提亮底色。
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '0 14px',
                    height: 37,
                    borderRadius: 8,
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 14,
                    background: 'rgba(255,255,255,0.05)',
                    color: blueprintMenuOpen ? '#FF9C2A' : '#fff',
                    minWidth: 150,
                    maxWidth: 150,
                  }}
                  aria-expanded={blueprintMenuOpen}
                  onClick={() => setBlueprintMenuOpen((open) => !open)}
                >
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {blueprints[playRootBlueprintId]?.title ?? playRootBlueprintId}
                  </span>
                  <span
                    aria-hidden="true"
                    // 底色只在展开时出现：收起时箭头是纯图标，展开时才压一枚芯片表示「这个菜单开着」。
                    style={{
                      flex: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      background: blueprintMenuOpen ? 'rgba(255,255,255,0.10)' : 'transparent',
                      color: 'currentColor',
                    }}
                  >
                    <svg
                      aria-hidden="true"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ transform: blueprintMenuOpen ? 'rotate(180deg)' : undefined, transition: 'transform 120ms' }}
                    >
                      <path d="m6 15 6-6 6 6" />
                    </svg>
                  </span>
                </button>
                {blueprintMenuOpen && (
                  <div style={{ ...menuPanel, left: 0, minWidth: 190, display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 8px' }}>
                    {Object.values(blueprints).map((blueprint) => (
                      <button
                        type="button"
                        key={blueprint.id}
                        data-testid={`play-blueprint-option-${blueprint.id}`}
                        className="gv-play-menu-item"
                        aria-current={blueprint.id === playRootBlueprintId ? 'true' : undefined}
                        style={blueprintMenuItem(blueprint.id === playRootBlueprintId)}
                        onClick={() => {
                          setPlayRootBlueprintId(blueprint.id)
                          setPaused(false)
                          setViewMode('follow')
                          setPinnedBlueprintId(undefined)
                          setPinnedDrillPath([])
                          setBlueprintMenuOpen(false)
                          setRestartKey((k) => k + 1)
                        }}
                      >
                        {blueprint.title}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  data-testid="play-blueprint-overlay"
                  className="gv-play-chip"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    height: 37, padding: '6px 8px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    fontSize: 14, background: 'rgba(255,255,255,0.05)',
                    color: showBlueprint ? '#FF9C2A' : '#fff',
                  }}
                  aria-pressed={showBlueprint}
                  onClick={() => setShowBlueprint((value) => !value)}
                >
                  <BlueprintChipIcon />
                  {translateUi('ui.copy.6c72663ddbeb')}
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  type="button"
                  data-testid="play-toggle"
                  data-action={playToggleAction}
                  className="gv-play-control"
                  // 只换图标，不给暂停态橙色底——暂停不是「工具开着」。
                  style={toolBtn(false)}
                  onClick={handlePlayToggle}
                  aria-label={showPlayIcon ? translateUi('ui.copy.4a25a87a775a') : translateUi('ui.copy.68229a924327')}
                >
                  {showPlayIcon ? <PlayTriangleIcon /> : <PlayPauseBarIcon />}
                </button>
                <button
                  type="button"
                  data-testid="play-restart"
                  className="gv-play-control"
                  style={toolBtn(false)}
                  aria-label={translateUi('ui.copy.6a77bc83ab3b')}
                  onClick={restartPlayback}
                >
                  <PlayReplayIcon />
                </button>
                <div ref={volumeMenuRef} style={{ position: 'relative' }}>
                  <button
                    type="button"
                    data-testid="play-volume-trigger"
                    data-muted={audioMuted ? 'true' : 'false'}
                    className="gv-play-control"
                    style={toolBtn(volumeMenuOpen)}
                    aria-label={translateUi('graphPlay.audio.volume')}
                    aria-expanded={volumeMenuOpen}
                    onClick={() => setVolumeMenuOpen((open) => !open)}
                  >
                    {audioMuted ? <PlayVolumeMutedIcon /> : <PlayVolumeIcon />}
                  </button>
                  {volumeMenuOpen && (
                    <div style={{ ...menuPanel, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: '24px', padding: '8px 0' }}>
                      <span style={{ color: '#FF9C2A', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{volume}</span>
                      <input
                        type="range"
                        data-testid="play-volume-slider"
                        className="gv-play-volume-slider"
                        aria-label={translateUi('graphPlay.audio.volume')}
                        min={0}
                        max={100}
                        step={1}
                        value={volume}
                        onChange={(event) => setVolume(Number(event.target.value))}
                      />
                    </div>
                  )}
                </div>
                <div ref={rateMenuRef} style={{ position: 'relative' }}>
                  <button
                    type="button"
                    data-testid="play-rate-trigger"
                    data-selected={playbackRate !== DEFAULT_PLAYBACK_RATE ? 'true' : 'false'}
                    className="gv-play-chip"
                    // 两个独立信号：橙字 = 当前不是默认倍速，灰底 = 选择窗口开着。合起来才是设计稿那四态。
                    style={{
                      ...toolBtn(false),
                      background: rateMenuOpen ? 'rgba(255,255,255,0.05)' : 'transparent',
                      border: '0.611px solid  rgba(255, 255, 255, 0.10)',
                      padding: '0 6px',
                      color: playbackRate !== DEFAULT_PLAYBACK_RATE ? '#FF9C2A' : '#FFF',
                    }}
                    aria-label={translateUi('ui.copy.7aabf295e7b5')}
                    aria-expanded={rateMenuOpen}
                    onClick={() => setRateMenuOpen((open) => !open)}
                  >
                    {playbackRate}{translateUi('graphPlay.rate.suffix')}
                  </button>
                  {rateMenuOpen && (
                    <div style={{ ...menuPanel, left: '50%', transform: 'translateX(-50%)', width: 75, padding: '8px 7px', gap: 4, display: 'flex', flexDirection: 'column' }}>
                      {[2, 1.5, 1, 0.5].map((rate) => (
                        <button
                          type="button"
                          key={rate}
                          data-testid={`play-rate-option-${rate}`}
                          className="gv-play-menu-item"
                          aria-current={rate === playbackRate ? 'true' : undefined}
                          style={rateMenuItem(rate === playbackRate)}
                          onClick={() => { setPlaybackRate(rate); setRateMenuOpen(false) }}
                        >
                          {rate}{translateUi('graphPlay.rate.suffix')}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span data-testid="play-clip-time" style={{ color: 'rgba(255, 255, 255, 0.80)', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                  {formatPlayClock(currentMs)} <span style={{ color: 'rgba(255, 255, 255, 0.40)' }}>/ {formatPlayClock(durationMs)}</span>
                </span>
                <button
                  type="button"
                  data-testid="play-fullscreen"
                  className="gv-play-control"
                  style={toolBtn(isFullscreen)}
                  aria-label={translateUi('videoAssets.player.fullscreen')}
                  aria-pressed={isFullscreen}
                  onClick={handleFullscreenClick}
                >
                  <img src={fullscreenIcon} width="18" height="18" alt="" />
                </button>
              </div>
            </div>
          </div>

          {/* 蓝图浮层：可拖拽 + 可缩放，复用 GraphCanvas */}
          {showBlueprint && (
            <DraggablePanel
              title={(
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span>{translateUi(viewMode === 'follow' ? 'graphPlay.blueprint.follow' : 'graphPlay.blueprint.pinned')}</span>
                  {crumbs.length > 0 && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0, overflow: 'hidden' }}>
                      {crumbs.map((crumb, index) => (
                        <span key={crumb.blueprintId} style={{ display: 'contents' }}>
                          {index > 0 && <span style={{ color: '#697386' }}>›</span>}
                          <button
                            title={`${translateUi('ui.template.db8db0530432')}${crumb.title}`}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={() => {
                              if (crumb.blueprintId === snap?.activeBlueprintId) {
                                setViewMode('follow')
                                setPinnedBlueprintId(undefined)
                                setPinnedDrillPath([])
                              } else {
                                setViewMode('pinned')
                                setPinnedBlueprintId(crumb.blueprintId)
                                setPinnedDrillPath([])
                              }
                            }}
                            style={{ padding: 0, border: 'none', background: 'none', color: crumb.blueprintId === displayBlueprintId ? '#f5bd75' : '#aeb8c8', cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' }}
                          >
                            {crumb.title}
                          </button>
                        </span>
                      ))}
                    </span>
                  )}
                  {viewMode === 'pinned' && (
                    <button
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => {
                        setViewMode('follow')
                        setPinnedBlueprintId(undefined)
                        setPinnedDrillPath([])
                      }}
                      style={{ marginLeft: 'auto', padding: '2px 6px', borderRadius: 4, border: '1px solid #66513b', background: '#2f2923', color: '#f5bd75', cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' }}
                    >
                      {translateUi('ui.copy.52ede777adf2')}</button>
                  )}
                </div>
              )}
              // 每次开都现算：浮层随 showBlueprint 重新挂载，读的就是当下的容器高度（含全屏切换后）。
              initial={resolveBlueprintPanelBox({ rootHeight: rootRef.current?.clientHeight ?? 0 })}
              onClose={() => setShowBlueprint(false)}
            >
              {drillPath.length > 0 && (
                <div
                  style={{
                    position: 'absolute', top: 8, left: 8, zIndex: 5, display: 'flex', gap: 6, alignItems: 'center',
                    maxWidth: 'calc(100% - 70px)', padding: '4px 10px', borderRadius: 999, fontSize: 12,
                    background: 'rgba(27,23,19,0.94)', border: '1px solid #66513b', color: '#c9d1e0',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.45)', overflow: 'hidden',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => pinDrillPath([])}
                    style={{ flex: 'none', padding: 0, border: 'none', background: 'none', color: '#f08840', cursor: 'pointer', fontSize: 12 }}
                  >
                    {translateUi('ui.copy.c122e1758cb9')}</button>
                  {drillLabels.map((item, index) => (
                    <span key={item.id} style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
                      <span style={{ color: '#697386' }}>›</span>
                      <button
                        type="button"
                        onClick={() => pinDrillPath(drillPath.slice(0, index + 1))}
                        style={{
                          minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: 0,
                          border: 'none', background: 'none', color: index === drillPath.length - 1 ? '#f5bd75' : '#aeb8c8',
                          cursor: 'pointer', fontSize: 12, fontWeight: index === drillPath.length - 1 ? 700 : 400,
                        }}
                      >
                        {item.name}
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    title={translateUi('ui.copy.94c327416801')}
                    onClick={() => pinDrillPath(drillPath.slice(0, -1))}
                    style={{ flex: 'none', marginLeft: 2, padding: '1px 6px', borderRadius: 4, border: '1px solid #403830', background: '#252019', color: '#c9d1e0', cursor: 'pointer', fontSize: 11 }}
                  >
                    ←
                  </button>
                </div>
              )}
              <GraphCanvas
                graph={displayGraph}
                onChange={() => { }}
                overlays={overlays}
                videoOptions={videoOptions}
                entities={entities}
                variables={variables}
                activeNodeId={visibleActiveNodeId}
                traversedEdgeIds={displayBlueprintId === snap?.activeBlueprintId ? traversed : undefined}
                drillFitKey={`${displayBlueprintId}:${drillPath.join('/') || 'root'}`}
                revealNodeId={revealNodeId}
                onJump={jumpFromBlueprint}
                onDrill={drillIntoNode}
                readOnly
                hideViewportChrome
                fitViewOnMount={false}
                defaultZoom={0.5}
              />
            </DraggablePanel>
          )}

        </div>
      </PlayerRootContext.Provider>
    </PlaybackClockProvider>
  )
}
