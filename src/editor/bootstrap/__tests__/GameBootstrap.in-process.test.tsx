/**
 * In-process mounts have no parent frame, so the iframe handshake can never
 * settle. These tests pin the injected-host path: the real `getExtensionHost`
 * must serve the host-supplied client and never build a handshake client.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  applyHostInit,
  releaseHostInit,
  resetHostInjectionForTests,
} from '@/editor/host-init'
import { resetHostInitForTests } from '../../../lib/forgeax-http'
import type { ExtensionHostClient } from '../../../lib/extension-host'
import { setLocale } from '../../../i18n'
import { GameBootstrap } from '../GameBootstrap'

const { createExtensionClient } = vi.hoisted(() => ({
  createExtensionClient: vi.fn(() => {
    throw new TypeError('A hostOrigin is required when document.referrer is unavailable')
  }),
}))

vi.mock('@forgeax/extension-host/extension', () => ({
  createExtensionClient,
  ExtensionClientError: class ExtensionClientError extends Error {},
}))

const ready = vi.fn()
const status = vi.fn()

function injectedHost(): ExtensionHostClient {
  return {
    ready,
    gamePackage: { status, initialize: vi.fn() },
  } as unknown as ExtensionHostClient
}

beforeEach(() => {
  setLocale('en')
  createExtensionClient.mockClear()
  ready.mockReset().mockResolvedValue({ gameId: 'handshake-game' })
  status.mockReset().mockResolvedValue({ state: 'initialized' })
})

afterEach(() => {
  resetHostInitForTests()
  resetHostInjectionForTests()
})

test('boots from the injected host without any iframe handshake', async () => {
  applyHostInit({ host: injectedHost() })
  const boot = vi.fn()

  render(<GameBootstrap gameId="arrival-game" onBoot={boot}><div>workspace</div></GameBootstrap>)

  await waitFor(() => expect(boot).toHaveBeenCalledWith('arrival-game'))
  expect(screen.getByText('workspace')).toBeTruthy()
  expect(createExtensionClient).not.toHaveBeenCalled()
})

test('falls back to the handshake error once the host is released', async () => {
  applyHostInit({ host: injectedHost() })
  releaseHostInit()

  render(<GameBootstrap onBoot={vi.fn()}><div>workspace</div></GameBootstrap>)

  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByText('workspace')).toBeNull()
  expect(createExtensionClient).toHaveBeenCalled()
})
