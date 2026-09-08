import { afterEach, describe, expect, it } from 'vitest'
import { registerComponent, getComponent, unregisterComponent, deriveOutputs, getComponentManifest, type ComponentDef } from '../core/registry/component-registry'
import type { GameNode, Overlay } from '../core/schema/graph-schema'

const qteDef: ComponentDef = {
  events: [{ id: 'pass' }, { id: 'good' }, { id: 'fail' }],
}

function nodeWithComponents(componentIds: string[]): { node: GameNode; overlays: Record<string, Overlay> } {
  const overlays: Record<string, Overlay> = {
    'ov-n1': {
      id: 'ov-n1',
      children: componentIds.map((c, i) => ({
        id: `e${i}`,
        component: c,
        trigger: { when: 'enter' as const },
        inputs: {},
      })),
    },
  }
  const node: GameNode = {
    id: 'n1',
    type: 'perf',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [],
    data: { name: 't', overlayNodes: [{ overlay: 'ov-n1' }] },
  }
  return { node, overlays }
}

afterEach(() => unregisterComponent('qte'))

describe('component-registry', () => {
  it('register / get', () => {
    registerComponent('qte', qteDef)
    expect(getComponent('qte')?.events?.map((e) => e.id)).toEqual(['pass', 'good', 'fail'])
    expect(getComponent('nope')).toBeUndefined()
  })

  it('deriveOutputs = default + component event handles (dedup)', () => {
    registerComponent('qte', qteDef)
    const { node, overlays } = nodeWithComponents(['qte'])
    expect(deriveOutputs(node, overlays).map((h) => h.id)).toEqual(['default', 'pass', 'good', 'fail'])
  })

  it('unregistered component contributes no handle', () => {
    const { node, overlays } = nodeWithComponents(['unknownComponent'])
    expect(deriveOutputs(node, overlays).map((h) => h.id)).toEqual(['default'])
  })

  it('manifest.inputs: explicit inputs pass through; events included', () => {
    registerComponent('banner', {
      label: '横幅',
      inputs: [
        { key: 'heroName', label: '英雄名', valueType: 'string' },
        { key: 'dmg', label: '扣血', valueType: 'number' },
      ],
      events: [{ id: 'cheer', label: '加油' }],
    })
    const m = getComponentManifest('banner')!
    expect(m.inputs?.map((i) => `${i.key}:${i.valueType}`)).toEqual(['heroName:string', 'dmg:number'])
    expect(m.events.map((e) => e.id)).toEqual(['cheer'])
    unregisterComponent('banner')
  })

  it('组件出口 = 声明的 events（皮肤自 emit，引擎无 resolve/outputs）', () => {
    registerComponent('qteResolve', { events: [{ id: 'pass' }, { id: 'fail' }] })
    expect(getComponentManifest('qteResolve')!.events.map((e) => e.id)).toEqual(['pass', 'fail'])
    unregisterComponent('qteResolve')
  })
})
