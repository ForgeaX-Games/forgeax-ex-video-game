import { describe, expect, it } from 'vitest'
import { applyRuleOps } from '@/authoring/rules/rule-authoring'
import {
  ensureEntity,
  ensureEntityAttribute,
  ensureFormula,
  ensureVariable,
} from '@/authoring/formulas/meta-catalog'

describe('metaCatalog rule-authoring adapters', () => {
  it('creates entities, attributes, variables, and formulas with applyRuleOps semantics', () => {
    const entities = ensureEntity(undefined, {
      entityId: 'ent_wukong',
      name: '孙悟空',
      kind: 'hero',
    })
    const withAttr = ensureEntityAttribute(entities, {
      entityId: 'ent_wukong',
      attrId: 'insight',
      initialValue: 2,
      meta: { min: 0, max: 5 },
    })
    const variables = ensureVariable(undefined, {
      variableId: 'var_clues',
      name: '线索',
      initialValue: 0,
    })
    const formula = {
      formulaId: 'formula_truth',
      name: '真相深度',
      ast: {
        t: 'bin' as const,
        id: 'bin0',
        op: '+' as const,
        a: { t: 'ref' as const, id: 'ref0', ref: { kind: 'var' as const, varId: 'var_clues' } },
        b: { t: 'num' as const, id: 'num0', v: 1 },
      },
    }
    const formulas = ensureFormula(undefined, formula, {
      entities: withAttr,
      variables,
    })

    const direct = applyRuleOps({}, [
      { op: 'upsert-entity', entityId: 'ent_wukong', name: '孙悟空', kind: 'hero' },
      { op: 'upsert-entity-attr', entityId: 'ent_wukong', attrId: 'insight', value: 2, meta: { min: 0, max: 5 } },
      { op: 'upsert-variable', variableId: 'var_clues', name: '线索', initial: 0 },
      { op: 'upsert-formula', formulaId: formula.formulaId, name: formula.name, ast: formula.ast },
    ])
    if (!direct.ok) throw new Error(JSON.stringify(direct.errors))

    expect({ entities: withAttr, variables, formulas }).toEqual(direct.meta)
  })

  it('rejects a text variable in a numeric formula', () => {
    const result = applyRuleOps({
      variables: { title: { id: 'title', initial: '序章' } },
    }, [{
      op: 'upsert-formula',
      formulaId: 'formula_title',
      ast: { t: 'ref', id: 'ref0', ref: { kind: 'var', varId: 'title' } },
    }])

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]?.code).toBe('rules.formula.non-numeric-var')
  })
})
