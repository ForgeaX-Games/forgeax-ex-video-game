// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { __resetInjectedForTest } from '@/editor/styles/injectStyle'
import { ensureGenerationComponentsStyles, GENERATION_COMPONENTS_CSS } from '../../generationComponentsStyles'
import { GenerationDialog } from '../surface/GenerationSurface'

describe('GenerationDialog', () => {
  afterEach(() => __resetInjectedForTest())

  it('traps focus and leaves dismissal to an open child layer', () => {
    const onClose = vi.fn()
    render(
      <GenerationDialog open title="Generation" onClose={onClose} dismissBlocked>
        <button type="button">First</button>
        <button type="button">Last</button>
      </GenerationDialog>,
    )
    const panel = screen.getByRole('dialog', { name: 'Generation' })
    const last = screen.getByRole('button', { name: 'Last' })
    last.focus()
    fireEvent.keyDown(panel, { key: 'Tab' })
    expect(screen.getByRole('button', { name: '关闭生成面板' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes from Escape and backdrop when no child layer is open', () => {
    const onClose = vi.fn()
    render(
      <GenerationDialog open title="Generation" onClose={onClose}>
        <button type="button">Content</button>
      </GenerationDialog>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(document.querySelector('.generation-dialog__backdrop') as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('guards the close button while a child layer owns dismissal', () => {
    const onClose = vi.fn()
    render(
      <GenerationDialog open title="Generation" onClose={onClose} dismissBlocked>
        <button type="button">Content</button>
      </GenerationDialog>,
    )
    const close = screen.getByRole('button', { name: '关闭生成面板' })
    expect(close).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(close)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('injects real layout and atom style contracts once', () => {
    ensureGenerationComponentsStyles()
    ensureGenerationComponentsStyles()
    const style = document.querySelector('style[data-reel-style="game-video-generation-components"]')
    expect(style).not.toBeNull()
    expect(style?.textContent).toContain('.generation-surface')
    expect(style?.textContent).toContain('.generation-prompt-composer')
    expect(style?.textContent).toContain('.generation-parameters')
    expect(style?.textContent).toContain('.generation-preview-frame')
    expect(GENERATION_COMPONENTS_CSS).toContain('.generation-preview-frame { box-sizing: border-box; display: flex; width: 100%;')
    expect(style?.textContent).toContain('.generation-history-list')
    expect(style?.textContent).toContain('.generation-upload')
    expect(style?.textContent).toContain('.vgen-generation-layout')
    expect(GENERATION_COMPONENTS_CSS).toContain('.vgen-generation-surface .vgen-generation-reference')
    expect(GENERATION_COMPONENTS_CSS).toContain('.vgen-generation-surface .vgen-generation-reference-add')
    expect(GENERATION_COMPONENTS_CSS).toContain('.vgen-generation-surface .vgen-frame')
    expect(GENERATION_COMPONENTS_CSS).toContain(
      '.igen-workspace.generation-surface {\n  grid-template-columns: 225px minmax(0, 1fr);',
    )
    expect(GENERATION_COMPONENTS_CSS).toContain(
      '.igen-workspace.generation-surface.has-history { grid-template-columns: 225px minmax(0, 1fr) 67px; }',
    )
    expect(GENERATION_COMPONENTS_CSS).toContain('.generation-history-item.is-cover')
    expect(GENERATION_COMPONENTS_CSS).toContain('.igen-workspace > .generation-surface__composer')
    expect(GENERATION_COMPONENTS_CSS).toContain(
      '.igen-workspace > .generation-surface__composer > .igen-composer { height: 100%; }',
    )
    expect(GENERATION_COMPONENTS_CSS).toContain(
      '.vgen-generation-layout.is-page .vgen-design-workspace > .generation-surface__composer',
    )
    expect(GENERATION_COMPONENTS_CSS).toContain(
      '.vgen-generation-layout.is-page .vgen-design-workspace {\n  grid-template-columns: 225px minmax(0, 1fr);',
    )
    expect(GENERATION_COMPONENTS_CSS).toContain('.vgen-design-workspace.has-history { grid-template-columns: 225px minmax(0, 1fr) 67px; }')
    expect(GENERATION_COMPONENTS_CSS).toContain(
      '.vgen-generation-layout.is-page .vgen-design-workspace > .generation-surface__history',
    )
    expect(GENERATION_COMPONENTS_CSS).toContain(
      'grid-template-rows: minmax(300px, 1fr) 330px;',
    )
    expect(GENERATION_COMPONENTS_CSS).toContain(
      '.vgen-generation-layout.is-page .vgen-design-workspace > .generation-surface__history { grid-column: 3; grid-row: 1;',
    )
    expect(GENERATION_COMPONENTS_CSS).toContain(
      '.generation-prompt-composer .generation-prompt-submit',
    )
    expect(GENERATION_COMPONENTS_CSS).toContain('.generation-prompt-clear')
    expect(GENERATION_COMPONENTS_CSS).toContain(
      '.generation-page-layout.is-page { min-height: 0; flex: 1 1 auto; }',
    )
    expect(GENERATION_COMPONENTS_CSS).toContain('.generation-prompt-body:focus-within')
    expect(GENERATION_COMPONENTS_CSS).toContain(
      '.vgen-generation-layout.is-page .vgen-composer .vgen-mode-tabs button.is-on:hover:not(:disabled) { background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.2); color: #000; }',
    )
    expect(GENERATION_COMPONENTS_CSS).toContain('transform: rotate(45deg) scaleX(-1);')
    expect(GENERATION_COMPONENTS_CSS).not.toContain('translate(-1px,-1px)')
    expect(document.querySelectorAll('style[data-reel-style="game-video-generation-components"]')).toHaveLength(1)
    expect(GENERATION_COMPONENTS_CSS).toContain('.generation-dialog__backdrop')
  })
})
