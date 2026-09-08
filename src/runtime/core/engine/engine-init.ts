/**
 * 从 GameScenario 建初始运行态 MutableState。
 *
 * - variables：kind='number' → vars(+varMeta 上下限)；kind='flag' → flags(0/1)。
 * - entities：attrs 直接拷贝作为初始/当前值；attrMeta 透传（clamp/ratio/复位约束）。
 *   若某 attr 只在 attrMeta 里给了 initial 而 attrs 没有，则用 initial 补上初值。
 *   **无 hp 特权**：hp 只是 attrs 里名为 hp 的一项（约定）。
 * - rng：使用会话注入的 seed；缺省 0，保证 headless 调试和测试可复现。
 */
import { isNumericScalar, isTextScalar, type GameScenario } from '../schema/graph-schema'
import { createRng } from './rng'
import type { MutableEntity, MutableState } from './apply-effects'

export function initState(scenario: GameScenario, rngSeed = 0): MutableState {
  const vars: Record<string, number> = {}
  const textVars: Record<string, string> = {}
  const varMeta: Record<string, { min?: number; max?: number }> = {}
  const flags: Record<string, number> = {}

  // 声明变量一律进 vars 桶（带 min/max clamp）；flag 为纯运行时概念，由 flag effect 写 flags 桶（默认 0）。
  for (const [id, raw] of Object.entries(scenario.variables ?? {})) {
    if (isNumericScalar(raw.initial)) {
      vars[id] = raw.initial
      if (raw.min !== undefined || raw.max !== undefined) varMeta[id] = { min: raw.min, max: raw.max }
    } else if (isTextScalar(raw.initial)) {
      textVars[id] = raw.initial
    }
  }

  const entities: Record<string, MutableEntity> = {}
  for (const [id, raw] of Object.entries(scenario.entities ?? {})) {
    const attrs = Object.fromEntries(
      Object.entries(raw.attrs ?? {}).filter(([, value]) => isNumericScalar(value)),
    ) as Record<string, number>
    if (raw.attrMeta) {
      for (const [k, m] of Object.entries(raw.attrMeta)) {
        if (!Object.hasOwn(raw.attrs ?? {}, k) && attrs[k] === undefined && m.initial !== undefined) attrs[k] = m.initial
      }
    }
    entities[id] = { attrs, attrMeta: raw.attrMeta }
  }

  return {
    vars,
    textVars,
    varMeta,
    entities,
    flags,
    formulas: (scenario as GameScenario & { formulas?: Record<string, unknown> }).formulas,
    score: 0,
    items: {},
    rng: createRng(rngSeed),
    appliedOnce: new Set<string>(),
  }
}
