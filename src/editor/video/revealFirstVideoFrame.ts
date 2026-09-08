const FIRST_FRAME_SEEK_SECONDS = 0.001

/** Force browsers to decode the first frame without starting playback. */
export function revealFirstVideoFrame(video: HTMLVideoElement): void {
  if (video.currentTime > 0 || !Number.isFinite(video.duration) || video.duration <= 0) return
  video.currentTime = Math.min(FIRST_FRAME_SEEK_SECONDS, video.duration / 2)
}
