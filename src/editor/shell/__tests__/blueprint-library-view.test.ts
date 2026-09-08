/**
 * 蓝图列表纯派生逻辑测试。不 mount 侧栏/画布——只测 `blueprintListItems`。
 */
import { describe, it, expect } from 'vitest'
import { blueprintListItems, blueprintSidebarPath, BLUEPRINT_NAV_ROOT } from '../blueprintNav'
import type { BlueprintDoc } from '@/runtime/core/schema/graph-schema'

function doc(id: string, title: string): BlueprintDoc {
  return { id, title, entry: 'entry', graph: { nodes: [], edges: [] } }
}

describe('blueprintListItems', () => {
  it('puts the main blueprint first with an entry badge', () => {
    const blueprints: Record<string, BlueprintDoc> = {
      'bp-b': doc('bp-b', 'B 蓝图'),
      'bp-main': doc('bp-main', '主蓝图'),
      'bp-a': doc('bp-a', 'A 蓝图'),
    }
    const items = blueprintListItems(blueprints, 'bp-main')
    expect(items[0]).toEqual({ id: 'bp-main', label: '主蓝图', isEntry: true })
  })

  it('sorts sub-blueprints by title after the main one', () => {
    const blueprints: Record<string, BlueprintDoc> = {
      'bp-main': doc('bp-main', '主蓝图'),
      'bp-z': doc('bp-z', 'Z 子蓝图'),
      'bp-a': doc('bp-a', 'A 子蓝图'),
      'bp-m': doc('bp-m', 'M 子蓝图'),
    }
    const items = blueprintListItems(blueprints, 'bp-main')
    expect(items.map((i) => i.id)).toEqual(['bp-main', 'bp-a', 'bp-m', 'bp-z'])
    expect(items.slice(1).every((i) => !i.label.includes('入口'))).toBe(true)
  })

  it('handles a missing main blueprint gracefully (no crash, subs still listed sorted)', () => {
    const blueprints: Record<string, BlueprintDoc> = {
      'bp-b': doc('bp-b', 'B'),
      'bp-a': doc('bp-a', 'A'),
    }
    const items = blueprintListItems(blueprints, 'does-not-exist')
    expect(items.map((i) => i.id)).toEqual(['bp-a', 'bp-b'])
  })

  it('handles an empty blueprint map', () => {
    expect(blueprintListItems({}, 'bp-main')).toEqual([])
  })
})

describe('blueprintSidebarPath', () => {
  const blueprints: Record<string, BlueprintDoc> = {
    'bp-main': doc('bp-main', '主蓝图'),
    'bp-a': doc('bp-a', 'A 子蓝图'),
  }

  it('walks from the sidebar blueprint root down to the blueprint itself', () => {
    expect(blueprintSidebarPath(blueprints, 'bp-a')).toEqual([
      { id: BLUEPRINT_NAV_ROOT.id, label: BLUEPRINT_NAV_ROOT.label },
      { id: 'bp-a', label: 'A 子蓝图' },
    ])
  })

  it('keeps the root crumb when the blueprint is unknown', () => {
    expect(blueprintSidebarPath(blueprints, 'gone')).toEqual([
      { id: BLUEPRINT_NAV_ROOT.id, label: BLUEPRINT_NAV_ROOT.label },
    ])
  })
})
