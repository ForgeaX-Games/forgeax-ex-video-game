import { describe, expect, it } from 'vitest'
import {
  KINO_DEFAULT_IMAGE,
  KINO_DEFAULT_IMAGE_MODEL,
  KINO_IMAGE_SIZES,
  type KinoImageGenerationParams,
} from '../core/schema/kino-image-schema'

describe('Kino image generation schema', () => {
  it('publishes the supported sizes and deployed default model', () => {
    expect(KINO_IMAGE_SIZES).toEqual([
      '2560x1440',
      '1440x2560',
      '2496x1664',
      '1664x2496',
    ])
    expect(KINO_DEFAULT_IMAGE.generation).toEqual({
      prompt: '',
      model: KINO_DEFAULT_IMAGE_MODEL,
      size: '2560x1440',
    })
  })

  it('uses Kino resource ids for image references', () => {
    const generation = {
      prompt: 'front side back character turnaround',
      referenceImageResourceIds: ['kino-resource-1'],
      size: '2560x1440',
      model: 'lite',
    } satisfies KinoImageGenerationParams

    expect(generation.referenceImageResourceIds).toEqual(['kino-resource-1'])
  })
})
