import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GameGraph } from '@/runtime/core/schema/graph-schema'
import { node, scnOf } from '@/runtime/__tests__/test-fixtures'
import { GamePlayer } from '../GamePlayer'

vi.mock('../BgmPlayer', () => ({ BgmPlayer: () => null }))
vi.mock('../GameStage', () => ({
  GameStage: ({
    clip,
    onPerformanceEnd,
  }: {
    clip?: { nodeId: string }
    onPerformanceEnd(): void
  }) => (
    <button type="button" data-testid="finish-performance" onClick={onPerformanceEnd}>
      {clip?.nodeId}
    </button>
  ),
}))

describe('GamePlayer', () => {
  it('notifies the host once when the session reaches its end', () => {
    const graph: GameGraph = {
      nodes: [node('ending', { durationMs: 100 })],
      edges: [],
    }
    const onEnded = vi.fn()

    render(
      <GamePlayer
        scenario={scnOf(graph)}
        game="demo"
        resolveAsset={() => undefined}
        onEnded={onEnded}
      />,
    )

    expect(onEnded).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('finish-performance'))

    expect(onEnded).toHaveBeenCalledOnce()
  })
})
