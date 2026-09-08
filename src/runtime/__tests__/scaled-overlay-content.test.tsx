// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ScaledOverlayContent,
  computeScaledOverlayGeometry,
} from '../react/play/ScaledOverlayContent'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ScaledOverlayContent', () => {
  it('uses the interface canvas width as the logical stage and a uniform scale', () => {
    expect(computeScaledOverlayGeometry(480, 270)).toEqual({
      logicalWidth: 960,
      logicalHeight: 540,
      scale: 0.5,
    })
    expect(computeScaledOverlayGeometry(1280, 800)).toEqual({
      logicalWidth: 1280,
      logicalHeight: 800,
      scale: 1,
    })
  })

  it('scales fixed-pixel overlay content with the rendered stage width', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-overlay-scale-root')) {
        return {
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          right: 480,
          bottom: 270,
          width: 480,
          height: 270,
          toJSON: () => ({}),
        }
      }
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      }
    })

    const { container } = render(
      <div style={{ position: 'relative', width: 480, height: 270 }}>
        <ScaledOverlayContent>
          <span>overlay</span>
        </ScaledOverlayContent>
      </div>,
    )

    expect(screen.getByText('overlay')).toBeInTheDocument()
    const stage = container.querySelector('[data-overlay-logical-stage]') as HTMLElement
    expect(stage.style.width).toBe('960px')
    expect(stage.style.height).toBe('540px')
    expect(stage.style.transform).toBe('scale(0.5)')
  })
})
