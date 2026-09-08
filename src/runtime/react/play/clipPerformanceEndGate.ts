/**
 * 演出收尾闸门：同一 clip 只 performanceEnd 一次，且同步穿链到下一节点后
 * 禁止旧 `<video>` 的 onEnded / 残余 onTimeUpdate 误收下一节点。
 *
 * 典型事故：序章带 durationMs 上限 → cap 触发 end → 下钻子流程 → 旧 video 再 onEnded
 * → 子流程入口被立刻 advance 弹回，看起来像「跳过子流程直达子蓝图」。
 */
export class ClipPerformanceEndGate {
  private endedFor: string | null = null
  /** false = 刚收过尾、穿链中；等新 clip 挂载（reset）后再允许。 */
  private armed = true

  /** 新 clip 开演 / session 重开时调用。 */
  reset(): void {
    this.endedFor = null
    this.armed = true
  }

  /**
   * 尝试开始一次收尾。返回当前应结束的 nodeId；null = 忽略本次调用。
   * 调用方拿到 id 后应立刻 `performanceEnd()`（可能同步穿到下一节点）。
   */
  tryBegin(currentNodeId: string | null | undefined): string | null {
    if (!this.armed || !currentNodeId || this.endedFor === currentNodeId) return null
    this.endedFor = currentNodeId
    this.armed = false
    return currentNodeId
  }
}
