/**
 * 有上限的并发映射，保持输入顺序。
 *
 * 为什么需要上限：出图是按张计费且受 provider 限流的操作。无限并发会在
 * 一个规模稍大的剧本上同时打出十几个请求，既容易触发限流，也让失败面难以收敛。
 * 固定上限让「批内并发」成为稳定的提速手段而不是抖动来源。
 *
 * 单个目标失败不影响其他目标：调用方负责把失败折叠成结果项而不是抛出。
 */
export const DEFAULT_GENERATION_CONCURRENCY = 4

export async function mapWithConcurrency<Input, Output>(
  items: readonly Input[],
  limit: number,
  worker: (item: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  if (items.length === 0) return []
  const effectiveLimit = Math.max(1, Math.min(limit, items.length))
  const results = new Array<Output>(items.length)
  let cursor = 0
  const runners = Array.from({ length: effectiveLimit }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await worker(items[index]!, index)
    }
  })
  await Promise.all(runners)
  return results
}
