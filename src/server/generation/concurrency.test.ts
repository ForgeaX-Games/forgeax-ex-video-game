import { describe, expect, it } from 'vitest'
import { DEFAULT_GENERATION_CONCURRENCY, mapWithConcurrency } from './concurrency'

describe('批内并发', () => {
  it('默认上限是 4，避免限流与计费突刺', () => {
    expect(DEFAULT_GENERATION_CONCURRENCY).toBe(4)
  })

  it('保持输入顺序，即便完成顺序被打乱', async () => {
    const delays = [30, 5, 20, 1, 10]
    const output = await mapWithConcurrency(delays, 4, async (delay, index) => {
      await new Promise((resolve) => setTimeout(resolve, delay))
      return index
    })
    expect(output).toEqual([0, 1, 2, 3, 4])
  })

  it('并发度不超过上限', async () => {
    let active = 0
    let peak = 0
    await mapWithConcurrency(Array.from({ length: 12 }, (_unused, index) => index), 4, async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return null
    })
    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1)
  })

  it('目标数少于上限时不空转', async () => {
    let started = 0
    await mapWithConcurrency([1, 2], 4, async () => {
      started += 1
      return null
    })
    expect(started).toBe(2)
  })

  it('空输入直接返回', async () => {
    expect(await mapWithConcurrency([], 4, async () => 'x')).toEqual([])
  })
})
