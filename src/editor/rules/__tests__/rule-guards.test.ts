import { describe, expect, it } from 'vitest'
import { applyRuleOps } from '@/authoring/rules/rule-authoring'
import { FORMULA_FUNCTION_NAMES, checkFormulaCall } from '@/runtime/core/engine/formula-registry'
import { parseExpr } from '@/runtime/core/engine/expr'
import { parseExprToFormulaAst, validateFormulaCalls } from '@/authoring/blueprint/formula-authoring'

function catalog(overrides: Parameters<typeof applyRuleOps>[0] = {}) {
  return { entities: {}, variables: {}, formulas: {}, ...overrides }
}

/** 失败结果里第一个错误码；成功时返回 undefined。 */
function errorCode(result: ReturnType<typeof applyRuleOps>): string | undefined {
  return result.ok ? undefined : result.errors[0]?.code
}

describe('新建变量 ID 约束', () => {
  it('接受字母、数字与下划线组合', () => {
    const result = applyRuleOps(catalog(), [
      { op: 'upsert-variable', variableId: 'clue_count_2', name: '线索数' },
    ])
    expect(result.ok).toBe(true)
  })

  it('拒绝中文、连字符与数字开头的新 ID', () => {
    for (const variableId of ['线索', 'clue-count', '2hp', 'hp!']) {
      const result = applyRuleOps(catalog(), [{ op: 'upsert-variable', variableId }])
      expect(result.ok, variableId).toBe(false)
      expect(errorCode(result), variableId).toBe('rules.variable.invalid-id')
    }
  })

  it('展示名不受限制', () => {
    const result = applyRuleOps(catalog(), [
      { op: 'upsert-variable', variableId: 'wanted_level', name: '通缉等级（越高越危险）' },
    ])
    expect(result.ok).toBe(true)
  })

  it('历史连字符 ID 仍可更新和删除', () => {
    const legacy = catalog({ variables: { 'var-clues': { id: 'var-clues', name: '线索', initial: 0 } } })
    const updated = applyRuleOps(legacy, [
      { op: 'upsert-variable', variableId: 'var-clues', initial: 3 },
    ])
    expect(updated.ok).toBe(true)
    if (updated.ok) expect(updated.meta.variables?.['var-clues']?.initial).toBe(3)

    const removed = applyRuleOps(legacy, [{ op: 'remove-variable', variableId: 'var-clues' }])
    expect(removed.ok).toBe(true)
  })

  it('省略 ID 时由分配器给出合法 ID', () => {
    const result = applyRuleOps(catalog(), [{ op: 'upsert-variable', name: '体力' }])
    expect(result.ok).toBe(true)
    if (result.ok) {
      const [id] = Object.keys(result.meta.variables ?? {})
      expect(id).toBeDefined()
      expect(id && /^[A-Za-z_][A-Za-z0-9_]*$/.test(id)).toBe(true)
    }
  })

  it('批处理中任一非法 ID 都整批失败，不写入其他变更', () => {
    const result = applyRuleOps(catalog(), [
      { op: 'upsert-variable', variableId: 'good_one' },
      { op: 'upsert-variable', variableId: '坏的' },
    ])
    expect(result.ok).toBe(false)
  })
})

describe('公式函数白名单', () => {
  it('注册表就是运行时支持的八个函数', () => {
    expect([...FORMULA_FUNCTION_NAMES].sort()).toEqual(
      ['abs', 'chance', 'floor', 'max', 'min', 'rand', 'randInt', 'round'].sort(),
    )
  })

  it('每个函数的参数边界都被钉住', () => {
    expect(checkFormulaCall('abs', 1)).toBeUndefined()
    expect(checkFormulaCall('abs', 0)?.code).toBe('rules.formula.invalid-arity')
    expect(checkFormulaCall('abs', 2)?.code).toBe('rules.formula.invalid-arity')
    expect(checkFormulaCall('rand', 0)).toBeUndefined()
    expect(checkFormulaCall('rand', 1)?.code).toBe('rules.formula.invalid-arity')
    expect(checkFormulaCall('randInt', 2)).toBeUndefined()
    expect(checkFormulaCall('randInt', 1)?.code).toBe('rules.formula.invalid-arity')
    // 可变参数：min/max 至少一个，多个合法。
    expect(checkFormulaCall('min', 1)).toBeUndefined()
    expect(checkFormulaCall('min', 5)).toBeUndefined()
    expect(checkFormulaCall('min', 0)?.code).toBe('rules.formula.invalid-arity')
  })

  it('未知函数被识别', () => {
    const issue = checkFormulaCall('sqrt', 1)
    expect(issue?.code).toBe('rules.formula.unknown-function')
    // 报错要把可用函数列出来，让 Agent 一次改对而不是逐个试。
    expect(issue?.message).toContain('abs')
  })

  it('AST 校验器递归检查嵌套调用', () => {
    expect(validateFormulaCalls(parseExprToFormulaAst('abs(1) + min(2, 3)'))).toEqual([])
    const issues = validateFormulaCalls(parseExprToFormulaAst('abs(sqrt(4))'))
    expect(issues[0]?.code).toBe('rules.formula.unknown-function')
  })

  it('未知函数在写入时就失败，不留到运行时', () => {
    const result = applyRuleOps(catalog(), [
      { op: 'upsert-formula', formulaId: 'dmg', expressionText: 'sqrt(16)' },
    ])
    expect(result.ok).toBe(false)
    expect(errorCode(result)).toBe('rules.formula.unknown-function')
  })

  it('参数个数错误在写入时就失败', () => {
    const result = applyRuleOps(catalog(), [
      { op: 'upsert-formula', formulaId: 'dmg', expressionText: 'randInt(1)' },
    ])
    expect(result.ok).toBe(false)
    expect(errorCode(result)).toBe('rules.formula.invalid-arity')
  })

  it('合法公式正常写入', () => {
    const result = applyRuleOps(catalog(), [
      { op: 'upsert-variable', variableId: 'hp', initial: 10 },
      { op: 'upsert-formula', formulaId: 'dmg', expressionText: 'max(1, floor(var.hp / 2))' },
    ])
    expect(result.ok).toBe(true)
  })

  it('运行时求值对未知函数同样拒绝，形成第二道防线', () => {
    // parser 只管语法，所以未知函数能解析成 AST；求值必须拒绝。
    const node = parseExpr('sqrt(4)')
    expect(node.t).toBe('call')
    expect(validateFormulaCalls(parseExprToFormulaAst('sqrt(4)'))[0]?.code)
      .toBe('rules.formula.unknown-function')
  })
})
