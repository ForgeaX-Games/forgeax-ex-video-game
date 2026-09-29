/**
 * 支柱骨架推导：结构正确性由 Host 负责，语义由 design peer 负责。
 *
 * 章节数、战斗回合数、终局数量都能从需求契约确定性推出。让 peer 自己数的结果是
 * 反复出现「短篇设成 0 个战斗回合」「节点数超预算」「终局节拍没有玩家动作」这类
 * 偏差，而它们全都要等下游编译时才暴露。Host 先把骨架摆好，peer 只填叙事与玩法。
 *
 * 骨架还要标出每个节拍的写作密度。短篇 10 拍若每拍都写完整 v4（carrier /
 * feedbackSpec / 结算散文），第一次 upsert 就会超过 12k，peer 再花十几轮删字段——
 * 真跑里这把会把「支柱生成」拖成超长空转。过场只占一个 none 动作，分叉和战斗
 * 才写玩法字段，第一次就能写进上限，结果节点也留得出预算。
 */
import type { PillarActionRequiredRole } from '@/authoring/documents/pillar-interaction-contract'
import type { RequirementContract } from '../../workflow/contracts'
import { workScaleBudgetFromContract, WORK_SCALE_BUDGETS, type WorkScaleBudget } from '../../workflow/work-scale-budget'

export type PillarSkeletonBeatKind = 'pass' | 'branch' | 'combat' | 'ending'

export interface PillarSkeletonBeat {
  id: string
  /** 过场 / 分叉 / 战斗 / 终局。决定这一拍要写多满，peer 不得改 kind。 */
  kind: PillarSkeletonBeatKind
  /** 该节拍要设计的动作类型；战斗节拍由预算钉死，peer 不得改。 */
  requiredRole: PillarActionRequiredRole
  /** 终局节拍的出口目标；非终局节拍留空，由 peer 按剧情填 `exit.toBeatId`。 */
  exitToEndingId?: string
}

export interface PillarSkeletonEnding {
  id: string
  title: string
}

export interface PillarSkeletonWriteGuide {
  contentBudget: number
  hostLimit: number
  resultHeadroom: number
  rules: readonly string[]
  /** 本批 upsert 允许写入的节拍。过场一批，分叉/战斗/终局每次 1 拍。 */
  nextBeatIds?: readonly string[]
  /** 本批是否应带 title / cast / settings / mainLoop / variables / entities / formulas / endings。 */
  includeHeader?: boolean
}

export interface PillarWriteBatch {
  beatIds: readonly string[]
  includeHeader: boolean
  kind: PillarSkeletonBeatKind
}

export interface PillarSkeleton {
  schemaVersion: 4
  budget: WorkScaleBudget
  beats: PillarSkeletonBeat[]
  endings: PillarSkeletonEnding[]
  writeGuide: PillarSkeletonWriteGuide
}

/** 缺少 work_scale 时按短篇推导：它是问卷的默认档，也是最常见的成品规模。 */
const DEFAULT_BUDGET = WORK_SCALE_BUDGETS.find((budget) => budget.id === 'short')!

/** peer 提交前自检；超过后再压散文，不要删分叉/战斗的玩法字段。 */
export const PILLAR_CONTENT_SOFT_LIMIT = 10_000

/** MCP 放行后 Host 仍按这个硬上限拒稿。 */
export const PILLAR_CONTENT_HARD_LIMIT = 32_000

function beatId(index: number): string {
  return `B${String(index + 1).padStart(2, '0')}`
}

/**
 * 战斗回合落在靠后但非终局的位置：终局节拍要承接结局路由，把战斗压在它身上会
 * 让「战斗未分胜负回到本节拍」和「离开去终局」两条语义挤在同一个节点上。
 */
function combatBeatIndex(beatCount: number): number {
  return Math.max(0, beatCount - 3)
}

function earlyBranchIndex(beatCount: number): number {
  return beatCount >= 4 ? 1 : 0
}

function lateBranchIndex(beatCount: number, combatAt: number): number {
  if (combatAt > 0) return Math.max(0, combatAt - 1)
  return Math.max(0, beatCount - 3)
}

export function deriveBeatKind(
  index: number,
  beatCount: number,
  combatAt: number,
): PillarSkeletonBeatKind {
  if (index === beatCount - 1) return 'ending'
  if (index === combatAt) return 'combat'
  const early = earlyBranchIndex(beatCount)
  const late = lateBranchIndex(beatCount, combatAt)
  if (index === early || (index === late && index !== early && index !== combatAt)) {
    return 'branch'
  }
  return 'pass'
}

