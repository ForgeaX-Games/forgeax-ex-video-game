import { t as translateUi, tf as translateUiFormat } from '../../i18n'
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import { revealFirstVideoFrame } from '@/editor/video/revealFirstVideoFrame'
import restartIcon from '@/editor/ui-assets/video-control-restart.svg?url'
import fullscreenIcon from '@/editor/ui-assets/video-control-fullscreen.svg?url'

export interface VideoFullscreenDialogProps {
  open: boolean
  src?: string | null
  label: string
  durationMs?: number
  onClose: () => void
  onImport?: () => void | Promise<void>
  children?: ReactNode
  controls?: ReactNode
}

export const VIDEO_FULLSCREEN_DIALOG_CSS = `
.vfd-backdrop {
  position: fixed;
  z-index: var(--z-top, 9999);
  inset: 0;
  background: #000;
}
.vfd-dialog {
  box-sizing: border-box;
  display: grid;
  position: relative;
  grid-template-rows: minmax(0, 1fr);
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: #000;
  color: #f5f6f8;
  box-shadow: none;
}
.vfd-footer {
  display: flex;
  flex: none;
  align-items: center;
  padding: 14px 16px;
  background: rgba(0, 0, 0, .48);
}
.vfd-header { position: absolute; z-index: 1; top: 12px; right: 12px; }
.vfd-footer { position: absolute; z-index: 1; inset: auto 0 0; justify-content: flex-end; border-top: 0; }
.vfd-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
.vfd-close,
.vfd-import {
  border: 1px solid transparent;
  border-radius: 8px;
  font: inherit;
  cursor: pointer;
}
.vfd-close {
  display: grid;
  flex: none;
  width: 30px;
  height: 30px;
  padding: 0;
  place-items: center;
  background: transparent;
  color: #c5cad5;
  font-size: 20px;
  line-height: 1;
}
.vfd-close:hover { background: rgba(255, 255, 255, .09); color: #fff; }
.vfd-import {
  padding: 8px 12px;
  background: #f2a65a;
  color: #24170b;
  font-size: 13px;
  font-weight: 650;
}
.vfd-import:hover { background: #ffb76d; }
.vfd-close:focus-visible,
.vfd-import:focus-visible { outline: 2px solid #8ab4ff; outline-offset: 2px; }
.vfd-stage {
  display: grid;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  place-items: center;
  background: #000;
}
.vfd-stage > .gvv-video-col {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: clamp(12px, 2vw, 24px);
}
.vfd-stage > .gvv-video-col .gc-frame {
  width: 100%;
  height: 100%;
  min-height: 0;
  max-height: none;
  aspect-ratio: auto;
  flex: 1 1 0;
}
.vfd-stage > .gvv-video-col .gvv-controls { flex: none; }
.vfd-video {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  background: #050608;
}
.vfd-controls {
  position: absolute;
  z-index: 1;
  inset: auto 0 0;
  display: flex;
  box-sizing: border-box;
  flex-direction: column;
  gap: 24px;
  width: 100%;
  padding: 24px;
  background: linear-gradient(to top, rgba(0, 0, 0, .9), rgba(0, 0, 0, .5) 50%, transparent);
}
.vfd-progress {
  width: 100%;
  height: 6px;
  margin: 0;
  appearance: none;
  border: 0;
  border-radius: 999px;
  background: linear-gradient(to right, #ff9c2a 0 var(--vfd-progress), rgba(255, 255, 255, .2) var(--vfd-progress) 100%);
  cursor: pointer;
}
.vfd-progress::-webkit-slider-thumb { width: 0; height: 0; appearance: none; }
.vfd-control-row { display: flex; align-items: center; justify-content: space-between; height: 20px; }
.vfd-control-left,
.vfd-control-right,
.vfd-time { display: flex; align-items: center; }
.vfd-control-left { gap: 16px; }
.vfd-control-right { gap: 24px; }
.vfd-time { gap: 4px; color: rgba(255, 255, 255, .4); font-size: 16px; line-height: 20px; }
.vfd-time-current { color: rgba(255, 255, 255, .8); }
.vfd-control-button {
  display: grid;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  place-items: center;
  color: rgba(255, 255, 255, .8);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 16px;
  line-height: 1;
}
.vfd-control-button:hover { color: #fff; }
.vfd-play-icon { display: flex; gap: 5px; }
.vfd-play-icon > i { display: block; width: 2.5px; height: 15px; background: currentColor; }
.vfd-restart-icon { display: block; width: 19px; height: 20px; }
.vfd-fullscreen-icon > img { display: block; width: 20px; height: 20px; }
.vfd-rate { padding: 0; border: 0; color: #ff9c2a; background: transparent; cursor: pointer; font: inherit; font-size: 16px; line-height: 20px; }
.vfd-image {
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  object-fit: contain;
}
.vfd-audio-stage {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  background: #050608;
}
.vfd-audio-stage > audio { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.vfd-audio-waveform {
  position: relative;
  display: grid;
  width: min(84vw, 960px);
  height: min(36vh, 256px);
  overflow: hidden;
  background: #050608;
}
.vfd-audio-track {
  position: absolute;
  top: 0;
  left: 50%;
  height: 100%;
  will-change: transform;
}
.vfd-audio-waveform-canvas-fallback {
  position: absolute;
  inset: 0;
}
.vfd-audio-waveform-canvas-fallback > canvas {
  position: absolute;
  width: 100%;
  height: 100%;
  transition: opacity .12s ease;
}
.vfd-audio-waveform-canvas-fallback > img {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 110px;
  height: 32px;
  object-fit: contain;
  transform: translate(-50%, -50%);
  transition: opacity .12s ease;
}
.vfd-audio-playhead {
  position: absolute;
  z-index: 1;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  background: linear-gradient(90deg, #FF7001 .01%, var(--prim-color-orange-500, #FF9C2A) 100%);
  box-shadow: 0 0 6px rgba(255, 156, 42, .45);
  transform: translateX(-.5px);
  pointer-events: none;
}
.vfd-control-button:disabled { cursor: not-allowed; opacity: .28; }
.vfd-empty {
  max-width: 360px;
  padding: 24px;
  color: #aeb5c4;
  font-size: 14px;
  line-height: 1.55;
  text-align: center;
}
.vfd-empty strong { display: block; margin-bottom: 6px; color: #f5f6f8; font-size: 15px; }
@media (max-width: 560px) {
  .vfd-controls { gap: 16px; padding: 16px; }
}
`

