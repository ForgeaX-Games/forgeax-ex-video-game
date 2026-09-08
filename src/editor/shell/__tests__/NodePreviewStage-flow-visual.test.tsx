// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GraphSession } from '@/runtime/core/engine/session'
import { node, scnOf } from '../../../runtime/__tests__/test-fixtures'
import { NodePreviewStage, type FlowNodePreviewState } from '../NodePreviewStage'

describe('NodePreviewStage · Flow preview visual contract', () => {
  it('uses the aligned frame and control card while preserving Flow-only controls', () => {
    const current = node('flow-a', { name: '流程节点 A', durationMs: 3_000 })
    const scenario = scnOf({ nodes: [current], edges: [] })
    const session = new GraphSession(scenario)
    const snapshot = session.start()
    const flow: FlowNodePreviewState = {
      snapshot,
      session,
      videoSrc: undefined,
      videoKey: 'flow-a-0',
      preloadVideos: [],
      timeline: {
        materials: [{
          key: 'flow-a-video',
          id: 'flow-a-video',
          kind: 'video',
          label: '流程节点 A',
          startMs: 0,
          endMs: 3_000,
          zIndex: 0,
        }],
        pointMarkers: [],
        conditionMarkers: [],
        segments: [{
          id: 'flow-a',
          label: '流程节点 A',
          startMs: 0,
          endMs: 3_000,
          active: true,
        }],
        activeIndex: 0,
        playheadMs: 1_000,
        maxMs: 3_000,
      },
      paused: true,
      playbackRate: 1,
      videoAudioEnabled: true,
      bgmRunKey: 0,
      resolveBgm: () => undefined,
      onPausedChange: vi.fn(),
      onPlaybackRateChange: vi.fn(),
      onVideoAudioToggle: vi.fn(),
      onRestart: vi.fn(),
      onEmit: vi.fn(),
      onTick: vi.fn(),
      onPerformanceEnd: vi.fn(),
      onDurationChange: vi.fn(),
      onSeek: vi.fn(() => true),
    }

    const { container } = render(
      <NodePreviewStage
        scenario={scenario}
        node={current}
        game="test"
        muted={false}
        mode="preview"
        flow={flow}
        timelineDisclosure={{ showToggle: true }}
        onEditScenario={vi.fn()}
        onMutedChange={vi.fn()}
      />,
    )

    expect(screen.getByTestId('flow-node-preview')).toBeTruthy()
    expect(container.querySelector('.nps-frame')).toHaveClass('nps-frame-edit')
    expect(getComputedStyle(container.querySelector('.nps-root') as HTMLElement).backgroundColor)
      .toBe('#2C2C2C')

    const controls = container.querySelector('.nps-flow-controls')
    expect(controls).toHaveClass('nps-video-controls')
    expect(controls).not.toHaveClass('nps-controls')

    expect(screen.getByRole('button', { name: '继续预览' }).querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('button', { name: '从起始节点重开' }).querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('button', { name: '关闭视频声音' }).querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('combobox', { name: '预览倍速' })).toHaveValue('1')
    expect(screen.getByText(snapshot.phase)).toBeTruthy()
    expect(screen.getByText('00:01')).toBeTruthy()
    expect(screen.getByText(/\/ 00:03/)).toBeTruthy()

    expect(container.querySelector('.mtl-root')).toHaveClass('is-readonly')
    expect(container.querySelector('.gc-flow-segment.is-active')).not.toBeNull()
  })
})
