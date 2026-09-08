import type { Overlay } from '@/runtime/core/schema/graph-schema'

function normalizedTitle(title: string | undefined): string {
  return title?.trim() ?? ''
}

export function overlayTitleExists(
  overlays: Record<string, Overlay>,
  title: string,
  excludeId?: string,
): boolean {
  const normalized = normalizedTitle(title)
  if (!normalized) return false
  return Object.entries(overlays).some(([id, overlay]) =>
    id !== excludeId && normalizedTitle(overlay.title) === normalized)
}

export function nextUniqueOverlayTitle(
  overlays: Record<string, Overlay>,
  base = '新方案',
): string {
  if (!overlayTitleExists(overlays, base)) return base
  let index = 2
  while (overlayTitleExists(overlays, `${base} ${index}`)) index += 1
  return `${base} ${index}`
}
