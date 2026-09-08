/**
 * 叙事段 demo 契约回归 —— 对齐
 * docs/superpowers/specs/2026-07-03-nodia-narrative-intro-design.md
 *
 * 不绑定 `component-host/components` 具体组件（catalog 将来动态加载 / npm）。
 */
import { describe, expect, it } from 'vitest'
import { makeNodiaFixture } from '../../editor/demo/__tests__/fixtures/nodia-fixture'

const DAZHAO_RESOURCE_ID = 'fa6da536-df0b-4f4f-aede-d77e8b053950'

function collectMediaRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectMediaRefs(item, refs)
    return refs
  }
  if (!value || typeof value !== 'object') return refs
  const record = value as Record<string, unknown>
  const media = record.media
  if (media && typeof media === 'object') {
    const ref = (media as Record<string, unknown>).ref
    if (typeof ref === 'string') refs.push(ref)
  }
  for (const child of Object.values(record)) collectMediaRefs(child, refs)
  return refs
}

describe('nodia narrative demo contract', () => {
  it('重置模板使用 Kino/COS resource id，不回退本地视频 basename', () => {
    const refs = collectMediaRefs(makeNodiaFixture())
    expect(refs).toContain(DAZHAO_RESOURCE_ID)
    expect(refs).not.toContain('dazhao')
    expect(refs.filter((ref) => ref.includes('narr-')).every((ref) => ref.startsWith('m-narr-'))).toBe(true)
  })

  it('拓扑：上岸 應→灯笼 / 默→孟婆；渡河 應→小孩 / 默→上岸', () => {
    const scn = makeNodiaFixture()
    const edges = scn.graph.edges
    const of = (src: string) =>
      edges.filter((e) => e.source === src).map((e) => [e.sourceHandle ?? 'default', e.target] as const)
    expect(new Set(of('n_land'))).toEqual(
      new Set([
        ['ying', 'n_mask'],
        ['mo', 'n_mengpo'],
        ['default', 'n_mengpo'],
      ]),
    )
    expect(new Set(of('n_river'))).toEqual(
      new Set([
        ['ying', 'n_child'],
        ['mo', 'n_land'],
        ['default', 'n_land'],
      ]),
    )
  })
})
