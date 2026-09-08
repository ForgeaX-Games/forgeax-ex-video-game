/**
 * 公式函数与变量 ID 的唯一事实源。
 *
 * 为什么单独抽一个模块：同一套规则原先散在四处——运行时求值器、`patch-rules`
 * 应用层、公式编辑器的函数菜单、项目校验器。任何一处漏改都会让「写得进去但跑不起来」
 * 的内容落盘，直到 GraphSession 求值才炸。现在四处都从这里读。
 *
 * 浏览器与 Node 端共用，因此不得引入任何平台专有依赖。
 */

export interface FormulaFunctionSpec {
  name: string
  minArgs: number
  /** null 表示可变参数（min/max）。 */
  maxArgs: number | null
  /** 需要可复现随机源；纯函数为 false。 */
  requiresRng: boolean
  summary: string
}

export const FORMULA_FUNCTIONS: readonly FormulaFunctionSpec[] = [
  { name: 'abs', minArgs: 1, maxArgs: 1, requiresRng: false, summary: '绝对值' },
  { name: 'floor', minArgs: 1, maxArgs: 1, requiresRng: false, summary: '向下取整' },
  { name: 'round', minArgs: 1, maxArgs: 1, requiresRng: false, summary: '四舍五入' },
  { name: 'min', minArgs: 1, maxArgs: null, requiresRng: false, summary: '取最小值' },
  { name: 'max', minArgs: 1, maxArgs: null, requiresRng: false, summary: '取最大值' },
  { name: 'rand', minArgs: 0, maxArgs: 0, requiresRng: true, summary: '0-1 随机数' },
  { name: 'randInt', minArgs: 2, maxArgs: 2, requiresRng: true, summary: '区间随机整数' },
  { name: 'chance', minArgs: 1, maxArgs: 1, requiresRng: true, summary: '按概率判定' },
]

const BY_NAME = new Map(FORMULA_FUNCTIONS.map((spec) => [spec.name, spec]))

export const FORMULA_FUNCTION_NAMES: readonly string[] = FORMULA_FUNCTIONS.map((spec) => spec.name)

export function formulaFunction(name: string): FormulaFunctionSpec | undefined {
  return BY_NAME.get(name)
}

export type FormulaCallIssue =
  | { code: 'rules.formula.unknown-function'; name: string; message: string }
  | { code: 'rules.formula.invalid-arity'; name: string; message: string }

/** 校验一次函数调用的名称与参数个数。 */
export function checkFormulaCall(name: string, argCount: number): FormulaCallIssue | undefined {
  const spec = formulaFunction(name)
  if (!spec) {
    return {
      code: 'rules.formula.unknown-function',
      name,
      message: `不支持的函数 ${name}()。可用函数：${FORMULA_FUNCTION_NAMES.join('、')}`,
    }
  }
  const tooFew = argCount < spec.minArgs
  const tooMany = spec.maxArgs !== null && argCount > spec.maxArgs
  if (tooFew || tooMany) {
    const expected = spec.maxArgs === null
      ? `至少 ${spec.minArgs} 个`
      : spec.minArgs === spec.maxArgs
        ? `${spec.minArgs} 个`
        : `${spec.minArgs}-${spec.maxArgs} 个`
    return {
      code: 'rules.formula.invalid-arity',
      name,
      message: `${name}() 需要${expected}参数，实际 ${argCount} 个`,
    }
  }
  return undefined
}

/**
 * 新建规则 ID 的格式。
 *
 * 首字符必须是字母或下划线：公式 tokenizer 会把以数字开头的记号识别为数值，
 * `2hp` 这样的 ID 在表达式里无法稳定引用。
 *
 * 只约束**新建**——历史项目里的 `var-clues` 这类连字符 ID 必须继续可读、可更新、
 * 可删除，否则等于把旧游戏改坏。
 */
export const RULE_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export function isValidNewRuleId(id: string): boolean {
  return RULE_ID_PATTERN.test(id)
}

export const RULE_ID_RULE_TEXT = '只能使用英文字母、数字和下划线，且不能以数字开头（展示名不受限制）'
