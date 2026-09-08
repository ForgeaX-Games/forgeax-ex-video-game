import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClipSnap } from '@/runtime/core/engine/session'
import { GameStage } from '../GameStage'

afterEach(cleanup)

const noop = (): void => {}

const placeholderClip: ClipSnap = {
  nodeId: 'node_2',
  name: '生死审判',
  mediaId: 'a-video-final-placeholder-v1',
  loop: false,
}

function renderStage(overrides: Partial<Parameters<typeof GameStage>[0]>): void {
  render(
    <GameStage
      videoSrc="/media/placeholder.mp4"
      clip={placeholderClip}
      overlayMounts={[]}
      skins={undefined}
      skinCtx={undefined}
      onEmit={noop}
      onTick={noop}
      onPerformanceEnd={noop}
      {...overrides}
    />,
  )
}

describe('GameStage pending video card', () => {
  it('shows an explicit "not generated" card (node name + node id) when the clip video is a placeholder', () => {
    renderStage({ videoPending: true })

    const card = screen.getByTestId('stage-pending-card')
    expect(card).toHaveTextContent('生死审判')
    expect(card).toHaveTextContent('node_2')
    // A pending placeholder is NOT a load failure — the "cannot play resource" notice must not appear.
    expect(screen.queryByTestId('missing-video-notice')).toBeNull()
  })

  it('does not render the pending card when the clip video is a ready asset', () => {
    renderStage({ videoPending: false, clip: { ...placeholderClip, mediaId: 'ready-id' } })

    expect(screen.queryByTestId('stage-pending-card')).toBeNull()
  })
})
