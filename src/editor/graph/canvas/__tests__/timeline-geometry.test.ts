import { describe, expect, it } from 'vitest'
import type { OverlayChild } from '@/runtime/core/schema/node-config-schema'
import { clampSettlementSpawnTtlMs, spawnTemplateTtlMs } from '@/authoring/graph/timeline-geometry'

const child = (over: Partial<OverlayChild> = {}): OverlayChild => ({
  id: 'value',
  component: 'test.float',
  trigger: { when: 'enter' },
  inputs: {},
  ...over,
})

describe('spawnTemplateTtlMs', () => {
  it('reads the declared visible length off the template window', () => {
    expect(spawnTemplateTtlMs(child({ window: { startMs: 400, endMs: 1_000 } }))).toBe(600)
  })

  it('measures from 0 when the window only declares an end', () => {
    expect(spawnTemplateTtlMs(child({ window: { endMs: 900 } }))).toBe(900)
  })

  it('measures from the at trigger when the window declares no start', () => {
    expect(spawnTemplateTtlMs(child({ trigger: { when: 'at', ms: 300 }, window: { endMs: 900 } }))).toBe(600)
  })

  it('reports no length when the window declares no end, which means persist to node end', () => {
    // builtin-schemes 的注释即此约定：不写 endMs = 持续到节点结束 → 绑定后就是「常驻」。
    expect(spawnTemplateTtlMs(child({ window: { startMs: 0 } }))).toBeUndefined()
  })

  it('reports no length when the template declares no window at all', () => {
    expect(spawnTemplateTtlMs(child())).toBeUndefined()
  })

  it('reports no length for a non-positive window, rather than a zero-length interface', () => {
    expect(spawnTemplateTtlMs(child({ window: { startMs: 900, endMs: 900 } }))).toBeUndefined()
    expect(spawnTemplateTtlMs(child({ window: { startMs: 900, endMs: 400 } }))).toBeUndefined()
  })
})

describe('clampSettlementSpawnTtlMs', () => {
  it('caps a duration at the node performance length', () => {
    expect(clampSettlementSpawnTtlMs(99_999, 8_000)).toBe(8_000)
  })

  it('treats a missing or non-positive duration as running to the node end', () => {
    expect(clampSettlementSpawnTtlMs(undefined, 8_000)).toBe(8_000)
    expect(clampSettlementSpawnTtlMs(0, 8_000)).toBe(8_000)
  })
})
