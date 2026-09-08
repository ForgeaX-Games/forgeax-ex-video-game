import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  createTestSkinRegistry,
  TEST_CHOICE,
  TEST_FLOAT,
  TEST_HUD,
  TEST_QTE,
} from '../../../runtime/__tests__/test-components'
import type { OverlayChild } from '@/runtime/core/schema/graph-schema'
import { renderOverlayChildPreview } from '../overlayChildPreview'

const ctx = {
  hud: { entities: {}, vars: {}, flags: {}, score: 0 },
}

function renderPreview(
  component: string,
  playheadMs: number,
  previewPlaying = false,
  window?: OverlayChild['window'],
): string {
  return renderToStaticMarkup(renderOverlayChildPreview(
    { id: component, component, inputs: {}, window },
    createTestSkinRegistry(),
    ctx,
    playheadMs,
    undefined,
    previewPlaying,
  ) as ReactElement)
}

describe('overlayChildPreview fixture rendering', () => {
  it('uses the fixture fit target for HUD previews', () => {
    const html = renderPreview(TEST_HUD, 0)
    expect(html).toContain('class="test-stub')
    expect(html).toContain('data-overlay-fit-target="true"')
  })

  it.each([TEST_FLOAT, TEST_CHOICE, TEST_QTE])(
    'freezes %s at its local preview time',
    (component) => {
      const html = renderPreview(component, 1300, false, { startMs: 1000 })
      expect(html).toContain('test-stub')
      expect(html).toContain('is-preview-frozen')
      expect(html).toContain('--preview-t:300ms')
      expect(html).toContain('data-overlay-fit-target="true"')
    },
  )

  it('does not freeze fixture animations while preview playback is active', () => {
    const html = renderPreview(TEST_QTE, 400, true)
    expect(html).toContain('class="test-stub"')
    expect(html).not.toContain('is-preview-frozen')
    expect(html).not.toContain('--preview-t')
  })
})
