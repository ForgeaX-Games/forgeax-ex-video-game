import { afterEach, describe, expect, it, vi } from 'vitest'
import { forgeaxHttp, resetHostInitForTests } from '../forgeax-http'
import { pluginFetch, pluginUrl, productFetch } from '../plugin-http'

vi.mock('../extension-host', () => ({
  getExtensionHost: () => ({
    ready: async () => undefined,
    extension: {
      url: (path: string) => `/__extension_test__${path}?gameId=demo`,
      fetch: (path: string, init?: RequestInit) => globalThis.fetch(`/__extension_test__${path}`, init),
    },
  }),
}))

describe('pluginUrl', () => {
  it('leaves absolute and opaque URLs alone', () => {
    expect(pluginUrl('https://cdn.example/a')).toBe('https://cdn.example/a')
    expect(pluginUrl('blob:http://localhost/1')).toBe('blob:http://localhost/1')
    expect(pluginUrl('data:text/plain,hi')).toBe('data:text/plain,hi')
  })

  it('resolves extension paths through the extension host', () => {
    expect(pluginUrl('/__gva__/assets')).toBe('/__extension_test__/__gva__/assets?gameId=demo')
  })

  it('merges logical query parameters into the handshake endpoint', () => {
    expect(pluginUrl('/media/resources?page=1&page_size=100')).toBe(
      '/__extension_test__/media/resources?gameId=demo&page=1&page_size=100',
    )
  })
})

describe('pluginFetch + forgeaxHttp', () => {
  afterEach(() => {
    resetHostInitForTests()
    vi.unstubAllGlobals()
  })

  it('rewrites the logical path before extension host fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    forgeaxHttp.defaults.rewrite = [
      { from: /^\/__gva__\/(.*)$/, to: '/proxy/gva/$1' },
    ]

    await pluginFetch('/__gva__/assets')

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/__extension_test__/proxy/gva/assets')
  })

  it('passes opaque URLs through untouched', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    forgeaxHttp.defaults.rewrite = [
      { from: /^\/__gva__\/(.*)$/, to: '/proxy/gva/$1' },
    ]

    await pluginFetch('blob:http://localhost:5173/6c2f')

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('blob:http://localhost:5173/6c2f')
  })

  it('keeps query parameters when dispatching through the handshake endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)

    await pluginFetch('/media/resources?page=1&page_size=100')

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      '/__extension_test__/media/resources?gameId=demo&page=1&page_size=100',
    )
  })

  it('dispatches rewritten product routes directly without the extension endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    forgeaxHttp.defaults.rewrite = [
      { from: /^\/api\/v1\/kino(\/.*)?$/, to: 'https://box.example/api/v1/kino$1' },
    ]

    await productFetch('/api/v1/kino/resources?game_id=demo')

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://box.example/api/v1/kino/resources?game_id=demo',
    )
  })
})
