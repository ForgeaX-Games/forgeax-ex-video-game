import { describe, expect, it } from 'vitest'
import { applyProductionProjection, type NavNode } from '../NewSidebar'

describe('NewSidebar production status', () => {
  it('marks only the Blueprint root while integration is working', () => {
    const nodes: NavNode[] = [{
      id: 'graph',
      label: '蓝图',
      kind: 'entry',
      children: [{
        id: 'main',
        label: '主蓝图',
        kind: 'leaf',
        blueprint: true,
      }],
    }]

    const projected = applyProductionProjection(nodes, {
      modules: { blueprint: { availability: 'working' } },
    } as never)

    expect(projected[0]!.productionAvailability).toBe('working')
    expect(projected[0]!.children?.[0]!.productionAvailability).toBeUndefined()
  })
})
