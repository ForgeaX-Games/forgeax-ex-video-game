import type { ExtensionContext } from '@forgeax/extension-host/node'
import { activityContract } from '../../workflow/activity-contracts'
import { VIDEO_GAME_ACTIVITIES, type VideoGameActivity } from '../../workflow/contracts'
import { validateProjectForActivity } from './project-inspection'
import {
  beginWorkflowActivity,
  completeWorkflowActivity,
  readWorkflowState,
} from './workflow-state'

/**
 * 文档落盘即凭据:作者阶段的推进由 Host 依据产物自行判定,不依赖 Agent 记得调
 * `begin_activity`。
 *
 * 为什么需要:活动序列是严格 +1 推进的,而按 profile 的能力划分,requirement /
 * design peer 只有 `complete_activity`,能 `begin` 的只有 orchestrator —— 但提示词
 * 从未要求它为四个文档活动 begin。结果是工作流永远停在 `brief.collecting`,支柱
 * 确认门(要求 `document.pillar` 且 complete)永远返回 400,而支柱文档其实早就写好了。
 * 把判定权收回 Host 之后,「阶段走到哪」由落盘产物决定，聊天里漏没漏一次工具调用
 * 不再影响它。
 *
 * 这不是绕过完成校验:每个活动仍然要通过 `validateProjectForActivity` 的硬性检查，
 * 证据由 Host 自己算、自己签。也不会推平作者门:`document.pillar` 需要 core 门凭据、
 * `blueprint.outline` 需要 Host 记录的支柱确认，缺了就停在门前。
 */

/**
 * 写入哪种文档意味着推进到哪个活动。
 *
 * `intake` 不在表内：需求文档已删除（设计 §9.10），需求契约由 Host 在
 * `brief.collecting` 完成时写进生产平面。旧项目遗留的 intake 文件仍可读，
 * 但不再推进任何活动。
 */
const ACTIVITY_FOR_DOCUMENT: Readonly<Record<string, VideoGameActivity>> = {
  // 三方案文档是 document.core 的产物:该活动的硬性检查查的就是 design-options。
  'design-options': 'document.core',
  core: 'document.core',
  pillar: 'document.pillar',
}

type Validator = typeof validateProjectForActivity

function activityIndex(activity: VideoGameActivity): number {
  return VIDEO_GAME_ACTIVITIES.indexOf(activity)
}

export async function autoAdvanceWorkflowForDocument(
  context: ExtensionContext,
  documentType: string,
  deps: { validate?: Validator, reworkCompletedTarget?: boolean } = {},
): Promise<void> {
  const target = ACTIVITY_FOR_DOCUMENT[documentType]
  if (!target) return
  const validate = deps.validate ?? validateProjectForActivity
  const targetIndex = activityIndex(target)
  let reworkCompletedTarget = deps.reworkCompletedTarget === true

  // 每一步都重读状态:begin / complete 各自带锁写盘，不能缓存旧快照。
  // 上界防御一个死循环,正常情况远走不到。
  for (let step = 0; step < VIDEO_GAME_ACTIVITIES.length + 1; step += 1) {
    const state = await readWorkflowState(context, { create: true })
    if (!state) return
    const currentIndex = activityIndex(state.activity)
    if (currentIndex < 0) return

    const targetStatus = state.activities[target]?.status
    if (
      reworkCompletedTarget
      && currentIndex >= targetIndex
      && (targetStatus === 'complete' || targetStatus === 'not-required')
    ) {
      // 这是 Host 对刚落盘正文的内部一致性修复，不使用浏览器/Agent 快照 revision。
      // beginWorkflowActivity 会在自己的 WORKFLOW_LOCK 内读取最新状态并完成返工。
      await beginWorkflowActivity(context, {
        activity: target,
        rework: true,
        reason: `${documentType} document content changed`,
      })
      reworkCompletedTarget = false
      continue
    }

    if (state.activityStatus === 'complete' || state.activityStatus === 'not-required') {
      if (currentIndex >= targetIndex) return
      const next = VIDEO_GAME_ACTIVITIES[currentIndex + 1]
      if (!next) return
      if (!await tryBegin(context, next, state.revision)) return
      continue
    }

    if (currentIndex > targetIndex) return

    if (state.activityStatus === 'not-started') {
      if (!await tryBegin(context, state.activity, state.revision)) return
      continue
    }

    // blocked / awaiting-user 是留给人的状态,不硬推。
    if (state.activityStatus !== 'working') return

    // 文档落盘只能证明文档活动，不能替作者回答需求或补充问询。旧实现会在
    // design-options 写入时一路“自动完成”这两步，等于绕过作者输入。
    if (state.activity === 'brief.collecting' && !state.requirementContract) return
    if (state.activity === 'document.inquiry' && !state.inquiryContract) return

    const contract = activityContract(state.activity)
    const validation = await validate(context, state.activity, state.activityRevision, contract.hardChecks)
    if (validation.ok) {
      await completeWorkflowActivity(context, {
        schemaVersion: 1,
        activity: state.activity,
        activityRevision: state.activityRevision,
        artifactRefs: [],
        checkIds: [...contract.hardChecks],
      }, [...validation.evidence])
      continue
    }

    // 目标活动自己不达标 → 停在 working,让门合法地关着。
    if (currentIndex >= targetIndex) return
    return
  }
}

/**
 * 作者门缺凭据、状态被并发改写等都会让 begin 合法失败 —— 那不是异常，是「该停下
 * 等人」。已记录的 core 门凭据要显式带上，因为开始支柱定稿的契约要求调用方出示。
 */
async function tryBegin(
  context: ExtensionContext,
  activity: VideoGameActivity,
  expectedWorkflowRevision: number,
): Promise<boolean> {
  const state = await readWorkflowState(context)
  const core = state?.gates.core
  const gateApproval = activity === 'document.pillar' && core?.status === 'approved'
    ? {
      gateApproval: {
        gate: 'core',
        evidenceRef: core.evidenceRef,
        revision: core.revision,
        approvedAt: core.approvedAt,
      },
    }
    : {}
  try {
    await beginWorkflowActivity(context, {
      activity,
      expectedWorkflowRevision,
      ...gateApproval,
    })
    return true
  } catch {
    return false
  }
}
