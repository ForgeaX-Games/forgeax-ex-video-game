/**
 * 回归：草稿/磁盘 project 缺 entities 时不得抹掉 demo 实体（否则挂载血条 bind 全空、试玩看不见 HUD）。
 * 蓝图库改版前此规则由 `mergeScenario` 守护（见已删除的 mergeScenario.test.ts）；graph 现由
 * blueprints 派生、不再经过这条 meta 合流路径，故只针对 `withDemoMetaFallback` 这一纯函数验证。
 */
import { describe, expect, it } from 'vitest'
import { withDemoMetaFallback } from '../graphScenarioStore'
import type { GameScenario, ScenarioMetaFields } from '@/runtime/core/schema/graph-schema'

const demo = {
  version: 'game-video.graph.v1',
  graph: { nodes: [], edges: [] },
  entities: {
    'ent-player': { id: 'ent-player', attrs: { hp: 100 }, attrMeta: { hp: { max: 100 } } },
    'ent-boss': { id: 'ent-boss', attrs: { hp: 500 }, attrMeta: { hp: { max: 500 } } },
  },
  variables: { qi: { id: 'qi', initial: 0 } },
} as unknown as GameScenario

describe('withDemoMetaFallback', () => {
  it('meta.entities 为 undefined 时保留 demo 实体', () => {
    const meta: ScenarioMetaFields = {
      entities: undefined,
      variables: undefined,
      ui: { overlays: { 'scheme-static': { id: 'scheme-static', children: [] } } },
    }
    const out = withDemoMetaFallback(meta, demo)
    expect(Object.keys(out.entities ?? {})).toEqual(['ent-player', 'ent-boss'])
    expect(out.variables?.qi).toBeTruthy()
    expect(out.ui?.overlays?.['scheme-static']).toBeTruthy()
  })

  it('meta 显式 entities:{} 表示用户清空，予以保留', () => {
    const out = withDemoMetaFallback({ entities: {} }, demo)
    expect(out.entities).toEqual({})
  })
})
