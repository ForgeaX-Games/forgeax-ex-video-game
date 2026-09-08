import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyHostInit,
  getDocumentMountOptions,
  releaseHostInit as releaseAll,
  resetHostInjectionForTests,
} from '@/editor/host-init'
import { getPendingDocumentTypes } from '@/editor/persist/pendingDocumentsStore'
import {
  forgeaxHttp,
  releaseHostInit,
  resetHostInitForTests,
} from '@/lib/forgeax-http'
import {
  getExtensionHost,
  type ExtensionHostClient,
} from '@/lib/extension-host'

vi.mock('@forgeax/extension-host/extension', () => ({
  createExtensionClient: () => {
    throw new Error('Extension handshake is not available without a parent frame')
  },
}))

function fakeHost(): ExtensionHostClient {
  return { ready: async () => ({}) } as unknown as ExtensionHostClient
}

describe('applyHostInit host injection', () => {
  afterEach(() => {
    resetHostInitForTests()
    resetHostInjectionForTests()
  })

  it('serves the injected client to every consumer instead of handshaking', () => {
    const host = fakeHost()

    applyHostInit({ host })

    expect(getExtensionHost()).toBe(host)
  })

  it('falls back to the iframe handshake once the last mount releases', () => {
    const host = fakeHost()
    applyHostInit({ host })
    applyHostInit({ host })

    releaseAll()
    expect(getExtensionHost()).toBe(host)

    releaseAll()
    expect(() => getExtensionHost()).toThrow(/handshake/i)
  })
})

describe('applyHostInit', () => {
  afterEach(() => {
    resetHostInitForTests()
    resetHostInjectionForTests()
  })

  it('installs rewrite rules on forgeaxHttp.defaults', () => {
    applyHostInit({
      rewrite: [{ from: /^\/a$/, to: '/b' }],
    })
    expect(forgeaxHttp.rewriteUrl('/a')).toBe('/b')
  })

  it('clears rewrite only after matching releases (refcount)', () => {
    applyHostInit({ rewrite: [{ from: /^\/a$/, to: '/b' }] })
    applyHostInit({ rewrite: [{ from: /^\/a$/, to: '/b' }] })
    releaseHostInit()
    expect(forgeaxHttp.rewriteUrl('/a')).toBe('/b')
    releaseHostInit()
    expect(forgeaxHttp.rewriteUrl('/a')).toBe('/a')
  })

  it('throws on invalid rewrite', () => {
    expect(() =>
      applyHostInit({ rewrite: [{ from: /x/, to: 1 as unknown as string }] }),
    ).toThrow(/rewrite/i)
  })
})

describe('applyHostInit document options across panes', () => {
  afterEach(() => {
    resetHostInitForTests()
    resetHostInjectionForTests()
  })

  it('keeps the center pane docActionSlotEl when the left pane omits it', () => {
    const slot = document.createElement('div')
    applyHostInit({ docActionSlotEl: slot })

    applyHostInit({ pane: 'left' })

    expect(getDocumentMountOptions().docActionSlotEl).toBe(slot)
  })

  it('keeps pending document types when the left pane omits them', () => {
    applyHostInit({ pendingDocumentTypes: ['core'] })

    applyHostInit({ pane: 'left' })

    expect(getPendingDocumentTypes()).toEqual(['core'])
  })

  it('clears document options once every mount releases', () => {
    const slot = document.createElement('div')
    applyHostInit({ docActionSlotEl: slot, pendingDocumentTypes: ['core'] })
    applyHostInit({ pane: 'left' })

    releaseAll()
    expect(getDocumentMountOptions().docActionSlotEl).toBe(slot)

    releaseAll()
    expect(getDocumentMountOptions().docActionSlotEl).toBeUndefined()
    expect(getPendingDocumentTypes()).toEqual([])
  })

  it('still allows an explicit empty pending list to clear badges', () => {
    applyHostInit({ pendingDocumentTypes: ['core'] })

    applyHostInit({ pendingDocumentTypes: [] })

    expect(getPendingDocumentTypes()).toEqual([])
  })
})
