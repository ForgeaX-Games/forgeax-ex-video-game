import { afterEach, describe, expect, it, vi } from 'vitest'
import { forgeaxHost, setInjectedAcceptReference } from '../HostSdkBridge'
import type { ContextReference } from '../context-reference'

const REFERENCE: ContextReference = {
  refKind: 'game-video.blueprint-node.v1',
  sourceExtensionId: '@forgeax-extension/game-video',
  display: { title: '首领战', icon: '🔷' },
  payload: { kind: 'game-video.blueprint-node-reference.v1' },
  action: { protocol: 'tools', toolHints: ['game-video:get-graph'] },
}

function stubParentFrame(postMessage: ReturnType<typeof vi.fn>): () => void {
  const fakeParent = { postMessage } as unknown as Window
  const original = window.parent
  Object.defineProperty(window, 'parent', {
    configurable: true,
    get: () => fakeParent,
  })
  return () => {
    Object.defineProperty(window, 'parent', {
      configurable: true,
      get: () => original,
    })
  }
}

describe('forgeaxHost', () => {
  afterEach(() => {
    setInjectedAcceptReference(null)
    vi.restoreAllMocks()
  })

  it('is unavailable with no injected accept and no parent frame', () => {
    expect(forgeaxHost.available).toBe(false)
  })

  it('routes insertReference to the injected accept function when present', () => {
    const accept = vi.fn()
    setInjectedAcceptReference(accept)

    expect(forgeaxHost.available).toBe(true)
    forgeaxHost.composer.insertReference(REFERENCE)

    expect(accept).toHaveBeenCalledWith(REFERENCE)
  })

  it('clearing the injected accept function makes the host unavailable again (outside an iframe)', () => {
    setInjectedAcceptReference(vi.fn())
    setInjectedAcceptReference(null)
    expect(forgeaxHost.available).toBe(false)
  })

  it('falls back to postMessage(FORGEAX_COMPOSER_INSERT) when running inside an iframe', () => {
    const postMessage = vi.fn()
    const restore = stubParentFrame(postMessage)

    expect(forgeaxHost.available).toBe(true)
    forgeaxHost.composer.insertReference(REFERENCE)

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'FORGEAX_COMPOSER_INSERT', reference: REFERENCE },
      '*',
    )
    restore()
  })

  it('prefers the injected accept function over postMessage when both are available', () => {
    const accept = vi.fn()
    const postMessage = vi.fn()
    const restore = stubParentFrame(postMessage)
    setInjectedAcceptReference(accept)

    forgeaxHost.composer.insertReference(REFERENCE)

    expect(accept).toHaveBeenCalledWith(REFERENCE)
    expect(postMessage).not.toHaveBeenCalled()
    restore()
  })

  it('adapts the legacy insert(pill) call into a ContextReference with protocol none', () => {
    const accept = vi.fn()
    setInjectedAcceptReference(accept)

    forgeaxHost.composer.insert({
      kind: 'blueprint-node',
      display: '首领战',
      icon: '🔷',
      detail: 'legacy detail',
      tooltip: { title: 'legacy title', lines: ['line-1'] },
    })

    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({
        refKind: 'game-video.legacy-pill.v1',
        display: { title: '首领战', icon: '🔷' },
        action: { protocol: 'none' },
      }),
    )
  })
})
