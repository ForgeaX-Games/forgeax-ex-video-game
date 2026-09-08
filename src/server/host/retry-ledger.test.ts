import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { clearRejections, recordRejection, RETRY_LEDGER_FILE } from './retry-ledger'

/**
 * 重试预算（设计 §9.7.5、§9.9「同码重试 ≤ 2 次」）。
 *
 * 此前预算只写在 Prompt 里，模型不照做就没有兜底：同一个错误可以无限重试，
 * 把创作耗时拖到不可接受。这里让 Host 自己收敛。
 */

function createContext(): { context: ExtensionContext, files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>()
  const context = {
    gameId: 'g',
    files: {
      async read(path: string) {
        const bytes = files.get(path)
        return bytes ? new Uint8Array(bytes) : null
      },
      async write(path: string, contents: Uint8Array) { files.set(path, new Uint8Array(contents)) },
      async list() { return [...files.keys()] },
      async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>) { return operation() },
    },
  } as unknown as ExtensionContext
  return { context, files }
}

const conflict = {
  activity: 'rules.catalog',
  activityRevision: 3,
  code: 'workflow.revision.conflict',
  retry: 'retry-now' as const,
}

describe('重试预算', () => {
  it('第一次失败保留原本的重试语义', async () => {
    const { context } = createContext()

    const first = await recordRejection(context, conflict)

    expect(first).toMatchObject({ attempts: 1, retry: 'retry-now', budgetExhausted: false })
  })

  it('同码第二次失败收敛成 stop', async () => {
    const { context } = createContext()

    await recordRejection(context, conflict)
    const second = await recordRejection(context, conflict)

    expect(second).toMatchObject({ attempts: 2, retry: 'stop', budgetExhausted: true })
  })

  it('不同错误码各自计数，互不牵连', async () => {
    const { context } = createContext()

    await recordRejection(context, conflict)
    const other = await recordRejection(context, {
      ...conflict,
      code: 'workflow.completion.rejected',
      retry: 'fix-then-retry',
    })

    expect(other).toMatchObject({ attempts: 1, retry: 'fix-then-retry' })
  })

  it('活动修订号变了就重新计数：返工后不该背着上一轮的失败', async () => {
    const { context } = createContext()

    await recordRejection(context, conflict)
    await recordRejection(context, conflict)
    const afterRework = await recordRejection(context, { ...conflict, activityRevision: 4 })

    expect(afterRework).toMatchObject({ attempts: 1, retry: 'retry-now', budgetExhausted: false })
  })

  it('stop 类错误不计数：它本来就不该重试，计数只会污染账本', async () => {
    const { context, files } = createContext()

    const result = await recordRejection(context, {
      ...conflict,
      code: 'workflow.write-scope.denied',
      retry: 'stop',
    })

    expect(result).toMatchObject({ attempts: 0, retry: 'stop' })
    expect(files.has(RETRY_LEDGER_FILE)).toBe(false)
  })

  it('活动交付后清掉这条线的账，其他线的账保留', async () => {
    const { context } = createContext()
    await recordRejection(context, conflict)
    await recordRejection(context, { ...conflict, activity: 'scenes.modeling' })

    await clearRejections(context, 'rules.catalog')

    expect(await recordRejection(context, conflict)).toMatchObject({ attempts: 1 })
    expect(await recordRejection(context, { ...conflict, activity: 'scenes.modeling' }))
      .toMatchObject({ attempts: 2, budgetExhausted: true })
  })

  it('账本损坏不影响创作，按空账本重新计数', async () => {
    const { context, files } = createContext()
    files.set(RETRY_LEDGER_FILE, new TextEncoder().encode('{ not json'))

    const result = await recordRejection(context, conflict)

    expect(result).toMatchObject({ attempts: 1, retry: 'retry-now' })
  })
})
