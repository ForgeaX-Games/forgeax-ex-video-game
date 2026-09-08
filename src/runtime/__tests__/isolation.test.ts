import { describe, expect, it } from 'vitest'
import { GraphSession } from '../core/engine/session'
import { ComponentRegistry } from '../core/registry/component-registry'
import { node, scnOf } from './test-fixtures'
import {
  claimPlayerFocus,
  isPlayerFocused,
  releasePlayerFocus,
} from '../react/input/playerFocus'

describe('shared component registries (B)', () => {
  it('two sessions share the default ComponentRegistry', () => {
    const a = new GraphSession(scnOf({ nodes: [node('a')], edges: [] }))
    const b = new GraphSession(scnOf({ nodes: [node('b')], edges: [] }))
    expect(a.runtime.components).toBe(b.runtime.components)
  })

  it('custom ComponentRegistry instances stay isolated when injected', () => {
    const onlyA = new ComponentRegistry()
    onlyA.registerComponent('secretView', {})
    expect(onlyA.getComponent('secretView')).toBeDefined()
    expect(new ComponentRegistry().getComponent('secretView')).toBeUndefined()
  })
})

describe('player focus gate (A)', () => {
  it('with no claimed focus, any root is allowed', () => {
    const a = { id: 'a' } as unknown as HTMLElement
    const b = { id: 'b' } as unknown as HTMLElement
    releasePlayerFocus(a)
    releasePlayerFocus(b)
    expect(isPlayerFocused(a)).toBe(true)
    expect(isPlayerFocused(b)).toBe(true)
  })

  it('after claim, only the focused root passes', () => {
    const a = { id: 'a', contains: () => false } as unknown as HTMLElement
    const b = { id: 'b', contains: () => false } as unknown as HTMLElement
    claimPlayerFocus(a)
    expect(isPlayerFocused(a)).toBe(true)
    expect(isPlayerFocused(b)).toBe(false)
    claimPlayerFocus(b)
    expect(isPlayerFocused(a)).toBe(false)
    expect(isPlayerFocused(b)).toBe(true)
    releasePlayerFocus(b)
    expect(isPlayerFocused(a)).toBe(true)
    expect(isPlayerFocused(b)).toBe(true)
  })
})
