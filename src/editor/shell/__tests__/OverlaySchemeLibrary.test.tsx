// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { OverlaySchemeLibrary } from '../OverlaySchemeLibrary'
import { UI_TEMPLATE_COMPOSE_EVENT } from '../../persist/graphUiTreeSync'

afterEach(cleanup)

describe('OverlaySchemeLibrary', () => {
  it('opens the shared create dialog from the empty search state', () => {
    render(
      <OverlaySchemeLibrary
        schemes={[]}
        entities={{}}
        variables={{}}
        onOpen={() => undefined}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('暂无模板')
    fireEvent.click(screen.getByRole('button', { name: '新建模板' }))

    expect(screen.getByRole('dialog', { name: '界面添加' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: '界面名称' })).toBeTruthy()
  })

  it('opens the same dialog when the main region receives a sidebar request', () => {
    render(
      <OverlaySchemeLibrary
        schemes={[]}
        entities={{}}
        variables={{}}
        onOpen={() => undefined}
      />,
    )

    act(() => window.dispatchEvent(new Event(UI_TEMPLATE_COMPOSE_EVENT)))

    expect(screen.getByRole('dialog', { name: '界面添加' })).toBeTruthy()
  })
})
