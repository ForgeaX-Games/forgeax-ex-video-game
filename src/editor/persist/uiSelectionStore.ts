import { create } from 'zustand'

interface UiSelectionState {
  selectedTreeNodeId: string | null
  selectedOverlayId: string | null
  selectUiNode: (treeNodeId: string | null, overlayId?: string | null) => void
  clearUiSelection: () => void
}

/**
 * 界面目录的瞬态选中态。
 *
 * 树与 overlay 内容仍以 graphScenarioStore.meta 为唯一真相；这里不持久化。
 * split-pane 通过 graphUiTreeSync 的 select 意图镜像这两个 selection 字段。
 */
export const useUiSelection = create<UiSelectionState>((set) => ({
  selectedTreeNodeId: null,
  selectedOverlayId: null,
  selectUiNode: (selectedTreeNodeId, selectedOverlayId = null) => set({
    selectedTreeNodeId,
    selectedOverlayId,
  }),
  clearUiSelection: () => set({
    selectedTreeNodeId: null,
    selectedOverlayId: null,
  }),
}))
