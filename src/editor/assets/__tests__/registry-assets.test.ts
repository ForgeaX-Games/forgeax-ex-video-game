import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaAsset } from '@/authoring/assets/registry-types'
import { fetchRegistryAssets } from '../registry-assets'

const mocks = vi.hoisted(() => ({
  extensionFetch: vi.fn(),
  readExtensionJson: vi.fn(),
}))

vi.mock('../../../lib/extension-host', () => ({
  getExtensionHost: () => ({ extension: { fetch: mocks.extensionFetch } }),
  readExtensionJson: mocks.readExtensionJson,
}))

const GENERATED_CLIP: MediaAsset = {
  id: 'a-vid-generated',
  kind: 'video',
  productionType: 'video_clip',
  status: 'generating',
  createdAt: 1,
  updatedAt: 2,
}

describe('fetchRegistryAssets', () => {
  beforeEach(() => {
    mocks.extensionFetch.mockReset()
    mocks.readExtensionJson.mockReset()
    mocks.extensionFetch.mockResolvedValue(new Response('{}'))
  })

  it('calls the host-owned assets endpoint and preserves the requested kind', async () => {
    mocks.readExtensionJson.mockResolvedValue({ assets: [GENERATED_CLIP] })

    const assets = await fetchRegistryAssets('demo-game', 'video')

    expect(assets).toEqual([GENERATED_CLIP])
    expect(mocks.extensionFetch).toHaveBeenCalledWith('assets?kind=video')
  })

  it('omits the optional kind query when no kind is requested', async () => {
    mocks.readExtensionJson.mockResolvedValue({ assets: [] })

    await fetchRegistryAssets()

    expect(mocks.extensionFetch).toHaveBeenCalledWith('assets')
  })

  it('throws host transport errors instead of treating them as an empty registry', async () => {
    mocks.readExtensionJson.mockRejectedValue(new Error('registry unavailable'))

    await expect(fetchRegistryAssets('demo-game')).rejects.toThrow('registry unavailable')
  })

  it('throws semantic errors returned by the host assets route', async () => {
    mocks.readExtensionJson.mockResolvedValue({ assets: [], error: 'game scope is unavailable' })

    await expect(fetchRegistryAssets('demo-game')).rejects.toThrow('game scope is unavailable')
  })
})
