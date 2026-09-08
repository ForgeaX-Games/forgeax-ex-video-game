/**
 * 节点尺寸回环 —— 把 xyflow 量出来的宽高留在「我们下一次交给它的节点对象」上。
 *
 * 为什么需要：画布是受控用法，每次点选都会重建整份 nodes 数组。xyflow 用引用相等判断
 * 「还是不是同一个用户节点」，对象换了新的就当作重新初始化，把 measured 与 handleBounds
 * 一起清空（见 `@xyflow/system` 的 `adoptUserNodes` / `parseHandles`）。没有尺寸的节点会被
 * 渲染成 visibility:hidden、边也暂时找不到锚点，直到 ResizeObserver 重新量回来——这中间
 * 的一帧就是用户看到的「蓝图闪一下」。测量结果只会经 `onNodesChange` 的 dimensions 变更
 * 回到我们手上，丢掉它就等于每次重建都要重来一遍。
 *
 * 复用有条件：只有「布局签名」没变才认。出口增删、标题/摘要变化都会改卡片尺寸，这时宁可
 * 让 xyflow 重量一次，也不能把过期的 handleBounds 留给连线去锚。选中态不进签名——它只改
 * 描边颜色，正是必须无损切换的那一种变化。
 */

export type NodeMeasure = { width: number; height: number }

export type NodeMeasureCache = Map<string, { signature: string; measured: NodeMeasure }>

/** onNodesChange 里我们关心的那一类变更（结构化取形，避免把 xyflow 类型拖进纯逻辑）。 */
export type MeasuredChange = {
  type: string
  id?: string
  dimensions?: { width: number; height: number }
}

export type NodeLayoutSignatureInput = {
  label: string
  /** 出口按渲染顺序：条数决定卡片高度，文案决定宽度。 */
  outputs: readonly { id: string; label: string }[]
  inputCount: number
  performance?: string
  interfaces: readonly string[]
  settlements: readonly string[]
  isEntry: boolean
  isGroup: boolean
  isPack: boolean
  /** 只读画布不渲染节点操作条，卡片外框跟着变。 */
  readOnly: boolean
}

const FIELD_SEP = '\u0001'
const ITEM_SEP = '\u0002'

export function createNodeMeasureCache(): NodeMeasureCache {
  return new Map()
}

/** 卡片布局的指纹：任何会改变渲染盒子的输入都要在里面，选中/试玩高亮不在。 */
export function nodeLayoutSignature(input: NodeLayoutSignatureInput): string {
  return [
    input.label,
    input.outputs.map((o) => `${o.id}=${o.label}`).join(ITEM_SEP),
    String(input.inputCount),
    input.performance ?? '',
    input.interfaces.join(ITEM_SEP),
    input.settlements.join(ITEM_SEP),
    input.isEntry ? 'entry' : '',
    input.isGroup ? 'group' : '',
    input.isPack ? 'pack' : '',
    input.readOnly ? 'ro' : '',
  ].join(FIELD_SEP)
}

/** 收下 xyflow 报上来的度量结果，按当时渲染的签名归档。 */
export function rememberNodeMeasures(
  cache: NodeMeasureCache,
  changes: readonly MeasuredChange[],
  signatureOf: (nodeId: string) => string | undefined,
): void {
  for (const change of changes) {
    if (change.type !== 'dimensions' || !change.id) continue
    const { width, height } = change.dimensions ?? {}
    // 0 尺寸是「还没布局」而不是量到了，记下来会让节点以塌陷状态复活。
    if (!width || !height) continue
    const signature = signatureOf(change.id)
    if (signature === undefined) continue
    cache.set(change.id, { signature, measured: { width, height } })
  }
}

/** 签名一致才复用；否则返回 undefined，让 xyflow 重量一次。 */
export function reuseNodeMeasure(
  cache: NodeMeasureCache,
  nodeId: string,
  signature: string,
): NodeMeasure | undefined {
  const hit = cache.get(nodeId)
  return hit && hit.signature === signature ? hit.measured : undefined
}

/** 节点删了 / 切了蓝图，别把尺寸永远留在缓存里。 */
export function pruneNodeMeasures(cache: NodeMeasureCache, liveIds: Iterable<string>): void {
  const live = liveIds instanceof Set ? liveIds : new Set(liveIds)
  for (const id of [...cache.keys()]) {
    if (!live.has(id)) cache.delete(id)
  }
}
