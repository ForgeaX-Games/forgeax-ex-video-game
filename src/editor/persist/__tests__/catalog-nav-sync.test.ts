import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CATALOG_ROOT_TARGET } from '@/editor/assets/asset-catalog'
import { installCatalogNavSync, useCatalogNav } from '../catalogNavStore'

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  postMessage = vi.fn()
  close = vi.fn()
  constructor(readonly name: string) { FakeBroadcastChannel.instances.push(this) }
}

beforeEach(() => {
  FakeBroadcastChannel.instances = []
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  localStorage.clear()
  useCatalogNav.setState({ location: { kind: 'catalog-root', target: CATALOG_ROOT_TARGET } })
})

afterEach(() => vi.unstubAllGlobals())

describe('catalog navigation sync', () => {
  it('broadcasts catalog locations and accepts only a matching placement identity from a peer pane', () => {
    const dispose = installCatalogNavSync()
    const channel = FakeBroadcastChannel.instances[0]!
    const location = { kind: 'item' as const, tabKind: 'image' as const, itemId: 'asset-1', placementKey: 'image:asset-1', target: 'root:image' }

    useCatalogNav.getState().setLocation(location)
    expect(channel.postMessage).toHaveBeenCalledWith(location)

    channel.onmessage?.({ data: { kind: 'item', tabKind: 'image', itemId: 'asset-2', placementKey: 'video:asset-2', target: 'root:image' } } as MessageEvent)
    expect(useCatalogNav.getState().location).toEqual(location)

    channel.onmessage?.({ data: { kind: 'tab-root', tabKind: 'video', target: 'root:video' } } as MessageEvent)
    expect(useCatalogNav.getState().location).toEqual({ kind: 'tab-root', tabKind: 'video', target: 'root:video' })
    expect(channel.postMessage).toHaveBeenCalledTimes(1)
    dispose()
  })
})
