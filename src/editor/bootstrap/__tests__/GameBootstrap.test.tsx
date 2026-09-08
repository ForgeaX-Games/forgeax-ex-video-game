import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'
import { setLocale } from '../../../i18n'
import { GameBootstrap } from '../GameBootstrap'

const client = {
  ready: vi.fn(),
  gamePackage: {
    status: vi.fn(),
    initialize: vi.fn(),
  },
}

vi.mock('../../../lib/extension-host', () => ({
  getExtensionHost: () => client,
}))

beforeEach(() => {
  client.ready.mockReset()
  client.ready.mockResolvedValue({ gameId: 'accepted-game' })
  client.gamePackage.status.mockReset()
  client.gamePackage.initialize.mockReset()
  setLocale('en')
  window.history.replaceState({}, '', '/')
})

test('renders the guide in the active locale', async () => {
  setLocale('zh')
  client.gamePackage.status.mockResolvedValueOnce({ state: 'uninitialized', missing: [] })
  render(<GameBootstrap onBoot={vi.fn()}><div>workspace</div></GameBootstrap>)
  expect(await screen.findByRole('heading', { name: '从模板新建视频游戏' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '从模板新建' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '否，稍后再说' })).toBeTruthy()
})

test('shows guide without initializing an uninitialized package', async () => {
  client.gamePackage.status.mockResolvedValueOnce({ state: 'uninitialized', missing: [] })
  const boot = vi.fn()
  render(<GameBootstrap onBoot={boot}><div>workspace</div></GameBootstrap>)
  expect(await screen.findByRole('heading', { name: 'Create a video game from template' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Create from template' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'No, maybe later' })).toBeTruthy()
  expect(boot).not.toHaveBeenCalled()
  expect(client.gamePackage.status).toHaveBeenCalledTimes(1)
  expect(client.gamePackage.initialize).not.toHaveBeenCalled()
})

test('initializes once on yes and then mounts workspace', async () => {
  client.gamePackage.status.mockResolvedValueOnce({ state: 'uninitialized', missing: [] })
  client.gamePackage.initialize.mockResolvedValueOnce({ state: 'initialized', missing: [], initialized: true })
  const boot = vi.fn()
  render(<GameBootstrap onBoot={boot}><div>workspace</div></GameBootstrap>)
  await screen.findByRole('button', { name: 'Create from template' })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create from template' })) })
  await waitFor(() => expect(boot).toHaveBeenCalledTimes(1))
  expect(screen.getByText('workspace')).toBeTruthy()
  expect(client.gamePackage.status).toHaveBeenCalledTimes(1)
  expect(client.gamePackage.initialize).toHaveBeenCalledTimes(1)
})

test('closes the guide on no without writing, then retries a failed initialize', async () => {
  client.gamePackage.status.mockResolvedValueOnce({ state: 'uninitialized', missing: [] })
  const boot = vi.fn()
  const first = render(<GameBootstrap onBoot={boot}><div>workspace</div></GameBootstrap>)
  await screen.findByRole('button', { name: 'No, maybe later' })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'No, maybe later' })) })
  expect(screen.queryByRole('heading', { name: 'Create a video game from template' })).toBeNull()
  expect(boot).not.toHaveBeenCalled()
  expect(client.gamePackage.status).toHaveBeenCalledTimes(1)

  first.unmount()
  client.gamePackage.status.mockResolvedValueOnce({ state: 'uninitialized', missing: [] })
  render(<GameBootstrap onBoot={boot}><div>workspace</div></GameBootstrap>)
  await screen.findByRole('button', { name: 'Create from template' })
  client.gamePackage.initialize.mockRejectedValueOnce(new Error('temporary'))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create from template' })) })
  expect(await screen.findByText('Initialization failed')).toBeTruthy()
  client.gamePackage.initialize.mockResolvedValueOnce({ state: 'initialized', missing: [], initialized: true })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })) })
  await waitFor(() => expect(boot).toHaveBeenCalledTimes(1))
  expect(screen.getByText('workspace')).toBeTruthy()
  expect(client.gamePackage.status).toHaveBeenCalledTimes(2)
  expect(client.gamePackage.initialize).toHaveBeenCalledTimes(2)
})

test('renders inconsistent packages as an explicit non-retryable error', async () => {
  client.gamePackage.status.mockResolvedValueOnce({ state: 'inconsistent', missing: ['blueprint.json'] })
  render(<GameBootstrap onBoot={vi.fn()}><div>workspace</div></GameBootstrap>)
  expect(await screen.findByText('Video game files are inconsistent')).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toContain('blueprint.json')
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
})

