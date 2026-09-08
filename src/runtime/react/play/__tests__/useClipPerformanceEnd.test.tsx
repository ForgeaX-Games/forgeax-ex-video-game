import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GraphSession, type SessionSnapshot } from '@/runtime/core/engine/session'
import type { GameGraph } from '@/runtime/core/schema/graph-schema'
import { node, scnOf } from '@/runtime/__tests__/test-fixtures'
import { useClipPerformanceEnd } from '../useClipPerformanceEnd'

describe('useClipPerformanceEnd', () => {
  it('re-arms when nested blueprints enter different occurrences with the same node id', () => {
    const main: GameGraph = {
      nodes: [node('wrap-a', { subFlowPack: { id: 'pack-a', version: '1' } }), node('after', { durationMs: 100 })],
      edges: [{ id: 'main-next', source: 'wrap-a', target: 'after', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const packA: GameGraph = {
      nodes: [node('entry', { durationMs: 100 }), node('wrap-b', { subFlowPack: { id: 'pack-b', version: '1' } })],
      edges: [{ id: 'a-next', source: 'entry', target: 'wrap-b', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const packB: GameGraph = { nodes: [node('entry', { durationMs: 100 })], edges: [] }
    const scenario = {
      ...scnOf(main),
      manifest: {
        version: 'game-video.blueprint-manifest.v1' as const,
        mainPackId: 'bp-main',
        packs: {
          'bp-main': { id: 'bp-main', entry: 'wrap-a', graph: main },
          'pack-a': { id: 'pack-a', version: '1', entry: 'entry', graph: packA },
          'pack-b': { id: 'pack-b', version: '1', entry: 'entry', graph: packB },
        },
      },
    }
    const session = new GraphSession(scenario, { rootBlueprintId: 'bp-main' })
    let snap = session.start()
    const sessionRef = { current: session }
    const setSnap = vi.fn((next: SessionSnapshot | ((current: SessionSnapshot) => SessionSnapshot)) => {
      snap = typeof next === 'function' ? next(snap) : next
    })
    const { result, rerender } = renderHook(
      ({ clipSeq }) => useClipPerformanceEnd(sessionRef, setSnap, clipSeq, session),
      { initialProps: { clipSeq: snap.clipSeq } },
    )

    act(() => result.current())
    expect(snap.activeBlueprintId).toBe('pack-b')
    expect(snap.clip?.nodeId).toBe('entry')
    expect(snap.clipSeq).toBe(2)

    rerender({ clipSeq: snap.clipSeq })
    act(() => result.current())
    expect(snap.activeBlueprintId).toBe('bp-main')
    expect(snap.currentNodeId).toBe('after')
    expect(snap.callStack).toEqual([])
  })
})
