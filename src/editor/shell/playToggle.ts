/**
 * 试玩底栏播放按钮的动作语义 —— 对齐业内视频播放器：
 *   播放中 → 显示暂停（点一下停）
 *   暂停中 → 显示播放（点一下继续）
 *   已结束 → 显示播放（点一下重开），不继续显示暂停图标
 */
export type PlayToggleAction = 'pause' | 'resume' | 'restart'

export function resolvePlayToggleAction(input: {
  paused: boolean
  ended: boolean
}): PlayToggleAction {
  if (input.ended) return 'restart'
  return input.paused ? 'resume' : 'pause'
}

export function playToggleShowsPlay(action: PlayToggleAction): boolean {
  return action !== 'pause'
}
