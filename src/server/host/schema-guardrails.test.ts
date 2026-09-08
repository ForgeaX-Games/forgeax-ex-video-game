import { describe, expect, it } from 'vitest'
import patchRulesArgs from '../../../schemas/patch-rules.args.json'
import { FORMULA_FUNCTION_NAMES, RULE_ID_PATTERN } from '@/runtime/core/engine/formula-registry'

/**
 * schema 层的参数护栏（设计 §9.7.4 L4）。
 *
 * 模型每填一个参数就是一次出错机会。ID 规则和函数白名单只写在应用层，
 * 意味着模型要先写错一次、被拒一次、再改一次；写进 schema 描述可以让它
 * 在生成阶段就被约束住。这组用例保证描述不会和唯一注册表漂移。
 */

type OpVariant = {
  properties: Record<string, { const?: string, description?: string }>
}

const variants = patchRulesArgs.properties.ops.items.oneOf as unknown as OpVariant[]

function variantFor(op: string): OpVariant {
  const found = variants.find((variant) => variant.properties.op?.const === op)
  if (!found) throw new Error(`patch-rules schema has no ${op} variant`)
  return found
}

describe('patch-rules schema 护栏', () => {
  it('每个新建 ID 字段都带上正则与正反例', () => {
    const cases: Array<[string, string]> = [
      ['upsert-variable', 'variableId'],
      ['upsert-entity', 'entityId'],
      ['upsert-entity-attr', 'attrId'],
      ['upsert-formula', 'formulaId'],
    ]

    for (const [op, field] of cases) {
      const description = variantFor(op).properties[field]?.description ?? ''
      expect(description, `${op}.${field} 缺少正则`).toContain(RULE_ID_PATTERN.source)
      expect(description, `${op}.${field} 缺少合法示例`).toMatch(/合法：/)
      expect(description, `${op}.${field} 缺少非法示例`).toMatch(/非法：/)
    }
  })

  it('公式表达式字段列出运行时支持的全部函数，且不多列', () => {
    const description = variantFor('upsert-formula').properties.expressionText?.description ?? ''

    for (const name of FORMULA_FUNCTION_NAMES) {
      expect(description, `缺少函数 ${name}`).toContain(`${name}(`)
    }
    // 描述里出现的函数调用不能超出注册表，否则模型会用到不存在的函数。
    const mentioned = new Set([...description.matchAll(/([A-Za-z][A-Za-z0-9]*)\(/g)].map((m) => m[1]!))
    const allowed = new Set(FORMULA_FUNCTION_NAMES)
    expect([...mentioned].filter((name) => !allowed.has(name))).toEqual([])
  })

  it('更新历史 ID 不受新建规则限制，所以 schema 不能用 pattern 硬拦', () => {
    // pattern 会连同「更新一个历史连字符 ID」一起拒掉，那是数据损坏而不是保护。
    for (const [op, field] of [
      ['upsert-variable', 'variableId'],
      ['upsert-entity', 'entityId'],
      ['upsert-formula', 'formulaId'],
    ] as Array<[string, string]>) {
      expect(variantFor(op).properties[field]).not.toHaveProperty('pattern')
    }
  })
})
