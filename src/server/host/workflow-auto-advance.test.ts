import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { autoAdvanceWorkflowForDocument } from './workflow-auto-advance'
import {
  beginWorkflowActivity,
  completeWorkflowActivity,
  confirmPillarAuthorGate,
  projectWorkflowState,
  readWorkflowState,
} from './workflow-state'
import type { ProjectValidationResult } from './project-inspection'
import type { VideoGameActivity } from '../../workflow/contracts'
import { activityContract } from '../../workflow/activity-contracts'

function context(): ExtensionContext {
  const entries = new Map<string, Uint8Array>()
  return {
    gameId: 'auto-advance-game',
    files: {
      async read(path: string) { return entries.get(path) ?? null },
      async write(path: string, bytes: Uint8Array) { entries.set(path, new Uint8Array(bytes)) },
      async delete(path: string) { entries.delete(path) },
      async list() { return [] },
      async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>) { return operation() },
    },
  } as unknown as ExtensionContext
}

/**
 * 用「哪些文档已落盘」驱动校验结果，模拟真实 validateProjectForActivity 的判定，
 * 但不必伪造整个文档库。
 */
function validatorFor(present: readonly string[]) {
  return async (
    _context: ExtensionContext,
    activity: VideoGameActivity,
    activityRevision: number,
  ): Promise<ProjectValidationResult> => {
    const satisfied = (check: string): boolean => {
      if (check.startsWith('document.design-options.')) return present.includes('design-options')
      const match = /^document\.(intake|core|inquiry|pillar)\.ready$/.exec(check)
      if (match) return present.includes(match[1]!)
      return true
    }
    const checks = activityContract(activity).hardChecks
    const ok = checks.every(satisfied)
    return {
      schemaVersion: 1,
      ok,
      summary: { schemaVersion: 1, activity, activityRevision, ok, issues: [] } as never,
      evidence: checks.map((checkId) => ({
        schemaVersion: 1,
        activity,
        activityRevision,
        checkId,
        status: satisfied(checkId) ? 'pass' : 'fail',
        observedAt: new Date().toISOString(),
      })) as never,
    }
  }
}

async function approveCoreGate(ctx: ExtensionContext): Promise<void> {
  const state = (await readWorkflowState(ctx, { create: true }))!
  const patched = {
    ...state,
    gates: {
      ...state.gates,
      core: { status: 'approved', revision: 1, evidenceRef: 'author-core-choice-b', approvedAt: new Date().toISOString() },
    },
  }
  await ctx.files.write(
    '.forgeax/extensions/game-video/workflow.json',
    new TextEncoder().encode(JSON.stringify(patched)),
  )
}

async function prepareForCoreDesign(ctx: ExtensionContext): Promise<void> {
  let state = (await readWorkflowState(ctx, { create: true }))!
  state = await beginWorkflowActivity(ctx, {
    activity: 'brief.collecting',
    expectedWorkflowRevision: state.revision,
  })
  state = await completeWorkflowActivity(ctx, {
    schemaVersion: 1,
    activity: 'brief.collecting',
    activityRevision: state.activityRevision,
    artifactRefs: [],
    checkIds: ['brief.required-dimensions'],
  }, [{
    schemaVersion: 1,
    activity: 'brief.collecting',
    activityRevision: state.activityRevision,
    checkId: 'brief.required-dimensions',
    status: 'pass',
    observedAt: new Date().toISOString(),
  }], {
    requirementContract: {
      rawIntent: '武松打虎互动影游',
      locale: 'zh-CN',
      dimensions: {},
    },
  })
  state = await beginWorkflowActivity(ctx, {
    activity: 'document.inquiry',
    expectedWorkflowRevision: state.revision,
  })
  await completeWorkflowActivity(ctx, {
    schemaVersion: 1,
    activity: 'document.inquiry',
    activityRevision: state.activityRevision,
    artifactRefs: [],
    checkIds: [],
  }, [], {
    inquiryContract: {
      answers: Array.from({ length: 5 }, (_, index) => ({
        question: `关键取舍 ${index + 1}`,
        answer: '选择 B',
      })),
    },
  })
}

