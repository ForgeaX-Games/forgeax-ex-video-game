import { t as translateUi } from '../../i18n'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { GraphSession, SessionSnapshot } from '@/runtime/core/engine/session'
import { PlayerRootContext } from '@/runtime/react/component-host/rendererRegistry'
import { createCoreSkinRegistry } from '@/runtime/react/component-host'
import { claimPlayerFocus, releasePlayerFocus } from '@/runtime/react/input/playerFocus'
import {
  BgmPlayer,
  GameStage,
  PlaybackClockProvider,
  type GameStageProps,
} from '@/runtime/react/play'
import { MaterialTimeline } from '../video/MaterialTimeline'
import type { ProjectedFlowTimeline } from '../video/flowPreviewTimeline'
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import {
  formatPreviewTime,
  PreviewPauseIcon,
  PreviewPlayIcon,
  PreviewRefreshIcon,
  PreviewVolumeIcon,
} from './nodePreviewControls'
import {
  createFollowIdleReattach,
  isHorizontalNavKey,
  isHorizontalWheelIntent,
  nextSoftFollowScrollLeft,
  shouldFollowPlayheadScroll,
} from './flowPreviewScrollFollow'

const FLOW_PREVIEW_CSS = `
.nps-flow-controls { gap: 12px; }
.nps-flow-controls .nps-video-controls-right { min-width: 0; flex: 1 1 auto; justify-content: flex-end; }
.nps-flow-status {
  min-width: 0; flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: rgba(255,255,255,.4); font-size: 11px;
}
.nps-flow-status strong { color: rgba(255,255,255,.8); font-weight: 500; }
.nps-flow-controls select {
  flex: none; height: 21px; box-sizing: border-box;
  border: 1px solid rgba(255,255,255,.12); border-radius: 4px;
  background: rgba(255,255,255,.04); color: rgba(255,255,255,.8);
  font-size: 10px; padding: 1px 4px;
}
.nps-flow-controls .nps-hud-time { flex: none; }
`

export interface FlowNodePreviewState {
  snapshot: SessionSnapshot
  session: GraphSession
  videoSrc: string | undefined
  videoKey: string
  preloadVideos: NonNullable<GameStageProps['preloadVideos']>
  timeline: ProjectedFlowTimeline
  paused: boolean
  playbackRate: number
  videoAudioEnabled: boolean
  /** 全流程时间轴持续拖动的灵敏度；1 为等比例，默认 0.8。按下定位不受影响。 */
  seekDragSensitivity?: number
  bgmRunKey: number
  resolveBgm: (id: string | undefined) => string | undefined
  onPausedChange: (paused: boolean) => void
  onPlaybackRateChange: (rate: number) => void
  onVideoAudioToggle: () => void
  onRestart: () => void
  onEmit: (elementId: string, key: string) => void
  onTick: (nowMs: number) => void
  onPerformanceEnd: () => void
  onDurationChange: (durationMs: number) => void
  /** 恢复目标片段入口 checkpoint 并推进到局部时刻；无 checkpoint 时返回 false。 */
  onSeek: (segmentIndex: number, localMs: number) => boolean
}

interface PendingFlowSeek {
  segmentIndex: number
  localMs: number
  globalMs: number
}

interface FlowNodePreviewStageProps {
  flow: FlowNodePreviewState
  timelineId: string
  timelineExpanded: boolean
  timelineToggle: ReactNode
}

