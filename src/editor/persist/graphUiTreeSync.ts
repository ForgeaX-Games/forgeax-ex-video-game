/**
 * 跨 pane 界面树（uiTree）意图同步 —— 对齐 `graphBlueprintSync` 的模式。
 *
 * 与蓝图同构：left/center 各自直接读写本地 `graphScenarioStore`，store action 成功后
 * 广播「意图」（最小数据，非完整 snapshot），对 pane `applyRemote` 用意图数据落地到本地
 * store。选中态跨 pane 由 `select` 意图承载（对齐 `activeBlueprintId` 的 select 广播）。
 *
 * 这取代了旧的 `uiNavSync` 命令通道 + snapshot 镜像：旧方案让 left 当「哑终端」只能发命令、
 * 靠 center 回传整个 snapshot，一次命令内多次 store 写入会发出多个 snapshot，左栏高亮会
 * 先收到带旧选中态的中间 snapshot 而闪烁。意图广播只发一次最终意图，无中间态。
 */
import type { Overlay, UiTree } from '@/runtime/core/schema/graph-schema'
import { useGraphScenario } from './graphScenarioStore'
import { useUiSelection } from './uiSelectionStore'
import {
  addUiTreeFolder,
  addUiTreeScheme,
  ensureUiTree,
  findUiTreeNode,
  removeUiTreeNode,
  renameUiTreeFolder,
} from './ui-tree'
import { gameKeySuffix } from './gameScope'

// 按 game 隔离频道：与 graphBlueprintSync / graphViewSync 同源跨 tab 隔离一致。
// 后缀在 install 时才求值：进程内挂载的 game 标识由宿主注入，晚于本模块求值。
const CHANNEL_BASE = 'game-video:graph:ui-tree-sync'

export type UiTreeSyncMsg =
  | { type: 'select'; treeNodeId: string | null; overlayId: string | null }
  | { type: 'scheme-added'; parentId: string; nodeId: string; overlayId: string; title: string }
  | { type: 'folder-added'; parentId: string | null; nodeId: string; name: string }
  | { type: 'renamed'; nodeId: string; name: string }
  | { type: 'overlay-renamed'; overlayId: string; title: string }
  | { type: 'removed'; nodeId: string; removedOverlayIds: string[]; removedNodeIds: string[] }

let channel: BroadcastChannel | null = null
/** 收到远端广播时置位，避免 store 成功路径再往回广播成回环。 */
let applyingRemote = false

function isSyncMsg(v: unknown): v is UiTreeSyncMsg {
  if (!v || typeof v !== 'object') return false
  const t = (v as { type?: unknown }).type
  return t === 'select'
    || t === 'scheme-added'
    || t === 'folder-added'
    || t === 'renamed'
    || t === 'overlay-renamed'
    || t === 'removed'
}

/** store action / 调用方成功路径调用；未 install 或正在 apply remote 时 no-op。 */
export function broadcastUiTreeIntent(msg: UiTreeSyncMsg): void {
  if (applyingRemote) return
  channel?.postMessage(msg)
}

function applyRemote(msg: UiTreeSyncMsg): void {
  const st = useGraphScenario.getState()
  switch (msg.type) {
    case 'select': {
      // 纯选中意图：直接落到 uiSelection，不动 scenario。
      if (msg.treeNodeId === null) {
        useUiSelection.getState().clearUiSelection()
        return
      }
      useUiSelection.getState().selectUiNode(msg.treeNodeId, msg.overlayId)
      return
    }
    case 'scheme-added': {
      // 对齐蓝图 applyRemote：用意图数据直接 set（不调 store action，避免回环 + 重复写 tip）。
      useGraphScenario.setState((s) => {
        const overlays = s.meta.ui?.overlays ?? {}
        if (overlays[msg.overlayId]) return s
        const tree = ensureUiTree(s.meta.uiTree, overlays)
        if (findUiTreeNode(tree, msg.nodeId)) return s
        const nextTree = addUiTreeScheme(tree, msg.parentId, { id: msg.nodeId, overlayId: msg.overlayId })
        const nextOverlay: Overlay = { id: msg.overlayId, title: msg.title, children: [] }
        return {
          meta: {
            ...s.meta,
            ui: { ...s.meta.ui, overlays: { [msg.overlayId]: nextOverlay, ...overlays } },
            uiTree: nextTree,
          },
        }
      })
      useGraphScenario.getState().touchDraft()
      useUiSelection.getState().selectUiNode(msg.nodeId, msg.overlayId)
      return
    }
    case 'folder-added': {
      useGraphScenario.setState((s) => {
        const overlays = s.meta.ui?.overlays ?? {}
        const tree = ensureUiTree(s.meta.uiTree, overlays)
        if (findUiTreeNode(tree, msg.nodeId)) return s
        const nextTree = addUiTreeFolder(tree, msg.parentId, { id: msg.nodeId, name: msg.name })
        return { meta: { ...s.meta, uiTree: nextTree } }
      })
      useGraphScenario.getState().touchDraft()
      useUiSelection.getState().selectUiNode(msg.nodeId, null)
      return
    }
    case 'renamed': {
      useGraphScenario.setState((s) => {
        const overlays = s.meta.ui?.overlays ?? {}
        const tree = ensureUiTree(s.meta.uiTree, overlays)
        const nextTree = renameUiTreeFolder(tree, msg.nodeId, msg.name)
        if (nextTree === tree) return s
        return { meta: { ...s.meta, uiTree: nextTree } }
      })
      useGraphScenario.getState().touchDraft()
      return
    }
    case 'overlay-renamed': {
      useGraphScenario.setState((s) => {
        const overlay = s.meta.ui?.overlays?.[msg.overlayId]
        if (!overlay) return s
        return {
          meta: {
            ...s.meta,
            ui: {
              ...s.meta.ui,
              overlays: { ...(s.meta.ui?.overlays ?? {}), [msg.overlayId]: { ...overlay, title: msg.title } },
            },
          },
        }
      })
      useGraphScenario.getState().touchDraft()
      return
    }
    case 'removed': {
      useGraphScenario.setState((s) => {
        const overlays = s.meta.ui?.overlays ?? {}
        const tree = ensureUiTree(s.meta.uiTree, overlays)
        if (!findUiTreeNode(tree, msg.nodeId)) return s
        const nextTree = removeUiTreeNode(tree, msg.nodeId)
        const nextOverlays = { ...overlays }
        for (const overlayId of msg.removedOverlayIds) delete nextOverlays[overlayId]
        return {
          meta: {
            ...s.meta,
            ui: { ...s.meta.ui, overlays: nextOverlays },
            uiTree: nextTree,
          },
        }
      })
      useGraphScenario.getState().touchDraft()
      const sel = useUiSelection.getState()
      if (
        msg.removedNodeIds.includes(sel.selectedTreeNodeId ?? '')
        || msg.removedOverlayIds.includes(sel.selectedOverlayId ?? '')
      ) {
        sel.clearUiSelection()
      }
      return
    }
  }
}

/**
 * 启用跨 pane 界面树意图同步（仅 split-pane 嵌入态调用）。返回 dispose。
 * 无 BroadcastChannel（standalone / 测试）时 no-op。
 */
export function installGraphUiTreeSync(): () => void {
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
export function resetGraphUiTreeSyncForTests(): void {
  channel?.close()
  channel = null
  applyingRemote = false
}
