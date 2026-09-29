import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { createGameVideoService } from './extension-service'
import { createInitialWorkflowState, VIDEO_GAME_WORKFLOW_FILE } from './workflow-state'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * 作者点「确认」的那一刻，这份支柱必须已经是可执行的。
 *
 * 支柱是否可执行不该由作者判断，作者也不该看见 Agent 的返工过程——
 * 所以保证必须落在**写入**和**确认**这两个动作上，而不是依赖
 * 「前面某一步应该已经校验过了」这种跨步不变量。实测有两条路绕过了它：
 * `import_stage_artifacts` 直接写盘并自动批准作者门，`confirm_pillar_author_gate`
 * 只看活动状态、不看支柱内容。
 */

const PROSE = [
  '# 游戏支柱',
  '## 角色\n武松与老虎。',
  '## 场景\n景阳冈山道与山神庙。',
  '## 主循环\n玩家在对峙中选择进攻或防守，消耗气力换取伤害窗口。',
  '## 互动节拍\nB01：玩家观察猛虎蓄力后选择防反或闪避。',
  '## 界面反馈\n双方血条持续展示生命；伤害发生时显示飘字。',
  '## 结算与分支\n敌方生命归零进入胜利，玩家生命归零进入失败。',
  '## 战斗回合\n每回合包含敌方意图、玩家决策、状态结算、反馈与胜负判断。',
]

/**
 * 一份真正可执行的支柱：出口写全、有一个真选择、短篇有一个成环的战斗回合，
 * 战斗用到的数值被写入、被看见、也被终局条件消费。缺任何一项都不是门误伤，
 * 而是支柱确实还不能交付。
 */
function pillarBody(beatCount: number): string {
  const beatId = (index: number): string => `B${String(index + 1).padStart(2, '0')}`
  const combatAt = beatCount >= 10 ? beatCount - 3 : -1
  const passAction = (index: number) => ({
    id: `act-${index + 1}`,
    intent: '在攻击窗口内完成防反',
    stateMutationOwner: 'none',
    requiredRole: 'player-choice',
    exit: index === beatCount - 1
      ? { kind: 'ending', endingId: 'ending-win' }
      : { kind: 'beat', toBeatId: beatId(index + 1) },
    stateChange: '不修改持久状态',
    immediateFeedback: '锁定输入',
    downstreamPayoff: '呈现反击或受击',
    exitIntent: '进入对应结果演出',
  })

  const beats = Array.from({ length: beatCount }, (_, index) => {
    const base = {
      id: beatId(index),
      narrativeIntent: '玩家识破猛虎扑击并作出决策',
      staging: '景阳冈山道上乱石横陈，武松背靠老松，猛虎自坡上俯冲而下，镜头贴着他的肩头。',
      playerInformation: ['猛虎正在蓄力'],
      uiCapabilities: ['防反输入'],
      settlements: [] as unknown[],
    }
    // 第一拍是真选择：两个动作去往不同的地方，否则最小可玩结构不成立。
    if (index === 0) {
      return {
        ...base,
        actions: [
          passAction(0),
          {
            ...passAction(0),
            id: 'act-1-evade',
            intent: '侧身闪避，绕开正面扑击',
            exit: beatCount > 2
              ? { kind: 'beat', toBeatId: beatId(2) }
              : { kind: 'ending', endingId: 'ending-win' },
            downstreamPayoff: '呈现闪避后的反手',
          },
        ],
      }
    }
    if (index !== combatAt) return { ...base, actions: [passAction(index)] }
    return {
      ...base,
      actions: [{
        id: `act-${index + 1}`,
        intent: '抓住虎爪落空的空档重击',
        stateMutationOwner: 'settlement',
        requiredRole: 'combat-command',
        effect: { target: 'var.tigerHp', op: 'sub', value: 10 },
        feedbackSpec: { kind: 'state-binding', component: 'BattleEnemyHpBar', target: 'var.tigerHp' },
        // 打回本拍才有回合；离场交给下面的系统结算。
        exit: { kind: 'beat', toBeatId: beatId(index) },
        stateChange: '猛虎生命下降',
        immediateFeedback: '虎血条下降',
        downstreamPayoff: '呈现猛虎踉跄',
        exitIntent: '继续下一回合',
      }],
      loop: { progress: '每回合削减猛虎生命', exitConditions: ['猛虎生命归零'] },
      settlements: [
        {
          id: `act-${index + 1}-result`,
          sourceActionId: `act-${index + 1}`,
          trigger: 'at',
          triggerSpec: { type: 'at', ms: 900 },
          feedbackSpec: { kind: 'transient-component', component: 'DamageFloatText' },
          source: '重击命中帧',
          intent: '应用重击伤害',
          feedback: '虎血条下降并显示数值',
          exitIntent: '继续下一回合',
        },
        {
          id: `act-${index + 1}-down`,
          trigger: 'state',
          triggerSpec: { type: 'state', condition: { all: [{ type: 'var', varId: 'tigerHp', op: 'lte', value: 0 }] } },
          source: '猛虎生命归零',
          intent: '战斗收束',
          feedback: '猛虎瘫倒',
          exitIntent: '进入下一拍',
          exit: { kind: 'beat', toBeatId: beatId(index + 1) },
        },
      ],
    }
  })

  return [
    ...PROSE,
    '```pillar-interaction-contract',
    JSON.stringify({
      schemaVersion: 4,
      ...(combatAt >= 0 ? { variables: [{ id: 'tigerHp', initial: 30, min: 0, max: 30 }] } : {}),
      endings: [
        ...(combatAt >= 0
          ? [{ id: 'ending-tamed', title: '虎毙冈上', when: 'var.tigerHp <= 0', summary: '猛虎伏地不起，武松喘息着撑住老松' }]
          : []),
        { id: 'ending-win', title: '打虎归来', summary: '武松拖着虎尸下冈，村口灯火通明' },
      ],
      beats,
    }),
    '```',
  ].join('\n')
}

