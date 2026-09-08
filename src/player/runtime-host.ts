import type { RuntimeGamePackage } from './package'

export interface RuntimeSdkSession {
  gameId: string
  gamePackage: RuntimeGamePackage
  componentModuleUrl: string | null
}

/**
 * Where the standalone player gets one game's data.
 * Implementations decide the source; the player and asset resolver stay unaware of it.
 */
export interface RuntimeSdkHost {
  ready(signal?: AbortSignal): Promise<RuntimeSdkSession>
  close?(): void
}
