import { beforeEach, describe, expect, test, vi } from 'vitest'

const createExtensionClient = vi.fn()
const client = {
  gamePackage: {},
  extension: { fetch: vi.fn() },
  tool: { call: vi.fn() },
}

vi.mock('@forgeax/extension-host/extension', () => ({
  createExtensionClient,
}))

beforeEach(() => {
  createExtensionClient.mockReset()
  createExtensionClient.mockReturnValue(client)
  client.extension.fetch.mockReset()
  client.tool.call.mockReset()
})

describe('getExtensionHost', () => {
  test('creates one extension client for all browser consumers', async () => {
    const { getExtensionHost } = await import('../extension-host')

    expect(getExtensionHost()).toBe(client)
    expect(getExtensionHost()).toBe(client)
    expect(createExtensionClient).toHaveBeenCalledTimes(1)
  })

  test('uses extension fetch instead of legacy browser endpoints', async () => {
    client.extension.fetch.mockResolvedValueOnce(new Response(
      JSON.stringify({ assets: [] }),
      { headers: { 'content-type': 'application/json' } },
    ))
    const { fetchRegistryAssets } = await import('../../editor/assets/registry-assets')

    await fetchRegistryAssets('query-game', 'image')

    expect(client.extension.fetch).toHaveBeenCalledWith('assets?kind=image')
    for (const [request] of client.extension.fetch.mock.calls) {
      expect(String(request)).not.toMatch(/^\/(?:api\/game-host|__gva__|__ce-api__)/)
    }
  })

  test('accepts only successful JSON extension responses', async () => {
    const { ExtensionResponseError, readExtensionJson } = await import('../extension-host')

    await expect(readExtensionJson(new Response('not json', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }))).rejects.toBeInstanceOf(ExtensionResponseError)
    await expect(readExtensionJson(new Response('{', {
      status: 200,
      headers: { 'content-type': 'application/problem+json' },
    }))).rejects.toBeInstanceOf(ExtensionResponseError)
    await expect(readExtensionJson(new Response(JSON.stringify({ message: 'missing' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    }))).rejects.toMatchObject({ status: 404 })
  })

  test('reports HTTP status before inspecting a non-JSON error body', async () => {
    const { readExtensionJson } = await import('../extension-host')

    await expect(readExtensionJson(new Response('<html>bad gateway</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    }))).rejects.toMatchObject({
      status: 502,
      message: 'Extension request failed (502)',
    })
  })
})