const EXECUTABLE_PILLAR = pillarBody(2)
/** 短篇骨架 10 拍；作者确认带 work_scale 时必须写齐，否则 incomplete。 */
const SHORT_FORM_EXECUTABLE_PILLAR = pillarBody(10)
/** 短篇上限 15，16 个互动节拍推导出的最小方案装不进去。 */
const OVER_BUDGET_PILLAR = pillarBody(16)
const INCOMPLETE_PILLAR = '# 游戏支柱\n只写了个标题。'

function context(options: {
  pillarContent?: string
  workScale?: string
  pillarComplete?: boolean
} = {}): { context: ExtensionContext; files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>([
    ['blueprint.json', encoder.encode(JSON.stringify({
      revision: 1,
      manifest: { mainPackId: 'main', packs: {} },
      graph: { nodes: [], edges: [] },
    }))],
  ])

  const assets: unknown[] = []
  if (options.pillarContent !== undefined) {
    files.set('docs/wusong_pillar.md', encoder.encode(options.pillarContent))
    assets.push({
      id: 'doc-pillar',
      kind: 'document',
      name: '支柱',
      status: 'ready',
      mimeType: 'text/markdown',
      provider: { kind: 'local', ref: 'docs/wusong_pillar.md' },
      createdAt: 1,
      updatedAt: 1,
      meta: { documentType: 'pillar' },
    })
  }
  files.set('assets/manifest.json', encoder.encode(JSON.stringify({ version: 2, assets })))

  const state = createInitialWorkflowState('wusong')
  if (options.workScale) {
    state.requirementContract = {
      schemaVersion: 1,
      rawIntent: '做一个武松打虎互动影游',
      dimensions: { work_scale: { value: options.workScale, source: 'author' } },
      locale: 'zh-CN',
      collectedAt: new Date().toISOString(),
    }
  }
  if (options.pillarComplete) {
    state.productPhase = 'planning-design'
    state.activity = 'document.pillar'
    state.activityRevision = 1
    state.activityStatus = 'complete'
    for (const settled of ['brief.collecting', 'document.inquiry', 'document.core', 'document.pillar'] as const) {
      state.activities[settled] = { revision: 1, status: 'complete', artifactRefs: [], evidence: [] }
    }
    state.activeGroup = { id: 'design', activities: [], status: 'complete', revision: 1 }
  }
  files.set(VIDEO_GAME_WORKFLOW_FILE, encoder.encode(JSON.stringify(state)))

  let chain: Promise<unknown> = Promise.resolve()
  return {
    files,
    context: {
      gameId: 'wusong',
      files: {
        async read(path: string) {
          const bytes = files.get(path)
          return bytes ? new Uint8Array(bytes) : null
        },
        async write(path: string, bytes: Uint8Array) { files.set(path, new Uint8Array(bytes)) },
        async list(path: string) {
          const prefix = `${path.replace(/\/+$/, '')}/`
          return [...new Set([...files.keys()]
            .filter((entry) => entry.startsWith(prefix))
            .map((entry) => entry.slice(prefix.length).split('/', 1)[0]!))].sort()
        },
        async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>): Promise<T> {
          const run = chain.then(operation, operation)
          chain = run.catch(() => undefined)
          return run
        },
      },
      media: { async list() { return [] }, async read() { return null } },
    } as unknown as ExtensionContext,
  }
}