function writeGuideFor(budget: WorkScaleBudget, beatCount: number): PillarSkeletonWriteGuide {
  const resultHeadroom = Math.max(0, budget.maxNodeCount - beatCount)
  return {
    contentBudget: PILLAR_CONTENT_SOFT_LIMIT,
    hostLimit: PILLAR_CONTENT_HARD_LIMIT,
    resultHeadroom,
    rules: [
      `JSON.stringify(contract).length <= ${PILLAR_CONTENT_SOFT_LIMIT}（Host 硬上限 ${PILLAR_CONTENT_HARD_LIMIT}，按本批计）`,
      '用 upsert_document.contract 提交 IR，不要写作者 Markdown；Host 渲染角色/场景/主循环/互动节拍',
      'slug 只用 ASCII，复用 pillarSource.documentSlug；核心正文在 pillarSource.coreMarkdown，不要调用 Read / Write',
      '短篇可在一份不超过 Host 硬上限的完整 IR 中一次写齐全部节拍；超长时才按 writeGuide.nextBeatIds 分批提交',
      'Host 按 beat.id 合并；超长或截断时不要续写损坏 JSON，改为按 writeGuide.nextBeatIds 分批提交',
      'incomplete 时 missingBeatIds 是尚未写齐的全部，本批仍只交 nextBeatIds',
      'cast[].summary / settings[].summary 至少 20 字：外形服饰或地点光影，下游角色预设和视频 prompt 会直接引用',
      '每个节拍写 staging（至少 20 字）：谁在场、发生什么、镜头与气氛；narrativeIntent 只当章节名',
      '有独立对象、多属性时声明 entities[]（效果写 entity.<id>.attr.<attr>）；全局进度/旗标用 variables[]',
      '每个节拍规划界面运用：同一节点通常不挂两份相同覆盖物组件，多个动作共用一个输入覆盖物的不同事件',
      'kind=pass：一个 player-choice 动作，stateMutationOwner=none，省略 effect / settlement / carrier / feedbackSpec',
      'kind=branch：两个动作，exit 或 effect 必须可感知不同；写 effect、feedbackSpec、配对 settlement、exit',
      `kind=combat：combat-command + formulas + loop；每个含 settlement 的节拍消耗 1 个结果节点（额度 ${resultHeadroom}），不要给过场加结果节点`,
      'kind=ending：一个动作，exit.kind=ending',
      '省略 carrier 与 settlement 的 source/intent/feedback/exitIntent 长句，Host 会补机械字段',
    ],
  }
}

export function pillarContentOversizeError(received: number): string {
  return (
    `pillar content exceeds ${PILLAR_CONTENT_HARD_LIMIT} characters (received ${received}). `
    + 'This limit is per contract batch, not the merged document. '
    + 'Do not delete branch/combat play fields. Compress by: '
    + '(1) send IR via contract, never author Markdown; '
    + '(2) kind=pass beats: one none action, omit effect/settlement/carrier/feedbackSpec; '
    + '(3) omit carrier and settlement prose — Host hydrates them; '
    + '(4) only write writeGuide.nextBeatIds this call; Host merges by beat.id.'
  )
}

export function nextPillarWriteBatch(
  skeleton: PillarSkeleton,
  current: { beats: readonly { id: string }[] } | null,
): PillarWriteBatch | null {
  const have = new Set(current?.beats.map((beat) => beat.id) ?? [])
  const missing = skeleton.beats.filter((beat) => !have.has(beat.id))
  if (missing.length === 0) return null

  const remainingPass = missing.filter((beat) => beat.kind === 'pass')
  if (remainingPass.length > 0) {
    return {
      beatIds: remainingPass.map((beat) => beat.id),
      includeHeader: (current?.beats.length ?? 0) === 0,
      kind: 'pass',
    }
  }

  const next = missing[0]!
  return {
    beatIds: [next.id],
    includeHeader: false,
    kind: next.kind,
  }
}

export function annotatePillarWriteGuide(
  skeleton: PillarSkeleton,
  current: { beats: readonly { id: string }[] } | null,
): PillarSkeleton {
  const batch = nextPillarWriteBatch(skeleton, current)
  return {
    ...skeleton,
    writeGuide: {
      ...skeleton.writeGuide,
      nextBeatIds: batch?.beatIds ?? [],
      includeHeader: batch?.includeHeader ?? false,
    },
  }
}

