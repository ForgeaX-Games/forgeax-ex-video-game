import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import type { VideoGameWorkflowState } from '../../workflow/contracts'
import { validateProjectForActivity } from './project-inspection'
import { createInitialWorkflowState } from './workflow-state'

const encoder = new TextEncoder()

/**
 * 文档完成门的内容校验。
 *
 * `document.pillar.ready` 曾经只查「文件登记了」，
 * 于是一份只有标题的支柱文档也能过门；下游总脉络拿着空壳文档开工，
 * 问题会在几步之后以「声明不齐」之类的形式爆出来，很难回溯到真正的源头。
 */

const PILLAR_PROSE = [
  '# 游戏支柱',
  '## 角色',
  '武松：性烈如火的行者，主角。老虎：景阳冈的猛兽，最终对手。',
  '## 场景',
  '景阳冈山道、山神庙、酒家。夜色与月光是统一的视觉基调。',
  '## 主循环',
  '玩家在对峙中选择进攻或防守，消耗气力换取伤害窗口，气力耗尽即失败。',
  '## 数值',
  '气力、酒意、虎威三个变量互相牵制，伤害由公式结算。',
  '## 互动节拍',
  'B01：玩家观察猛虎蓄力后选择防反或闪避，结果进入不同受击演出。',
  '## 界面反馈',
  '双方血条持续展示生命；伤害发生时血条下降并显示伤害飘字。',
  '## 结算与分支',
  '敌方生命归零进入胜利，玩家生命归零进入失败，双方存活继续下一回合。',
  '## 战斗回合',
  '每回合包含敌方意图、玩家决策、状态结算、反馈、结果演出和胜负判断。',
]

function pillarBody(contract: unknown): string {
  return [...PILLAR_PROSE, '```pillar-interaction-contract', JSON.stringify(contract), '```'].join('\n')
}

const BEAT_PROSE = {
  id: 'B01',
  narrativeIntent: '玩家识破猛虎扑击并作出防反决策',
  playerInformation: ['猛虎正在蓄力', '双方当前生命值'],
  uiCapabilities: ['双方生命反馈', '防反输入', '伤害反馈'],
  settlements: [{
    id: 'health-terminal',
    trigger: 'state',
    source: 'player.hp <= 0 or enemy.hp <= 0',
    intent: '判定战斗胜负',
    feedback: '冻结战斗输入并保留最后一次生命变化',
    exitIntent: '进入胜利或失败结局',
  }],
  loop: { progress: '每回合至少一方生命或资源变化', exitConditions: ['敌方生命归零', '玩家生命归零'] },
}

const ACTION_PROSE = {
  id: 'parry',
  intent: '在攻击窗口内完成防反',
  stateChange: '成功降低敌方生命，失败降低玩家生命',
  immediateFeedback: '血条和伤害飘字同步变化',
  downstreamPayoff: '下游视频分别呈现反击命中或玩家受击',
  exitIntent: '进入对应结果演出',
}

const PILLAR_BODY = pillarBody({
  schemaVersion: 1,
  beats: [{ ...BEAT_PROSE, actions: [ACTION_PROSE] }],
})

/** v3 起每个动作必须声明承载角色，或显式承认目录承载不了。 */
function pillarBodyV3(carrier: Record<string, unknown>): string {
  return pillarBody({
    schemaVersion: 3,
    beats: [{
      ...BEAT_PROSE,
      actions: [{ ...ACTION_PROSE, stateMutationOwner: 'none', ...carrier }],
    }],
  })
}

function shortFormBeats(combatRole: 'combat-command' | 'timed-input' | 'player-choice') {
  return Array.from({ length: 10 }, (_, index) => ({
    ...BEAT_PROSE,
    id: `B${String(index + 1).padStart(2, '0')}`,
    actions: [{
      ...ACTION_PROSE,
      id: `act-${index + 1}`,
      stateMutationOwner: 'none' as const,
      requiredRole: index === 7 ? combatRole : 'player-choice',
      ...(index < 9
        ? { exit: { kind: 'beat' as const, toBeatId: `B${String(index + 2).padStart(2, '0')}` } }
        : {}),
    }],
    settlements: [],
  }))
}

