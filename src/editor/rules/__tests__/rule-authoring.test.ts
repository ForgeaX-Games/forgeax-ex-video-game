import { describe, expect, it } from 'vitest'
import {
  RULE_ID_PREFIXES,
  applyRuleOps,
  type RuleAuthoringMeta,
  type RuleOp,
} from '@/authoring/rules/rule-authoring'

function meta(overrides: RuleAuthoringMeta = {}): RuleAuthoringMeta {
  return { entities: {}, variables: {}, formulas: {}, ...overrides }
}

/**
 * 旧项目遗留的连字符变量必须继续可引用、可更新、可删除。
 * 预置成既有目录而非新建，因为新建 ID 已禁止连字符（见 rule-guards.test.ts）。
 */
function legacyVariable(id: string, name: string): RuleAuthoringMeta {
  return meta({ variables: { [id]: { id, name, initial: 0 } } })
}

function apply(ops: RuleOp[], base: RuleAuthoringMeta = meta()) {
  return applyRuleOps(base, ops)
}

function expectOk(result: ReturnType<typeof applyRuleOps>) {
  if (!result.ok) {
    throw new Error(`expected ok, got errors: ${JSON.stringify(result.errors)}`)
  }
  return result
}

describe('applyRuleOps — entities', () => {
  it('creates an entity and allocates the same id shape the editor UI allocates', () => {
    const result = expectOk(apply([{ op: 'upsert-entity', name: '孙悟空' }]))

    expect(result.results[0]!.id).toBe(`${RULE_ID_PREFIXES.entity}0`)
    expect(result.meta.entities![`${RULE_ID_PREFIXES.entity}0`]).toEqual({
      id: `${RULE_ID_PREFIXES.entity}0`,
      name: '孙悟空',
      attrs: {},
      attrMeta: {},
    })
  })

  it('honours an explicit id and updates in place on a second upsert', () => {
    const created = expectOk(apply([
      { op: 'upsert-entity', entityId: 'ent_wukong', name: '悟空', kind: 'hero' },
      { op: 'upsert-entity-attr', entityId: 'ent_wukong', attrId: 'insight', value: 3 },
    ]))
    const renamed = expectOk(applyRuleOps(created.meta, [
      { op: 'upsert-entity', entityId: 'ent_wukong', name: '齐天大圣' },
    ]))

    expect(renamed.meta.entities!['ent_wukong']).toMatchObject({
      name: '齐天大圣',
      kind: 'hero',
      attrs: { insight: 3 },
    })
  })

  it('adds an attribute with clamp metadata', () => {
    const result = expectOk(apply([
      { op: 'upsert-entity', entityId: 'ent_wukong', name: '悟空' },
      {
        op: 'upsert-entity-attr',
        entityId: 'ent_wukong',
        attrId: 'hp',
        value: 100,
        meta: { min: 0, max: 100, initial: 100, label: '生命' },
      },
    ]))

    expect(result.meta.entities!['ent_wukong']).toMatchObject({
      attrs: { hp: 100 },
      attrMeta: { hp: { min: 0, max: 100, initial: 100, label: '生命' } },
    })
  })

  it('refuses an attribute on a missing entity', () => {
    const result = apply([{ op: 'upsert-entity-attr', entityId: 'nope', attrId: 'hp', value: 1 }])

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.errors[0]!.code).toBe('rules.entity.not-found')
    expect(result.ok === false && result.failedOpIndex).toBe(0)
  })

  it('removes an entity and its attribute', () => {
    const base = expectOk(apply([
      { op: 'upsert-entity', entityId: 'ent_a', name: 'A' },
      { op: 'upsert-entity-attr', entityId: 'ent_a', attrId: 'hp', value: 1 },
      { op: 'upsert-entity', entityId: 'ent_b', name: 'B' },
    ])).meta

    expect(expectOk(applyRuleOps(base, [
      { op: 'remove-entity-attr', entityId: 'ent_a', attrId: 'hp' },
    ])).meta.entities!['ent_a']!.attrs).toEqual({})
    expect(expectOk(applyRuleOps(base, [
      { op: 'remove-entity', entityId: 'ent_a' },
    ])).meta.entities).toEqual({ 'ent_b': expect.objectContaining({ id: 'ent_b' }) })
  })

  it('refuses to remove something that does not exist', () => {
    const result = apply([{ op: 'remove-entity', entityId: 'ghost' }])

    expect(result.ok === false && result.errors[0]!.code).toBe('rules.entity.not-found')
  })
})

