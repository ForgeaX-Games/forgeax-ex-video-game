import type { ContextReference } from '../../platform/context-reference'

/**
 * 共享的 `chat.reference.accept@1` producer 侧常量与工具。
 *
 * 节点 / 公式 / overlay 三类引用都用同一信封结构（见
 * docs/superpowers/specs/2026-08-05-chat-context-reference-capability-design.md），
 * 这里集中放跨 builder 复用的预算截断逻辑，避免每个 builder 各抄一份二分搜索。
 */
export const SOURCE_EXTENSION_ID = '@forgeax-extension/game-video'

/** 快照预算；权威来源仍是 `get-graph`（tools 协议），引用负载只是给 Agent 的上下文。 */
export const MAX_PAYLOAD_JSON_LENGTH = 30_000

/**
 * 超预算时降级为「身份字段 + 截断快照」：Agent 仍能定位目标，细节靠 `get-graph`
 * （tools 协议）补齐，而非依赖这份快照当权威数据。
 *
 * 快照塞进 JSON 字符串字段时原始 JSON 里的引号 / 反斜杠会被再转义，不能直接按原始
 * 子串长度分配预算，所以用二分搜索找出真正不超限的最大切片长度。
 */
export function truncatePayloadIfNeeded(
  payload: Record<string, unknown>,
  identity: Record<string, unknown>,
): unknown {
  const json = JSON.stringify(payload)
  if (json.length <= MAX_PAYLOAD_JSON_LENGTH) return payload

  const withSnapshot = (sliceLength: number) => ({
    ...identity,
    truncated: true,
    snapshot: `${json.slice(0, sliceLength)}…`,
  })

  let low = 0
  let high = json.length
  let best: unknown = { ...identity, truncated: true, snapshot: '…' }
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = withSnapshot(mid)
    if (JSON.stringify(candidate).length <= MAX_PAYLOAD_JSON_LENGTH) {
      best = candidate
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return best
}

/** 构造 tools 协议写回提示；默认指向蓝图读写两个 tool。 */
export function toolsAction(
  toolHints: readonly string[] = ['game-video:get-graph', 'game-video:patch-graph'],
): NonNullable<ContextReference['action']> {
  return { protocol: 'tools', toolHints }
}
