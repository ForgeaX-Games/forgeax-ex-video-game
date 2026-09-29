import {
  KINO_MEDIA_TYPES,
  loadKinoAssetLocators,
  type KinoMediaType,
} from './kino'
import {
  GamePackageError,
  parseGamePackage,
  type RuntimeAsset,
  type RuntimeGamePackage,
} from './package'
import type { RuntimeSdkHost, RuntimeSdkSession } from './runtime-host'

const PLAYABLE_LOCATOR = /^(?:https?:|blob:|data:|\/)/

export interface StandaloneRuntimeOptions {
  fetch?: typeof fetch
  /** Base URL containing project.json, blueprint.json, assets/, and components/. */
  gameBaseUrl?: string
}

function defaultGameBaseUrl(): string {
  const documentBase = globalThis.document?.baseURI ?? globalThis.location?.href ?? 'http://localhost/'
  return new URL('./game/', documentBase).href
}

async function fetchJson(
  url: string,
  request: typeof fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await request(url, { cache: 'no-store', signal })
  if (!response.ok) {
    throw new GamePackageError(`Failed to load ${url} (${response.status})`, response.status)
  }
  return response.json()
}

function readGameId(project: unknown): string {
  if (
    typeof project === 'object'
    && project !== null
    && 'id' in project
    && typeof project.id === 'string'
    && project.id.length > 0
  ) {
    return project.id
  }
  throw new GamePackageError('Game project.json is missing a string "id"')
}

function unresolvedMediaTypes(gamePackage: RuntimeGamePackage): KinoMediaType[] {
  const assets = gamePackage.assetsManifest.assets
  if (assets.length === 0) return [...KINO_MEDIA_TYPES]
  const unresolved = new Set<KinoMediaType>()
  for (const asset of assets) {
    if (
      KINO_MEDIA_TYPES.includes(asset.kind as KinoMediaType)
      && (!asset.url || !PLAYABLE_LOCATOR.test(asset.url))
    ) {
      unresolved.add(asset.kind as KinoMediaType)
    }
  }
  return KINO_MEDIA_TYPES.filter((mediaType) => unresolved.has(mediaType))
}

function kinoResourceIds(asset: RuntimeAsset): string[] {
  return [
    asset.provider?.upstreamResourceId,
    asset.provider?.kind === 'kino'
      && asset.provider.ref
      && !PLAYABLE_LOCATOR.test(asset.provider.ref)
      ? asset.provider.ref
      : undefined,
    asset.id,
  ].filter((value): value is string => Boolean(value))
}

/**
 * Fills in playable URLs from Kino for assets the package manifest leaves
 * unresolved. Editor products may ship an empty `assets/manifest.json` because
 * the media lives in Kino. Package-declared assets always win.
 */
async function withKinoAssets(
  gameId: string,
  gamePackage: RuntimeGamePackage,
  request: typeof fetch,
  signal?: AbortSignal,
): Promise<RuntimeGamePackage> {
  const mediaTypes = unresolvedMediaTypes(gamePackage)
  if (mediaTypes.length === 0) return gamePackage
  const kinoAssets = await loadKinoAssetLocators(gameId, request, signal, mediaTypes)
  if (kinoAssets.length === 0) return gamePackage
  const remainingKinoAssets = new Map(kinoAssets.map((asset) => [asset.id, asset]))
  const assets = gamePackage.assetsManifest.assets.map((asset) => {
    const kinoResourceId = kinoResourceIds(asset)
      .find((resourceId) => remainingKinoAssets.has(resourceId))
    const kinoAsset = kinoResourceId ? remainingKinoAssets.get(kinoResourceId) : undefined
    if (kinoResourceId) remainingKinoAssets.delete(kinoResourceId)
    if (asset.url && PLAYABLE_LOCATOR.test(asset.url)) return asset
    return kinoAsset?.url ? { ...kinoAsset, ...asset, url: kinoAsset.url } : asset
  })
  return {
    ...gamePackage,
    assetsManifest: {
      ...gamePackage.assetsManifest,
      assets: [...assets, ...remainingKinoAssets.values()],
    },
  }
}

/**
 * Boots the published player from game data assembled beside the static shell.
 * The publisher writes the payload under `./game/`; only missing media URLs are
 * resolved through Kino.
 */
export function createStandaloneRuntimeHost(options: StandaloneRuntimeOptions = {}): RuntimeSdkHost {
  const request = options.fetch ?? globalThis.fetch
  const gameBaseUrl = options.gameBaseUrl ?? defaultGameBaseUrl()

  return Object.freeze({
    async ready(signal?: AbortSignal): Promise<RuntimeSdkSession> {
      const [project, blueprint, assetsManifest] = await Promise.all([
        fetchJson(new URL('project.json', gameBaseUrl).href, request, signal),
        fetchJson(new URL('blueprint.json', gameBaseUrl).href, request, signal),
        fetchJson(new URL('assets/manifest.json', gameBaseUrl).href, request, signal),
      ])
      const gamePackage = parseGamePackage({ project, blueprint, assetsManifest })
      const gameId = readGameId(project)
      return {
        gameId,
        gamePackage: await withKinoAssets(gameId, gamePackage, request, signal),
        componentModuleUrl: new URL('components/index.js', gameBaseUrl).href,
      }
    },
  })
}