injectStyleOnce('game-video-fullscreen-dialog', VIDEO_FULLSCREEN_DIALOG_CSS)

function formatPlaybackTime(value: number): string {
  const seconds = Math.max(0, Math.floor(value || 0))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function MediaPreviewControls({
  currentTime,
  duration,
  playing,
  playbackRate,
  onTogglePlayback,
  onRestartPlayback,
  onSeek,
  onUpdatePlaybackRate,
  onFullscreen,
  fullscreenDisabled = false,
}: {
  currentTime: number
  duration: number
  playing: boolean
  playbackRate: number
  onTogglePlayback(): void
  onRestartPlayback(): void
  onSeek(time: number): void
  onUpdatePlaybackRate(): void
  onFullscreen?(): void
  fullscreenDisabled?: boolean
}): JSX.Element {
  const progress = duration > 0 ? Math.min(100, currentTime / duration * 100) : 0
  return <div className="vfd-controls">
    <input
      className="vfd-progress"
      type="range"
      min="0"
      max={duration || 0}
      step="0.01"
      value={currentTime}
      style={{ '--vfd-progress': `${progress}%` } as CSSProperties}
      aria-label={translateUi('mediaPreview.progress')}
      onChange={(event) => onSeek(Number(event.target.value))}
    />
    <div className="vfd-control-row">
      <div className="vfd-control-left">
        <button type="button" className="vfd-control-button" onClick={onTogglePlayback} aria-label={translateUi(playing ? 'mediaPreview.pause' : 'mediaPreview.play')}>
          {playing ? <span className="vfd-play-icon" aria-hidden><i /><i /></span> : '▶'}
        </button>
        <button type="button" className="vfd-control-button" onClick={onRestartPlayback} aria-label={translateUi('mediaPreview.replay')}><img className="vfd-restart-icon" src={restartIcon} alt="" /></button>
        <span className="vfd-time"><span className="vfd-time-current">{formatPlaybackTime(currentTime)}</span><span>/</span><span>{formatPlaybackTime(duration)}</span></span>
      </div>
      <div className="vfd-control-right">
        <button type="button" className="vfd-rate" onClick={onUpdatePlaybackRate}>{translateUiFormat('mediaPreview.rateValue', { rate: playbackRate.toFixed(1) })}</button>
        <button type="button" className="vfd-control-button vfd-fullscreen-icon" onClick={onFullscreen} aria-label={translateUi('mediaPreview.fullscreen')} disabled={fullscreenDisabled}><img src={fullscreenIcon} alt="" /></button>
      </div>
    </div>
  </div>
}

export function VideoFullscreenDialog({
  open,
  src,
  label,
  onClose,
  onImport,
  children,
  controls,
}: VideoFullscreenDialogProps): JSX.Element | null {
  const titleId = useId()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const activeElementRef = useRef<HTMLElement | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [fittedVideoSize, setFittedVideoSize] = useState<{ width: number; height: number } | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const fitVideoToStage = useCallback((): void => {
    const stage = stageRef.current
    const video = videoRef.current
    if (!stage || !video || !video.videoWidth || !video.videoHeight) return

    const { width: stageWidth, height: stageHeight } = stage.getBoundingClientRect()
    if (!stageWidth || !stageHeight) return

    const scale = Math.min(stageWidth / video.videoWidth, stageHeight / video.videoHeight)
    const width = Math.floor(video.videoWidth * scale)
    const height = Math.floor(video.videoHeight * scale)
    setFittedVideoSize((current) => current?.width === width && current.height === height ? current : { width, height })
  }, [])

  useEffect(() => {
    if (!open || typeof document === 'undefined') return

    const activeElement = document.activeElement
    activeElementRef.current = activeElement instanceof HTMLElement ? activeElement : null
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCloseRef.current()
    }
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown)
      activeElementRef.current?.focus()
      activeElementRef.current = null
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const stage = stageRef.current
    if (!stage) return

    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fitVideoToStage)
    resizeObserver?.observe(stage)
    window.addEventListener('resize', fitVideoToStage)
    fitVideoToStage()

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', fitVideoToStage)
    }
  }, [fitVideoToStage, open, src])

  const togglePlayback = (): void => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play()
    else video.pause()
  }

  const restartPlayback = (): void => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = 0
    void video.play()
  }

  const updatePlaybackRate = (): void => {
    const video = videoRef.current
    const nextRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1
    setPlaybackRate(nextRate)
    if (video) video.playbackRate = nextRate
  }

  if (!open || typeof document === 'undefined') return null

  const hasVideoPreview = Boolean(src?.trim())
  return createPortal(
    <div
      className="vfd-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="vfd-dialog" style={{ width: '100vw', height: '100dvh' }} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="vfd-header">
          <span id={titleId} className="vfd-visually-hidden">{label}</span>
          <button ref={closeButtonRef} type="button" className="vfd-close" onClick={onClose} aria-label={translateUi('ui.copy.03a55b6d4114')} title={translateUi('ui.copy.6c14bd7f6f9e')}>
            ×
          </button>
        </header>
        <div ref={stageRef} className="vfd-stage" style={{ width: '100%', height: '100%', minHeight: 0 }}>
          {children != null ? children : hasVideoPreview ? (
            <video
              ref={videoRef}
              className="vfd-video"
              style={fittedVideoSize ? { width: fittedVideoSize.width, height: fittedVideoSize.height, maxWidth: 'none', maxHeight: 'none' } : undefined}
              src={src ?? undefined}
              playsInline
              aria-label={`${label}${translateUi('ui.template.86bdb43fefd9')}`}
              onLoadedMetadata={(event) => {
                revealFirstVideoFrame(event.currentTarget)
                setDuration(event.currentTarget.duration || 0)
                fitVideoToStage()
              }}
              onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
          ) : (
            <div className="vfd-empty" role="status">
              <strong>{translateUi('ui.copy.2cd050d915f7')}</strong>
              {translateUi('ui.copy.e619d106f8b0')}</div>
          )}
        </div>
        {controls ?? (hasVideoPreview && children == null ? <MediaPreviewControls
          currentTime={currentTime}
          duration={duration}
          playing={playing}
          playbackRate={playbackRate}
          onTogglePlayback={togglePlayback}
          onRestartPlayback={restartPlayback}
          onSeek={(time) => { setCurrentTime(time); if (videoRef.current) videoRef.current.currentTime = time }}
          onUpdatePlaybackRate={updatePlaybackRate}
          onFullscreen={() => { void stageRef.current?.requestFullscreen?.() }}
        /> : null)}
        {onImport ? (
          <footer className="vfd-footer">
            <button type="button" className="vfd-import" onClick={() => { void onImport() }}>
              {translateUi('ui.copy.0841fce504c0')}</button>
          </footer>
        ) : null}
      </section>
    </div>,
    document.body,
  )
}
