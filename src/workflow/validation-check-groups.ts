/**
 * 组合校验 id：活动契约表达业务意图，运行时展开为叶子 check 执行与取证。
 *
 * - Group：可展开；成员仍可单独通过 validate_project.checkIds 请求。
 * - 叶子 check 在 project-inspection 里 checks.set() 注册；组合 id 本身无独立实现。
 *
 * 维护约定：
 * - 增删成员后同步 docs/superpowers/specs/2026-08-17-blueprint-runtime-validation-design.md §6.1。
 * - check-coverage 对 hardChecks 做 expandCheckIds，组合 id 不要求 checks.set()。
 */
export const VALIDATION_CHECK_GROUPS = {
  /** 蓝图 JSON 静态合法性：结构连通、出边可推进、运行时 reaction/condition 形状。 */
  'blueprint.data.valid': [
    'graph.connected',
    'edge.no-producer',
    'runtime.shape.valid',
  ],
  /** 玩法 / 业务逻辑合理性：路径不非法卡死、规则可执行、数值区间合理。 */
  'playtest.playability.valid': [
    'playtest.paths-not-illegally-stuck',
    'playtest.rules-executable',
    'playtest.numeric-sanity',
  ],
} as const

export type ValidationCheckGroupId = keyof typeof VALIDATION_CHECK_GROUPS

export function isValidationCheckGroup(checkId: string): checkId is ValidationCheckGroupId {
  return Object.prototype.hasOwnProperty.call(VALIDATION_CHECK_GROUPS, checkId)
}

/** 组合 id → 叶子 id；已是叶子的 id 原样保留；去重并保持首次出现顺序。 */
export function expandCheckIds(requested: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of requested) {
    if (isValidationCheckGroup(id)) {
      for (const member of VALIDATION_CHECK_GROUPS[id]) {
        if (!seen.has(member)) {
          seen.add(member)
          out.push(member)
        }
      }
      continue
    }
    if (!seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}
