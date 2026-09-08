import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureBuiltinSchemes,
  listBaseHudIds,
  listInterfaceCustomSchemeIds,
} from '@/authoring/demo/builtin-schemes'
import type { Overlay } from '@/runtime/core/schema/graph-schema'
import {
  registerComponent,
  unregisterComponent,
} from '@/runtime/core/registry/component-registry'

afterEach(() => unregisterComponent('project.option-button'))

describe('interface custom scheme order', () => {
  it('keeps a prepended new scheme ahead of existing custom schemes', () => {
    const overlay = (id: string): Overlay => ({ id, title: id, children: [] })
    const overlays = {
      'scheme-new': overlay('scheme-new'),
      'scheme-old': overlay('scheme-old'),
      'base:Dialogue': overlay('base:Dialogue'),
    }

    expect(listInterfaceCustomSchemeIds(overlays)).toEqual([
      'scheme-new',
      'scheme-old',
    ])
  })

  it('adds dynamically registered project components to Basic UI', () => {
    registerComponent('project.option-button', {
      label: '选项按钮',
      inputs: [{ key: 'label', valueType: 'string', default: '选项' }],
      events: [{ id: 'select', label: '选择' }],
    })

    const overlays = ensureBuiltinSchemes({})

    expect(overlays['base:project.option-button']).toMatchObject({
      id: 'base:project.option-button',
      title: '选项按钮',
      children: [{ component: 'project.option-button', inputs: {} }],
    })
    expect(listBaseHudIds(overlays)).toContain('base:project.option-button')
  })
})
