import type { ExtensionRouterResponse } from '@forgeax/extension-host/node'
import { open, readFile, readdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { NODIA_ASSETS_MANIFEST } from './nodia-assets'

const EMPTY = new Uint8Array()

function notFound(): ExtensionRouterResponse {
  return {
    status: 404,
    headers: {
      'cache-control': 'no-store',
      'content-length': '0',
    },
    body: EMPTY,
  }
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function resolveBundledAsset(
  id: string,
  key: string,
): Promise<URL | null> {
  // Source checkout: immutable extension-owned path relative to this module.
  const source = new URL(`../../authoring/demo/assets/${key}`, import.meta.url)
  try {
    if ((await stat(source)).isFile()) return source
  } catch {
    // Fall through to the published bundle below. The runtime path must never
    // depend on a process working directory.
  }
  // Published package: Vite-owned assets are siblings of dist/server and are
  // content-hashed. The logical manifest id selects exactly one basename.
  const assetsDirectory = new URL('../assets/', import.meta.url)
  let entries: string[]
  try {
    entries = await readdir(assetsDirectory)
  } catch {
    return null
  }
  const matcher = new RegExp(`^${escaped(id)}(?:-[A-Za-z0-9_-]+)?\\.mp4$`)
  const matches = entries.filter((entry) => matcher.test(entry)).sort()
  if (matches.length !== 1) return null
  try {
    const resolved = new URL(matches[0]!, assetsDirectory)
    return (await stat(resolved)).isFile() ? resolved : null
  } catch {
    return null
  }
}

export type BundledMediaResolver = (id: string, key: string) => Promise<URL | null>

export interface BundledMediaResponseOptions {
  readonly resolveAsset?: BundledMediaResolver
}

interface ByteRange {
  start: number
  end: number
}

function parseRange(value: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match || (!match[1] && !match[2]) || size <= 0) return null
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || start >= size
    || requestedEnd < start
  ) {
    return null
  }
  return { start, end: Math.min(requestedEnd, size - 1) }
}

function rangeNotSatisfiable(size: number): ExtensionRouterResponse {
  return {
    status: 416,
    headers: {
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
      'content-length': '0',
      'content-range': `bytes */${size}`,
    },
    body: EMPTY,
  }
}

/**
 * Serves one extension-owned bundled video by logical id. No package path is
 * returned to callers; byte ranges are sliced inclusively per RFC semantics.
 */
export async function bundledMediaResponse(
  rawId: string,
  rangeHeader?: string,
  options: BundledMediaResponseOptions = {},
): Promise<ExtensionRouterResponse> {
  let id: string
  try {
    id = decodeURIComponent(rawId)
  } catch {
    return notFound()
  }
  if (
    !id
    || id === '.'
    || id === '..'
    || id.includes('/')
    || id.includes('\\')
  ) {
    return notFound()
  }
  const asset = NODIA_ASSETS_MANIFEST.assets.find((entry) => entry.id === id)
  if (!asset) return notFound()
  const key = asset.file.key.replace(/\\/g, '/')
  if (
    key.startsWith('/')
    || key.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    return notFound()
  }
  // Resolve the URL here to assert it is file-backed and avoid ever returning
  // it as part of a public response.
  fileURLToPath(new URL(`../../authoring/demo/assets/${key}`, import.meta.url))
  const location = await (options.resolveAsset ?? resolveBundledAsset)(id, key)
  if (!location) return notFound()
  let size: number
  try {
    size = (await stat(location)).size
  } catch {
    return notFound()
  }

  const baseHeaders = {
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=31536000, immutable',
    'content-type': asset.file.mime,
  }
  if (rangeHeader !== undefined) {
    const range = parseRange(rangeHeader, size)
    if (!range) return rangeNotSatisfiable(size)
    const body = new Uint8Array(range.end - range.start + 1)
    const handle = await open(location, 'r')
    try {
      const result = await handle.read(body, 0, body.byteLength, range.start)
      if (result.bytesRead !== body.byteLength) return rangeNotSatisfiable(size)
    } finally {
      await handle.close()
    }
    return {
      status: 206,
      headers: {
        ...baseHeaders,
        'content-length': String(body.byteLength),
        'content-range': `bytes ${range.start}-${range.end}/${size}`,
      },
      body,
    }
  }
  const bytes = new Uint8Array(await readFile(location))
  return {
    status: 200,
    headers: {
      ...baseHeaders,
      'content-length': String(bytes.byteLength),
    },
    body: bytes,
  }
}
