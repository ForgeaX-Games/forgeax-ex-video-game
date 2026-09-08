/** 视频 object-fit:contain 后的实际画面矩形（相对 video.parentElement）。 */
export interface VideoContentRect {
  left: number
  top: number
  width: number
  height: number
}

export function computeVideoContentRect(video: HTMLVideoElement): VideoContentRect | null {
  const parent = video.parentElement
  if (!parent) return null
  const boxW = parent.clientWidth
  const boxH = parent.clientHeight
  if (boxW <= 0 || boxH <= 0) return null
  const mediaW = video.videoWidth || 16
  const mediaH = video.videoHeight || 9
  const scale = Math.min(boxW / mediaW, boxH / mediaH)
  const width = mediaW * scale
  const height = mediaH * scale
  return {
    left: (boxW - width) / 2,
    top: (boxH - height) / 2,
    width,
    height,
  }
}

/** 将 pointer 事件坐标映射为画面归一化坐标 (0..1)，与 QTEOverlay 一致。 */
export function pointerToVideoNorm(
  clientX: number,
  clientY: number,
  frameEl: HTMLElement,
  video: HTMLVideoElement | null,
): { x: number; y: number } | null {
  const frame = frameEl.getBoundingClientRect()
  if (frame.width <= 0 || frame.height <= 0) return null
  const content = (video && computeVideoContentRect(video)) ?? {
    left: 0,
    top: 0,
    width: frame.width,
    height: frame.height,
  }
  const absLeft = frame.left + content.left
  const absTop = frame.top + content.top
  if (content.width <= 0 || content.height <= 0) return null
  return {
    x: Math.max(0, Math.min(1, (clientX - absLeft) / content.width)),
    y: Math.max(0, Math.min(1, (clientY - absTop) / content.height)),
  }
}
