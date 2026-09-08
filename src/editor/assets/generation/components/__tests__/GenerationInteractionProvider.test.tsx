// @vitest-environment happy-dom
import { act, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  GenerationInteractionProvider,
  useGenerationInteraction,
  type GenerationInteractionContextValue,
} from '..'

function Reader({ value }: { value: { current: GenerationInteractionContextValue | null } }): null {
  value.current = useGenerationInteraction()
  return null
}

describe('GenerationInteractionProvider', () => {
  it('exposes state, actions, and derived interaction meta', () => {
    const value: { current: GenerationInteractionContextValue | null } = { current: null }
    render(
      <GenerationInteractionProvider>
        <Reader value={value} />
      </GenerationInteractionProvider>,
    )

    expect(value.current?.state).toEqual({ disabled: false, readOnly: false, busy: false })
    expect(value.current?.meta.canInteract).toBe(true)
    expect(value.current?.meta.canMutate).toBe(true)
    expect(value.current?.meta.canCancel).toBe(false)

    act(() => value.current?.actions.setBusy(true))
    expect(value.current?.meta.canMutate).toBe(false)
    expect(value.current?.meta.canCancel).toBe(true)
    expect(value.current?.meta.can('generate')).toBe(false)
    expect(value.current?.meta.can('cancel')).toBe(true)

    act(() => value.current?.actions.setReadOnly(true))
    expect(value.current?.state.readOnly).toBe(true)
    expect(value.current?.meta.can('cancel')).toBe(true)
    expect(value.current?.meta.can('edit')).toBe(false)

    act(() => value.current?.actions.setDisabled(true))
    expect(value.current?.meta.canInteract).toBe(false)
    expect(value.current?.meta.canCancel).toBe(false)

    act(() => value.current?.actions.reset())
    expect(value.current?.state).toEqual({ disabled: false, readOnly: false, busy: false })
  })

  it('accepts initial interaction state without boolean mode props', () => {
    const value: { current: GenerationInteractionContextValue | null } = { current: null }
    render(
      <GenerationInteractionProvider initialState={{ readOnly: true }}>
        <Reader value={value} />
      </GenerationInteractionProvider>,
    )

    expect(value.current?.state).toEqual({ disabled: false, readOnly: true, busy: false })
    expect(value.current?.meta.canMutate).toBe(false)

    act(() => {
      value.current?.actions.setBusy(true)
      value.current?.actions.setReadOnly(false)
      value.current?.actions.reset()
    })

    expect(value.current?.state).toEqual({ disabled: false, readOnly: true, busy: false })
  })

  it('throws when the hook is used outside the provider', () => {
    expect(() => render(<Reader value={{ current: null }} />)).toThrow(
      'useGenerationInteraction must be used within GenerationInteractionProvider',
    )
  })
})
