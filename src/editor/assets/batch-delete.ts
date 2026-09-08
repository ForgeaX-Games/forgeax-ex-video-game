export interface BatchDeleteProgress {
  current: number
  total: number
  id: string
}

export interface BatchDeleteResult {
  completed: number
  failedId?: string
  error?: unknown
}

/** 顺序删除：首个失败即停止，避免在作者未察觉时扩大破坏范围。 */
export async function deleteSequentially(
  ids: readonly string[],
  remove: (id: string) => Promise<void>,
  onProgress?: (progress: BatchDeleteProgress) => void,
): Promise<BatchDeleteResult> {
  for (const [index, id] of ids.entries()) {
    onProgress?.({ current: index + 1, total: ids.length, id })
    try {
      await remove(id)
    } catch (error) {
      return { completed: index, failedId: id, error }
    }
  }
  return { completed: ids.length }
}
