export interface ResourceCacheEntry<T> {
  items: T[]
  loading: boolean
  error: string | null
  generation: number
}

export function beginResourceRefresh<T, Entry extends ResourceCacheEntry<T>>(
  current: Entry,
): { generation: number, entry: Entry } {
  const generation = current.generation + 1
  return {
    generation,
    entry: { ...current, loading: true, error: null, generation },
  }
}

export function completeResourceRefresh<T, Entry extends ResourceCacheEntry<T>>(
  current: Entry,
  items: T[],
  generation: number,
  extra: Partial<Entry> = {},
): Entry {
  return {
    ...current,
    ...extra,
    items,
    loading: false,
    error: null,
    generation,
  }
}

export function failResourceRefresh<T, Entry extends ResourceCacheEntry<T>>(
  current: Entry,
  error: string,
  generation: number,
): Entry {
  return { ...current, loading: false, error, generation }
}

export function upsertResource<T>(
  items: readonly T[],
  item: T,
  id: (value: T) => string,
  placement: 'preserve' | 'prepend' = 'preserve',
): T[] {
  const itemId = id(item)
  const existing = items.findIndex((entry) => id(entry) === itemId)
  if (placement === 'prepend') return [item, ...items.filter((entry) => id(entry) !== itemId)]
  return existing < 0
    ? [item, ...items]
    : items.map((entry, index) => index === existing ? item : entry)
}

export function removeResource<T>(items: readonly T[], resourceId: string, id: (value: T) => string): T[] {
  return items.filter((item) => id(item) !== resourceId)
}
