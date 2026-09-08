import { describe, expect, it } from 'vitest'
import {
  emptyFlowTimeline,
  flowTimelineIdentity,
  projectFlowTimeline,
  updateFlowTimelineDuration,
  visitFlowTimeline,
} from '../flowPreviewTimeline'
import { node, scnOf } from '../../../runtime/__tests__/test-fixtures'

const visit = (nodeId: string, durationMs = 1000) => ({
  blueprintId: 'main',
  graphPath: [],
  nodeId,
  nodeTitle: nodeId.toUpperCase(),
  durationMs,
})

describe('flow preview timeline ledger', () => {
  it('appends the actual route and computes stable offsets', () => {
    let ledger = emptyFlowTimeline()
    ledger = visitFlowTimeline(ledger, visit('a', 1200))
    ledger = visitFlowTimeline(ledger, visit('b', 800))

    expect(ledger.activeIndex).toBe(1)
    expect(ledger.segments.map(({ nodeId, startMs, endMs }) => ({ nodeId, startMs, endMs }))).toEqual([
      { nodeId: 'a', startMs: 0, endMs: 1200 },
      { nodeId: 'b', startMs: 1200, endMs: 2000 },
    ])
  })

  it('reuses an existing segment when a cycle returns to it', () => {
    let ledger = emptyFlowTimeline()
    ledger = visitFlowTimeline(ledger, visit('battle'))
    ledger = visitFlowTimeline(ledger, visit('failed'))
    ledger = visitFlowTimeline(ledger, visit('battle'))

    expect(ledger.segments.map((segment) => segment.nodeId)).toEqual(['battle', 'failed'])
    expect(ledger.activeIndex).toBe(0)

    const projected = projectFlowTimeline(ledger, 240, () => null)
    expect(projected.playheadMs).toBe(240)
    expect(projected.maxMs).toBe(2000)
  })

  it('replaces the stale suffix when a loop exits through another branch', () => {
    let ledger = emptyFlowTimeline()
    ledger = visitFlowTimeline(ledger, visit('battle'))
    ledger = visitFlowTimeline(ledger, visit('failed'))
    ledger = visitFlowTimeline(ledger, visit('battle'))
    ledger = visitFlowTimeline(ledger, visit('victory', 1500))

    expect(ledger.segments.map((segment) => segment.nodeId)).toEqual(['battle', 'victory'])
    expect(ledger.segments[1]).toMatchObject({ startMs: 1000, endMs: 2500 })
  })

  it('treats identical node ids in different graph scopes as different segments', () => {
    let ledger = visitFlowTimeline(emptyFlowTimeline(), visit('entry'))
    ledger = visitFlowTimeline(ledger, {
      ...visit('entry'),
      blueprintId: 'battle-pack',
      graphPath: ['round'],
    })

    expect(ledger.segments).toHaveLength(2)
    expect(ledger.segments[0]?.instanceKey).not.toBe(ledger.segments[1]?.instanceKey)
  })

  it('reflows later segments when video metadata corrects a duration', () => {
    let ledger = visitFlowTimeline(emptyFlowTimeline(), visit('a'))
    ledger = visitFlowTimeline(ledger, visit('b'))
    ledger = updateFlowTimelineDuration(ledger, flowTimelineIdentity(visit('a')), 2400)

    expect(ledger.segments.map(({ startMs, endMs }) => ({ startMs, endMs }))).toEqual([
      { startMs: 0, endMs: 2400 },
      { startMs: 2400, endMs: 3400 },
    ])
  })

  it('projects every visited node as a proportional video track', () => {
    let ledger = visitFlowTimeline(emptyFlowTimeline(), visit('knock', 15_000))
    ledger = visitFlowTimeline(ledger, visit('next', 7_000))

    const projected = projectFlowTimeline(ledger, 0, () => null)
    const videos = projected.materials.filter((material) => material.kind === 'video')

    expect(videos.map(({ label, startMs, endMs }) => ({ label, startMs, endMs }))).toEqual([
      { label: 'KNOCK', startMs: 0, endMs: 15_000 },
      { label: 'NEXT', startMs: 15_000, endMs: 22_000 },
    ])
    expect(videos.map((video) => video.endMs - video.startMs)).toEqual([15_000, 7_000])
    expect(projected.maxMs).toBe(22_000)
  })

  it('attaches per-segment videoSrc for filmstrip frames when resolver is provided', () => {
    let ledger = visitFlowTimeline(emptyFlowTimeline(), visit('a', 1000))
    ledger = visitFlowTimeline(ledger, visit('b', 2000))
    const a = node('a', { media: { ref: 'clip-a' } })
    const b = node('b', { media: { ref: 'clip-b' } })
    const scenario = scnOf({ nodes: [a, b], edges: [] })

    const projected = projectFlowTimeline(
      ledger,
      0,
      (segment) => ({
        scenario,
        node: segment.nodeId === 'a' ? a : b,
      }),
      (_segment, source) => source ? `/media/${source.node.data.media?.ref}` : undefined,
    )

    expect(projected.materials.filter((m) => m.kind === 'video').map((m) => m.videoSrc)).toEqual([
      '/media/clip-a',
      '/media/clip-b',
    ])
  })

  it('projects each node settlement into the global route coordinates', () => {
    const first = node('a', {
      durationMs: 1000,
      routingSettlement: { type: 'at', ms: 600 },
    })
    const second = node('b', {
      durationMs: 2000,
      routingSettlement: { type: 'at', ms: 250 },
    })
    const scenario = scnOf({ nodes: [first, second], edges: [] })
    let ledger = visitFlowTimeline(emptyFlowTimeline(), visit('a', 1000))
    ledger = visitFlowTimeline(ledger, visit('b', 2000))

    const projected = projectFlowTimeline(ledger, 400, (segment) => ({
      scenario,
      node: segment.nodeId === 'a' ? first : second,
    }))

    expect(projected.pointMarkers.map(({ ms, label }) => ({ ms, label }))).toEqual([
      { ms: 600, label: 'A · 结算时刻 · 延迟事件边在此刻提交并离开节点' },
      { ms: 1250, label: 'B · 结算时刻 · 延迟事件边在此刻提交并离开节点' },
    ])
    expect(projected.playheadMs).toBe(1400)
    expect(projected.segments.map(({ label, startMs, endMs }) => ({ label, startMs, endMs }))).toEqual([
      { label: 'A', startMs: 0, endMs: 1000 },
      { label: 'B', startMs: 1000, endMs: 3000 },
    ])
  })
})
