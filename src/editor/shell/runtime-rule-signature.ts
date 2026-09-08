import type { Entity, Variable } from '@/runtime/core/schema/graph-schema'

function sortedEntries<T>(values: Record<string, T> | undefined): Array<[string, T]> {
  return Object.entries(values ?? {}).sort(([left], [right]) => left.localeCompare(right))
}

/**
 * 只签运行态初始化会消费的规则字段。名称和属性显示名变化不应打断正在进行的试玩。
 */
export function runtimeRuleSignature(
  entities: Record<string, Entity> | undefined,
  variables: Record<string, Variable> | undefined,
): string {
  return JSON.stringify({
    entities: sortedEntries(entities).map(([entityId, entity]) => ({
      entityId,
      attrs: sortedEntries(entity.attrs),
      attrMeta: sortedEntries(entity.attrMeta).flatMap(([attr, meta]) => (
        meta.min === undefined && meta.max === undefined && meta.initial === undefined
          ? []
          : [[attr, meta.min, meta.max, meta.initial]]
      )),
    })),
    variables: sortedEntries(variables).map(([variableId, variable]) => [
      variableId,
      variable.initial,
      variable.min,
      variable.max,
    ]),
  })
}
