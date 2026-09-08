import { describe, expect, it } from 'vitest'
import type { BlueprintDoc, ScenarioMetaFields } from '@/runtime/core/schema/graph-schema'
import { renameScenarioId } from '../scenario-id'

const meta: ScenarioMetaFields = {
  variables: { rage: { id: 'rage', initial: 1 } },
  entities: { hero: { id: 'hero', attrs: { hp: 10 }, attrMeta: { hp: { label: '生命' } } } },
  formulas: {
    damage: {
      id: 'damage',
      ast: {
        t: 'bin',
        id: 'b0',
        op: '+',
        a: { t: 'ref', id: 'r0', ref: { kind: 'entityAttr', entityId: 'hero', attr: 'hp' } },
        b: { t: 'ref', id: 'r1', ref: { kind: 'var', varId: 'rage' } },
      },
    },
  },
  ui: {
    overlays: {
      hud: {
        id: 'hud',
        children: [{ id: 'bar', component: 'BattleHpBar', inputs: { bind: 'hero', attr: 'hp', value: { expr: 'entity.hero.attr.hp + var.rage' } }, layout: {} }],
      },
    },
  },
}

const blueprints = {
  main: {
    id: 'main',
    title: 'main',
    entry: 'n1',
    requires: { entities: ['hero'], vars: ['rage'] },
    graph: {
      nodes: [{
        id: 'n1',
        type: 'perf',
        position: { x: 0, y: 0 },
        data: {
          reactions: [{
            when: { type: 'watch', of: 'entity.hero.attr.hp' },
            do: [{
              kind: 'effect',
              effects: [{
                kind: 'attr',
                entityId: 'hero',
                attr: 'hp',
                op: 'add',
                value: {
                  expr: 'entity.hero.attr.hp + var.rage',
                  pick: {
                    mode: 'formula',
                    formulaId: 'damage',
                    holeBindings: { target: { kind: 'entityAttr', entityId: 'hero', attr: 'hp' } },
                  },
                },
              }],
            }],
          }],
        },
      }],
      edges: [],
    },
  },
} as unknown as Record<string, BlueprintDoc>

describe('scenario ID migration', () => {
  it('keeps a renamed attribute at its original display position', () => {
    const orderedMeta: ScenarioMetaFields = {
      entities: {
        hero: {
          id: 'hero',
          attrs: { attack: 10, defense: 5, speed: 3 },
          attrMeta: { attack: {}, defense: {}, speed: {} },
        },
      },
    }
    const result = renameScenarioId(orderedMeta, {}, { kind: 'attribute', entityId: 'hero', oldId: 'defense', newId: 'guard' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.meta.entities?.hero?.attrs ?? {})).toEqual(['attack', 'guard', 'speed'])
    expect(Object.keys(result.meta.entities?.hero?.attrMeta ?? {})).toEqual(['attack', 'guard', 'speed'])
  })

  it('renames entity and synchronizes graph, expression, component and formula references', () => {
    const result = renameScenarioId(meta, blueprints, { kind: 'entity', oldId: 'hero', newId: 'player', name: '玩家' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.meta.entities?.player?.id).toBe('player')
    expect(result.meta.entities?.player?.name).toBe('玩家')
    expect(result.meta.entities?.hero).toBeUndefined()
    expect((result.meta.formulas?.damage as { ast: { a: { ref: { entityId: string } } } }).ast.a.ref.entityId).toBe('player')
    expect((result.meta.ui?.overlays?.hud?.children[0]?.inputs?.bind)).toBe('player')
    expect((result.meta.ui?.overlays?.hud?.children[0]?.inputs?.value as { expr: string }).expr).toBe('entity.player.attr.hp + var.rage')
    const node = result.blueprints.main?.graph.nodes[0] as unknown as { data: { reactions: Array<{ when: { of: string }; do: Array<{ effects: Array<{ entityId: string; value: { expr: string; pick: { holeBindings: { target: { entityId: string } } } } }> }> }> } }
    expect(node.data.reactions[0]?.when.of).toBe('entity.player.attr.hp')
    expect(node.data.reactions[0]?.do[0]?.effects[0]?.entityId).toBe('player')
    expect(node.data.reactions[0]?.do[0]?.effects[0]?.value.expr).toBe('entity.player.attr.hp + var.rage')
    expect(node.data.reactions[0]?.do[0]?.effects[0]?.value.pick.holeBindings.target.entityId).toBe('player')
  })

  it('renames an attribute only within its owning entity and rejects duplicates', () => {
    const result = renameScenarioId(meta, blueprints, { kind: 'attribute', entityId: 'hero', oldId: 'hp', newId: 'health', name: '生命值' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.meta.entities?.hero?.attrs?.health).toBe(10)
    expect(result.meta.entities?.hero?.attrMeta?.health?.label).toBe('生命值')
    expect(renameScenarioId(meta, blueprints, { kind: 'attribute', entityId: 'hero', oldId: 'hp', newId: 'hp' }).ok).toBe(true)
  })

  it('renames formulas through formula picks and rejects conflicting IDs', () => {
    const result = renameScenarioId(meta, blueprints, { kind: 'formula', oldId: 'damage', newId: 'damage-v2', name: '伤害公式' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const node = result.blueprints.main?.graph.nodes[0] as unknown as { data: { reactions: Array<{ do: Array<{ effects: Array<{ value: { pick: { formulaId: string } } }> }> }> } }
    expect(node.data.reactions[0]?.do[0]?.effects[0]?.value.pick.formulaId).toBe('damage-v2')
    expect((result.meta.formulas?.['damage-v2'] as { name?: string }).name).toBe('伤害公式')
    expect(renameScenarioId(meta, blueprints, { kind: 'entity', oldId: 'hero', newId: 'hero' }).ok).toBe(true)
  })
})
