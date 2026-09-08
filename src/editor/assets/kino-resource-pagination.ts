import {
  MAX_KINO_RESOURCE_PAGE_SIZE,
  type KinoRequestOptions,
  type KinoResourceDTO,
  type KinoVideoClient,
  type ListKinoResourcesQuery,
} from './kino-api'

const MAX_KINO_RESOURCE_PAGES = 100

export interface ListAllKinoResourcesOptions extends KinoRequestOptions {
  accept?: (item: KinoResourceDTO) => boolean
  completion?: 'received' | 'unique'
}

export interface AllKinoResources {
  items: KinoResourceDTO[]
  total: number
}

export async function listAllKinoResources(
  client: Pick<KinoVideoClient, 'list'>,
  query: Omit<ListKinoResourcesQuery, 'page' | 'page_size'>,
  options: ListAllKinoResourcesOptions = {},
): Promise<AllKinoResources> {
  const byId = new Map<string, KinoResourceDTO>()
  let total = 0
  let received = 0
  for (let page = 1; page <= MAX_KINO_RESOURCE_PAGES; page += 1) {
    const result = await client.list({
      ...query,
      page,
      page_size: MAX_KINO_RESOURCE_PAGE_SIZE,
    }, { signal: options.signal })
    for (const item of result.items) {
      if (!options.accept || options.accept(item)) byId.set(item.resource_id, item)
    }
    received += result.items.length
    total = result.total
    const completed = options.completion === 'unique' ? byId.size >= total : received >= total
    if (result.items.length === 0 || completed) break
  }
  return { items: [...byId.values()], total }
}
