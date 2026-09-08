/**
 * 流程出口 handle 的人类可读标签（画布引脚 / 节点配置「出边」下拉共用）。
 * 落盘用机器 id（default / ying / pass …）；UI 只展示中文或组件提供的 label。
 */
import type { NodeHandle } from '@/runtime/core/schema/graph-schema'

const BUILTIN: Record<string, string> = {
  default: '默认推进',
  pass: '成功',
  fail: '失败',
  good: '良好',
  miss: '失手',
  A: '按键 A',
  B: '按键 B',
}

/** 仅由显式 `advance` 动作消费；不会作为事件出口或默认自动推进出口。 */
export const SETTLEMENT_ADVANCE_HANDLE_PREFIX = 'settlement-advance:'

export function isSettlementAdvanceHandle(id: string): boolean {
  return id.startsWith(SETTLEMENT_ADVANCE_HANDLE_PREFIX)
}

/** 将 sourceHandle（= 出口 event id）转成展示文案。 */
export function flowHandleDisplay(id: string, label?: string): string {
  if (label && label !== id) return label
  if (isSettlementAdvanceHandle(id)) return '结算推进'
  if (BUILTIN[id]) return BUILTIN[id]
  return id
}

export function flowHandleOption(h: NodeHandle): { value: string; label: string } {
  return { value: h.id, label: flowHandleDisplay(h.id, h.label) }
}

/** 合并 deriveOutputs + 边上已用到的 handle，去重保序。 */
export function mergeFlowHandles(
  derived: NodeHandle[],
  extraIds: Iterable<string>,
): Array<{ value: string; label: string }> {
  const seen = new Set<string>()
  const out: Array<{ value: string; label: string }> = []
  const push = (id: string, label?: string) => {
    if (seen.has(id)) return
    seen.add(id)
    out.push({ value: id, label: flowHandleDisplay(id, label) })
  }
  for (const h of derived) push(h.id, h.label)
  for (const id of extraIds) push(id)
  return out
}
