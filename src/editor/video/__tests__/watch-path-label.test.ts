import { describe, expect, it } from 'vitest'
import type { Entity, GameNode, GameScenario } from '@/runtime/core/schema/graph-schema'
import { collectNodeTimelineMarkers } from '../nodeTimelineMarkers'
import { formatWatchPathLabel } from '../../watch-path-label'

const player: Entity = {
  id: 'ent-player',
  name: '空藏',
  attrs: { hp: 100 },
  attrMeta: { hp: { label: '生命', max: 100, initial: 100 } },
}

describe('formatWatchPathLabel', () => {
  it('把实体属性路径翻成中文，缺名时回退到技术 id', () => {
    expect(formatWatchPathLabel('entity.ent-player.attr.hp', { 'ent-player': player })).toBe('实体.空藏.属性.生命')
    expect(formatWatchPathLabel('entity.ent-ghost.attr.rage', { 'ent-player': player })).toBe('实体.ent-ghost.属性.rage')
    expect(formatWatchPathLabel('score')).toBe('分数')
    expect(formatWatchPathLabel('var.v-gold', undefined, { 'v-gold': { id: 'v-gold', name: '金币' } })).toBe('变量.金币')
    expect(formatWatchPathLabel('')).toBe('未选数值')
  })
})

describe('collectNodeTimelineMarkers · 条件结算中文展示', () => {
  it('条件行用实体/属性中文名，动作侧仍报绑定界面数', () => {
    const node: GameNode = {
      id: 'gate',
      type: 'perf',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: [],
      data: {
        name: '序章',
        reactions: [{
          when: { type: 'watch', of: 'entity.ent-player.attr.hp', on: 'change' },
          do: [{ kind: 'spawn', from: 'hud/rage', ttlMs: 800 }],
        }],
      },
    }
    const scenario: GameScenario = {
      version: 't',
      variables: {},
      entities: { 'ent-player': player },
      ui: { overlays: {} },
      graph: { nodes: [node], edges: [] },
    } as unknown as GameScenario

    const { conditionMarkers } = collectNodeTimelineMarkers(scenario, node)
    expect(conditionMarkers).toEqual([{
      id: 'life:0',
      label: '实体.空藏.属性.生命 变化 → 绑定 1 个界面',
      conditionChips: ['实体.空藏.属性.生命', '变化'],
      actionChips: ['绑定 1 个界面'],
    }])
  })
})
