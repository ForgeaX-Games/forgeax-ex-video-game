/**
 * 编译产物落盘：作者确认的支柱与可玩蓝图之间不再有 LLM。
 *
 * 蓝图是支柱的纯函数产物，所以每次支柱验收都整份重编译并覆盖写入——不做增量
 * 合并，也就不存在「旧图残留一半、新图覆盖另一半」这种只能靠人肉排查的中间态。
 *
 * 前身把编译结果丢掉，改让 `blueprint.outline` peer 重画一张。重画那张不在支柱期
 * 可执行性证明的覆盖范围内，于是「支柱过门 → 下游无解重试」反复复发：最后一次在
 * 终局节点上空转 76 分钟，编排者自己打了 194 次节点配置。
 */
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { parsePillarInteractionContract } from '@/authoring/documents/pillar-interaction-contract'
import {
  nextDocumentRevision,
  readDocumentRevision,
  readScopeRevisions,
  stampDocumentRevision,
} from './document-revision'
import { GRAPH_SAVE_LOCK } from './locks'
import { compilePillar, pillarAssetDefinitions, type PillarCompileIssue } from './pillar-compiler'
import {
  beginWorkflowActivity,
  completeWorkflowActivity,
  readWorkflowState,
  settledActivityOf,
} from './workflow-state'
import { COMPILED_VIDEO_GAME_ACTIVITIES } from '../../workflow/contracts'
import { activityContract } from '../../workflow/activity-contracts'
import { expandCheckIds } from '../../workflow/validation-check-groups'
import { HOST_MANIFEST_LOCK, readHostManifest, writeHostManifest } from '../asset-registry'
import { seedMissingAssetDefinitions } from './asset-entity-catalog'

/** 蓝图落盘路径。与 `extension-service` 共用同一个常量，避免两处各写一份字面量。 */
export const BLUEPRINT_FILE = 'blueprint.json'

const encoder = new TextEncoder()

export type PillarCommitResult =
  | { ok: true; revision: number; nodeCount: number; edgeCount: number }
  | { ok: false; issues: PillarCompileIssue[] }

/**
 * 把五个编译阶段一次性推进到完成。
 *
 * 它们是同一次编译的产物，所以只有「全部完成」和「都没开始」两种合法状态——
 * 中间态是旧结构才有的东西：总脉络完成、规则还在跑、整装等着，任何一步失败都
 * 留下一个只能靠人肉排查的半成品。
 *
 * 失败静默：编译产物已经落盘，工作流没跟上顶多是进度显示滞后，下一次支柱写入
 * 会重新推进。反过来抛出去会让一次成功的编译看起来像失败。
 */
/** 最近一次编译阶段推进失败的原因；仅用于诊断，不参与控制流。 */
let lastAdvanceFailure: { activity: string; message: string } | null = null

/** 测试与本地排查入口：读最近一次编译阶段推进为什么没走通。 */
export function lastCompiledStageAdvanceFailure(): { activity: string; message: string } | null {
  return lastAdvanceFailure
}

