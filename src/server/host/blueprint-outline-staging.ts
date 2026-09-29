import { createHash } from 'node:crypto'
import type { ExtensionContext } from '@forgeax/extension-host/node'

export const BLUEPRINT_OUTLINE_STAGE_FILE = '.workbench/blueprint-outline-stage.json'
export const BLUEPRINT_OUTLINE_STAGE_LOCK = 'game-video-blueprint-outline-stage'
export const OUTLINE_REQUEST_MAX_BYTES = 20 * 1024
export const OUTLINE_STAGED_TOTAL_MAX_BYTES = 64 * 1024
export const OUTLINE_STAGE_MAX_BATCHES = 4
export const OUTLINE_STAGE_MAX_CHAPTERS = 10
export const OUTLINE_STAGE_MAX_ROUTES = 40

interface StoredBatch {
  fingerprint: string
  bytes: number
  chapters: unknown[]
  routes: unknown[]
}

interface StoredPlan {
  schemaVersion: 1
  planId: string
  batchCount: number
  entry: string
  idempotencyKey: string
  blueprintId?: string
  title?: string
  batches: Record<string, StoredBatch>
}

export type OutlineStagingResult =
  | {
      ok: true
      planId: string
      batchIndex: number
      batchCount: number
      receivedBatches: number[]
      remainingBatches: number[]
      stagedBytes: number
      replayed: boolean
      readyToCommit: boolean
      planFingerprint: string
      compileInput?: Record<string, unknown>
    }
  | { ok: false; errorCode: string; errors: string[]; failedPath?: string }

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function parseStoredPlan(value: Uint8Array | null): StoredPlan | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(new TextDecoder().decode(value)) as StoredPlan
    if (parsed?.schemaVersion !== 1 || !parsed.planId || !parsed.batches) return undefined
    return parsed
  } catch {
    return undefined
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stableHeader(input: Record<string, unknown>): Omit<StoredPlan, 'schemaVersion' | 'batches'> {
  return {
    planId: String(input.planId),
    batchCount: Number(input.batchCount),
    entry: String(input.entry),
    idempotencyKey: String(input.idempotencyKey),
    ...(optionalString(input.blueprintId) ? { blueprintId: optionalString(input.blueprintId) } : {}),
    ...(optionalString(input.title) ? { title: optionalString(input.title) } : {}),
  }
}

function sameHeader(plan: StoredPlan, header: ReturnType<typeof stableHeader>): boolean {
  return plan.planId === header.planId
    && plan.batchCount === header.batchCount
    && plan.entry === header.entry
    && plan.blueprintId === header.blueprintId
    && plan.title === header.title
}

export function outlineRequestBytes(input: Record<string, unknown>): number {
  return bytes(input)
}

export async function stageBlueprintOutlineBatch(
  context: ExtensionContext,
  input: Record<string, unknown>,
): Promise<OutlineStagingResult> {
  const planId = optionalString(input.planId)
  const batchIndex = Number(input.batchIndex)
  const batchCount = Number(input.batchCount)
  const chapters = Array.isArray(input.chapters) ? input.chapters : []
  const routes = Array.isArray(input.routes) ? input.routes : []
  if (!planId || !/^[A-Za-z0-9_-]{1,80}$/u.test(planId)) {
    return { ok: false, errorCode: 'outline.plan-id-invalid', errors: ['planId 只能使用 1～80 位字母、数字、下划线或连字符。'], failedPath: 'planId' }
  }
  if (!Number.isInteger(batchCount) || batchCount < 2 || batchCount > OUTLINE_STAGE_MAX_BATCHES) {
    return { ok: false, errorCode: 'outline.batch-count-invalid', errors: [`batchCount 必须介于 2 和 ${OUTLINE_STAGE_MAX_BATCHES}。`], failedPath: 'batchCount' }
  }
  if (!Number.isInteger(batchIndex) || batchIndex < 0 || batchIndex >= batchCount) {
    return { ok: false, errorCode: 'outline.batch-index-invalid', errors: ['batchIndex 必须是 batchCount 范围内的零基索引。'], failedPath: 'batchIndex' }
  }
  if (chapters.length > OUTLINE_STAGE_MAX_CHAPTERS || routes.length > OUTLINE_STAGE_MAX_ROUTES) {
    return {
      ok: false,
      errorCode: 'outline.batch-over-budget',
      errors: [`单批最多 ${OUTLINE_STAGE_MAX_CHAPTERS} 个章节、${OUTLINE_STAGE_MAX_ROUTES} 条路由。`],
      failedPath: chapters.length > OUTLINE_STAGE_MAX_CHAPTERS ? 'chapters' : 'routes',
    }
  }
  const requestBytes = outlineRequestBytes(input)
  if (requestBytes > OUTLINE_REQUEST_MAX_BYTES) {
    return {
      ok: false,
      errorCode: 'outline.payload-over-budget',
      errors: [`单次总脉络请求为 ${requestBytes} bytes，超过 ${OUTLINE_REQUEST_MAX_BYTES} bytes。请缩短文本或重新分批。`],
    }
  }
  const header = stableHeader(input)
  const batchPayload = { chapters: structuredClone(chapters), routes: structuredClone(routes) }
  const batch: StoredBatch = {
    fingerprint: fingerprint(batchPayload),
    bytes: bytes(batchPayload),
    ...batchPayload,
  }

  return context.files.withLocks([BLUEPRINT_OUTLINE_STAGE_LOCK], async () => {
    let plan = parseStoredPlan(await context.files.read(BLUEPRINT_OUTLINE_STAGE_FILE))
    if (plan && plan.planId !== planId) {
      if (batchIndex !== 0) {
        return {
          ok: false,
          errorCode: 'outline.plan-conflict',
          errors: [`当前正在暂存计划 ${plan.planId}；新计划必须从 batchIndex=0 开始。`],
          failedPath: 'planId',
        }
      }
      plan = undefined
    }
    if (plan && !sameHeader(plan, header)) {
      return {
        ok: false,
        errorCode: 'outline.plan-conflict',
        errors: ['同一 planId 的 entry、batchCount、blueprintId 和 title 必须保持不变；各批次可使用独立幂等键。'],
      }
    }
    plan ??= { schemaVersion: 1, ...header, batches: {} }
    const prior = plan.batches[String(batchIndex)]
    const replayed = prior?.fingerprint === batch.fingerprint
    if (!replayed) plan.batches[String(batchIndex)] = batch
    const stagedBytes = Object.values(plan.batches).reduce((sum, item) => sum + item.bytes, 0)
    if (stagedBytes > OUTLINE_STAGED_TOTAL_MAX_BYTES) {
      return {
        ok: false,
        errorCode: 'outline.plan-over-budget',
        errors: [`暂存计划累计 ${stagedBytes} bytes，超过 ${OUTLINE_STAGED_TOTAL_MAX_BYTES} bytes。请压缩互动意图。`],
      }
    }
    await context.files.write(
      BLUEPRINT_OUTLINE_STAGE_FILE,
      new TextEncoder().encode(JSON.stringify(plan, null, 2)),
    )
    const receivedBatches = Object.keys(plan.batches).map(Number).sort((a, b) => a - b)
    const remainingBatches = Array.from({ length: batchCount }, (_, index) => index)
      .filter((index) => !receivedBatches.includes(index))
    const readyToCommit = remainingBatches.length === 0
    const planFingerprint = fingerprint(plan)
    return {
      ok: true,
      planId,
      batchIndex,
      batchCount,
      receivedBatches,
      remainingBatches,
      stagedBytes,
      replayed,
      readyToCommit,
      planFingerprint,
      ...(readyToCommit ? {
        compileInput: {
          ...(plan.blueprintId ? { blueprintId: plan.blueprintId } : {}),
          ...(plan.title ? { title: plan.title } : {}),
          entry: plan.entry,
          idempotencyKey: plan.idempotencyKey,
          chapters: receivedBatches.flatMap((index) => plan!.batches[String(index)]!.chapters),
          routes: receivedBatches.flatMap((index) => plan!.batches[String(index)]!.routes),
        },
      } : {}),
    }
  })
}

export async function clearBlueprintOutlineStage(
  context: ExtensionContext,
  planId: string,
  planFingerprint: string,
): Promise<void> {
  await context.files.withLocks([BLUEPRINT_OUTLINE_STAGE_LOCK], async () => {
    const current = parseStoredPlan(await context.files.read(BLUEPRINT_OUTLINE_STAGE_FILE))
    if (current?.planId === planId && fingerprint(current) === planFingerprint) {
      await context.files.delete(BLUEPRINT_OUTLINE_STAGE_FILE)
    }
  })
}
