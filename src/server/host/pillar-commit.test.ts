import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import {
  advanceCompiledStages,
  BLUEPRINT_FILE,
  commitCompiledPillar,
  lastCompiledStageAdvanceFailure,
} from './pillar-commit'
import {
  confirmPillarAuthorGate,
  readWorkflowState,
  VIDEO_GAME_WORKFLOW_FILE,
} from './workflow-state'
import { COMPILED_VIDEO_GAME_ACTIVITIES } from '../../workflow/contracts'
import type { validateProjectForActivity } from './project-inspection'
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'

/**
 * 支柱确认与可玩蓝图之间不再有 LLM：蓝图是支柱的纯函数产物。
 *
 * 旧结构在这里丢掉编译结果，改由 `blueprint.outline` peer 重画一张；重画那张
 * 不在支柱期证明的覆盖范围内，于是终局节点上空转了 76 分钟。
 */
function pillarMarkdown(overrides: Record<string, unknown> = {}): string {
  const contract = {
    schemaVersion: 4,
    variables: [{ id: 'arrowCount', initial: 0, max: 100000 }],
    formulas: [{ id: 'gain_arrows_heavy', expression: 'floor(20000 + var.stamina * 500)' }],
    endings: [{ id: 'ending-win', title: '十万齐备', when: 'var.arrowCount >= 100000', summary: '箭满归营' }],
    beats: [
      {
        id: 'B01',
        narrativeIntent: '雾夜受箭',
        staging: '长江大雾中草船舷侧受箭，火把隐约，镜头贴着船舷跟随诸葛亮抬手示意。',
        playerInformation: ['当前箭矢数'],
        uiCapabilities: ['战斗指令'],
        actions: [{
          id: 'heavy',
          intent: '聚船受箭',
          stateMutationOwner: 'settlement',
          requiredRole: 'combat-command',
          effect: { target: 'var.arrowCount', op: 'add', formulaId: 'gain_arrows_heavy' },
          feedbackSpec: { kind: 'hide-interface' },
          exit: { kind: 'beat', toBeatId: 'B02' },
          stateChange: '箭矢累积上升',
          immediateFeedback: '飘字显示获箭量',
          downstreamPayoff: '呈现箭雨扎满草人',
          exitIntent: '进入受箭结果',
        }],
        settlements: [{
          id: 'heavy-result',
          sourceActionId: 'heavy',
          trigger: 'at',
          triggerSpec: { type: 'at', ms: 900 },
          feedbackSpec: { kind: 'transient-component', component: 'GainFloatText' },
          source: '受箭命中帧',
          intent: '应用获箭量',
          feedback: '飘字显示获箭量',
          exitIntent: '继续结果演出',
        }],
      },
      {
        id: 'B02',
        narrativeIntent: '交箭交差',
        staging: '雾散后草船靠岸，诸葛亮把堆满船舱的箭矢交到鲁肃眼前交差。',
        playerInformation: ['最终箭矢数'],
        uiCapabilities: ['剧情选择'],
        actions: [{
          id: 'handover',
          intent: '向周瑜交箭',
          stateMutationOwner: 'none',
          requiredRole: 'player-choice',
          feedbackSpec: { kind: 'hide-interface' },
          exit: { kind: 'ending', endingId: 'ending-win' },
          stateChange: '不改数值',
          immediateFeedback: '隐藏选择界面',
          downstreamPayoff: '呈现交箭复命',
          exitIntent: '进入胜利结局',
        }],
        settlements: [],
      },
    ],
    ...overrides,
  }
  return `# 支柱\n\n\`\`\`pillar-interaction-contract\n${JSON.stringify(contract)}\n\`\`\`\n`
}

function context(): { ctx: ExtensionContext; entries: Map<string, Uint8Array> } {
  const entries = new Map<string, Uint8Array>()
  const ctx = {
    gameId: 'pillar-commit-game',
    files: {
      async read(path: string) { return entries.get(path) ?? null },
      async write(path: string, bytes: Uint8Array) { entries.set(path, new Uint8Array(bytes)) },
      async delete(path: string) { entries.delete(path) },
      async list() { return [] },
      async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>) { return operation() },
    },
  } as unknown as ExtensionContext
  return { ctx, entries }
}

