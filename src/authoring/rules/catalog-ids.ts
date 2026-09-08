/** Shared catalog identity helpers for UI and Agent rule authoring adapters. */
export function catalogIdOccupied(
  catalog: Record<string, { id?: string }> | undefined,
  id: string,
): boolean {
  return Object.entries(catalog ?? {}).some(([key, item]) => key === id || item.id === id)
}

export function nextCatalogId(
  prefix: string,
  catalog: Record<string, { id?: string }> | undefined,
): string {
  let index = Object.keys(catalog ?? {}).length
  let id = `${prefix}${index}`
  while (catalogIdOccupied(catalog, id)) {
    index += 1
    id = `${prefix}${index}`
  }
  return id
}

export function nextAvailableCatalogId(
  requestedId: string,
  catalog: Record<string, { id?: string }> | undefined,
): string {
  if (!catalogIdOccupied(catalog, requestedId)) return requestedId
  let index = 2
  let id = `${requestedId}${index}`
  while (catalogIdOccupied(catalog, id)) {
    index += 1
    id = `${requestedId}${index}`
  }
  return id
}
