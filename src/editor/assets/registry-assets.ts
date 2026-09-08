/** Reads shared-registry assets from the extension and preserves failures. */
import { getExtensionHost, readExtensionJson } from '../../lib/extension-host'
import type { MediaAsset, MediaKind } from '@/authoring/assets/registry-types'

export async function fetchRegistryAssets(
  game?: string,
  kind?: MediaKind,
  options: { signal?: AbortSignal } = {},
): Promise<MediaAsset[]> {
  const params = new URLSearchParams()
  void game
  if (kind) params.set('kind', kind)
  const qs = params.toString()
  const path = `assets${qs ? `?${qs}` : ''}`
  const r = options.signal
    ? await getExtensionHost().extension.fetch(path, { signal: options.signal })
    : await getExtensionHost().extension.fetch(path)
  const j = await readExtensionJson(r) as { assets?: MediaAsset[]; error?: unknown }
  if (typeof j.error === 'string' && j.error.length > 0) {
    throw new Error(j.error)
  }
  if (!Array.isArray(j.assets)) throw new Error('Extension returned an invalid assets response')
  return j.assets
}

export async function deleteRegistryAsset(id: string): Promise<{ clearedReferences: string[] }> {
  const response = await getExtensionHost().extension.fetch(`assets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  const body = await readExtensionJson(response) as {
    asset?: MediaAsset | null
    clearedReferences?: unknown
    error?: unknown
  }
  if (!response.ok || typeof body.error === 'string') {
    throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${response.status}`)
  }
  return {
    clearedReferences: Array.isArray(body.clearedReferences)
      ? body.clearedReferences.filter((path): path is string => typeof path === 'string')
      : [],
  }
}