/**
 * 只证明「推进」这件事时用它：夹具是 2 拍最小图，够编译但够不上交付级篇幅。
 * 真实校验器由「编译产物过不了硬门时拒绝推进」那条覆盖。
 */
const passingValidator: typeof validateProjectForActivity = async (
  _context,
  activity,
  activityRevision,
  checkIds,
) => ({
  schemaVersion: 1,
  ok: true,
  summary: { schemaVersion: 1, activity, activityRevision, ok: true, issues: [] } as never,
  evidence: (checkIds ?? []).map((checkId) => ({
    schemaVersion: 1,
    activity,
    activityRevision,
    checkId,
    status: 'pass',
    observedAt: new Date().toISOString(),
  })) as never,
})

function committedGraph(entries: Map<string, Uint8Array>): GraphLibraryDocument | null {
  const bytes = entries.get(BLUEPRINT_FILE)
  if (!bytes) return null
  return JSON.parse(new TextDecoder().decode(bytes)) as GraphLibraryDocument
}

/**
 * 复刻线上那局提交时的工作流：需求与策划四步都已完成、支柱刚过门，
 * 编译紧接着发生。全新状态（brief.collecting:not-started）复现不出这个场景。
 */
async function seedPillarCompleteWorkflow(
  ctx: ExtensionContext,
  entries: Map<string, Uint8Array>,
): Promise<void> {
  const state = (await readWorkflowState(ctx, { create: true }))!
  const completed = { revision: 1, status: 'complete' as const, artifactRefs: [], evidence: [] }
  const seeded = {
    ...state,
    productPhase: 'planning-design',
    phaseStatus: 'complete',
    activity: 'document.pillar',
    activityRevision: 1,
    activityStatus: 'complete',
    activities: {
      'brief.collecting': completed,
      'document.inquiry': completed,
      'document.core': completed,
      'document.pillar': completed,
    },
  }
  entries.set(
    VIDEO_GAME_WORKFLOW_FILE,
    new TextEncoder().encode(JSON.stringify(seeded)),
  )
}