export function pillarBatchTooWideError(batch: PillarWriteBatch, extraIds: readonly string[]): string {
  return (
    `本批只能写节拍 ${batch.beatIds.join('、')}（${batch.kind}）。`
    + '不要一次提交全部节拍；Host 按 beat.id 合并。'
    + (extraIds.length > 0 ? ` 多交了 ${extraIds.join('、')}。` : '')
    + ' 下次 upsert 的 beats[].id 必须是 writeGuide.nextBeatIds 的子集。'
  )
}

/**
 * 本批 beats[].id 必须落在骨架内，且新增节拍只能是 writeGuide.nextBeatIds。
 * 已经写过的节拍可以原样带回（合并覆盖），但不能夹带尚未轮到的分叉/战斗。
 * 骨架写齐后每次只修 1 个非过场节拍，避免「完整重写」再次打出 10 拍大 JSON。
 */
export function rejectOffBatchPillarPatch(
  skeleton: PillarSkeleton,
  current: { beats: readonly { id: string }[] } | null,
  patchBeatIds: readonly string[],
): { error: string; nextBeatIds: readonly string[] } | null {
  const skeletonIds = new Set(skeleton.beats.map((beat) => beat.id))
  const batch = nextPillarWriteBatch(skeleton, current)
  const nextBeatIds = batch?.beatIds ?? []
  const unknown = patchBeatIds.filter((id) => !skeletonIds.has(id))
  if (unknown.length > 0) {
    return {
      error: `未知节拍 ${unknown.join('、')}。只写骨架里的 beat.id；本批是 ${
        nextBeatIds.length > 0 ? nextBeatIds.join('、') : '（骨架已齐，只修已有节拍）'
      }。`,
      nextBeatIds,
    }
  }

  const have = new Set(current?.beats.map((beat) => beat.id) ?? [])
  const newIds = patchBeatIds.filter((id) => !have.has(id))
  if (batch) {
    // 完整骨架可原子校验、原子落盘。强制让 Agent 分五次维护写入协议，
    // 只会扩大恢复和时序造成的失败面。
    const isInitialCompleteSubmission = have.size === 0
      && newIds.length === skeleton.beats.length
      && new Set(newIds).size === skeleton.beats.length
    if (isInitialCompleteSubmission) return null
    const extra = newIds.filter((id) => !batch.beatIds.includes(id))
    if (extra.length > 0) return { error: pillarBatchTooWideError(batch, extra), nextBeatIds }
    return null
  }

  const kindById = new Map(skeleton.beats.map((beat) => [beat.id, beat.kind]))
  const nonPass = patchBeatIds.filter((id) => kindById.get(id) !== 'pass')
  if (nonPass.length > 1) {
    return {
      error: `骨架已写齐。本批只修 1 个分叉/战斗/终局节拍（本次交了 ${nonPass.join('、')}），不要重交全文。`,
      nextBeatIds,
    }
  }
  return null
}

/** `docs/<slug>_core.md` → `<slug>`；非法路径返回 undefined。 */
export function documentSlugFromDocumentRef(ref: string | undefined): string | undefined {
  const match = ref?.match(/^docs\/([A-Za-z0-9][A-Za-z0-9._-]*)_core\.md$/u)
  return match?.[1]
}

export function derivePillarSkeleton(
  contract: RequirementContract | undefined,
): PillarSkeleton {
  const budget = workScaleBudgetFromContract(contract) ?? DEFAULT_BUDGET
  const beatCount = budget.nodeCount
  const combatCount = budget.minCombatCount ?? 0
  const combatAt = combatCount > 0 ? combatBeatIndex(beatCount) : -1

  const endings: PillarSkeletonEnding[] = [{ id: 'ending-main', title: '主线结局' }]
  const beats: PillarSkeletonBeat[] = Array.from({ length: beatCount }, (_, index) => {
    const kind = deriveBeatKind(index, beatCount, combatAt)
    return {
      id: beatId(index),
      kind,
      requiredRole: kind === 'combat' ? 'combat-command' : 'player-choice',
      ...(kind === 'ending' ? { exitToEndingId: endings[0]!.id } : {}),
    }
  })

  return {
    schemaVersion: 4,
    budget,
    beats,
    endings,
    writeGuide: writeGuideFor(budget, beatCount),
  }
}
