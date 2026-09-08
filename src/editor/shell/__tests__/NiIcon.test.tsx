import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { iconMaskUrl, NiIcon, niIconMaskCss } from '../ni-ui/NiIcon'

describe('NiIcon', () => {
  it('encodes inline SVG quotes so the browser keeps the mask declaration', () => {
    const { container } = render(<NiIcon name="chevron" />)
    const icon = container.querySelector<HTMLElement>('.ni-icon')

    expect(icon?.style.maskImage).toContain('data:image/svg+xml,')
    expect(icon?.style.maskImage).toContain('%3Csvg')
    expect(icon?.style.maskImage).not.toContain('<svg')
  })

  it('uses the same valid URL encoding for CSS-generated icons', () => {
    const css = niIconMaskCss('chevron')

    expect(css).toContain('data:image/svg+xml,')
    expect(css).toContain('%3Csvg')
    expect(css).not.toContain('<svg')
  })

  it('handles tsup raw SVG payloads without double-encoding existing escapes', () => {
    const raw = iconMaskUrl('data:image/svg+xml,<svg width="100%" fill="#fff"></svg>')
    const alreadyEncoded = iconMaskUrl('data:image/svg+xml,%3Csvg%20fill%3D%22%23fff%22%3E%0A%3C%2Fsvg%3E')

    expect(raw).toContain('%3Csvg')
    expect(raw).toContain('100%25')
    expect(raw).toContain('%23fff')
    expect(alreadyEncoded).toContain('%3Csvg%20fill%3D%22%23fff%22%3E%0A')
    expect(alreadyEncoded).not.toContain('%253Csvg')
  })

  it('quotes ordinary asset URLs as CSS strings', () => {
    expect(iconMaskUrl('/assets/icon.svg?label="next"')).toBe(
      'url("/assets/icon.svg?label=\\"next\\"")',
    )
  })
})