test('surfaces an initialized package load failure and does not mount the workspace', async () => {
  client.gamePackage.status.mockResolvedValueOnce({ state: 'initialized' })
  const boot = vi.fn().mockRejectedValueOnce(new Error('temporary package read failure'))

  render(<GameBootstrap onBoot={boot}><div>workspace</div></GameBootstrap>)

  expect(await screen.findByText('Initialization failed')).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toContain('temporary package read failure')
  expect(screen.queryByText('workspace')).toBeNull()
})

test('explains that direct top-level loading requires a Extension host', async () => {
  client.ready.mockRejectedValueOnce(
    new TypeError('A hostOrigin is required when document.referrer is unavailable'),
  )

  render(<GameBootstrap onBoot={vi.fn()}><div>workspace</div></GameBootstrap>)

  expect(await screen.findByText('Open Video Game Studio from a Extension host.')).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toContain('This standalone URL does not provide the Extension handshake.')
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
})

test('does not repeat status or use a stale onBoot callback after a parent rerender', async () => {
  let resolveStatus: ((value: { state: 'initialized' }) => void) | undefined
  client.gamePackage.status.mockReturnValueOnce(new Promise((resolve) => { resolveStatus = resolve }))
  const firstBoot = vi.fn()
  const latestBoot = vi.fn()
  const view = render(<GameBootstrap onBoot={firstBoot}><div>workspace</div></GameBootstrap>)

  view.rerender(<GameBootstrap onBoot={latestBoot}><div>workspace</div></GameBootstrap>)
  resolveStatus?.({ state: 'initialized' })

  await waitFor(() => expect(latestBoot).toHaveBeenCalledTimes(1))
  expect(firstBoot).not.toHaveBeenCalled()
  expect(client.gamePackage.status).toHaveBeenCalledTimes(1)
})

test.each(['猫', 'a'])('boots the exact handshake game id %s and ignores query selectors', async (gameId) => {
  window.history.replaceState({}, '', '/?slug=query-game&game=other-game')
  client.ready.mockResolvedValueOnce({ gameId })
  client.gamePackage.status.mockResolvedValueOnce({ state: 'initialized' })
  const boot = vi.fn()

  render(<GameBootstrap onBoot={boot}><div>workspace</div></GameBootstrap>)

  await waitFor(() => expect(boot).toHaveBeenCalledWith(gameId))
  expect(client.ready).toHaveBeenCalledTimes(1)
  expect(client.ready.mock.invocationCallOrder[0]).toBeLessThan(
    client.gamePackage.status.mock.invocationCallOrder[0]!,
  )
})

test('boots the explicit in-process game id instead of the iframe handshake id', async () => {
  client.ready.mockResolvedValueOnce({ gameId: 'iframe-game' })
  client.gamePackage.status.mockResolvedValueOnce({ state: 'initialized' })
  const boot = vi.fn()

  render(<GameBootstrap gameId="arrival-game" onBoot={boot}><div>workspace</div></GameBootstrap>)

  await waitFor(() => expect(boot).toHaveBeenCalledWith('arrival-game'))
})

test('auto-initializes an uninitialized package without showing the guide', async () => {
  client.gamePackage.status.mockResolvedValueOnce({ state: 'uninitialized', missing: [] })
  client.gamePackage.initialize.mockResolvedValueOnce({ state: 'initialized', missing: [], initialized: true })
  const boot = vi.fn()

  render(<GameBootstrap autoInitialize onBoot={boot}><div>workspace</div></GameBootstrap>)

  await waitFor(() => expect(boot).toHaveBeenCalledTimes(1))
  expect(screen.getByText('workspace')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Create from template' })).toBeNull()
  expect(client.gamePackage.status).toHaveBeenCalledTimes(1)
  expect(client.gamePackage.initialize).toHaveBeenCalledTimes(1)
})

test('still shows the guide for an uninitialized package when autoInitialize is off', async () => {
  client.gamePackage.status.mockResolvedValueOnce({ state: 'uninitialized', missing: [] })
  const boot = vi.fn()

  render(<GameBootstrap onBoot={boot}><div>workspace</div></GameBootstrap>)

  expect(await screen.findByRole('button', { name: 'Create from template' })).toBeTruthy()
  expect(client.gamePackage.initialize).not.toHaveBeenCalled()
})

test('boots after StrictMode replays the mount effect', async () => {
  client.ready.mockResolvedValue({ gameId: '猫' })
  client.gamePackage.status.mockResolvedValue({ state: 'initialized' })
  const boot = vi.fn()

  render(
    <StrictMode>
      <GameBootstrap onBoot={boot}><div>workspace</div></GameBootstrap>
    </StrictMode>,
  )

  await waitFor(() => expect(boot).toHaveBeenCalledWith('猫'))
  expect(boot).toHaveBeenCalledTimes(1)
  expect(screen.getByText('workspace')).toBeTruthy()
})
