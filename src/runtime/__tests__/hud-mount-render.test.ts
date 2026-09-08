import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createTestSkinRegistry, TEST_HUD } from './test-components'

describe('HUD mount rendering', () => {
  it('renders fixture HUD children through an isolated skin registry', () => {
    const skins = createTestSkinRegistry()
    const html = renderToStaticMarkup(skins.renderOverlayMount({
      mountId: 'hud',
      children: [
        {
          elementId: 'hud/player',
          component: TEST_HUD,
          inputs: { current: 72, max: 100, label: '我方' },
        },
        {
          elementId: 'hud/enemy',
          component: TEST_HUD,
          inputs: { current: 58, max: 100, label: '敌方' },
        },
      ],
      mountLayout: { left: 0, top: 0, width: 1, height: 1 },
    }) as ReactElement)

    expect(html.match(/class="test-stub/g)).toHaveLength(2)
    expect(html.match(/data-overlay-fit-target="true"/g)).toHaveLength(2)
  })
})
