/**
 * GameStage —— 「当前演出帧」的共享渲染 SSOT（runtime/play）。
 *
 * 把原先散在 GraphPlayer / GraphPlaySurface / GraphStudio 里**重复**的
 * 「<video> 演出 + 缺片提示 + VideoOverlayStage 叠层」这一块收成一个组件。
 * 只依赖 runtime（引擎快照类型 + 皮肤注册表 + 视频矩形工具），**不碰 editor / 宿主**：
 *   - 视频地址由调用方算好传入(`videoSrc`)——宿主专属的 mediaId→url 解析留在调用方(注入)。
 *   - 会话推进/事件回灌经回调(onTick / onPerformanceEnd / onEmit)交给调用方的 GraphSession。
 *
 * 自持:video 预取池、内容矩形(useVideoContentRect)、缺片状态(随 clip 变更自动复位)。
 * 后继视频在当前演出期间建立 DOM 并加载；换片时复用同一元素，首帧提交合成器后才接管画面。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { t as translateUi, tf } from '@/i18n'
import type { ClipSnap, OverlayMountSnap } from '@/runtime/core/engine/session'
import type { SkinCtx, SkinRegistry } from '../component-host/rendererRegistry'
import { MissingVideoNotice } from './MissingVideoNotice'
import { refreshPlaybackUrl } from './refreshPlaybackUrl'
import { VideoOverlayStage } from './VideoOverlayStage'
import { useVideoContentRect } from './useVideoContentRect'
import { videoDurationCapReached } from './videoTiming'

export interface GameStageProps {
  /** 当前演出视频的可播 url;调用方用(注入的)解析器把 clip.mediaId 转成 url。 */
  videoSrc: string | undefined
  clip: ClipSnap | undefined
  overlayMounts: OverlayMountSnap[]
  /** 皮肤注册表(session.skins);缺省不渲染叠层。 */
  skins: SkinRegistry | undefined
  skinCtx: SkinCtx | undefined
  onEmit: (elementId: string, key: string) => void
  onTick: (nowMs: number) => void
  /** 演出提前收尾(时长上限到点 / 非 loop 视频自然结束)。 */
  onPerformanceEnd: () => void
  /** 无视频时的占位内容(如「（无演出）」/「加载中…」)。 */
  placeholder?: ReactNode
  /**
   * 当前节点绑定的视频还不是成片(素材库里是 `status: 'placeholder'` 的近黑占位)。
   * 试玩里不能把那段占位当真视频播——否则演出结束后玩家只看到一片黑;这里改叠一张
   * 「该节点视频尚未生成」的说明卡,占位视频仍在底下播以维持原有推进/计时。
   */
  videoPending?: boolean
  /** 播放标识覆盖(默认 clip.nodeId);需要「同节点再 jump 强制重播」时传入带 epoch 的 key。 */
  videoKey?: string
  /** 每次节点演出进入的递增标识；用于重置一次性互动组件的 React 生命周期。 */
  overlayKey?: string | number
  /** 当前节点的后继候选；提前加载并保留 DOM，实际切换时不再设置 src。 */
  preloadVideos?: PreloadVideo[]
  /** 播放壳控制；不传时保持历史行为（播放中、1 倍速）。 */
  paused?: boolean
  playbackRate?: number
  /** 是否播放当前前台视频自带的音轨；预加载和退场视频始终静音。 */
  videoAudioEnabled?: boolean
  /** 当前视频 metadata 就绪后通知有效演出时长；仅供编辑器流程时间轴校准。 */
  onDurationChange?: (durationMs: number) => void
  /** 当前真正呈现的视频元素；编辑器用它逐帧读取 currentTime，不改变运行时 tick 频率。 */
  onActiveVideoChange?: (video: HTMLVideoElement | null) => void
}

export interface PreloadVideo {
  videoSrc: string | undefined
  clip: ClipSnap
  videoKey?: string
}

interface BufferedPlayback {
  key: string
  src: string
  mediaId: string | undefined
  loop: boolean
  durationMs: number | undefined
}

interface VideoSlot {
  id: string
  playback: BufferedPlayback
}

interface VideoBufferState {
  frontId: string | null
  slots: VideoSlot[]
}

const EMPTY_PRELOADS: PreloadVideo[] = []
const MAX_PRELOADS = 4

function playbackKey(videoSrc: string | undefined, clip: ClipSnap | undefined, videoKey: string | undefined): string | null {
  if (!videoSrc) return null
  return [
    videoKey ?? clip?.nodeId ?? 'clip',
    clip?.mediaId ?? '',
    clip?.loop ? 'loop' : 'once',
    clip?.durationMs ?? '',
    videoSrc,
  ].join('\u0000')
}

