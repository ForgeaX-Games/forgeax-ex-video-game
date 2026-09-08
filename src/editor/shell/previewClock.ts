/**
 * previewClock —— 视频预览台的泛用「时钟」契约（编辑器专用；试玩 `GraphPlaySurface` 不导入）。
 *
 * 心智分工：
 *   - 宿主（本模块 + `.gc-preview-clock`）统一管「停」：暂停时把预览皮肤层
 *     子树内全部 CSS animation 冻在当前帧，恢复播放接着走——新皮肤只要用 CSS animation 就自动
 *     获得，不用接任何 props。
 *   - `localMsForChild` + rendererRegistry 的 preview/previewTimeMs 统一管「时刻」：只有少数要
 *     scrub 精确对齐入场帧、或自己用 rAF 计时的皮肤才需要按需 opt-in
 *     （见 `runtime/component-host/components/skinRuntime.ts` 的 previewTStyle）。
 */
import { createContext, useContext } from 'react'
import type { OverlayChild } from '@/runtime/core/schema/graph-schema'

export interface PreviewClock {
  /** 是否处于播放态（false = 暂停/scrub 中）。 */
  playing: boolean
  /** 当前播放头（相对整段素材，ms）。 */
  playheadMs: number
}

const PreviewClockContext = createContext<PreviewClock | null>(null)

/** 挂在预览皮肤层根节点；子树内想读时钟又不想接 props 的皮肤可用 `usePreviewClock`。 */
export const PreviewClockProvider = PreviewClockContext.Provider

/** 读取当前预览时钟；试玩路径（无 Provider）读到 null。 */
export function usePreviewClock(): PreviewClock | null {
  return useContext(PreviewClockContext)
}

/** 预览皮肤层根 className：暂停时叠加 `is-paused`（配合 `PREVIEW_CLOCK_CSS`）。 */
export function previewClockLayerClassName(playing: boolean): string {
  return `gc-preview-clock${playing ? '' : ' is-paused'}`
}

/**
 * 单个 OverlayChild 相对自己出现时刻的本地 ms（无 window 则相对 0，即等于 playheadMs）。
 * QTE（inkKou/battleParry）走 cues 而不挂 window，localMs 因此等于原始 playheadMs——行为不变；
 * choice/option 类（inkYingMo 等）挂了 window.startMs，localMs 就是「进场后过了多久」。
 */
export function localMsForChild(child: Pick<OverlayChild, 'window'>, playheadMs: number): number {
  return Math.max(0, playheadMs - (child.window?.startMs ?? 0))
}

export interface PreviewMediaClock {
  /** 视频元素本轮的 currentTime。 */
  mediaMs: number
  /** 结算、界面窗口和组件动画共用的节点时间。 */
  playheadMs: number
}

/**
 * 视频循环只回绕媒体画面，节点时间首轮走完后停在末端。
 * 主动拖动不走这里，而是由宿主同时重置 mediaMs/playheadMs，因此仍可回看任意帧。
 */
export function advancePreviewMediaClock(
  previous: PreviewMediaClock | null,
  mediaMs: number,
  maxMs: number,
  looping: boolean,
): PreviewMediaClock {
  const currentMediaMs = Math.max(0, Math.min(maxMs, Math.round(mediaMs)))
  if (!looping || !previous) return { mediaMs: currentMediaMs, playheadMs: currentMediaMs }

  const wrapToleranceMs = Math.max(1, Math.min(250, Math.round(maxMs * 0.1)))
  const wrapped = currentMediaMs + wrapToleranceMs < previous.mediaMs
  return {
    mediaMs: currentMediaMs,
    playheadMs: wrapped ? maxMs : Math.max(previous.playheadMs, currentMediaMs),
  }
}

/** 随预览皮肤层一次性注入：暂停时冻结子树内全部 CSS animation（新组件默认免接）。 */
export const PREVIEW_CLOCK_CSS = `
.gc-preview-clock.is-paused,
.gc-preview-clock.is-paused * {
  animation-play-state: paused !important;
}
`
