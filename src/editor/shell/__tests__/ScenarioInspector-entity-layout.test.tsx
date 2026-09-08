import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Entity } from '@/runtime/core/schema/graph-schema'
import { CATALOG_CSS } from '../catalogCss'
import { ScenarioInspector, type ScenarioMeta } from '../ScenarioInspector'

function EntityHarness({ initial }: { initial: Record<string, Entity> }): JSX.Element {
  const [value, setValue] = useState<ScenarioMeta>({ entities: initial })
  return <ScenarioInspector value={value} section="entities" onChange={setValue} />
}

let catalogStyle: HTMLStyleElement

beforeAll(() => {
  catalogStyle = document.createElement('style')
  catalogStyle.textContent = CATALOG_CSS
  document.head.append(catalogStyle)
})

afterAll(() => catalogStyle.remove())

describe('ScenarioInspector entity row layout', () => {
  it('centers a vector chevron inside the entity expand button', () => {
    render(<EntityHarness initial={{ hero: { id: 'hero', name: '主角', attrs: {} } }} />)

    const toggle = screen.getByRole('button', { name: '折叠实体 主角' })
    expect(toggle.querySelector('svg')).not.toBeNull()
    expect(getComputedStyle(toggle).display).toBe('grid')
    expect(getComputedStyle(toggle).placeItems).toBe('center')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows a long entity name at its natural width and wraps when the row is constrained', () => {
    const longName = '一个不会被截断的很长实体名称'
    render(<EntityHarness initial={{ hero: { id: 'hero', name: longName, attrs: {} } }} />)

    const name = screen.getByText(longName)
    const identity = name.closest('.gc-rule-identity')
    const nameStyle = getComputedStyle(name)

    expect(name.tagName).toBe('SPAN')
    expect(nameStyle.maxWidth).toBe('100%')
    expect(nameStyle.whiteSpace).toBe('normal')
    expect(nameStyle.overflowWrap).toBe('anywhere')
    expect(identity).not.toBeNull()
    expect(getComputedStyle(identity!).flexWrap).toBe('wrap')
  })
})
