/** 蓝图标题唯一性：trim + 忽略大小写（zh-CN）。 */

export function normalizeBlueprintTitle(title: string): string {
  return title.trim().toLocaleLowerCase('zh-CN')
}

export function isBlueprintTitleTaken(
  blueprints: Record<string, { id: string; title: string }>,
  title: string,
  excludeId?: string,
): boolean {
  const key = normalizeBlueprintTitle(title)
  if (!key) return false
  for (const doc of Object.values(blueprints)) {
    if (excludeId && doc.id === excludeId) continue
    if (normalizeBlueprintTitle(doc.title) === key) return true
  }
  return false
}
