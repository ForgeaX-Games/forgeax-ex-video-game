import { describe, expect, it } from 'vitest'
import {
  createDevSessionContext,
  normalizeDevGameId,
  selectDevRuntime,
} from '../dev-host-session'

describe('standalone development host session', () => {
  it('selects the game-video runtime from the host catalog', () => {
    expect(selectDevRuntime([
      { extensionId: 'other', runtimeId: 'rt_other' },
      { extensionId: '@forgeax-extension/game-video', runtimeId: 'rt_video' },
    ])).toEqual({
      extensionId: '@forgeax-extension/game-video',
      runtimeId: 'rt_video',
    })
  })

  it('constructs bounded host endpoints from the selected game and runtime', () => {
    expect(createDevSessionContext({
      extensionId: '@forgeax-extension/game-video',
      runtimeId: 'rt_video',
    }, 'local game', { locale: 'zh-CN', theme: 'light' })).toEqual({
      extensionId: '@forgeax-extension/game-video',
      runtimeId: 'rt_video',
      gameId: 'local game',
      locale: 'zh-CN',
      theme: 'light',
      endpoints: {
        toolCall: '/__extension__/v1/tools/call',
        gamePackage: '/__extension__/v1/games/local%20game/package',
        extensionApi: '/__extension__/v1/extension/rt_video?gameId=local%20game',
        gameVersions: '/__extension__/v1/games/local%20game/versions',
        gameComponents: '/__extension__/v1/games/local%20game/components',
      },
      capabilities: ['game-package', 'game-versions', 'game-components'],
    })
  })

  it('rejects path-like game ids and missing runtimes', () => {
    expect(() => normalizeDevGameId('../outside')).toThrow(/path separators/u)
    expect(() => selectDevRuntime([])).toThrow(/runtime is missing/u)
  })
})
