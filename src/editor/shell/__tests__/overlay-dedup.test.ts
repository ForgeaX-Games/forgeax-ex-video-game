/**
 * overlay-dedup 纯派生逻辑测试：内容签名与重复分组。
 * 不 mount 组件——只测 `overlaySignature` / `findDuplicateOverlays` 的判等规则。
 */
import { describe, it, expect } from 'vitest'
import { overlaySignature, findDuplicateOverlays } from '../overlay-dedup'
import type { Overlay, OverlayChild } from '@/runtime/core/schema/graph-schema'

function child(over: Partial<OverlayChild> & Pick<OverlayChild, 'id' | 'component'>): OverlayChild {
  return { trigger: { when: 'enter' }, ...over }
}

function overlay(id: string, children: OverlayChild[], title?: string): Overlay {
  return { id, title: title ?? id, children }
}

describe('overlaySignature', () => {
  it('children 顺序无关：乱序但同内容 → 同签名', () => {
    const a = overlay('a', [
      child({ id: 'x', component: 'battleHpBar', inputs: { bind: 'ent-player' } }),
      child({ id: 'y', component: 'floatText', inputs: { text: '+30' } }),
    ])
    const b = overlay('b', [
      child({ id: 'y2', component: 'floatText', inputs: { text: '+30' } }),
      child({ id: 'x2', component: 'battleHpBar', inputs: { bind: 'ent-player' } }),
    ])
    expect(overlaySignature(a)).toBe(overlaySignature(b))
  })

  it('id/title/trigger 不参与签名', () => {
    const a = overlay('a', [child({ id: 'x', component: 'test.dialogue', inputs: { text: 'hi' } })], '标题甲')
    const b = overlay('b', [child({ id: 'z', component: 'test.dialogue', trigger: { when: 'at', ms: 500 }, inputs: { text: 'hi' } })], '标题乙')
    expect(overlaySignature(a)).toBe(overlaySignature(b))
  })

  it('inputs 不同 → 不同签名（inputs 参与判等）', () => {
    const a = overlay('a', [child({ id: 'x', component: 'battleHpBar', inputs: { bind: 'ent-player' } })])
    const b = overlay('b', [child({ id: 'x', component: 'battleHpBar', inputs: { bind: 'ent-boss' } })])
    expect(overlaySignature(a)).not.toBe(overlaySignature(b))
  })

  it('inputs key 顺序无关（稳定序列化）', () => {
    const a = overlay('a', [child({ id: 'x', component: 'floatText', inputs: { text: '+30', color: '#5fbf7f', x: 0.5 } })])
    const b = overlay('b', [child({ id: 'x', component: 'floatText', inputs: { x: 0.5, text: '+30', color: '#5fbf7f' } })])
    expect(overlaySignature(a)).toBe(overlaySignature(b))
  })

  it('layout：一个显式写默认(0)、一个缺省 → 不同签名（归一只比声明字段）', () => {
    const explicit = overlay('a', [child({ id: 'x', component: 'battleHpBar', layout: { left: 0, top: 0 }, inputs: {} })])
    const omitted = overlay('b', [child({ id: 'x', component: 'battleHpBar', inputs: {} })])
    expect(overlaySignature(explicit)).not.toBe(overlaySignature(omitted))
  })

  it('layout 同内容 → 同签名', () => {
    const a = overlay('a', [child({ id: 'x', component: 'test.qte', layout: { left: 0.5, top: 0.5, translateX: -0.5, translateY: -0.5 }, inputs: {} })])
    const b = overlay('b', [child({ id: 'y', component: 'test.qte', layout: { top: 0.5, left: 0.5, translateY: -0.5, translateX: -0.5 }, inputs: {} })])
    expect(overlaySignature(a)).toBe(overlaySignature(b))
  })
})

describe('findDuplicateOverlays', () => {
  it('手搓单组件方案 vs base:<component> 同内容 → 跨类判重', () => {
    const overlays: Record<string, Overlay> = {
      'base:battleHpBar': overlay('base:battleHpBar', [child({ id: 'battleHpBar-0', component: 'battleHpBar', inputs: { bind: 'ent-player', label: '角色' } })], 'HUD · 水墨血条'),
      'scheme-0': overlay('scheme-0', [child({ id: 'hand', component: 'battleHpBar', inputs: { bind: 'ent-player', label: '角色' } })], '我的方案'),
    }
    const dup = findDuplicateOverlays(overlays)
    expect(dup.get('base:battleHpBar')).toEqual(['scheme-0'])
    expect(dup.get('scheme-0')).toEqual(['base:battleHpBar'])
  })

  it('三项同内容 → 每项列出其余两项', () => {
    const mk = (id: string) => overlay(id, [child({ id: 'c', component: 'test.dialogue', inputs: { text: '同' } })])
    const dup = findDuplicateOverlays({ a: mk('a'), b: mk('b'), c: mk('c') })
    expect(dup.get('a')).toEqual(['b', 'c'])
    expect(dup.get('b')).toEqual(['a', 'c'])
    expect(dup.get('c')).toEqual(['a', 'b'])
  })

  it('node:* 容器不参与去重', () => {
    const body = [child({ id: 'c', component: 'test.dialogue', inputs: { text: '同' } })]
    const overlays: Record<string, Overlay> = {
      'node:n1': overlay('node:n1', body),
      'node:n2': overlay('node:n2', body),
    }
    expect(findDuplicateOverlays(overlays).size).toBe(0)
  })

  it('全不同 → 空 Map', () => {
    const overlays: Record<string, Overlay> = {
      a: overlay('a', [child({ id: 'c', component: 'test.dialogue', inputs: { text: 'A' } })]),
      b: overlay('b', [child({ id: 'c', component: 'floatText', inputs: { text: 'B' } })]),
    }
    expect(findDuplicateOverlays(overlays).size).toBe(0)
  })

  it('空目录 → 空 Map', () => {
    expect(findDuplicateOverlays({}).size).toBe(0)
  })
})
