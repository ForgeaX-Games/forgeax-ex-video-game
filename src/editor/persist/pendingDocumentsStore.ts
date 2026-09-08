import { useSyncExternalStore } from 'react'
import type { DocumentType } from '@/authoring/assets/registry-types'

let pendingDocumentTypes: readonly DocumentType[] = []
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

export function getPendingDocumentTypes(): readonly DocumentType[] {
  return pendingDocumentTypes
}

export function setPendingDocumentTypes(types: readonly DocumentType[]): void {
  pendingDocumentTypes = [...types]
  notify()
}

export function subscribePendingDocumentTypes(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function usePendingDocumentTypes(): readonly DocumentType[] {
  return useSyncExternalStore(
    subscribePendingDocumentTypes,
    getPendingDocumentTypes,
    getPendingDocumentTypes,
  )
}

export function resetPendingDocumentTypes(): void {
  pendingDocumentTypes = []
  notify()
}