describe('applyRuleOps — variables', () => {
  it('creates a variable with an initial value', () => {
    const result = expectOk(apply([
      { op: 'upsert-variable', variableId: 'var_clues', name: '线索数', initial: 0, min: 0, max: 9 },
    ]))

    expect(result.meta.variables!['var_clues']).toEqual({
      id: 'var_clues',
      name: '线索数',
      initial: 0,
      min: 0,
      max: 9,
    })
  })

  it('allocates variable ids with the editor prefix', () => {
    const result = expectOk(apply([{ op: 'upsert-variable', name: '悬疑度', initial: 1 }]))

    expect(result.results[0]!.id).toBe(`${RULE_ID_PREFIXES.variable}0`)
  })
})

describe('applyRuleOps — formulas', () => {
  const wukongMeta = () => expectOk(apply([
    { op: 'upsert-entity', entityId: 'ent_wukong', name: '悟空' },
    { op: 'upsert-entity-attr', entityId: 'ent_wukong', attrId: 'insight', value: 2 },
  ], legacyVariable('var-clues', '线索'))).meta

  it('parses expression text into a normalized authoring AST', () => {
    const result = expectOk(applyRuleOps(wukongMeta(), [{
      op: 'upsert-formula',
      formulaId: 'formula_truth',
      name: '真相深度',
      expressionText: 'var.var-clues + entity.ent_wukong.attr.insight',
    }]))

    const formula = result.meta.formulas!['formula_truth']!
    expect(formula.id).toBe('formula_truth')
    expect(formula.name).toBe('真相深度')
    expect(formula.ast.t).toBe('bin')
  })

  it('lets a formula reference objects created in the same batch', () => {
    // The formula parser needs the catalog to disambiguate hyphenated ids, so
    // expressions must be resolved against the end state of the batch.
    const result = expectOk(apply([
      { op: 'upsert-variable', variableId: 'var_a', name: 'A', initial: 0 },
      {
        op: 'upsert-formula',
        formulaId: 'formula_sum',
        name: '和',
        expressionText: 'var.var_a + 1',
      },
    ]))

    expect(result.meta.formulas!['formula_sum']).toBeDefined()
  })

  it('rejects an expression that references an unknown variable', () => {
    const result = applyRuleOps(wukongMeta(), [{
      op: 'upsert-formula',
      formulaId: 'formula_bad',
      name: '坏公式',
      expressionText: 'var.does-not-exist + 1',
    }])

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.errors[0]!.code).toBe('rules.formula.unknown-reference')
  })

  it('rejects an expression that references an unknown entity attribute', () => {
    const result = applyRuleOps(wukongMeta(), [{
      op: 'upsert-formula',
      formulaId: 'formula_bad',
      name: '坏公式',
      expressionText: 'entity.ent_wukong.attr.nope + 1',
    }])

    expect(result.ok === false && result.errors[0]!.code).toBe('rules.formula.unknown-reference')
  })

  it('reports a parse failure with the op index instead of throwing', () => {
    const result = applyRuleOps(wukongMeta(), [{
      op: 'upsert-formula',
      formulaId: 'formula_bad',
      name: '坏公式',
      expressionText: 'var.var-clues +',
    }])

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.errors[0]!.code).toBe('rules.formula.parse-failed')
    expect(result.ok === false && result.failedOpIndex).toBe(0)
  })

  it('accepts the score reference the runtime provides', () => {
    expectOk(applyRuleOps(wukongMeta(), [{
      op: 'upsert-formula',
      formulaId: 'formula_score',
      name: '局面分',
      expressionText: 'score * 2',
    }]))
  })

  it('keeps the existing expression when an update omits the text', () => {
    const created = expectOk(applyRuleOps(wukongMeta(), [{
      op: 'upsert-formula',
      formulaId: 'formula_truth',
      name: '真相深度',
      expressionText: 'var.var-clues + 1',
    }]))
    const renamed = expectOk(applyRuleOps(created.meta, [
      { op: 'upsert-formula', formulaId: 'formula_truth', name: '改名了' },
    ]))

    expect(renamed.meta.formulas!['formula_truth']).toMatchObject({
      name: '改名了',
      ast: created.meta.formulas!['formula_truth']!.ast,
    })
  })

  it('requires an expression when creating a formula', () => {
    const result = apply([{ op: 'upsert-formula', formulaId: 'formula_empty', name: '空' }])

    expect(result.ok === false && result.errors[0]!.code).toBe('rules.formula.expression-required')
  })
})

