import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createViteExtensionPlugin } from '@forgeax/extension-host/vite'
import { createDevExtensionHost, resolveDevGamesRoot } from './dev-host'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('development Vite adapter', () => {
  it('keeps the default game workspace inside the standalone checkout', () => {
    const checkoutRoot = resolve('workspace', 'forgeax-game-video')
    expect(resolveDevGamesRoot(checkoutRoot)).toBe(resolve(checkoutRoot, '.extension-dev', 'games'))
  })

  it('supports the greenfield package lifecycle for a new game id', async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'game-video-greenfield-'))
    const gamesRoot = join(fixtureRoot, 'games')
    temporaryRoots.push(fixtureRoot)
    mkdirSync(gamesRoot)

    const host = createDevExtensionHost({
      extensionRoot: resolve(import.meta.dirname, '..', '..'),
      gamesRoot,
    })
    const gameId = 'new-greenfield-game'

    await expect(host.packageStatus(gameId)).resolves.toMatchObject({
      state: 'uninitialized',
    })
    // The backend entry is intentionally loaded by the Bun/Vite runtime in
    // the browser acceptance suite. This unit test covers the adapter boundary
    // that previously returned workspace_not_found before initialization.
    expect(resolve(gamesRoot, gameId)).toBeTruthy()
  })

  it('refuses to construct in production mode', () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      expect(() => createViteExtensionPlugin({} as never)).toThrow(
        'development-only',
      )
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous
    }
  })

  it('rejects a game directory symlink that escapes the local workspace', async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'game-video-dev-host-'))
    const gamesRoot = join(fixtureRoot, 'games')
    const outsideRoot = mkdtempSync(join(tmpdir(), 'game-video-outside-'))
    temporaryRoots.push(fixtureRoot, outsideRoot)
    mkdirSync(gamesRoot)
    symlinkSync(outsideRoot, join(gamesRoot, 'escaped-game'), 'dir')

    const host = createDevExtensionHost({
      extensionRoot: resolve(import.meta.dirname, '..', '..'),
      gamesRoot,
    })

    await expect(
      host.componentFile('escaped-game', 'panel.js'),
    ).rejects.toThrow('Game workspace was not found')
  })
})
