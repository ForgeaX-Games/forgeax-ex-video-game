import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('game-video browser key migration', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it.each(['reel-studio:graph:view', 'gamevideo:graph:view'])(
    'moves %s into the game-video namespace',
    async (oldKey) => {
      localStorage.setItem(oldKey, 'saved')
      await import('../bootMigrateLegacyKeys')
      expect(localStorage.getItem('game-video:graph:view')).toBe('saved')
      expect(localStorage.getItem(oldKey)).toBeNull()
    },
  )

  it('preserves the node-panel preview width while moving its dotted gvid key', async () => {
    localStorage.setItem('gvid.nodePanel.previewW', '512')
    await import('../bootMigrateLegacyKeys')
    expect(localStorage.getItem('game-video.nodePanel.previewW')).toBe('512')
    expect(localStorage.getItem('gvid.nodePanel.previewW')).toBeNull()
  })

  it('preserves the node-panel preview state while moving its dotted gvid key', async () => {
    localStorage.setItem('gvid.nodePanel.previewOpen', '1')
    await import('../bootMigrateLegacyKeys')
    expect(localStorage.getItem('game-video.nodePanel.previewOpen')).toBe('1')
    expect(localStorage.getItem('gvid.nodePanel.previewOpen')).toBeNull()
  })

  it('does not overwrite an existing new key', async () => {
    localStorage.setItem('gamevideo:graph:view', 'old')
    localStorage.setItem('game-video:graph:view', 'new')
    await import('../bootMigrateLegacyKeys')
    expect(localStorage.getItem('game-video:graph:view')).toBe('new')
  })
})