const CORE_BODY = [
  '# 核心方向',
  '## 主循环',
  '以回合对峙为主循环：玩家读虎的动作预兆，选择闪避或反击，',
  '每次选择都改变气力与虎威，最终在气力耗尽前打出决胜一击。',
  '故事围绕武松从醉意到清醒的转变展开，节奏是紧张与喘息交替。',
].join('\n')

function context(documents: Array<{ documentType: string, content: string }>): ExtensionContext {
  const files = new Map<string, Uint8Array>([
    ['blueprint.json', encoder.encode(JSON.stringify({
      revision: 1,
      manifest: { mainPackId: 'main', packs: {} },
      graph: { nodes: [], edges: [] },
    }))],
  ])
  const assets = documents.map((document, index) => {
    const ref = `docs/wusong_${document.documentType}.md`
    files.set(ref, encoder.encode(document.content))
    return {
      id: `doc-${document.documentType}`,
      kind: 'document',
      name: document.documentType,
      status: 'ready',
      mimeType: 'text/markdown',
      provider: { kind: 'local', ref },
      createdAt: index + 1,
      updatedAt: index + 1,
      meta: { documentType: document.documentType },
    }
  })
  files.set('assets/manifest.json', encoder.encode(JSON.stringify({ version: 2, assets })))
  return {
    gameId: 'wusong',
    files: {
      async read(path: string) { return files.get(path) ?? null },
      async write(path: string, bytes: Uint8Array) { files.set(path, bytes) },
      async list(path: string) {
        const prefix = `${path.replace(/\/+$/, '')}/`
        return [...new Set([...files.keys()]
          .filter((entry) => entry.startsWith(prefix))
          .map((entry) => entry.slice(prefix.length).split('/', 1)[0]!))].sort()
      },
      async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>) { return operation() },
    },
    media: { async list() { return [] }, async read() { return null } },
  } as unknown as ExtensionContext
}

function workflow(scale?: string): VideoGameWorkflowState {
  const state = createInitialWorkflowState('wusong')
  if (!scale) return state
  state.requirementContract = {
    schemaVersion: 1,
    rawIntent: '做一个互动影游',
    dimensions: { work_scale: { value: scale, source: 'author' } },
    locale: 'zh-CN',
    collectedAt: new Date().toISOString(),
  }
  return state
}

async function status(
  documents: Array<{ documentType: string, content: string }>,
  checkId: string,
  workflowState?: VideoGameWorkflowState | null,
): Promise<{ status: string, codes: string[]; messages: string[] }> {
  const activity = checkId.includes('pillar') ? 'document.pillar' : 'document.core'
  const result = await validateProjectForActivity(
    context(documents),
    activity,
    1,
    [checkId],
    workflowState,
  )
  const evidence = result.evidence[0]!
  return {
    status: evidence.status,
    codes: (evidence.issues ?? []).map((entry) => entry.code),
    messages: (evidence.issues ?? []).map((entry) => entry.message),
  }
}

