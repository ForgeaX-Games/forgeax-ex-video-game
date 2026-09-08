import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GameScenario } from '@/runtime/core/schema/graph-schema'
import { GraphPlayer } from '../GraphPlayer'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { useKinoVideoCache } from '../../assets/kinoVideoCacheStore'

const hostClient = vi.hoisted(() => ({
  context: {
    gameId: 'test-game',
    endpoints: { gamePackage: 'https://host.test/__extension__/v1/games/test-game/package' },
  },
  extension: {
    fetch: vi.fn(),
    url: vi.fn((path: string) => `https://host.test/extension/runtime/${path.replace(/^\//, '')}`),
  },
  tool: { call: vi.fn() },
}))

vi.mock('../../../lib/extension-host', () => ({
  getExtensionHost: () => hostClient,
  ExtensionResponseError: class ExtensionResponseError extends Error {
    constructor(readonly status: number, message: string) {
      super(message)
    }
  },
  readExtensionJson: vi.fn(),
}))

const SCENARIO: GameScenario = {
  version: 'game-video.graph.v1',
  graph: {
    nodes: [{
      id: 'intro',
      type: 'perf',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: [],
      data: {
        name: 'Intro',
        media: { kind: 'video', ref: 'stable-video-id' },
      },
    }],
    edges: [],
  },
}

describe('GraphPlayer missing video handling', () => {
  it('reports a failed native CDN URL and clears it on loadedmetadata', () => {
    useGraphScenario.setState({ game: 'test-game' })
    useKinoVideoCache.setState({
      byGame: {
        'test-game': {
          items: [{
            resource_id: 'stable-video-id',
            game_id: 'test-game',
            media_type: 'video',
            name: 'stable-video.mp4',
            type: 'UPLOAD',
            url: 'https://cdn.test/stable-video.mp4',
            source: 'upload',
            source_meta: {},
            created_at: 1,
            updated_at: 1,
          }],
          total: 1,
          loading: false,
          error: null,
          generation: 1,
        },
      },
    })
    const { container } = render(<GraphPlayer scenario={SCENARIO} />)
    const video = container.querySelector('video')
    expect(video).toBeTruthy()

    fireEvent.error(video!)
    expect(screen.getByRole('status')).toHaveTextContent('stable-video-id')

    fireEvent.loadedMetadata(video!)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