function workflowOf(files: Map<string, Uint8Array>) {
  return JSON.parse(decoder.decode(files.get(VIDEO_GAME_WORKFLOW_FILE)!)) as {
    activity: string
    gates: Record<string, { status: string } | undefined>
  }
}

describe('作者确认前必须已经证明支柱可执行', () => {
  it('import_stage_artifacts 拒绝不可执行的支柱，且不落盘、不批准作者门', async () => {
    const { context: ctx, files } = context()
    const service = createGameVideoService(ctx)

    await expect(service.importStageArtifacts({
      slug: 'wusong',
      artifacts: { core: '# 核心方向\n## 主循环\n玩家在对峙中反复选择进攻或防守，气力耗尽即失败。', pillar: INCOMPLETE_PILLAR },
    })).rejects.toThrow(/document\.pillar\./)

    expect(files.has('docs/wusong_pillar.md')).toBe(false)
    const workflow = workflowOf(files)
    expect(workflow.activity).not.toBe('blueprint.outline')
    expect(workflow.gates.pillar?.status).not.toBe('approved')
  })

  it('import_stage_artifacts 接受可执行的支柱', async () => {
    const { context: ctx } = context()
    const service = createGameVideoService(ctx)

    const result = await service.importStageArtifacts({
      slug: 'wusong',
      artifacts: { core: '# 核心方向\n## 主循环\n玩家在对峙中反复选择进攻或防守，气力耗尽即失败。', pillar: EXECUTABLE_PILLAR },
    }) as { accepted: boolean; resumeActivity: string }

    expect(result).toMatchObject({ accepted: true, resumeActivity: 'blueprint.outline' })
  })

  it('作者确认时重新证明一遍：装不进篇幅的支柱不给批准', async () => {
    const { context: ctx, files } = context({
      pillarContent: OVER_BUDGET_PILLAR,
      workScale: '短篇（10个章节）',
      pillarComplete: true,
    })
    const service = createGameVideoService(ctx)

    await expect(service.confirmPillarAuthorGate({ productionId: 'prod-1' }))
      .rejects.toThrow(/document\.pillar\.outline-budget-exceeded/)

    expect(workflowOf(files).gates.pillar?.status).not.toBe('approved')
  })

  it('可执行的支柱照常批准，不误伤', async () => {
    const { context: ctx, files } = context({
      pillarContent: SHORT_FORM_EXECUTABLE_PILLAR,
      workScale: '短篇（10个章节）',
      pillarComplete: true,
    })
    const service = createGameVideoService(ctx)

    const result = await service.confirmPillarAuthorGate({ productionId: 'prod-1' }) as { accepted: boolean }

    expect(result.accepted).toBe(true)
    expect(workflowOf(files).gates.pillar?.status).toBe('approved')
  })
})
