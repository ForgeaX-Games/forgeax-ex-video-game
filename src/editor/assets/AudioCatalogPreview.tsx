import { useEffect, useRef, useState } from 'react'
import { tf as translateUiFormat } from '../../i18n'
import { AudioWaveform } from '@/editor/video/audioWaveform'
import { MediaPreviewControls, VideoFullscreenDialog } from '../shell/VideoFullscreenDialog'
import audioWaveformIcon from '@/editor/ui-assets/asset-audio-waveform.svg?url'

const WAVEFORM_PIXELS_PER_SECOND = 100

export function AudioCatalogPreview({
  open,
  src,
  label,
  onClose,
}: {
  open: boolean
  src: string
  label: string
  onClose(): void
}): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const waveformWidth = Math.max(1, Math.ceil(duration * WAVEFORM_PIXELS_PER_SECOND))

  useEffect(() => {
    if (open) return
    audioRef.current?.pause()
    setPlaying(false)
  }, [open])

  useEffect(() => {
    if (!playing) return
    let frame = 0
    const syncPlayhead = (): void => {
      const nextTime = audioRef.current?.currentTime
      if (nextTime !== undefined) setCurrentTime(nextTime)
      frame = requestAnimationFrame(syncPlayhead)
    }
    frame = requestAnimationFrame(syncPlayhead)
    return () => cancelAnimationFrame(frame)
  }, [playing])

  const togglePlayback = (): void => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) void audio.play().catch(() => setPlaying(false))
    else audio.pause()
  }

  const restartPlayback = (): void => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = 0
    void audio.play().catch(() => setPlaying(false))
  }

  const updatePlaybackRate = (): void => {
    const audio = audioRef.current
    const nextRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1
    setPlaybackRate(nextRate)
    if (audio) audio.playbackRate = nextRate
  }

  return <VideoFullscreenDialog
    open={open}
    label={label}
    onClose={onClose}
    controls={<MediaPreviewControls
      currentTime={currentTime}
      duration={duration}
      playing={playing}
      playbackRate={playbackRate}
      onTogglePlayback={togglePlayback}
      onRestartPlayback={restartPlayback}
      onSeek={(time) => {
        setCurrentTime(time)
        if (audioRef.current) audioRef.current.currentTime = time
      }}
      onUpdatePlaybackRate={updatePlaybackRate}
      fullscreenDisabled
    />}
  >
    <div className="vfd-audio-stage">
      <div className="vfd-audio-waveform" aria-label={translateUiFormat('audioPreview.waveformAria', { name: label })}>
        <div className="vfd-audio-track" style={{ width: waveformWidth, transform: `translateX(-${currentTime * WAVEFORM_PIXELS_PER_SECOND}px)` }}>
          <AudioWaveform src={src} width={waveformWidth} height={256} color="rgba(255,255,255,.86)" variant="bars" durationSeconds={duration} barsPerSecond={8} playedRatio={duration > 0 ? currentTime / duration : 0} className="vfd-audio-waveform-canvas" fallbackSrc={audioWaveformIcon} />
        </div>
        <span className="vfd-audio-playhead" aria-hidden />
      </div>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        aria-label={translateUiFormat('audioPreview.previewAria', { name: label })}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </div>
  </VideoFullscreenDialog>
}
