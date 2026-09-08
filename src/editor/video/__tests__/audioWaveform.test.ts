import { describe, expect, it } from 'vitest'
import { waveformBarHeights } from '../audioWaveform'

describe('waveformBarHeights', () => {
  it('uses absolute peaks from every sample window and preserves silence', () => {
    const peaks = {
      min: new Float32Array([0, -.2, -.8, 0]),
      max: new Float32Array([.1, .4, .3, 0]),
      buckets: 4,
    }

    expect(waveformBarHeights(peaks, 2)[0]).toBeCloseTo(.4)
    expect(waveformBarHeights(peaks, 2)[1]).toBeCloseTo(.8)
    expect(waveformBarHeights(peaks, 6).at(-1)).toBe(0)
  })
})
