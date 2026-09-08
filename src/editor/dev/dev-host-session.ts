import type { ExtensionSessionContext } from '@forgeax/extension-host/contracts'

export const DEV_EXTENSION_BASE = '/__extension__/v1'
export const DEFAULT_DEV_GAME_ID = 'dev-game'

export interface DevRuntimeCatalogEntry {
  extensionId: string
  runtimeId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function normalizeDevGameId(value: string): string {
  const gameId = value.trim()
  if (!gameId || gameId === '.' || gameId === '..' || /[\\/]/u.test(gameId)) {
    throw new TypeError('Game id must be a non-empty identifier without path separators')
  }
  return gameId
}

export function selectDevRuntime(catalog: unknown): DevRuntimeCatalogEntry {
  if (!Array.isArray(catalog)) throw new TypeError('Extension catalog is invalid')
  const entry = catalog.find((candidate) => (
    isRecord(candidate)
    && candidate.extensionId === '@forgeax-extension/game-video'
    && typeof candidate.runtimeId === 'string'
    && candidate.runtimeId.length > 0
  ))
  if (!isRecord(entry)) throw new Error('game-video runtime is missing from the development host')
  return {
    extensionId: entry.extensionId as string,
    runtimeId: entry.runtimeId as string,
  }
}

export function createDevSessionContext(
  entry: DevRuntimeCatalogEntry,
  gameIdValue: string,
  options: { locale?: string; theme?: 'light' | 'dark' } = {},
): ExtensionSessionContext {
  const gameId = normalizeDevGameId(gameIdValue)
  const encodedGameId = encodeURIComponent(gameId)
  const encodedRuntimeId = encodeURIComponent(entry.runtimeId)
  return {
    extensionId: entry.extensionId,
    runtimeId: entry.runtimeId,
    gameId,
    locale: options.locale?.trim() || 'en',
    theme: options.theme ?? 'dark',
    endpoints: {
      toolCall: `${DEV_EXTENSION_BASE}/tools/call`,
      gamePackage: `${DEV_EXTENSION_BASE}/games/${encodedGameId}/package`,
      extensionApi: `${DEV_EXTENSION_BASE}/extension/${encodedRuntimeId}?gameId=${encodedGameId}`,
      gameVersions: `${DEV_EXTENSION_BASE}/games/${encodedGameId}/versions`,
      gameComponents: `${DEV_EXTENSION_BASE}/games/${encodedGameId}/components`,
    },
    capabilities: ['game-package', 'game-versions', 'game-components'],
  }
}