export function GameStage({
  videoSrc, clip, overlayMounts, skins, skinCtx, onEmit, onTick, onPerformanceEnd, placeholder, videoKey, overlayKey,
  preloadVideos = EMPTY_PRELOADS, paused = false, playbackRate = 1, videoAudioEnabled = true,
  onDurationChange, onActiveVideoChange, videoPending = false,
}: GameStageProps): JSX.Element {
  const desired = useMemo<BufferedPlayback | null>(
    () => {
      const key = playbackKey(videoSrc, clip, videoKey)
      return videoSrc && key
        ? {
            key,
            src: videoSrc,
            mediaId: clip?.mediaId,
            loop: !!clip?.loop,
            durationMs: clip?.durationMs,
          }
        : null
    },
    [videoSrc, videoKey, clip?.nodeId, clip?.mediaId, clip?.loop, clip?.durationMs],
  )
  const desiredKey = desired?.key ?? null
  const preloads = useMemo(
    () => preloadVideos.slice(0, MAX_PRELOADS).flatMap(({ videoSrc: src, clip: candidate, videoKey: keyOverride }) => {
      const key = playbackKey(src, candidate, keyOverride)
      return src && key
        ? [{
            key,
            src,
            mediaId: candidate.mediaId,
            loop: candidate.loop,
            durationMs: candidate.durationMs,
          }]
        : []
    }),
    [preloadVideos],
  )
  const [buffer, setBuffer] = useState<VideoBufferState>(() => ({
    frontId: desired ? 'video-0' : null,
    slots: desired ? [{ id: 'video-0', playback: desired }] : [],
  }))
  const nextSlotIdRef = useRef(1)
  const slotElements = useRef<Record<string, HTMLVideoElement | null>>({})
  const loadedSlotsRef = useRef<Set<string>>(new Set())
  const pendingPresentationRef = useRef<string | null>(null)
  const refreshRevisionRef = useRef(0)
  const refreshingPlaybackKeysRef = useRef<Set<string>>(new Set())
  const retryResumeTimeRef = useRef<Map<string, number>>(new Map())
  const effectiveDurationByKeyRef = useRef<Map<string, number>>(new Map())
  const activeVideoRef = useRef<HTMLVideoElement | null>(null)
  const frontSlotRef = useRef<string | null>(buffer.frontId)
  const desiredKeyRef = useRef<string | null>(desiredKey)
  frontSlotRef.current = buffer.frontId
  desiredKeyRef.current = desiredKey
  const activeSlot = buffer.slots.find((slot) => slot.id === buffer.frontId)
  const activePlayback = activeSlot?.playback
  const { contentRect, recomputeRect } = useVideoContentRect(activeVideoRef, [activePlayback?.key])
  const [missingVideoId, setMissingVideoId] = useState<string | null>(null)
  const displayedMissingVideoId = missingVideoId ?? (clip?.mediaId && !videoSrc ? clip.mediaId : null)

  useEffect(() => {
    for (const element of Object.values(slotElements.current)) {
      if (!element) continue
      element.playbackRate = playbackRate
      if (paused) element.pause()
      else if (element === activeVideoRef.current) startPlaying(element)
    }
  }, [paused, playbackRate])

  useEffect(() => {
    setMissingVideoId(clip?.mediaId && !videoSrc ? clip.mediaId : null)
  }, [clip?.nodeId, clip?.mediaId, videoSrc])

  useEffect(() => {
    if (!desiredKey) return
    const cached = effectiveDurationByKeyRef.current.get(desiredKey)
    if (cached) onDurationChange?.(cached)
  }, [desiredKey, onDurationChange])

  useEffect(() => {
    pendingPresentationRef.current = null
    if (!desired) {
      for (const element of Object.values(slotElements.current)) element?.pause()
      activeVideoRef.current = null
      onActiveVideoChange?.(null)
      loadedSlotsRef.current.clear()
      setBuffer((current) => current.slots.length > 0 ? { frontId: null, slots: [] } : current)
      return
    }

    setBuffer((current) => {
      let slots = [...current.slots]
      let desiredSlot = slots.find((slot) => slot.playback.key === desired.key)
      if (!desiredSlot) {
        desiredSlot = slots.find(
          (slot) => slot.id !== current.frontId && slot.playback.src === desired.src,
        )
        if (desiredSlot) {
          slots = slots.map((slot) => slot.id === desiredSlot?.id ? { ...slot, playback: desired } : slot)
        } else {
          desiredSlot = { id: `video-${nextSlotIdRef.current++}`, playback: desired }
          slots.push(desiredSlot)
        }
      }

      for (const preload of preloads) {
        if (preload.key === desired.key) continue
        const reusable = slots.some(
          (slot) => slot.playback.key === preload.key
            || (slot.id !== current.frontId && slot.playback.src === preload.src),
        )
        if (!reusable) {
          slots.push({ id: `video-${nextSlotIdRef.current++}`, playback: preload })
        }
      }

      const keep = (slot: VideoSlot) =>
        slot.id === current.frontId
        || slot.id === desiredSlot?.id
        || preloads.some((preload) => preload.key === slot.playback.key || preload.src === slot.playback.src)
      slots = slots.filter(keep).slice(0, MAX_PRELOADS + 2)
      return { ...current, slots }
    })
  }, [desired, preloads])

  useEffect(() => {
    const target = buffer.slots.find((slot) => slot.playback.key === desiredKey)
    if (!target) return
    const element = slotElements.current[target.id]
    if (!element) return
    if (target.id === buffer.frontId) {
      activeVideoRef.current = element
      onActiveVideoChange?.(element)
      reportEffectiveDuration(target.playback, element)
      recomputeRect()
      startPlaying(element)
      return
    }
    if (loadedSlotsRef.current.has(target.id) || element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      presentWhenFrameReady(target, element)
    }
  }, [buffer, desiredKey, recomputeRect])

  const isCurrentPlayback = (slotId: string, key: string): boolean =>
    frontSlotRef.current === slotId && desiredKeyRef.current === key

  function startPlaying(element: HTMLVideoElement): void {
    // Buffer/preload reconciliation may rerender after the terminal clip has ended.
    // An ended foreground video must stay on its final frame; play() would restart it.
    if (paused || element.ended) return
    if (!element.paused) return
    const playing = element.play()
    void playing?.catch((error: unknown) => {
      if ((error as { name?: string })?.name !== 'AbortError') {
        console.warn('[game-video] failed to start buffered video', error)
      }
    })
  }

  function reportEffectiveDuration(playback: BufferedPlayback, element: HTMLVideoElement): void {
    const videoDurationMs = Math.round(element.duration * 1000)
    if (!Number.isFinite(videoDurationMs) || videoDurationMs <= 0) return
    const capMs = playback.durationMs
    const effectiveDurationMs = capMs && capMs > 0 && capMs <= videoDurationMs ? capMs : videoDurationMs
    effectiveDurationByKeyRef.current.set(playback.key, effectiveDurationMs)
    onDurationChange?.(effectiveDurationMs)
  }

  function presentWhenFrameReady(slot: VideoSlot, element: HTMLVideoElement): void {
    if (desiredKeyRef.current !== slot.playback.key) return
    reportEffectiveDuration(slot.playback, element)
    const presentationKey = `${slot.id}\u0000${slot.playback.key}`
    if (pendingPresentationRef.current === presentationKey) return
    pendingPresentationRef.current = presentationKey
    if (element.currentTime !== 0) element.currentTime = 0
    startPlaying(element)

    const activate = () => {
      if (
        desiredKeyRef.current !== slot.playback.key
        || pendingPresentationRef.current !== presentationKey
      ) return
      const previousFront = frontSlotRef.current
      if (previousFront && previousFront !== slot.id) slotElements.current[previousFront]?.pause()
      activeVideoRef.current = element
      onActiveVideoChange?.(element)
      frontSlotRef.current = slot.id
      pendingPresentationRef.current = null
      setMissingVideoId(null)
      setBuffer((current) => (
        current.slots.some((candidate) => candidate.id === slot.id && candidate.playback.key === slot.playback.key)
          ? { ...current, frontId: slot.id }
          : current
      ))
      recomputeRect()
    }

    if (element.requestVideoFrameCallback) {
      element.requestVideoFrameCallback(() => activate())
    } else {
      requestAnimationFrame(() => requestAnimationFrame(activate))
    }
  }

  const handleLoadedData = (slot: VideoSlot, element: HTMLVideoElement): void => {
    loadedSlotsRef.current.add(slot.id)
    refreshingPlaybackKeysRef.current.delete(slot.playback.key)
    setMissingVideoId(null)
    if (desiredKeyRef.current === slot.playback.key) {
      if (frontSlotRef.current === slot.id) {
        activeVideoRef.current = element
        onActiveVideoChange?.(element)
        reportEffectiveDuration(slot.playback, element)
        recomputeRect()
      } else {
        presentWhenFrameReady(slot, element)
      }
    }
  }

  const handleVideoError = (slot: VideoSlot, element: HTMLVideoElement): void => {
    const { playback } = slot
    if (desiredKeyRef.current !== playback.key || !playback.mediaId) return

    if (!refreshingPlaybackKeysRef.current.has(playback.key)) {
      const refreshedSrc = refreshPlaybackUrl(playback.src, ++refreshRevisionRef.current)
      if (refreshedSrc) {
        refreshingPlaybackKeysRef.current.add(playback.key)
        retryResumeTimeRef.current.set(slot.id, element.currentTime)
        loadedSlotsRef.current.delete(slot.id)
        setMissingVideoId(null)
        setBuffer((current) => ({
          ...current,
          slots: current.slots.map((candidate) => candidate.id === slot.id
            ? { ...candidate, playback: { ...candidate.playback, src: refreshedSrc } }
            : candidate),
        }))
        return
      }
    }

    setMissingVideoId(playback.mediaId)
  }

  return (
    <>
      {videoSrc ? (
        <>
          {buffer.slots.map((slot) => {
            const { playback } = slot
            const isFront = buffer.frontId === slot.id
            return (
              <video
                key={slot.id}
                ref={(element) => {
                  slotElements.current[slot.id] = element
                  if (!element) {
                    delete slotElements.current[slot.id]
                    loadedSlotsRef.current.delete(slot.id)
                  }
                }}
                data-video-slot={slot.id}
                data-playback-key={playback.key}
                src={playback.src}
                autoPlay={isFront}
                muted={!videoAudioEnabled || !isFront}
                playsInline
                preload="auto"
                loop={playback.loop}
                onLoadedMetadata={(event) => {
                  const videoDurationMs = Math.round(event.currentTarget.duration * 1000)
                  if (Number.isFinite(videoDurationMs) && videoDurationMs > 0) {
                    const capMs = playback.durationMs
                    effectiveDurationByKeyRef.current.set(
                      playback.key,
                      capMs && capMs > 0 && capMs <= videoDurationMs ? capMs : videoDurationMs,
                    )
                  }
                  if (desiredKeyRef.current !== playback.key) return
                  reportEffectiveDuration(playback, event.currentTarget)
                  const resumeAt = retryResumeTimeRef.current.get(slot.id)
                  if (resumeAt !== undefined) {
                    retryResumeTimeRef.current.delete(slot.id)
                    if (Number.isFinite(resumeAt) && resumeAt > 0) event.currentTarget.currentTime = resumeAt
                  }
                  setMissingVideoId(null)
                  if (isCurrentPlayback(slot.id, playback.key)) {
                    activeVideoRef.current = event.currentTarget
                    onActiveVideoChange?.(event.currentTarget)
                    recomputeRect()
                  }
                }}
                onLoadedData={(event) => handleLoadedData(slot, event.currentTarget)}
                onError={(event) => handleVideoError(slot, event.currentTarget)}
                onEnded={() => {
                  if (!isCurrentPlayback(slot.id, playback.key) || playback.loop) return
                  onPerformanceEnd()
                }}
                onTimeUpdate={(event) => {
                  if (!isCurrentPlayback(slot.id, playback.key)) return
                  const element = event.currentTarget
                  const nowMs = Math.floor(element.currentTime * 1000)
                  if (!playback.loop && videoDurationCapReached(nowMs, playback.durationMs, element.duration)) {
                    element.pause()
                    onPerformanceEnd()
                    return
                  }
                  onTick(nowMs)
                }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  opacity: isFront ? 1 : 0,
                  pointerEvents: 'none',
                }}
              />
            )
          })}
        </>
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.7, color: 'rgba(255,255,255,0.6)' }}>
          {placeholder ?? clip?.name ?? '（无演出）'}
        </div>
      )}
      {displayedMissingVideoId && !videoPending ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.72)', padding: 16, zIndex: 2 }}>
          <MissingVideoNotice resourceId={displayedMissingVideoId} />
        </div>
      ) : null}
      {videoPending ? (
        // 说明卡不吃点击、不整屏遮盖：底下占位视频照播、上层交互层(选项/HUD)照常点击,
        // 只是在近黑画面中央告诉玩家「这段还没出片」。
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, pointerEvents: 'none', zIndex: 1 }}>
          <div
            data-testid="stage-pending-card"
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, maxWidth: '80%', padding: '16px 20px', borderRadius: 10, background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.14)', textAlign: 'center' }}
          >
            <div style={{ color: 'rgba(255,255,255,0.92)', fontSize: 15, fontWeight: 600 }}>
              {clip?.name ?? placeholder ?? '（无演出）'}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>
              {translateUi('playStage.videoPending.message')}
            </div>
            {clip?.nodeId ? (
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
                {tf('playStage.node', { id: clip.nodeId })}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <VideoOverlayStage contentRect={contentRect}>
        <style>{'.gv-playback-layer.is-paused,.gv-playback-layer.is-paused *,.gv-playback-layer.is-paused *::before,.gv-playback-layer.is-paused *::after{animation-play-state:paused!important}'}</style>
        <div
          key={overlayKey ?? videoKey ?? clip?.nodeId ?? 'overlay'}
          className={`gv-playback-layer${paused ? ' is-paused' : ''}`}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          {overlayMounts.map((m) => (
            <span key={m.mountId} style={{ display: 'contents' }}>
              {skins?.renderOverlayMount(m, onEmit, skinCtx)}
            </span>
          ))}
        </div>
      </VideoOverlayStage>
    </>
  )
}