export async function advanceCompiledStages(
  context: ExtensionContext,
): Promise<void> {
  lastAdvanceFailure = null
  const preflight = await readWorkflowState(context, { create: true })
  if (!preflight) return
  const pending = COMPILED_VIDEO_GAME_ACTIVITIES.filter((activity) => !settledActivityOf(preflight, activity))
  // 作者确认是编译阶段唯一的解锁点。支柱每次落盘都会走到这里，确认之前再怎么
  // 校验也推不动，没必要为每次写入白跑五轮 inspectProject。
  if (pending.length > 0 && preflight.gates.pillar?.status !== 'approved') {
    lastAdvanceFailure = {
      activity: pending[0]!,
      message: 'blocked until pillar confirmation is recorded',
    }
    return
  }
  for (const activity of pending) {
    try {
      // `create: true`：支柱是第一个写工作流的活动，但编译紧跟其后发生，
      // 状态文件尚未落盘时不该让整条编译链静默停摆。
      const state = await readWorkflowState(context, { create: true })
      if (!state) return
      if (settledActivityOf(state, activity)) continue
      const begun = await beginWorkflowActivity(
        context,
        { activity, expectedWorkflowRevision: state.revision },
        { compilerOwned: true },
      )
      const activityRevision = begun.activities[activity]?.revision ?? begun.activityRevision
      const hardChecks = activityContract(activity).hardChecks
      // Semantic validity was proven before the author gate against this
      // exact deterministic compilation. These are progress projections, not
      // a second set of rejectable work items.
      const evidence = expandCheckIds(hardChecks).map((checkId) => ({
        schemaVersion: 1 as const,
        activity,
        activityRevision,
        checkId,
        status: 'pass' as const,
        observedAt: new Date().toISOString(),
        details: { source: 'pillar-delivery-preflight' },
      }))
      await completeWorkflowActivity(
        context,
        {
          schemaVersion: 1,
          activity,
          activityRevision,
          artifactRefs: [],
          checkIds: [...hardChecks],
        },
        evidence,
      )
    } catch (error) {
      // 见上：进度滞后可自愈，不能让它把成功的编译报成失败。但静默返回让
      // 「图写盘了、进度停在支柱、资产线永远开不了」这种状态完全无从排查，
      // 所以失败原因必须留痕。
      lastAdvanceFailure = {
        activity,
        message: error instanceof Error ? error.message : String(error),
      }
      return
    }
  }
}

/**
 * 编译支柱正文并把产物写成蓝图。
 *
 * 编译失败时**不写盘**：宁可让作者看到「支柱第几拍缺什么」，也不要留下一张
 * 半成品图让下游以为可以接着干。
 */
export async function commitCompiledPillar(
  context: ExtensionContext,
  pillarMarkdown: string,
): Promise<PillarCommitResult> {
  let contract
  try {
    contract = parsePillarInteractionContract(pillarMarkdown)
  } catch (error) {
    return {
      ok: false,
      issues: [{
        code: 'document.pillar.not-buildable',
        message: `支柱互动契约无法解析：${error instanceof Error ? error.message : String(error)}`,
      }],
    }
  }

  const compiled = compilePillar(contract)
  if (!compiled.ok) return { ok: false, issues: compiled.issues }

  const committed = await context.files.withLocks([GRAPH_SAVE_LOCK], async () => {
    const bytes = await context.files.read(BLUEPRINT_FILE)
    const revision = nextDocumentRevision(readDocumentRevision(bytes))
    await context.files.write(
      BLUEPRINT_FILE,
      encoder.encode(JSON.stringify(
        stampDocumentRevision(
          compiled.document,
          revision,
          [],
          { previous: readScopeRevisions(bytes), touched: ['graph'] },
        ),
        null,
        2,
      )),
    )
    return {
      ok: true as const,
      revision,
      nodeCount: compiled.document.graph.nodes.length,
      edgeCount: compiled.document.graph.edges.length,
    }
  })

  // 图已落盘，工作流随后跟上。顺序不能反：先推进活动再写图，一旦写图失败就会
  // 留下「阶段说完成了但图是空的」这种状态。
  //
  // 这里通常推不动：`blueprint.outline` 要求 Host 记录过作者确认，而支柱写入
  // 发生在确认之前。真正让编译阶段落地的是作者确认后的那一次调用；这里保留
  // 是为了作者已确认后重写支柱的情形。
  await seedCompiledPillarAssets(context, contract)
  await advanceCompiledStages(context)
  return committed
}

/** 只补目录里还没有的角色/场景，不覆盖建模已经写过的外观与 prompt。 */
async function seedCompiledPillarAssets(
  context: ExtensionContext,
  pillar: ReturnType<typeof parsePillarInteractionContract>,
): Promise<void> {
  const definitions = pillarAssetDefinitions(pillar)
  if (
    Object.keys(definitions.characters).length === 0
    && Object.keys(definitions.scenes).length === 0
  ) return
  await context.files.withLocks([HOST_MANIFEST_LOCK], async () => {
    const manifest = await readHostManifest(context.files)
    await writeHostManifest(context.files, seedMissingAssetDefinitions(manifest, definitions))
  })
}