describe('commitCompiledPillar', () => {
  it('writes the compiled blueprint so the author confirms an already-built graph', async () => {
    const { ctx, entries } = context()

    const result = await commitCompiledPillar(ctx, pillarMarkdown())

    expect(result.ok).toBe(true)
    expect(committedGraph(entries)?.graph.nodes.length).toBeGreaterThan(0)
  })

  it('carries the pillar rule catalog into the committed graph', async () => {
    const { ctx, entries } = context()

    await commitCompiledPillar(ctx, pillarMarkdown())

    const graph = committedGraph(entries)
    expect(graph?.variables?.arrowCount).toMatchObject({ id: 'arrowCount', initial: 0 })
    expect(graph?.formulas?.gain_arrows_heavy).toBeDefined()
  })

  it('seeds character and scene catalog identities so previewing has on-screen targets', async () => {
    const { ctx, entries } = context()

    await commitCompiledPillar(ctx, pillarMarkdown({
      cast: [{ name: '诸葛亮', summary: '羽扇纶巾，青衣布履，面容清癯从容，手持羽毛扇调度水军。' }],
      settings: [{ name: '长江雾夜', summary: '冬夜长江大雾锁江，草船隐没在水气里，远处偶见敌营火把。' }],
    }))

    const graph = committedGraph(entries)
    const interactive = graph?.graph.nodes.find((node) => node.data.name === '雾夜受箭')
    expect(interactive?.data.cast?.[0]?.characterId).toBe('character-1')
    expect(interactive?.data.scenes?.[0]?.sceneId).toBe('scene-1')
    const manifestBytes = entries.get('assets/manifest.json')
    expect(manifestBytes).toBeDefined()
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
      assetCatalog: { entities: { character: Record<string, { name: string }>; scene: Record<string, { name: string }> } }
    }
    expect(manifest.assetCatalog.entities.character['character-1']?.name).toBe('诸葛亮')
    expect(manifest.assetCatalog.entities.scene['scene-1']?.name).toBe('长江雾夜')
  })

  it('stamps a fresh document revision on every commit', async () => {
    const { ctx, entries } = context()

    await commitCompiledPillar(ctx, pillarMarkdown())
    const first = committedGraph(entries)!.revision!
    await commitCompiledPillar(ctx, pillarMarkdown())

    expect(committedGraph(entries)!.revision!).toBeGreaterThan(first)
  })

  it('refuses to commit when the pillar does not compile', async () => {
    const { ctx, entries } = context()

    const result = await commitCompiledPillar(
      ctx,
      pillarMarkdown().replace('"toBeatId":"B02"', '"toBeatId":"B99"'),
    )

    expect(result.ok).toBe(false)
    expect(entries.has(BLUEPRINT_FILE)).toBe(false)
  })

  // 线上表现：blueprint.json 写盘了 13 个节点，工作流却停在 document.pillar，
  // 编译阶段一个都没登记，asset-generation 永远是 not-started——于是 toast 一直
  // 说「蓝图、子蓝图即将开始」，资产线也开不了。成因被 advanceCompiledStages 的
  // 静默 catch 吞掉了，排查时没有任何线索。
  it('作者确认后把五个编译阶段一次推进到完成，工作流不再停在支柱', async () => {
    const { ctx, entries } = context()
    await seedPillarCompleteWorkflow(ctx, entries)
    await commitCompiledPillar(ctx, pillarMarkdown())
    // 作者确认是编译阶段的解锁点：支柱落盘时确认还没发生，那一次推进必然被拒。
    await confirmPillarAuthorGate(ctx, { productionId: 'author-confirm-1' })

    // 这条考的是推进本身：夹具是 2 拍最小图，达不到交付级篇幅硬门。
    // 「硬门不过就不许推进」由下一条用真实校验器单独证明。
    await advanceCompiledStages(ctx)

    const state = await readWorkflowState(ctx)
    const failure = lastCompiledStageAdvanceFailure()
    for (const activity of COMPILED_VIDEO_GAME_ACTIVITIES) {
      expect(
        state?.activities[activity]?.status,
        `${activity} 必须由编译推进到完成；最近一次失败：${JSON.stringify(failure)}`,
      ).toBe('complete')
    }
  })

  it('确认后的编译投影不会被后续篡改重新拒绝', async () => {
    const { ctx, entries } = context()
    await seedPillarCompleteWorkflow(ctx, entries)
    await commitCompiledPillar(ctx, pillarMarkdown())
    await confirmPillarAuthorGate(ctx, { productionId: 'author-confirm-broken' })
    // 把编译产物替换成一张入口之外无边可走的图：结构合法，但不可玩。
    const broken = committedGraph(entries)!
    const pack = broken.manifest.packs[broken.manifest.mainPackId]!
    pack.graph.edges = []
    broken.graph.edges = []
    entries.set(BLUEPRINT_FILE, new TextEncoder().encode(JSON.stringify(broken)))

    await advanceCompiledStages(ctx)

    const state = await readWorkflowState(ctx)
    for (const activity of COMPILED_VIDEO_GAME_ACTIVITIES) {
      expect(state?.activities[activity]?.status, activity).toBe('complete')
    }
    expect(lastCompiledStageAdvanceFailure()).toBeNull()
  })

  // 支柱落盘早于作者确认，所以那一次推进被拒是正常的——但它必须留痕，
  // 否则「图写盘了、进度停在支柱」这种状态完全无从排查。
  it('支柱落盘时推不动编译阶段，但记下被拒原因', async () => {
    const { ctx, entries } = context()
    await seedPillarCompleteWorkflow(ctx, entries)

    await commitCompiledPillar(ctx, pillarMarkdown())

    expect(lastCompiledStageAdvanceFailure()?.message).toMatch(/pillar confirmation/u)
  })

  it('refuses to commit a pillar whose contract block is missing', async () => {
    const { ctx, entries } = context()

    const result = await commitCompiledPillar(ctx, '# 支柱\n\n只有散文，没有机器契约。\n')

    expect(result.ok).toBe(false)
    expect(entries.has(BLUEPRINT_FILE)).toBe(false)
  })
})
