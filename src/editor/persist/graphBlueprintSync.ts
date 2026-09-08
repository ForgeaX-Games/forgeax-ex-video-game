/**
 * 跨 pane 蓝图库意图同步 —— 对齐 `graphViewStore` 的 BroadcastChannel 模式。
 * 只同步库级意图（选中 / 新建 / 重命名 / 删除 / 设入口），不同步画布节点编辑。
 */
import type { BlueprintDoc } from '@/runtime/core/schema/graph-schema'
import { useGraphScenario } from './graphScenarioStore'
import { gameKeySuffix } from './gameScope'

// 按 game 隔离频道：BroadcastChannel 作用域是整个 origin，不加后缀会让同源里
// 多开的不同 game workspace 共用一条频道，一个 tab 选蓝图会串到别的 game 的 tab。
// 后缀在 install 时才求值：进程内挂载的 game 标识由宿主注入，晚于本模块求值。
const CHANNEL_BASE = 'game-video:graph:blueprint-sync'

export type BlueprintSyncMsg =
  | { type: 'select'; id: string }
  | { type: 'created'; doc: BlueprintDoc }
  | { type: 'renamed'; id: string; title: string }
  | { type: 'deleted'; id: string; nextActive: string }
  | { type: 'mainSet'; id: string }

let channel: BroadcastChannel | null = null
/** 收到远端广播时置位，避免 store 成功路径再往回广播成回环。 */
let applyingRemote = false

const EMPTY_GRAPH = { nodes: [] as never[], edges: [] as never[] }

function isSyncMsg(v: unknown): v is BlueprintSyncMsg {
  if (!v || typeof v !== 'object') return false
  const t = (v as { type?: unknown }).type
  return t === 'select' || t === 'created' || t === 'renamed' || t === 'deleted' || t === 'mainSet'
}

/** store 成功路径调用；未 install 或正在 apply remote 时 no-op。 */
export function broadcastBlueprintIntent(msg: BlueprintSyncMsg): void {
  if (applyingRemote) return
  channel?.postMessage(msg)
}

function applyRemote(msg: BlueprintSyncMsg): void {
  const st = useGraphScenario.getState()
  switch (msg.type) {
    case 'select': {
      if (!st.blueprints[msg.id]) return
      st.selectBlueprint(msg.id)
      return
    }
    case 'created': {
      const doc = msg.doc
      if (!doc?.id) return
      useGraphScenario.setState((s) => ({
        blueprints: { ...s.blueprints, [doc.id]: doc },
        activeBlueprintId: doc.id,
        graph: doc.graph,
        selectedNodeId: null,
        fitSignal: s.fitSignal + 1,
      }))
      useGraphScenario.getState().touchDraft()
      return
    }
    case 'renamed': {
      if (!st.blueprints[msg.id]) return
      useGraphScenario.setState((s) => {
        const prev = s.blueprints[msg.id]
        if (!prev) return s
        return { blueprints: { ...s.blueprints, [msg.id]: { ...prev, title: msg.title } } }
      })
      useGraphScenario.getState().touchDraft()
      return
    }
    case 'deleted': {
      useGraphScenario.setState((s) => {
        if (!s.blueprints[msg.id]) return s
        const next = { ...s.blueprints }
        delete next[msg.id]
        const nextActive = next[msg.nextActive] ? msg.nextActive : s.mainBlueprintId
        return {
          blueprints: next,
          activeBlueprintId: nextActive,
          graph: next[nextActive]?.graph ?? EMPTY_GRAPH,
          selectedNodeId: null,
        }
      })
      useGraphScenario.getState().touchDraft()
      return
    }
    case 'mainSet': {
      if (!st.blueprints[msg.id]) return
      useGraphScenario.setState({ mainBlueprintId: msg.id })
      useGraphScenario.getState().touchDraft()
      return
    }
  }
}

/**
 * 启用跨 pane 蓝图意图同步（仅 split-pane 嵌入态调用）。返回 dispose。
 */
export function installGraphBlueprintSync(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  channel = new BroadcastChannel(`${CHANNEL_BASE}${gameKeySuffix()}`)
  channel.onmessage = (e: MessageEvent) => {
    if (!isSyncMsg(e.data)) return
    applyingRemote = true
    try {
      applyRemote(e.data)
    } finally {
      applyingRemote = false
    }
  }
  return () => {
    channel?.close()
    channel = null
  }
}

/** 单测用：重置模块级 channel / 标志（不关闭外部传入的 mock）。 */
export function resetGraphBlueprintSyncForTests(): void {
  channel?.close()
  channel = null
  applyingRemote = false
}
