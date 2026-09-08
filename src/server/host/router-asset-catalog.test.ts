import { describe, expect, it, vi } from 'vitest'
import type { ExtensionContext, ExtensionRouterRequest } from '@forgeax/extension-host/node'
import { createGameVideoRouter } from './router'

const decoder = new TextDecoder()

function request(method: 'GET' | 'POST', body?: unknown): ExtensionRouterRequest {
  return {
    gameId: 'game-1', runtimeId: 'runtime-1', method, path: 'asset-catalog',
    headers: body === undefined ? {} : { 'content-type': ['application/json'] }, query: {},
    body: body === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(body)),
  }
}

describe('asset-catalog route', () => {
  it('uses the Arrival capability for list and apply instead of reading the manifest directly', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ assetCatalog: { version: 1, folders: [], placements: {}, entities: {} }, assets: [], revision: 3 })
      .mockResolvedValueOnce({ ok: true, operationId: 'apply-1', assetCatalog: { version: 1, folders: [], placements: {}, entities: {} }, assets: [], revision: 4 })
    const context = { gameId: 'game-1', capabilities: { invoke } } as unknown as ExtensionContext
    const router = createGameVideoRouter(context)

    expect((await router.handle(request('GET'))).status).toBe(200)
    expect((await router.handle(request('POST', {
      operation: 'apply', operationId: 'apply-1', assetId: 'asset-1', tabKind: 'character', mode: 'catalog', entityId: 'hero',
    }))).status).toBe(200)

    expect(invoke).toHaveBeenNthCalledWith(1, 'game-video.asset-catalog.list', 2, {}, undefined)
    expect(invoke).toHaveBeenNthCalledWith(2, 'game-video.asset-catalog.apply', 2, {
      operationId: 'apply-1', assetId: 'asset-1', tabKind: 'character', mode: 'catalog', entityId: 'hero',
    }, { requestId: 'apply-1' })
  })

  it('surfaces a missing Arrival capability instead of falling back to manifest reads', async () => {
    const response = await createGameVideoRouter({ gameId: 'game-1' } as ExtensionContext).handle(request('GET'))
    expect(response.status).toBe(503)
    expect(JSON.parse(decoder.decode(response.body))).toMatchObject({
      error: { code: 'asset_catalog_capability_unavailable' },
    })
  })
})