describe('applyRuleOps — cross-reference safety', () => {
  const withFormula = () => expectOk(applyRuleOps(legacyVariable('var-clues', '线索'), [
    { op: 'upsert-entity', entityId: 'ent_wukong', name: '悟空' },
    { op: 'upsert-entity-attr', entityId: 'ent_wukong', attrId: 'insight', value: 2 },
    {
      op: 'upsert-formula',
      formulaId: 'formula_truth',
      name: '真相深度',
      expressionText: 'var.var-clues + entity.ent_wukong.attr.insight',
    },
  ])).meta

  it('refuses to orphan a formula by removing a referenced variable', () => {
    const result = applyRuleOps(withFormula(), [{ op: 'remove-variable', variableId: 'var-clues' }])

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.errors[0]!.code).toBe('rules.variable.in-use')
    expect(result.ok === false && result.errors[0]!.message).toContain('formula_truth')
  })

  it('refuses to orphan a formula by removing a referenced entity or attribute', () => {
    expect(applyRuleOps(withFormula(), [
      { op: 'remove-entity', entityId: 'ent_wukong' },
    ]).ok).toBe(false)
    expect(applyRuleOps(withFormula(), [
      { op: 'remove-entity-attr', entityId: 'ent_wukong', attrId: 'insight' },
    ]).ok).toBe(false)
  })

  it('allows removing a variable together with the formula that used it, in either order', () => {
    for (const ops of [
      [
        { op: 'remove-formula', formulaId: 'formula_truth' },
        { op: 'remove-variable', variableId: 'var-clues' },
      ],
      [
        { op: 'remove-variable', variableId: 'var-clues' },
        { op: 'remove-formula', formulaId: 'formula_truth' },
      ],
    ] as RuleOp[][]) {
      const result = expectOk(applyRuleOps(withFormula(), ops))
      expect(result.meta.variables).toEqual({})
      expect(result.meta.formulas).toEqual({})
    }
  })
})

describe('applyRuleOps — batch atomicity', () => {
  it('returns the original meta untouched when any op fails', () => {
    const base = meta({ entities: {}, variables: {}, formulas: {} })
    const snapshot = JSON.stringify(base)

    const result = applyRuleOps(base, [
      { op: 'upsert-entity', entityId: 'ent_ok', name: '会被丢弃' },
      { op: 'remove-variable', variableId: 'ghost' },
    ])

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.failedOpIndex).toBe(1)
    expect(JSON.stringify(base)).toBe(snapshot)
  })

  it('never mutates the input meta on success', () => {
    const base = meta()
    const snapshot = JSON.stringify(base)

    expectOk(applyRuleOps(base, [{ op: 'upsert-entity', entityId: 'ent_a', name: 'A' }]))

    expect(JSON.stringify(base)).toBe(snapshot)
  })

  it('rejects an empty batch', () => {
    const result = apply([])

    expect(result.ok === false && result.errors[0]!.code).toBe('rules.ops.empty')
  })

  it('creates a related rule set atomically in one call', () => {
    const result = expectOk(apply([
      { op: 'upsert-entity', entityId: 'ent_wukong', name: '孙悟空' },
      { op: 'upsert-entity-attr', entityId: 'ent_wukong', attrId: 'insight', value: 1, meta: { min: 0, max: 5 } },
      { op: 'upsert-variable', variableId: 'var_clue_count', name: '线索数', initial: 0 },
      {
        op: 'upsert-formula',
        formulaId: 'formula_truth_depth',
        name: '真相深度',
        expressionText: 'var.var_clue_count + entity.ent_wukong.attr.insight',
      },
    ]))

    expect(result.results.map((entry) => entry.id)).toEqual([
      'ent_wukong',
      'ent_wukong',
      'var_clue_count',
      'formula_truth_depth',
    ])
  })
})