export function FlowNodePreviewStage({
  flow,
  timelineId,
  timelineExpanded,
  timelineToggle,
}: FlowNodePreviewStageProps): JSX.Element {
  injectStyleOnce('flow-node-preview-stage', FLOW_PREVIEW_CSS)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [rootElement, setRootElement] = useState<HTMLElement | null>(null)
  const activeVideoRef = useRef<HTMLVideoElement | null>(null)
  const timelineHostRef = useRef<HTMLDivElement | null>(null)
  const timelineModelRef = useRef(flow.timeline)
  const syntheticLocalMsRef = useRef(0)
  const pendingSeekRef = useRef<PendingFlowSeek | null>(null)
  const scrubbingRef = useRef(false)
  /** 播放头横向跟随；用户手动横滚后脱钩，继续播放 / 重开 / seek / 闲置超时再挂钩。 */
  const followPlayheadRef = useRef(true)
  const followIdleRef = useRef<ReturnType<typeof createFollowIdleReattach> | null>(null)
  if (!followIdleRef.current) {
    followIdleRef.current = createFollowIdleReattach({
      onDetach: () => {
        followPlayheadRef.current = false
      },
      onReattach: () => {
        followPlayheadRef.current = true
      },
    })
  }
  timelineModelRef.current = flow.timeline
  const bindRoot = useCallback((element: HTMLDivElement | null) => {
    const previous = rootRef.current
    rootRef.current = element
    setRootElement(element)
    if (!element && previous) releasePlayerFocus(previous)
  }, [])
  const snap = flow.snapshot
  const enablePlayheadFollow = useCallback(() => {
    followIdleRef.current?.cancel()
    followPlayheadRef.current = true
  }, [])
  /**
   * 播放头位置的真相在这里（ms），DOM 位置每帧由它派生。
   * MaterialTimeline 自己也会按 `playheadMs` prop 写同一个 inline `left`——宿主每 tick 重渲染时
   * 那个值只到片段起点，会把平滑位置打回去。故每次渲染后都用本 ref 重新落地（见 layout effect）。
   */
  const playheadGlobalMsRef = useRef<number | null>(null)
  /** 把 ref 里的播放头时刻落到 DOM；返回画布内像素位置（无法计算时 null）。 */
  const applyPlayheadDom = useCallback((): number | null => {
    const timeline = timelineModelRef.current
    const globalMs = playheadGlobalMsRef.current
    if (globalMs == null || !(timeline.maxMs > 0)) return null
    const host = timelineHostRef.current
    const playhead = host?.querySelector<HTMLElement>('.gc-playhead')
    const canvas = host?.querySelector<HTMLElement>('.gc-mtimeline-canvas')
    if (!playhead || !canvas) return null
    const x = (globalMs / timeline.maxMs) * canvas.clientWidth
    playhead.style.left = `${x}px`
    return x
  }, [])
  const writeGlobalPlayhead = useCallback((globalMs: number, opts?: { forceScroll?: boolean }) => {
    playheadGlobalMsRef.current = globalMs
    const playheadX = applyPlayheadDom()
    if (playheadX == null) return
    const viewport = timelineHostRef.current?.querySelector<HTMLElement>('.gc-mtimeline-viewport')
    if (!viewport) return
    const canFollow = opts?.forceScroll === true || shouldFollowPlayheadScroll({
      followEnabled: followPlayheadRef.current,
      scrubbing: scrubbingRef.current,
      paused: flow.paused,
      phase: snap.phase,
    })
    if (!canFollow) return
    const next = nextSoftFollowScrollLeft({
      playheadX,
      viewportWidth: viewport.clientWidth,
      scrollLeft: viewport.scrollLeft,
    })
    // 连续跟滚每帧只移动几像素，阈值必须远小于 1px，否则慢速播放会被判成「不用滚」而卡顿。
    if (next == null || Math.abs(next - viewport.scrollLeft) < 0.05) return
    viewport.scrollLeft = next
  }, [applyPlayheadDom, flow.paused, snap.phase])
  const writeSmoothPlayhead = useCallback((localMs: number) => {
    const timeline = timelineModelRef.current
    const active = timeline.segments[timeline.activeIndex]
    if (!active) return
    const globalMs = active.startMs + Math.max(0, Math.min(active.endMs - active.startMs, localMs))
    writeGlobalPlayhead(globalMs)
  }, [writeGlobalPlayhead])
  const handleActiveVideoChange = useCallback((video: HTMLVideoElement | null) => {
    activeVideoRef.current = video
    if (!video) return
    const pending = pendingSeekRef.current
    if (pending && timelineModelRef.current.activeIndex === pending.segmentIndex) {
      try { video.currentTime = pending.localMs / 1000 } catch { /* metadata 未就绪 */ }
      syntheticLocalMsRef.current = pending.localMs
      writeGlobalPlayhead(pending.globalMs, { forceScroll: true })
      pendingSeekRef.current = null
      return
    }
    writeSmoothPlayhead(video.currentTime * 1000)
  }, [writeGlobalPlayhead, writeSmoothPlayhead])

  const handleScrubStart = useCallback(() => {
    scrubbingRef.current = true
    const video = activeVideoRef.current
    if (video && !video.paused) {
      try { video.pause() } catch { /* ignore */ }
    }
    flow.onPausedChange(true)
  }, [flow.onPausedChange])

  const handleScrubEnd = useCallback(() => {
    scrubbingRef.current = false
  }, [])

  const handlePausedChange = useCallback((paused: boolean) => {
    // 继续播放：重新挂钩，回到关注 playhead（业界剪辑软件同款）。
    if (!paused) enablePlayheadFollow()
    flow.onPausedChange(paused)
  }, [enablePlayheadFollow, flow.onPausedChange])

  const handleRestart = useCallback(() => {
    enablePlayheadFollow()
    flow.onRestart()
  }, [enablePlayheadFollow, flow.onRestart])

  const handleTimelineSeek = useCallback((globalMs: number) => {
    const timeline = timelineModelRef.current
    const segmentIndex = timeline.segments.findIndex((segment, index) => (
      globalMs < segment.endMs || index === timeline.segments.length - 1
    ))
    const segment = timeline.segments[segmentIndex]
    if (!segment) return
    const localMs = Math.max(0, Math.min(segment.endMs - segment.startMs, globalMs - segment.startMs))
    if (!flow.onSeek(segmentIndex, localMs)) return
    enablePlayheadFollow()
    const pending = { segmentIndex, localMs, globalMs: segment.startMs + localMs }
    pendingSeekRef.current = pending
    syntheticLocalMsRef.current = localMs
    writeGlobalPlayhead(pending.globalMs, { forceScroll: true })
    if (segmentIndex === timeline.activeIndex && activeVideoRef.current) {
      try { activeVideoRef.current.currentTime = localMs / 1000 } catch { /* metadata 未就绪 */ }
      pendingSeekRef.current = null
    }
  }, [enablePlayheadFollow, flow.onSeek, writeGlobalPlayhead])

  // 用户横向浏览 → 脱钩并开始闲置计时；闲置结束后自动重新挂钩。
  useEffect(() => {
    if (!timelineExpanded) return
    let viewport: HTMLElement | null = null
    let cancelled = false
    let frameId = 0
    const idle = followIdleRef.current
    if (!idle) return
    const onWheel = (event: WheelEvent): void => {
      if (isHorizontalWheelIntent(event)) idle.noteUserScroll()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isHorizontalNavKey(event.key)) idle.noteUserScroll()
    }
    const onPointerDown = (): void => {
      idle.noteUserScroll()
    }
    const bind = (): void => {
      if (cancelled) return
      viewport = timelineHostRef.current?.querySelector<HTMLElement>('.gc-mtimeline-viewport') ?? null
      if (!viewport) {
        frameId = requestAnimationFrame(bind)
        return
      }
      viewport.addEventListener('wheel', onWheel, { passive: true })
      viewport.addEventListener('keydown', onKeyDown)
      // 拖滚动条 / 触摸平移；点画布 seek 也会先走到这里，但随后 handleTimelineSeek 会立刻重新挂钩。
      viewport.addEventListener('pointerdown', onPointerDown, { passive: true })
      viewport.addEventListener('touchstart', onPointerDown, { passive: true })
    }
    bind()
    return () => {
      cancelled = true
      cancelAnimationFrame(frameId)
      viewport?.removeEventListener('wheel', onWheel)
      viewport?.removeEventListener('keydown', onKeyDown)
      viewport?.removeEventListener('pointerdown', onPointerDown)
      viewport?.removeEventListener('touchstart', onPointerDown)
    }
    // 只随时间轴显隐重绑。刻意不依赖 timeline/maxMs：试玩推进到新节点就会让它变，
    // 重绑本身无害，但 cleanup 会顺手清掉闲置计时器，导致脱钩后永远等不到自动恢复。
  }, [timelineExpanded])

  // 闲置计时器只在卸载时清，避免任何中途重绑吞掉待恢复的挂钩。
  useEffect(() => () => followIdleRef.current?.cancel(), [])

  /**
   * 重定位播放头只在「真的换了位置」时做：换片段（clipSeq）或 seek。
   * 刻意不依赖 `flow.timeline` 引用——宿主每 tick 都会重建它，跟着跑就会把平滑位置反复打回片段起点。
   */
  useEffect(() => {
    const pending = pendingSeekRef.current
    if (pending) {
      writeGlobalPlayhead(pending.globalMs, { forceScroll: true })
      if (!flow.videoSrc && timelineModelRef.current.activeIndex === pending.segmentIndex) {
        syntheticLocalMsRef.current = pending.localMs
        pendingSeekRef.current = null
      }
      return
    }
    const timeline = timelineModelRef.current
    const active = timeline.segments[timeline.activeIndex]
    const localMs = active ? Math.max(0, timeline.playheadMs - active.startMs) : 0
    syntheticLocalMsRef.current = localMs
    writeSmoothPlayhead(localMs)
  }, [snap.clipSeq, flow.timeline.activeIndex, flow.videoSrc, writeGlobalPlayhead, writeSmoothPlayhead])

  // 每次渲染后把平滑播放头重新落地，压过 MaterialTimeline 依 prop 写回的片段起点位置。
  useLayoutEffect(() => {
    applyPlayheadDom()
  })

  useEffect(() => {
    if (flow.paused || snap.phase === 'ended') {
      const video = activeVideoRef.current
      if (video) writeSmoothPlayhead(video.currentTime * 1000)
      return
    }
    let frameId = 0
    let previousFrameAt = performance.now()
    const renderFrame = (now: number): void => {
      const pending = pendingSeekRef.current
      if (pending) {
        writeGlobalPlayhead(pending.globalMs, { forceScroll: true })
        previousFrameAt = now
        frameId = requestAnimationFrame(renderFrame)
        return
      }
      const video = activeVideoRef.current
      if (video) {
        syntheticLocalMsRef.current = video.currentTime * 1000
      } else if (!flow.videoSrc) {
        syntheticLocalMsRef.current += Math.max(0, now - previousFrameAt) * flow.playbackRate
      }
      previousFrameAt = now
      writeSmoothPlayhead(syntheticLocalMsRef.current)
      frameId = requestAnimationFrame(renderFrame)
    }
    frameId = requestAnimationFrame(renderFrame)
    return () => cancelAnimationFrame(frameId)
  }, [flow.paused, flow.playbackRate, flow.videoSrc, snap.clipSeq, snap.phase, writeGlobalPlayhead, writeSmoothPlayhead])

  return (
    <div className="nps-root nps-flow-root" data-testid="flow-node-preview">
      <div className="gc-frame nps-frame nps-frame-edit" data-type="video">
        <PlaybackClockProvider value={{ paused: flow.paused, rate: flow.playbackRate }}>
          <PlayerRootContext.Provider value={rootElement}>
            <div
              ref={bindRoot}
              tabIndex={0}
              onPointerDown={() => claimPlayerFocus(rootRef.current)}
              onFocus={() => claimPlayerFocus(rootRef.current)}
              style={{ position: 'absolute', inset: 0, outline: 'none' }}
            >
              <BgmPlayer
                key={flow.bgmRunKey}
                bgm={snap.bgm}
                resolveAsset={flow.resolveBgm}
                paused={flow.paused}
                playbackRate={flow.playbackRate}
                active={snap.phase !== 'ended'}
              />
              <GameStage
                videoSrc={flow.videoSrc}
                videoKey={flow.videoKey}
                overlayKey={snap.clipSeq}
                clip={snap.clip}
                preloadVideos={flow.preloadVideos}
                overlayMounts={snap.overlayMounts}
                skins={createCoreSkinRegistry()}
                skinCtx={{
                  hud: snap.hud,
                  condition: {
                    state: flow.session.runtime.state,
                    visited: flow.session.runtime.state.visited,
                  },
                }}
                onEmit={flow.onEmit}
                onTick={flow.onTick}
                onPerformanceEnd={flow.onPerformanceEnd}
                onDurationChange={flow.onDurationChange}
                onActiveVideoChange={handleActiveVideoChange}
                paused={flow.paused}
                playbackRate={flow.playbackRate}
                videoAudioEnabled={flow.videoAudioEnabled}
              />
            </div>
          </PlayerRootContext.Provider>
        </PlaybackClockProvider>
      </div>

      <div className="nps-video-controls nps-flow-controls">
        <div className="nps-video-controls-left">
          <button
            type="button"
            onClick={() => handlePausedChange(!flow.paused)}
            title={flow.paused ? translateUi('ui.copy.2aadffaa7ffc') : translateUi('ui.copy.85fcf40e8776')}
            aria-label={flow.paused ? translateUi('ui.copy.2aadffaa7ffc') : translateUi('ui.copy.85fcf40e8776')}
          >
            {flow.paused ? <PreviewPlayIcon /> : <PreviewPauseIcon />}
          </button>
          <button type="button" onClick={handleRestart} title={translateUi('ui.copy.4dc231cd5b0a')} aria-label={translateUi('ui.copy.4dc231cd5b0a')}>
            <PreviewRefreshIcon />
          </button>
          <button
            type="button"
            className={flow.videoAudioEnabled ? undefined : 'nps-hud-btn-dim'}
            onClick={flow.onVideoAudioToggle}
            title={flow.videoAudioEnabled ? translateUi('ui.copy.f0472d131620') : translateUi('ui.copy.2a41d89ffc18')}
            aria-label={flow.videoAudioEnabled ? translateUi('ui.copy.f0472d131620') : translateUi('ui.copy.2a41d89ffc18')}
          >
            <PreviewVolumeIcon />
          </button>
        </div>
        <div className="nps-video-controls-right">
          <span className="nps-flow-status" title={`${snap.phase} · ${snap.clip?.name || snap.currentNodeId || ''}`}>
            <strong>{snap.phase}</strong>{snap.clip?.name || snap.currentNodeId ? ` · ${snap.clip?.name || snap.currentNodeId}` : ''}
          </span>
          <select
            aria-label={translateUi('ui.copy.7a53c5e850e9')}
            value={flow.playbackRate}
            onChange={(event) => flow.onPlaybackRateChange(Number(event.target.value))}
          >
            {[0.5, 1, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}{translateUi('ui.copy.11f6ad8ec52a')}</option>)}
          </select>
          <span className="nps-hud-time">
            {formatPreviewTime(flow.timeline.playheadMs)}
            <span> / {formatPreviewTime(flow.timeline.maxMs)}</span>
          </span>
          {timelineToggle}
        </div>
      </div>

      {timelineExpanded ? (
        <div ref={timelineHostRef} id={timelineId} className="nps-timeline-host">
          <MaterialTimeline
            materials={flow.timeline.materials}
            maxMs={flow.timeline.maxMs}
            playheadMs={flow.timeline.playheadMs}
            videoSrc={flow.videoSrc}
            selectedMaterialKey={null}
            pointMarkers={flow.timeline.pointMarkers}
            conditionMarkers={flow.timeline.conditionMarkers}
            segments={flow.timeline.segments}
            widthMode="append"
            context="video"
            editable={false}
            selectable={false}
            emptyHint={translateUi('ui.copy.f743f2438017')}
            onSeek={handleTimelineSeek}
            onScrubStart={handleScrubStart}
            onScrubEnd={handleScrubEnd}
            seekDragSensitivity={flow.seekDragSensitivity ?? 0.8}
            onSelectMaterial={() => {}}
            onPatchMaterial={() => {}}
          />
        </div>
      ) : null}
    </div>
  )
}
