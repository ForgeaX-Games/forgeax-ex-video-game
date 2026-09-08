/**
 * 演出节点「播放时长」上限判定（SSOT——三处试玩面 GamePlayer / GraphPlaySurface / GraphStudio +
 * 单节点预览 NodePreviewStage 共用）。纯函数,无宿主依赖,住 runtime/play。
 *
 * 规则（对齐 NodeData.durationMs 契约）：作者配的 `capMs` 必须 `>0` 且 `≤ 视频本身长度` 才生效,
 * 播放到点（`nowMs ≥ capMs`）即返回 true → 调用方 performanceEnd 提前收演出；
 * 否则（未填 / `≤0` / 超过视频长度 / 视频长度未知）返回 false,以视频本身长度为准（交给 onEnded）。
 *
 * @param nowMs            当前播放位置 ms（floor(video.currentTime*1000)）。
 * @param capMs            节点 data.durationMs（clip.durationMs）。
 * @param videoDurationSec 视频本身长度秒（video.duration,未加载时为 NaN）。
 */
export function videoDurationCapReached(
  nowMs: number,
  capMs: number | undefined,
  videoDurationSec: number,
): boolean {
  if (!capMs || capMs <= 0) return false
  const videoMs = Number.isFinite(videoDurationSec) ? videoDurationSec * 1000 : Infinity
  if (capMs > videoMs) return false // 超过视频长度 → 丢弃,以视频本身为准
  return nowMs >= capMs
}
