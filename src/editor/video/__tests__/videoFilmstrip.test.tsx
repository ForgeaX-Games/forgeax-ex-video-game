import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MaterialTimeline } from '../MaterialTimeline'
import { planTiles } from '../videoFilmstrip'

afterEach(cleanup)

describe('videoFilmstrip · planTiles 抽帧密度规划', () => {
  it('非法时长 → 0 帧', () => {
    expect(planTiles(0)).toEqual({ intervalMs: 1_000, count: 0 })
    expect(planTiles(-5)).toEqual({ intervalMs: 1_000, count: 0 })
    expect(planTiles(Number.NaN)).toEqual({ intervalMs: 1_000, count: 0 })
  })

  it('常规时长按 1s 一帧', () => {
    expect(planTiles(10_000)).toEqual({ intervalMs: 1_000, count: 10 })
    expect(planTiles(16_000)).toEqual({ intervalMs: 1_000, count: 16 })
    expect(planTiles(500)).toEqual({ intervalMs: 1_000, count: 1 })
  })

  it('长视频放宽间隔，帧数封顶 24', () => {
    expect(planTiles(30_000)).toEqual({ intervalMs: 1_500, count: 20 })
    expect(planTiles(60_000)).toEqual({ intervalMs: 2_500, count: 24 })
  })
})

describe('videoFilmstrip · 时间轴视频条集成', () => {
  const VIDEO_MATERIAL = {
    key: '__node-video__',
    id: '__node-video__',
    kind: 'video' as const,
    label: 'demo.mp4',
    startMs: 0,
    endMs: 10_000,
    zIndex: 0,
    locked: true,
  }

  it('视频条内渲染帧画面 canvas；无 videoSrc 或非视频条不渲染', () => {
    const { container } = render(
      <MaterialTimeline
        materials={[VIDEO_MATERIAL]}
        maxMs={10_000}
        playheadMs={0}
        selectedMaterialKey={null}
        videoSrc="/demo.mp4"
        onSelectMaterial={vi.fn()}
        onPatchMaterial={vi.fn()}
      />,
    )

    const videoClip = container.querySelector('.gc-mclip.is-video')!
    expect(videoClip.querySelector('canvas.gc-filmstrip')).not.toBeNull()

    cleanup()
    const bare = render(
      <MaterialTimeline
        materials={[VIDEO_MATERIAL]}
        maxMs={10_000}
        playheadMs={0}
        selectedMaterialKey={null}
        onSelectMaterial={vi.fn()}
        onPatchMaterial={vi.fn()}
      />,
    )
    expect(bare.container.querySelector('canvas.gc-filmstrip')).toBeNull()
  })

  it('prefers per-material videoSrc over the timeline-level videoSrc', () => {
    const { container } = render(
      <MaterialTimeline
        materials={[{ ...VIDEO_MATERIAL, videoSrc: '/segment.mp4' }]}
        maxMs={10_000}
        playheadMs={0}
        selectedMaterialKey={null}
        videoSrc="/fallback.mp4"
        onSelectMaterial={vi.fn()}
        onPatchMaterial={vi.fn()}
      />,
    )
    expect(container.querySelector('canvas.gc-filmstrip')).not.toBeNull()
  })
})
