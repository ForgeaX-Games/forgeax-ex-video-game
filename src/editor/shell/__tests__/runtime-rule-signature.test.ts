import { describe, expect, it } from 'vitest'
import type { Entity, Variable } from '@/runtime/core/schema/graph-schema'
import { runtimeRuleSignature } from '../runtime-rule-signature'

const entities: Record<string, Entity> = {
  player: {
    id: 'player',
    name: '空藏',
    attrs: { hpMax: 100, hp: 100 },
    attrMeta: {
      hp: { min: 0, max: 100, initial: 100, label: '生命' },
      hpMax: { label: '最大生命' },
    },
  },
}

const variables: Record<string, Variable> = {
  round: { id: 'round', name: '回合', initial: 0, min: 0 },
}

describe('runtimeRuleSignature', () => {
  it('changes when entity initial values or runtime constraints change', () => {
    const original = runtimeRuleSignature(entities, variables)
    expect(runtimeRuleSignature({
      ...entities,
      player: { ...entities.player!, attrs: { ...entities.player!.attrs, hpMax: 200 } },
    }, variables)).not.toBe(original)
    expect(runtimeRuleSignature({
      ...entities,
      player: {
        ...entities.player!,
        attrMeta: { ...entities.player!.attrMeta, hp: { ...entities.player!.attrMeta!.hp, max: 200 } },
      },
    }, variables)).not.toBe(original)
  })

  it('changes when variable initialization rules change', () => {
    const original = runtimeRuleSignature(entities, variables)
    expect(runtimeRuleSignature(entities, {
      round: { ...variables.round!, initial: 2 },
    })).not.toBe(original)
  })

  it('ignores display-only labels and object insertion order', () => {
    const original = runtimeRuleSignature(entities, variables)
    const displayOnly: Record<string, Entity> = {
      player: {
        ...entities.player!,
        name: '玩家',
        attrs: { hp: 100, hpMax: 100 },
        attrMeta: {
          attack: { label: '攻击' },
          hpMax: { label: '生命上限' },
          hp: { ...entities.player!.attrMeta!.hp, label: '当前生命' },
        },
      },
    }
    expect(runtimeRuleSignature(displayOnly, {
      round: { ...variables.round!, name: '当前回合' },
    })).toBe(original)
  })
})
