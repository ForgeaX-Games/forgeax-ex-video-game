// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeGamePackage } from '../package'
import type { RuntimeSdkHost } from '../runtime-host'
import { setLocale } from '@/i18n'
import { RuntimeGameApp } from '../RuntimeGameApp'

const { refreshGameComponentsFromUrl, mountRun } = vi.hoisted(() => ({
  refreshGameComponentsFromUrl: vi.fn(async () => true),
  mountRun: vi.fn(),
}))

vi.mock('@/runtime/react/component-host', () => ({
  refreshGameComponentsFromUrl,
}))

vi.mock('@/runtime/react/play', async () => {
  const { useEffect } = await import('react')
  return {
    GamePlayer: ({ game, resolveAsset, onEnded, paused }: {
      game: string
      resolveAsset: (id: string, game: string) => string | undefined
      onEnded?: () => void
      paused?: boolean
    }) => {
      useEffect(() => mountRun(), [])
      return (
        <>
          <output data-testid="player" data-paused={paused ? 'true' : 'false'}>
            {game}:{resolveAsset('clip', game)}
          </output>
          <button type="button" data-testid="finish-run" onClick={onEnded}>end</button>
        </>
      )
    },
  }
})

const gamePackage = {
  project: { id: 'arrival-game' },
  blueprint: {
    graph: { nodes: [], edges: [] },
    manifest: { mainPackId: 'main', packs: {} },
  },
  assetsManifest: {
    version: 2,
    assets: [{
      id: 'clip',
      kind: 'video',
      url: '/__extension__/v1/games/arrival-game/media/clip',
    }],
  },
} as unknown as RuntimeGamePackage

beforeEach(() => {
  refreshGameComponentsFromUrl.mockClear()
  mountRun.mockClear()
  setLocale('zh')
})
afterEach(cleanup)

describe('RuntimeGameApp', () => {
  it('renders a Extension package with its manifest locator once the player is started', async () => {
    const host: RuntimeSdkHost = {
      ready: vi.fn(async () => ({
        gameId: 'arrival-game',
        gamePackage,
        componentModuleUrl: '/__extension__/v1/games/arrival-game/components/index.js',
      })),
    }

    render(<RuntimeGameApp host={host} />)

    fireEvent.click(await screen.findByRole('button', { name: '开始游戏' }))

    expect((await screen.findByTestId('player')).textContent).toBe(
      'arrival-game:/__extension__/v1/games/arrival-game/media/clip',
    )
    expect(refreshGameComponentsFromUrl).toHaveBeenCalledWith(
      'arrival-game',
      '/__extension__/v1/games/arrival-game/components/index.js',
    )
  })

  // Browsers block sound-on autoplay without a gesture (NotAllowedError from video.play()).
  // The gate keeps the session frozen so its first frame shows through the scrim without
  // playing, and the click is what turns playback into a user-initiated gesture.
  it('keeps the player paused behind the start scrim until the gesture arrives', async () => {
    const host: RuntimeSdkHost = {
      ready: vi.fn(async () => ({
        gameId: 'arrival-game',
        gamePackage,
        componentModuleUrl: '/__extension__/v1/games/arrival-game/components/index.js',
      })),
    }

    render(<RuntimeGameApp host={host} />)

    expect(await screen.findByTestId('player')).toHaveAttribute('data-paused', 'true')

    fireEvent.click(screen.getByRole('button', { name: '开始游戏' }))

    expect(screen.getByTestId('player')).toHaveAttribute('data-paused', 'false')
    expect(screen.queryByRole('button', { name: '开始游戏' })).toBeNull()
  })

  it('remounts the player with a fresh run when the finished game is restarted', async () => {
    const host: RuntimeSdkHost = {
      ready: vi.fn(async () => ({
        gameId: 'arrival-game',
        gamePackage,
        componentModuleUrl: '/__workbench__/v1/games/arrival-game/components/index.js',
      })),
    }

    render(<RuntimeGameApp host={host} />)

    fireEvent.click(await screen.findByRole('button', { name: '开始游戏' }))
    await screen.findByTestId('player')
    expect(mountRun).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: '重新开始' })).toBeNull()

    fireEvent.click(screen.getByTestId('finish-run'))
    expect(await screen.findByText('游戏结束')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: '重新开始' }))

    expect(screen.queryByRole('button', { name: '重新开始' })).toBeNull()
    expect(screen.queryByText('游戏结束')).toBeNull()
    expect(mountRun).toHaveBeenCalledTimes(2)
  })

  it('shows a host loading failure', async () => {
    const host: RuntimeSdkHost = {
      ready: vi.fn(async () => {
        throw new Error('Extension package unavailable')
      }),
    }

    render(<RuntimeGameApp host={host} />)

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Extension package unavailable'))
  })

  it('closes an in-flight runtime host when unmounted', () => {
    const close = vi.fn()
    const host = {
      ready: vi.fn(() => new Promise(() => {})),
      close,
    } as RuntimeSdkHost & { close(): void }

    const view = render(<RuntimeGameApp host={host} />)
    view.unmount()

    expect(close).toHaveBeenCalledOnce()
  })
})
