// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest'
import {
  consumeImageGenerationTarget,
  requestImageGenerationTarget,
} from '../imageGenerationNavigation'
import { useCatalogNav } from '../../../persist/catalogNavStore'

beforeEach(() => {
  sessionStorage.clear()
  useCatalogNav.setState({ location: { kind: 'catalog-root', target: 'root:catalog' } })
})

it('carries one character asset into the reusable image-generation page', () => {
  requestImageGenerationTarget({ gameId: 'game-1', characterId: 'character-1', assetId: 'character-image-1', returnView: 'characters' })

  expect(consumeImageGenerationTarget('game-1')).toEqual({
    gameId: 'game-1',
    characterId: 'character-1',
    assetId: 'character-image-1',
    returnView: 'characters',
  })
  expect(consumeImageGenerationTarget('game-1')).toBeUndefined()
})

it('carries a character without a preview asset into manual image generation', () => {
  requestImageGenerationTarget({ gameId: 'game-1', characterId: 'character-2', returnView: 'characters' })

  expect(consumeImageGenerationTarget('game-1')).toEqual({
    gameId: 'game-1',
    characterId: 'character-2',
    returnView: 'characters',
  })
})

it('captures the current catalog folder for image generation and restores it on consume', () => {
  useCatalogNav.setState({ location: {
    kind: 'item', tabKind: 'scene', itemId: 'scene-1', placementKey: 'scene:scene-1', target: 'folder-scenes',
  } })
  requestImageGenerationTarget({ gameId: 'game-1', entityId: 'scene-1', targetRoot: 'scene', returnView: 'assets' })

  expect(consumeImageGenerationTarget('game-1')).toMatchObject({
    entityId: 'scene-1',
    targetRoot: 'scene',
    catalogLocation: {
      kind: 'item', tabKind: 'scene', itemId: 'scene-1', placementKey: 'scene:scene-1', target: 'folder-scenes',
    },
  })
})
