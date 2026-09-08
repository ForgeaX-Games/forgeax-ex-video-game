/**
 * 重试预算（设计 §9.7.5）。
 *
 * 同一个活动修订号上、同一个错误码连续失败两次，说明模型的修法没在起作用；
 * 继续放它重试只会烧预算并拖长创作耗时，此时应当转 blocker 交回编排者。
 *
 * 为什么不记在工作流状态里：那会让每一次被拒调用都推进 workflow revision，
 * 反过来让其他线手里的修订号变 stale——用一个诊断账本换来一堆乐观锁冲突。
 * 账本因此单独存一个小文件，不属于三平面中的任何一个，可随时删除。
 */
import type { ExtensionContext } from '@forgeax/extension-host/node'
import type { WorkflowRetryDisposition } from './workflow-state'

export const RETRY_LEDGER_FILE = '.forgeax/extensions/game-video/retry-ledger.json'

/** 同码连续失败达到这个次数就不再重试。 */
export const RETRY_BUDGET = 2

/**
 * `playtest.validating` 完成门：连续校验失败超过该次数后，下一次 `complete_activity`
 * 放行（仍保留失败证据），避免硬门把后续验证卡死。
 * 例如阈值为 2：第 1、2 次拒绝，第 3 次及以后放行。
 */
export const PLAYTEST_VALIDATING_BYPASS_AFTER_FAILURES = 2

/** 账本上限：只用于诊断当前活动，不需要保留历史。 */
const MAX_ENTRIES = 64

interface RetryLedger {
  schemaVersion: 1
  attempts: Record<string, number>
}

function parse(bytes: Uint8Array | null): RetryLedger {
  if (!bytes || bytes.length === 0) return { schemaVersion: 1, attempts: {} }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    if (!parsed || typeof parsed !== 'object') return { schemaVersion: 1, attempts: {} }
    const attempts = (parsed as RetryLedger).attempts
    return { schemaVersion: 1, attempts: attempts && typeof attempts === 'object' ? attempts : {} }
  } catch {
    // 账本坏了不该影响创作：当作空账本重新开始计数。
    return { schemaVersion: 1, attempts: {} }
  }
}

function ledgerKey(activity: string, activityRevision: number, code: string): string {
  return `${activity}@${activityRevision}#${code}`
}

export interface RejectionRecord {
  attempts: number
  /** 预算用尽后即便原本可重试，也要收敛成 stop。 */
  retry: WorkflowRetryDisposition
  budgetExhausted: boolean
}

/**
 * 记一次被守卫拒绝，并给出这次应该用的重试语义。
 *
 * `stop` 类错误不计数：它们本来就不该重试，计数只会污染账本。
 */
export async function recordRejection(
  context: ExtensionContext,
  input: { activity: string, activityRevision: number, code: string, retry: WorkflowRetryDisposition },
): Promise<RejectionRecord> {
  if (input.retry === 'stop') return { attempts: 0, retry: 'stop', budgetExhausted: false }
  const key = ledgerKey(input.activity, input.activityRevision, input.code)
  const ledger = parse(await context.files.read(RETRY_LEDGER_FILE).catch(() => null))
  const attempts = (ledger.attempts[key] ?? 0) + 1
  const entries = Object.entries({ ...ledger.attempts, [key]: attempts })
  const attemptsRecord = Object.fromEntries(entries.slice(-MAX_ENTRIES))
  await context.files
    .write(RETRY_LEDGER_FILE, new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, attempts: attemptsRecord })))
    .catch(() => undefined)
  const budgetExhausted = attempts >= RETRY_BUDGET
  return {
    attempts,
    retry: budgetExhausted ? 'stop' : input.retry,
    budgetExhausted,
  }
}

/** 活动成功推进后清账：下一个修订号不该背着上一轮的失败次数。 */
export async function clearRejections(
  context: ExtensionContext,
  activity: string,
): Promise<void> {
  const ledger = parse(await context.files.read(RETRY_LEDGER_FILE).catch(() => null))
  const attempts = Object.fromEntries(
    Object.entries(ledger.attempts).filter(([key]) => !key.startsWith(`${activity}@`)),
  )
  await context.files
    .write(RETRY_LEDGER_FILE, new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, attempts })))
    .catch(() => undefined)
}
