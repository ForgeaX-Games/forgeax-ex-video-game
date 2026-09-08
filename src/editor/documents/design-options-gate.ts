import { useSyncExternalStore } from 'react'

export interface DesignOptionsGate {
  busy?: boolean
  onApplied?: (optionId: 'A' | 'B' | 'C', option?: { title?: string }) => void | Promise<void>
  onRegenerate?: () => void | Promise<void>
}

let activeGate: DesignOptionsGate | null = null
const listeners = new Set<() => void>()

export function setDesignOptionsGate(gate: DesignOptionsGate | null): void {
  activeGate = gate
  listeners.forEach((listener) => listener())
}

export function getDesignOptionsGate(): DesignOptionsGate | null {
  return activeGate
}

export function subscribeDesignOptionsGate(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useDesignOptionsGate(): DesignOptionsGate | null {
  return useSyncExternalStore(subscribeDesignOptionsGate, getDesignOptionsGate, getDesignOptionsGate)
}
