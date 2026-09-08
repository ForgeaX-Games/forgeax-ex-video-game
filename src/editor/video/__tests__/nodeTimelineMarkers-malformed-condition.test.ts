import { describe, expect, it } from 'vitest'
import type { GameNode, GameScenario } from '@/runtime/core/schema/graph-schema'
import type { Reaction } from '@/runtime/core/schema/node-config-schema'
import { collectNodeTimelineMarkers } from '../nodeTimelineMarkers'

/**
 * AI 生成的 blueprint 会把出边 `edge.data.condition` 的写法套到 reaction 顶层，
 * 或者给 state 触发器留一个没有 `all` 的 condition。这类脏数据由
 * `runtime.shape.valid` 报错，但硬门可被 waivedAfterRetries 放行，
 * 所以编辑器必须能把它渲染成「未配置条件」而不是抛 TypeError 崩掉整页。
 */
function seed(reactions: Reaction[]): { scenario: GameScenario; node: GameNode } {
  const node: GameNode = {
    id: 'battle-open-next',
    type: 'perf',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [],
    data: { name: '战斗结算', durationMs: 4000, reactions },
  }
  const scenario: GameScenario = {
    version: 't',
    variables: {},
    entities: {},
    ui: { overlays: {} },
    graph: { nodes: [node], edges: [] },
  } as unknown as GameScenario
  return { scenario, node }
}

const markersOf = (reactions: Reaction[]) => {
  const { scenario, node } = seed(reactions)
  return collectNodeTimelineMarkers(scenario, node)
}

describe('collectNodeTimelineMarkers with malformed state conditions', () => {
  it('state trigger without when.condition renders an unconfigured chip', () => {
    const reactions = [{ when: { type: 'state' }, do: [] }] as unknown as Reaction[]
    const { conditionMarkers } = markersOf(reactions)
    expect(conditionMarkers).toHaveLength(1)
    expect(conditionMarkers[0]!.conditionChips).toEqual(['未配置条件'])
  })

  it('condition misplaced at reaction top level does not throw', () => {
    const reactions = [{
      when: { type: 'state' },
      condition: { all: [{ type: 'attrRatio', entityId: 'ent-boss', attr: 'hp', op: 'lte', value: 0 }] },
      do: [],
    }] as unknown as Reaction[]
    const { conditionMarkers } = markersOf(reactions)
    expect(conditionMarkers).toHaveLength(1)
    expect(conditionMarkers[0]!.conditionChips).toEqual(['未配置条件'])
  })

  it('condition object without an all array does not throw', () => {
    const reactions = [{
      when: { type: 'state', condition: { any: [] } },
      do: [],
    }] as unknown as Reaction[]
    expect(() => markersOf(reactions)).not.toThrow()
  })

  it('reaction without a when trigger is skipped instead of crashing', () => {
    const reactions = [{ do: [] }] as unknown as Reaction[]
    expect(() => markersOf(reactions)).not.toThrow()
  })
})
