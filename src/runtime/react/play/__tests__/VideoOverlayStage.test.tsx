import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VideoOverlayStage, videoOverlayStageStyle } from '../VideoOverlayStage'

describe('VideoOverlayStage', () => {
  it('keeps the video stage as the cqw/cqh container', () => {
    expect(videoOverlayStageStyle({
      left: 12,
      top: 8,
      width: 960,
      height: 540,
    })).toMatchObject({
      containerType: 'size',
      position: 'absolute',
      left: 12,
      top: 8,
      width: 960,
      height: 540,
    })
  })

  it('uses the same scaled overlay content shell as the node video preview', () => {
    const { container } = render(
      <VideoOverlayStage contentRect={null}>
        <span>overlay</span>
      </VideoOverlayStage>,
    )
    expect(container.querySelector('[data-overlay-scale-root]')).not.toBeNull()
    expect(container.querySelector('[data-overlay-logical-stage]')).not.toBeNull()
  })
})
