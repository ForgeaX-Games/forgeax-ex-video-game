/**
 * runtime/play —— 与宿主解耦的「玩游戏」层:GraphSession 之上的 React 播放壳 + 帧渲染件。
 * 只依赖 runtime + 注入契约(ResolveAsset / game slug),不 import editor/宿主。
 * editor 各试玩面消费本层;将来 arrival-studio 亦可直接复用。
 */
export { GamePlayer, type GamePlayerProps, type ResolveAsset } from './GamePlayer'
export { GameStage, type GameStageProps } from './GameStage'
export { VideoAudioToggle, type VideoAudioToggleProps } from './VideoAudioToggle'
export { BgmPlayer, type BgmPlayerProps } from './BgmPlayer'
export { videoDurationCapReached } from './videoTiming'
export { VideoOverlayStage } from './VideoOverlayStage'
export {
  ScaledOverlayContent,
  computeScaledOverlayGeometry,
  OVERLAY_LOGICAL_WIDTH,
  type ScaledOverlayGeometry,
} from './ScaledOverlayContent'
export { useVideoContentRect } from './useVideoContentRect'
export { computeVideoContentRect, pointerToVideoNorm, type VideoContentRect } from './videoContentRect'
export { MissingVideoNotice } from './MissingVideoNotice'
export { useClipPerformanceEnd } from './useClipPerformanceEnd'
export {
  PlaybackClockProvider,
  usePlaybackClock,
  usePlaybackTimeout,
  useControlledPlaybackTimeout,
  type PlaybackControl,
} from '../playback-clock'
