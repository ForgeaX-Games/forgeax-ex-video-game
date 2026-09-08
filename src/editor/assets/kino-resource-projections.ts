import type { KinoResourceDTO } from './kino-api'

export type ManagedAssetKind = 'image' | 'audio' | 'font'

export interface ManagedAsset {
  id: string
  kind: ManagedAssetKind
  name: string
  url?: string
  mime?: string
  bytes?: number
  updatedAt?: number
  source?: string
}

export interface VideoAssetListItem {
  id: string
  label: string
  url: string
  durMs?: number
  type?: string
  updatedAt?: number
}

function resourceBytes(resource: KinoResourceDTO): number | undefined {
  const value = resource.source_meta?.extra?.bytes
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

export function toManagedAsset(
  resource: KinoResourceDTO,
  kind: ManagedAssetKind,
): ManagedAsset {
  return {
    id: resource.resource_id,
    kind,
    name: resource.name || resource.resource_id,
    url: resource.url,
    mime: resource.source_meta?.mime_type,
    bytes: resourceBytes(resource),
    updatedAt: resource.updated_at,
    source: resource.source,
  }
}

export function appendVideoRevision(url: string, updatedAt: number): string {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}v=${encodeURIComponent(String(updatedAt))}`
}

export function toVideoAssetListItem(resource: KinoResourceDTO): VideoAssetListItem {
  return {
    id: resource.resource_id,
    label: resource.name?.trim() || resource.resource_id,
    url: appendVideoRevision(resource.url, resource.updated_at),
    durMs: resource.source_meta?.duration_ms,
    type: resource.type,
    updatedAt: resource.updated_at,
  }
}
