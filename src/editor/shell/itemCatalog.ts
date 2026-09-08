/** 从现有图与界面数据派生道具目录，不扩展发布 schema。 */
export function collectItemIds(...roots: unknown[]): string[] {
  const ids = new Set<string>()
  const seen = new Set<object>()

  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) {
      value.forEach(walk)
      return
    }
    const record = value as Record<string, unknown>
    if (
      (record.kind === 'item' || record.type === 'hasItem')
      && typeof record.itemId === 'string'
      && record.itemId.trim()
    ) {
      ids.add(record.itemId.trim())
    }
    Object.values(record).forEach(walk)
  }

  roots.forEach(walk)
  return [...ids].sort()
}