describe('文档落盘即凭据：Host 自行推进工作流', () => {
  // 需求文档已删除（设计 §9.10）：需求契约只存生产平面。旧项目可能仍留着
  // intake 文件，写入它不得再推进任何活动，否则会凭空跳过需求收集。
  it('写入 intake 不再推进工作流', async () => {
    const ctx = context()
    await readWorkflowState(ctx, { create: true })

    await autoAdvanceWorkflowForDocument(ctx, 'intake', { validate: validatorFor(['intake']) })

    const state = (await readWorkflowState(ctx))!
    expect(state.activity).toBe('brief.collecting')
    expect(state.activityStatus).toBe('not-started')
  })

  it('写入三方案后完成 document.core，但不越过作者选择门', async () => {
    const ctx = context()
    await prepareForCoreDesign(ctx)
    const validate = validatorFor(['intake', 'design-options'])

    await autoAdvanceWorkflowForDocument(ctx, 'intake', { validate })
    await autoAdvanceWorkflowForDocument(ctx, 'design-options', { validate })

    const state = (await readWorkflowState(ctx))!
    expect(state.activity).toBe('document.pillar')
    expect(state.activities['document.core']?.status).toBe('complete')
    // core 门还没批准，pillar 不能开始 —— 自动推进必须停在门前。
    expect(state.gates.core?.status).toBe('pending')
    // 三方案和完成状态由同一次 Host 写入产生；等待作者选择时不再展示生成中 Toast。
    expect(projectWorkflowState(state).notice).toBeUndefined()
  })

  it('作者选定方向后写入支柱，落到 document.pillar 完成，支柱确认门即可放行', async () => {
    const ctx = context()
    await prepareForCoreDesign(ctx)
    const validate = validatorFor(['intake', 'design-options', 'core', 'pillar'])

    await autoAdvanceWorkflowForDocument(ctx, 'intake', { validate })
    await autoAdvanceWorkflowForDocument(ctx, 'design-options', { validate })
    await approveCoreGate(ctx)
    await autoAdvanceWorkflowForDocument(ctx, 'pillar', { validate })

    const state = (await readWorkflowState(ctx))!
    expect(state.activity).toBe('document.pillar')
    expect(state.activityStatus).toBe('complete')
  })

  it('目标活动的硬性检查不通过时停在 working，不伪造完成', async () => {
    const ctx = context()
    await prepareForCoreDesign(ctx)

    // 三方案文档还没写好（校验器声明什么都没有），推进只能停在 document.core。
    await autoAdvanceWorkflowForDocument(ctx, 'design-options', { validate: validatorFor([]) })

    const state = (await readWorkflowState(ctx))!
    expect(state.activity).toBe('document.core')
    expect(state.activityStatus).toBe('working')
  })

  it('支柱正文变化会自动重做校验并重开作者确认门', async () => {
    const ctx = context()
    await prepareForCoreDesign(ctx)
    const validate = validatorFor(['design-options', 'core', 'pillar'])
    await autoAdvanceWorkflowForDocument(ctx, 'design-options', { validate })
    await approveCoreGate(ctx)
    await autoAdvanceWorkflowForDocument(ctx, 'pillar', { validate })
    const first = (await readWorkflowState(ctx))!
    const approved = await confirmPillarAuthorGate(ctx, { productionId: 'pillar-v1' })

    await autoAdvanceWorkflowForDocument(ctx, 'pillar', {
      validate,
      reworkCompletedTarget: true,
    })

    const regenerated = (await readWorkflowState(ctx))!
    expect(regenerated.activity).toBe('document.pillar')
    expect(regenerated.activityStatus).toBe('complete')
    expect(regenerated.activities['document.pillar']?.revision).toBeGreaterThan(
      first.activities['document.pillar']!.revision,
    )
    expect(regenerated.gates.pillar).toMatchObject({ status: 'pending' })
    expect(regenerated.gates.pillar?.evidenceRef).toBeUndefined()
    expect(regenerated.revision).toBeGreaterThan(approved.revision)
  })

  it('不回退已经走过的活动', async () => {
    const ctx = context()
    await prepareForCoreDesign(ctx)
    const validate = validatorFor(['intake', 'design-options'])
    await autoAdvanceWorkflowForDocument(ctx, 'intake', { validate })
    await autoAdvanceWorkflowForDocument(ctx, 'design-options', { validate })
    const before = (await readWorkflowState(ctx))!

    await autoAdvanceWorkflowForDocument(ctx, 'intake', { validate })

    const after = (await readWorkflowState(ctx))!
    expect(after.activity).toBe('document.pillar')
    expect(after.revision).toBe(before.revision)
  })
})
