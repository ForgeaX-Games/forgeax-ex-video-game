import { describe, expect, it } from 'vitest'
import {
  KINO_DEFAULT_GENERATION,
  KINO_VIDEO_GENERATION_MODES,
  KINO_VIDEO_RESOLUTIONS,
  KINO_VIDEO_SIZES,
  type KinoVideoGenerationParams,
} from '../core/schema/kino-schema'

describe('Kino video generation schema', () => {
  it('publishes the generation parameter vocabulary used by the editor', () => {
    expect(KINO_VIDEO_GENERATION_MODES).toEqual(['strict', 'firstref', 'ref', 't2v'])
    expect(KINO_VIDEO_RESOLUTIONS).toEqual(['720p', '1080p'])
    expect(KINO_VIDEO_SIZES).toEqual([
      '2560x1440',
      '1440x2560',
      '2496x1664',
      '1664x2496',
    ])
  })

  it('represents all parameters sent to Kino video generation', () => {
    const params = {
      prompt: 'A continuous tracking shot through a rainy alley',
      durationSeconds: 8,
      generateAudio: true,
      mode: 'strict',
      firstFrameResourceId: 'resource-first',
      lastFrameResourceId: 'resource-last',
      size: '2560x1440',
      resolution: '1080p',
      model: 'seedance2',
      visualStyleKey: 'bwcinema',
    } satisfies KinoVideoGenerationParams

    expect(params.mode).toBe('strict')
  })

  it('provides generation defaults without a bundled placeholder video', () => {
    expect(KINO_DEFAULT_GENERATION).toEqual({
      prompt: '',
      durationSeconds: 8,
      generateAudio: false,
      mode: 't2v',
      size: '2560x1440',
      resolution: '720p',
    })
  })
})
