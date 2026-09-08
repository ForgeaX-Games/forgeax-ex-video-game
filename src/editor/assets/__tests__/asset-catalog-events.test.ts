import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ASSET_CATALOG_INVALIDATION_CHANNEL,
  ASSET_CATALOG_INVALIDATION_EVENT,
  emitAssetCatalogInvalidation,
} from '../asset-catalog-events'

afterEach(() => vi.unstubAllGlobals())

describe('asset catalog invalidation', () => {
  it('notifies the current pane and broadcasts to the other Arrival panes', () => {
    const localListener = vi.fn()
    const postMessage = vi.fn()
    const close = vi.fn()
    let constructedName = ''
    class FakeBroadcastChannel {
      constructor(readonly name: string) { constructedName = name }
      postMessage = postMessage
      close = close
    }
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    window.addEventListener(ASSET_CATALOG_INVALIDATION_EVENT, localListener)

    emitAssetCatalogInvalidation()

    expect(localListener).toHaveBeenCalledOnce()
    expect(postMessage).toHaveBeenCalledWith({ type: 'invalidated' })
    expect(close).toHaveBeenCalledOnce()
    expect(constructedName).toBe(ASSET_CATALOG_INVALIDATION_CHANNEL)
    window.removeEventListener(ASSET_CATALOG_INVALIDATION_EVENT, localListener)
  })
})
