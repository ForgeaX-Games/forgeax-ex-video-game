export type VideoFrameCapture = (url: string) => Promise<string>

const thumbnailCache = new Map<string, Promise<string>>()
const CAPTURE_WIDTH = 192
const CAPTURE_TIMEOUT_MS = 8_000

export function loadVideoThumbnail(
  url: string,
  capture: VideoFrameCapture = captureVideoFrame,
): Promise<string> {
  const cached = thumbnailCache.get(url)
  if (cached) return cached

  const pending = capture(url).catch(() => '')
  thumbnailCache.set(url, pending)
  return pending
}

async function captureVideoFrame(url: string): Promise<string> {
  if (typeof document === 'undefined') return ''

  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    const canvas = document.createElement('canvas')
    let settled = false

    const cleanup = () => {
      window.clearTimeout(timeoutId)
      video.removeEventListener('error', onError)
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
      video.removeEventListener('loadeddata', onFrameReady)
      video.removeEventListener('seeked', onFrameReady)
      video.removeAttribute('src')
      video.load()
    }
    const finish = (result: string, error?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(result)
    }
    const onError = () => finish('', new Error(`Unable to load video thumbnail: ${url}`))
    const onFrameReady = () => {
      if (!video.videoWidth || !video.videoHeight) return
      try {
        const aspect = video.videoHeight / video.videoWidth
        canvas.width = CAPTURE_WIDTH
        canvas.height = Math.max(48, Math.round(CAPTURE_WIDTH * aspect))
        const context = canvas.getContext('2d')
        if (!context) {
          finish('', new Error('Canvas 2D context is unavailable'))
          return
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        finish(canvas.toDataURL('image/jpeg', 0.72))
      } catch (error) {
        finish('', error instanceof Error ? error : new Error(String(error)))
      }
    }
    const onLoadedMetadata = () => {
      const seekTarget = Number.isFinite(video.duration) && video.duration > 0
        ? Math.min(0.1, video.duration / 2)
        : 0
      if (seekTarget > 0) {
        video.currentTime = seekTarget
      } else {
        video.addEventListener('loadeddata', onFrameReady, { once: true })
      }
    }
    const timeoutId = window.setTimeout(
      () => finish('', new Error(`Timed out loading video thumbnail: ${url}`)),
      CAPTURE_TIMEOUT_MS,
    )

    video.crossOrigin = 'anonymous'
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.addEventListener('error', onError, { once: true })
    video.addEventListener('loadedmetadata', onLoadedMetadata, { once: true })
    video.addEventListener('seeked', onFrameReady, { once: true })
    video.src = url
    video.load()
  })
}
