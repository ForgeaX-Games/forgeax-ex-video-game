import { useEffect, useRef, useState, type CSSProperties } from 'react'
import fullscreenIcon from '@/editor/ui-assets/video-control-fullscreen.svg?url'
import { PreviewPauseIcon, PreviewPlayIcon } from '@/editor/shell/nodePreviewControls'
import { tf, useT } from '../../../../../i18n'
import {
  canPerformGenerationAction,
  type GeneratedVideoAsset,
  type GenerationInteractionState,
  type GenerationPhase,
} from '../types'
import { GenerationPreviewFrame } from './GenerationPreviewFrame'
import { revealFirstVideoFrame } from '@/editor/video/revealFirstVideoFrame'

export interface VideoPreviewProps {
  asset: GeneratedVideoAsset
  /** Optional direct playback override for task results that have not been registered as assets. */
  src?: string
  phase?: GenerationPhase
  interaction?: GenerationInteractionState
  ariaLabel?: string
  className?: string
  showFooter?: boolean
  applied?: boolean
  applying?: boolean
  applyError?: string | null
  onPlay?: (asset: GeneratedVideoAsset) => void
  onPlayAsset?: (asset: GeneratedVideoAsset) => void
  onPause?: (asset: GeneratedVideoAsset) => void
  onApply?: (asset: GeneratedVideoAsset) => void
  onLocate?: (resourceId: string) => void
  onLocateAsset?: (resourceId: string) => void
  onClose?: (asset: GeneratedVideoAsset) => void
}

const DEFAULT_INTERACTION: GenerationInteractionState = {
  disabled: false,
  readOnly: false,
  busy: false,
}