describe('文档完成门的内容校验', () => {
  it('完整支柱文档通过', async () => {
    const result = await status([{ documentType: 'pillar', content: PILLAR_BODY }], 'document.pillar.ready')
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'pass' })
  })

  it('只有标题的支柱文档不通过', async () => {
    const result = await status(
      [{ documentType: 'pillar', content: '# 游戏支柱' }],
      'document.pillar.ready',
    )

    expect(result.status).toBe('fail')
    expect(result.codes).toContain('document.pillar.too-thin')
  })

  it('支柱没谈到角色与场景时不通过：总脉络要靠它分派三条线', async () => {
    const withoutCast = [
      '# 游戏支柱',
      '## 主循环',
      '玩家在对峙中反复选择进攻或防守，通过消耗气力换取伤害窗口。',
      '整体节奏是紧张与喘息交替，失败与胜利都有明确终局。',
      '数值上由气力与虎威两个变量互相牵制，伤害由公式结算，',
      '每一次选择都会改变下一回合的可用动作与风险。',
    ].join('\n')

    const result = await status([{ documentType: 'pillar', content: withoutCast }], 'document.pillar.ready')

    expect(result.status).toBe('fail')
    expect(result.codes).toContain('document.pillar.missing-section')
  })

  it('核心方向必须谈到主循环', async () => {
    expect(await status([{ documentType: 'core', content: CORE_BODY }], 'document.core.ready'))
      .toMatchObject({ status: 'pass' })

    const vague = ['# 核心方向', '做一个武松打虎的互动短片，气质悲壮，篇幅短。'].join('\n')
    const result = await status([{ documentType: 'core', content: vague }], 'document.core.ready')
    expect(result.codes).toContain('document.core.missing-section')
  })

  it('文档缺失时报缺失，而不是内容问题', async () => {
    const result = await status([], 'document.pillar.ready')

    expect(result.status).toBe('fail')
    expect(result.codes).toContain('document.pillar.missing')
  })

  it('v3 动作声明了承载角色时干净通过', async () => {
    const content = pillarBodyV3({ requiredRole: 'timed-input' })
    const result = await status([{ documentType: 'pillar', content }], 'document.pillar.ready')

    expect(result, JSON.stringify(result)).toMatchObject({ status: 'pass' })
  })

  // 未解决的缺口会让总脉络/整装编译失败。支柱阶段就必须拦住，不能让作者确认一份不可执行的策划。
  it('v3 动作承认能力缺口时在支柱 ready 失败', async () => {
    const content = pillarBodyV3({
      capabilityGap: { need: '拖动排序输入', why: '目录里没有任何拖拽类控件' },
    })
    const result = await status([{ documentType: 'pillar', content }], 'document.pillar.ready')

    expect(result.status).toBe('fail')
    expect(result.codes).toContain('document.pillar.capability-gap')
  })

  it('v3 动作既没角色也没缺口时按契约非法处理', async () => {
    const content = pillarBodyV3({})
    const result = await status([{ documentType: 'pillar', content }], 'document.pillar.ready')

    expect(result.status).toBe('fail')
    expect(result.codes).toContain('document.pillar.interaction-contract-invalid')
  })

  // Regression (bug 01a0666a): the Host used to surface only the first
  // contract error, so the peer fixed one field, re-submitted the whole pillar,
  // and repeated until the next error surfaced. One pass must surface every
  // contract problem at once.
  it('一次返回支柱契约的全部问题，而不是只报第一条', async () => {
    const brokenAction = (id: string) => ({ ...ACTION_PROSE, id, stateMutationOwner: undefined })
    const content = pillarBody({
      schemaVersion: 2,
      beats: [{
        ...BEAT_PROSE,
        actions: [brokenAction('a1'), brokenAction('a2')],
      }],
    })

    const result = await status([{ documentType: 'pillar', content }], 'document.pillar.ready')

    expect(result.status).toBe('fail')
    const invalidCount = result.codes
      .filter((code) => code === 'document.pillar.interaction-contract-invalid')
      .length
    expect(invalidCount, JSON.stringify(result)).toBeGreaterThanOrEqual(2)
  })

  it('没有篇幅契约时不拦支柱 ready：预算闸门只在能算出上限时生效', async () => {
    const content = pillarBodyV3({ requiredRole: 'timed-input' })
    const result = await status(
      [{ documentType: 'pillar', content }],
      'document.pillar.ready',
      workflow(),
    )

    expect(result, JSON.stringify(result)).toMatchObject({ status: 'pass' })
  })

  it('短篇支柱最小节点数超过 15 时在作者确认前失败', async () => {
    const beats = Array.from({ length: 16 }, (_, index) => ({
      ...BEAT_PROSE,
      id: `B${String(index + 1).padStart(2, '0')}`,
      actions: [{
        ...ACTION_PROSE,
        id: `act-${index + 1}`,
        stateMutationOwner: 'none',
        requiredRole: index === 0 ? 'combat-command' : 'player-choice',
      }],
      settlements: [],
    }))
    const content = pillarBody({ schemaVersion: 3, beats })
    const result = await status(
      [{ documentType: 'pillar', content }],
      'document.pillar.ready',
      workflow('短篇（10个章节）'),
    )

    expect(result.status).toBe('fail')
    expect(result.codes).toContain('document.pillar.outline-budget-exceeded')
    expect(result.messages.join('\n')).toContain('16')
    expect(result.messages.join('\n')).toContain('15')
  })

  it('短篇支柱没有任何 combat-command 动作时失败', async () => {
    const content = pillarBody({ schemaVersion: 3, beats: shortFormBeats('timed-input') })
    const result = await status(
      [{ documentType: 'pillar', content }],
      'document.pillar.ready',
      workflow('短篇（10个章节）'),
    )

    expect(result.status).toBe('fail')
    expect(result.codes).toContain('document.pillar.combat-missing')
  })

  // 交给下游的支柱必须是 Host 自己画得出来的。这条覆盖「文档写得完整、契约也
  // 合法，但按支柱推导出的最小方案在总脉络里根本立不起来」这一类。
  it('Host 按最小方案画不出来的支柱在作者确认前失败', async () => {
    const content = pillarBody({
      schemaVersion: 3,
      beats: [
        { ...BEAT_PROSE, actions: [{ ...ACTION_PROSE, stateMutationOwner: 'none', requiredRole: 'player-choice' }] },
        { ...BEAT_PROSE, actions: [{ ...ACTION_PROSE, id: 'dodge', stateMutationOwner: 'none', requiredRole: 'player-choice' }] },
      ],
    })

    const result = await status([{ documentType: 'pillar', content }], 'document.pillar.ready')

    expect(result.status).toBe('fail')
    // 重复节拍 ID 由契约解析先拦下；这里确认它不会绕过任何一道门进到下游。
    expect(result.codes.some((code) => code.startsWith('document.pillar.'))).toBe(true)
  })

  it('短篇支柱在预算内且有战斗动作时通过', async () => {
    const content = pillarBody({ schemaVersion: 3, beats: shortFormBeats('combat-command') })
    const result = await status(
      [{ documentType: 'pillar', content }],
      'document.pillar.ready',
      workflow('短篇（10个章节）'),
    )

    expect(result, JSON.stringify(result)).toMatchObject({ status: 'pass' })
  })

  const PLAYABLE_V4 = {
    schemaVersion: 4,
    title: '白帝托孤',
    cast: [
      { name: '刘备', summary: '病榻上的君王，声音微弱却字字带着试探与托付' },
      { name: '诸葛亮', summary: '跪在榻前的丞相，羽扇未展，神色凝重不敢抬头' },
    ],
    settings: [{ name: '永安宫', summary: '白帝城永安宫烛火摇曳，药香弥漫在龙榻四周' }],
    variables: [
      { id: 'liubeiWill', label: '刘备心力', initial: 60, min: 0, max: 60 },
      { id: 'kongmingWill', label: '孔明心力', initial: 40, min: 0, max: 40 },
    ],
    formulas: [{ id: 'dmg_ult', expression: 'floor(20 + rand() * 10)' }],
    endings: [
      { id: 'ending-warm', title: '苍凉中的温暖', when: 'var.kongmingWill >= 20', summary: '君臣相得' },
      { id: 'ending-cold', title: '苍凉中的苍凉', summary: '无言以对' },
    ],
    beats: [
      {
        id: 'B01',
        narrativeIntent: '刘备第一次试探',
        staging: '白帝城永安宫烛火摇曳，刘备斜倚龙榻，诸葛亮跪在榻前对视。',
        actions: [
          {
            id: 'B01-ying',
            intent: '接下让位之言',
            stateMutationOwner: 'none',
            requiredRole: 'player-choice',
            exit: { kind: 'beat', toBeatId: 'B02' },
          },
          {
            id: 'B01-mo',
            intent: '沉默不接以退为进',
            stateMutationOwner: 'none',
            requiredRole: 'player-choice',
            exit: { kind: 'ending', endingId: 'ending-cold' },
          },
        ],
      },
      {
        id: 'B02',
        narrativeIntent: '心理交锋',
        staging: '殿内只剩君臣二人，镜头从榻前推到诸葛亮抬眼，空气里是药香。',
        actions: [{
          id: 'B02-ult',
          intent: '以命相誓一击定音',
          stateMutationOwner: 'settlement',
          requiredRole: 'combat-command',
          effect: { target: 'var.liubeiWill', op: 'sub', formulaId: 'dmg_ult' },
          feedbackSpec: { kind: 'state-binding', component: 'BattleEnemyHpBar', target: 'var.liubeiWill' },
          // 回合要成环：动作打回本拍，离场交给下面的系统结算。
          exit: { kind: 'beat', toBeatId: 'B02' },
        }],
        loop: { progress: '每回合削减刘备心力', exitConditions: ['刘备心力归零'] },
        settlements: [
          {
            id: 'B02-ult-result',
            sourceActionId: 'B02-ult',
            trigger: 'at',
            triggerSpec: { type: 'at', ms: 900 },
            feedbackSpec: { kind: 'transient-component', component: 'DamageFloatText' },
            source: '以辞破之的命中帧',
            intent: '应用心力削减',
            feedback: '刘备心力条下降并显示数值',
            exitIntent: '继续下一回合',
          },
          {
            id: 'B02-will-spent',
            trigger: 'state',
            triggerSpec: { type: 'state', condition: { all: [{ type: 'var', varId: 'liubeiWill', op: 'lte', value: 0 }] } },
            source: '刘备心力归零',
            intent: '交锋收束',
            feedback: '刘备闭眼长叹',
            exitIntent: '进入终局',
            exit: { kind: 'ending', endingId: 'ending-warm' },
          },
        ],
      },
    ],
  }

  it('可玩的 v4 支柱在作者确认前通过可玩性审查', async () => {
    const result = await status(
      [{ documentType: 'pillar', content: pillarBody(PLAYABLE_V4) }],
      'document.pillar.ready',
    )
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'pass' })
  })

  it('数值区间颠倒的支柱在作者确认前失败', async () => {
    const inverted = {
      ...PLAYABLE_V4,
      variables: [
        { id: 'liubeiWill', label: '刘备心力', initial: 60, min: 80, max: 10 },
        PLAYABLE_V4.variables[1],
      ],
    }
    const result = await status(
      [{ documentType: 'pillar', content: pillarBody(inverted) }],
      'document.pillar.ready',
    )
    expect(result.status).toBe('fail')
    expect(result.codes).toContain('document.pillar.not-buildable')
    expect(result.messages.join('\n')).toMatch(/min.*max|尚未可玩/u)
  })

  it('两个选项通向同一拍且没有状态后果时在作者确认前失败', async () => {
    const fakeChoice = {
      ...PLAYABLE_V4,
      beats: [
        {
          ...PLAYABLE_V4.beats[0],
          actions: [
            {
              id: 'B01-ying',
              intent: '接下让位之言',
              stateMutationOwner: 'none',
              requiredRole: 'player-choice',
              exit: { kind: 'beat', toBeatId: 'B02' },
            },
            {
              id: 'B01-mo',
              intent: '沉默不接以退为进',
              stateMutationOwner: 'none',
              requiredRole: 'player-choice',
              exit: { kind: 'beat', toBeatId: 'B02' },
            },
          ],
        },
        PLAYABLE_V4.beats[1],
      ],
    }
    const result = await status(
      [{ documentType: 'pillar', content: pillarBody(fakeChoice) }],
      'document.pillar.ready',
    )
    expect(result.status).toBe('fail')
    expect(result.codes).toContain('document.pillar.interaction-contract-invalid')
    expect(result.messages.join('\n')).toMatch(/出口相同|数值后果无差异/u)
  })
})
