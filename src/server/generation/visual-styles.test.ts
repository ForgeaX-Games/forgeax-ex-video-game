import { describe, expect, it, vi } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { listVideoVisualStyles } from './visual-styles'

describe('listVideoVisualStyles', () => {
  it('normalizes and orders the real Kino response shape', async () => {
    const invoke = vi.fn(async () => ({
      items: [
        { key: 'anime', label: '二次元日系动画', cdn_url: 'https://example.com/anime.jpg', tag: '2D', order: 3 },
        { key: 'bwcinema', label: '黑白电影风格', cdn_url: 'https://example.com/bw.jpg', tag: ['真人'], order: 1 },
      ],
      total: 2,
    }))
    const context = { capabilities: { invoke } } as unknown as ExtensionContext

    await expect(listVideoVisualStyles(context)).resolves.toEqual({ items: [
      { key: 'bwcinema', label: '黑白电影风格', cdnUrl: 'https://example.com/bw.jpg', tags: ['真人'], order: 1 },
      { key: 'anime', label: '二次元日系动画', cdnUrl: 'https://example.com/anime.jpg', tags: ['2D'], order: 3 },
    ] })
    expect(invoke).toHaveBeenCalledWith('media.video.visual-styles.list', 1, {})
  })

  it('rejects an invalid upstream item', async () => {
    const context = {
      capabilities: { invoke: vi.fn(async () => ({ items: [{ key: 'broken' }] })) },
    } as unknown as ExtensionContext
    await expect(listVideoVisualStyles(context)).rejects.toThrow('invalid visual style')
  })
})
