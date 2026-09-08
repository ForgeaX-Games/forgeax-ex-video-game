import { create } from 'zustand'
import type { GraphView } from './graphViewStore'
import type { NodeGenerationTarget } from '../assets/generation/videoGenerationNavigation'

interface VideoGenerationPanelState {
  open: boolean
  returnView: GraphView
  nodeTarget: NodeGenerationTarget | null
  activationRevision: number
  openForView: (returnView: GraphView) => void
  openForNode: (target: NodeGenerationTarget, returnView: GraphView) => void
  setNodeTarget: (target: NodeGenerationTarget | null) => void
  close: () => void
}

export const useVideoGenerationPanel = create<VideoGenerationPanelState>((set) => ({
  open: false,
  returnView: 'graph',
  nodeTarget: null,
  activationRevision: 0,
  openForView: (returnView) => set((state) => ({
    open: true,
    returnView,
    activationRevision: state.activationRevision + 1,
  })),
  openForNode: (nodeTarget, returnView) => set((state) => ({
    open: true,
    returnView,
    nodeTarget,
    activationRevision: state.activationRevision + 1,
  })),
  setNodeTarget: (nodeTarget) => set({ nodeTarget }),
  close: () => set({ open: false, nodeTarget: null }),
}))