/** Video-specific preview atom with playback, apply and asset-location contracts. */
export function VideoPreview({
  asset,
  src,
  phase = 'succeeded',
  interaction = DEFAULT_INTERACTION,
  ariaLabel,
  className,
  showFooter = true,
  applied = false,
  applying = false,
  applyError,
  onPlay,
  onPlayAsset,
  onPause,
  onApply,
  onLocate,
  onLocateAsset,
  onClose,
}: VideoPreviewProps): React.JSX.Element {
  const t = useT()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(asset.durationSeconds ?? 0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const resolvedSrc = src ?? asset.url
  const name = asset.label?.trim() || t('assetComponents.kind.video')
  const canRead = !interaction.disabled
  const canMutate = canPerformGenerationAction(interaction, 'edit')
  const locate = onLocateAsset ?? onLocate
  const hasLocate = Boolean(asset.resourceId && locate)
  const play = onPlayAsset ?? onPlay

  useEffect(() => {
    setPlaying(false)
    setCurrentTime(0)
    setDuration(asset.durationSeconds ?? 0)
    setPlaybackRate(1)
  }, [asset.durationSeconds, resolvedSrc])

  const togglePlayback = (): void => {
    if (!canRead) return
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      setPlaying(true)
      play?.(asset)
      void video.play().catch(() => setPlaying(false))
    } else {
      video.pause()
      setPlaying(false)
      onPause?.(asset)
    }
  }

  const cyclePlaybackRate = (): void => {
    if (!canRead) return
    const video = videoRef.current
    const next = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1
    if (video) video.playbackRate = next
    setPlaybackRate(next)
  }

  const openFullscreen = (): void => {
    if (!canRead) return
    const video = videoRef.current
    if (video?.requestFullscreen) void video.requestFullscreen()
  }

  return (
    <GenerationPreviewFrame
      phase={phase}
      interaction={interaction}
      ariaLabel={ariaLabel ?? t('videoAssets.generate.output')}
      className={className}
      showFooter={showFooter}
    >
      <div className="generation-preview-video">
        {resolvedSrc ? (
          <video
            ref={videoRef}
            data-testid="generation-preview"
            src={resolvedSrc}
            preload="metadata"
            playsInline
            aria-label={tf('generation.preview.inspect', { name })}
            onClick={togglePlayback}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => {
              setDuration(event.currentTarget.duration)
              revealFirstVideoFrame(event.currentTarget)
            }}
            onEnded={() => setPlaying(false)}
          />
        ) : (
          <span
            className="generation-preview-video__placeholder"
            role="img"
            aria-label={tf('generation.preview.empty', { name })}
          >
            ◇
          </span>
        )}
        {onClose ? (
          <button
            type="button"
            className="generation-preview-video__close"
            data-action="close"
            disabled={!canRead}
            aria-label={tf('generation.preview.close', { name })}
            onClick={() => onClose(asset)}
          >
            ×
          </button>
        ) : null}
        <div className="generation-preview-video__controls">
          <div className="generation-preview-video__control-row">
            <button
              type="button"
              data-action={playing ? 'pause' : 'play'}
              disabled={!canRead || !resolvedSrc}
              aria-label={tf(playing ? 'generation.preview.pause' : 'generation.preview.play', { name })}
              onClick={togglePlayback}
            >
              {playing ? <PreviewPauseIcon /> : <PreviewPlayIcon />}
            </button>
            <span className="generation-preview-video__time is-current" aria-live="off">{formatVideoTime(currentTime)}</span>
            <span className="generation-preview-video__time-separator" aria-hidden>/</span>
            <span className="generation-preview-video__time">{formatVideoTime(duration)}</span>
            <button
              type="button"
              className="generation-preview-video__rate"
              data-action="rate"
              disabled={!canRead || !resolvedSrc}
              aria-label={t('videoAssets.generate.player.rate')}
              onClick={cyclePlaybackRate}
            >
              {tf('videoAssets.generate.player.rateValue', { rate: playbackRate.toFixed(1) })}
            </button>
            <button
              type="button"
              className="generation-preview-video__fullscreen"
              data-action="fullscreen"
              disabled={!canRead || !resolvedSrc}
              aria-label={t('videoAssets.generate.player.fullscreen')}
              onClick={openFullscreen}
            >
              <img src={fullscreenIcon} alt="" />
            </button>
          </div>
          {resolvedSrc ? (
            <input
              type="range"
              className="generation-preview-video__progress"
              min={0}
              max={Math.max(duration, 0.01)}
              step={0.01}
              value={Math.min(currentTime, Math.max(duration, 0.01))}
              disabled={!canRead}
              aria-label={t('videoAssets.generate.player.progress')}
              style={{ '--generation-preview-progress': `${duration > 0 ? (currentTime / duration) * 100 : 0}%` } as CSSProperties}
              onChange={(event) => {
                const next = Number(event.target.value)
                if (videoRef.current) videoRef.current.currentTime = next
                setCurrentTime(next)
              }}
            />
          ) : null}
          {onApply || hasLocate ? <div className="generation-preview-video__actions">
            {onApply ? (
              <button
                type="button"
                className="generation-preview-video__apply"
                data-action="apply"
                disabled={!canMutate || applied || applying}
                aria-label={tf('generation.preview.apply', { name })}
                onClick={() => onApply(asset)}
              >
                {t(applied
                  ? 'videoAssets.generate.player.applied'
                  : applying
                    ? 'videoAssets.generate.player.applying'
                    : 'videoAssets.generate.player.apply')}
              </button>
            ) : null}
            {hasLocate ? (
              <button
                type="button"
                data-action="locate"
                disabled={!canRead}
                aria-label={tf('generation.preview.locate', { name })}
                onClick={() => locate?.(asset.resourceId as string)}
              >
                {tf('generation.preview.locate', { name })}
              </button>
            ) : null}
          </div> : null}
          {applyError ? <p className="generation-preview-video__apply-error" role="alert">{applyError}</p> : null}
        </div>
      </div>
    </GenerationPreviewFrame>
  )
}

function formatVideoTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  const minutes = Math.floor(whole / 60)
  const remainder = String(whole % 60).padStart(2, '0')
  return `${minutes}:${remainder}`
}
