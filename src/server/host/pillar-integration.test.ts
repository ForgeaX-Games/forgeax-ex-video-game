import { describe, expect, it } from 'vitest'
import { parsePillarInteractionContract } from '@/authoring/documents/pillar-interaction-contract'
import { compilePillar } from './pillar-compiler'
import { overlayMountId } from '@/runtime/core/schema/node-config-schema'
import { resolveMountChildren } from '@/runtime/core/schema/expand-overlay'
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import { inspectCompiledPlayability } from './project-inspection'

/**
 * 编译器原先只搬来了总脉络那半边（下工单），整装那半边（照单施工）从未实现：
 * 元件一个都没挂，玩家屏幕上没有可点的东西，结算也只有一条永远不会被触发的
 * 事件 reaction。产出因此必然「不可玩」，与支柱写得多细无关。
 */
const CANONICAL_STATE_CONDITION = { all: [{ type: 'var', varId: 'liubeiWill', op: 'lte', value: 0 }] }

function pillarMarkdown(stateCondition: unknown = CANONICAL_STATE_CONDITION): string {
  const contract = {
    schemaVersion: 4,
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
            triggerSpec: { type: 'state', condition: stateCondition },
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
  return `# 支柱\n\n\`\`\`pillar-interaction-contract\n${JSON.stringify(contract)}\n\`\`\`\n`
}

function compiled(): GraphLibraryDocument {
  const result = compilePillar(parsePillarInteractionContract(pillarMarkdown()))
  if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join('; '))
  return result.document
}

function nodeById(document: GraphLibraryDocument, id: string) {
  return document.graph.nodes.find((node) => node.id === id)
}

function mountedComponents(document: GraphLibraryDocument, nodeId: string): string[] {
  const node = nodeById(document, nodeId)
  return (node?.data.overlayNodes ?? []).flatMap((mount) => (
    resolveMountChildren(document.ui?.overlays, mount).map((child) => child.component)
  ))
}

describe('支柱编译产出可玩蓝图（整装半边）', () => {
  // 策划很自然会把条件写成表达式子句；编译器必须把它归一化成运行时条件形状。
  // 不归一化就会产出一条 condition 没有 all 的 reaction——那是编译器缺陷，
  // 策划改 IR 也修不掉，却会把支柱门堵死。
  it('把表达式形式的状态条件归一化成运行时条件', () => {
    const markdown = pillarMarkdown({ all: ['var.liubeiWill <= 0'] })
    const result = compilePillar(parsePillarInteractionContract(markdown))
    expect(result.ok, result.ok ? '' : result.issues.map((item) => item.message).join('; ')).toBe(true)
    if (!result.ok) return

    const codes = inspectCompiledPlayability(result.document, markdown).map((item) => item.code)
    expect(codes).not.toContain('condition.shape.invalid')
  })

  it('把承载动作的元件真正挂到互动节点上', () => {
    const document = compiled()

    // 没有挂载就没有任何东西会发出 `B01-ying` 事件，总脉络写好的 advance
    // reaction 永远不会被触发——这正是「蓝图不可玩」的直接成因。
    expect(mountedComponents(document, 'node-B01')).toContain('InkYingMo')
    expect(mountedComponents(document, 'node-B02')).toContain('BattleSkill')
  })

  it('把 state-binding 反馈元件挂上并绑到真实变量与上限', () => {
    const document = compiled()
    const node = nodeById(document, 'node-B02')!
    const children = (node.data.overlayNodes ?? []).flatMap((mount) => (
      resolveMountChildren(document.ui?.overlays, mount)
    ))
    const bar = children.find((child) => child.component === 'BattleEnemyHpBar')

    // 裸字符串虽然能被数值型 numberExpr 求值，但对文本型输入会被原样显示，
    // 而且所有校验器只认 `{ expr }` / `{ ref }`，绑了也看不出来。
    expect(bar?.inputs?.current).toEqual({ expr: 'var.liubeiWill' })
    expect(bar?.inputs?.max).toBe(60)
  })

  it('把结算飘字的参数绑成运行时真会插值的状态引用', () => {
    const document = compiled()
    const node = nodeById(document, 'node-B02-result')!
    const settlement = (node.data.reactions ?? []).find((reaction) => reaction.when.type === 'at')
    const spawn = settlement?.do.find((action) => action.kind === 'spawn')

    // `parameter` 是文本型 numberExpr：写裸 'var.liubeiWill' 会让玩家看见字面量，
    // 而不是心力数值。
    expect(spawn?.kind === 'spawn' ? spawn.inputs : undefined)
      .toEqual({ parameter: { ref: 'var.liubeiWill' } })
  })

  it('结算落成真正的 at 结算并把数值 effect 应用到变量上', () => {
    const document = compiled()
    const node = nodeById(document, 'node-B02-result')!
    const settlement = (node.data.reactions ?? []).find((reaction) => reaction.when.type === 'at')

    expect(settlement, '结果节点必须有一条 at 结算，而不是永远不触发的事件 reaction').toBeDefined()
    expect(settlement?.do).toContainEqual(
      expect.objectContaining({
        kind: 'effect',
        effects: expect.arrayContaining([
          expect.objectContaining({
            kind: 'var',
            varId: 'liubeiWill',
            op: 'add',
            value: { expr: '-formula.dmg_ult' },
          }),
        ]),
      }),
    )
  })

  it('瞬态反馈以 spawn 形式挂在结算上，让玩家看见数值变化', () => {
    const document = compiled()
    const node = nodeById(document, 'node-B02-result')!
    const settlement = (node.data.reactions ?? []).find((reaction) => reaction.when.type === 'at')

    expect(settlement?.do).toContainEqual(
      expect.objectContaining({ kind: 'spawn', from: 'base:DamageFloatText/DamageFloatText-0' }),
    )
  })

  // 多结局靠条件分流才成立。`when` 只被解析、不被编译时，两个终局都由无条件
  // 边抵达，作者写的「信任度≥阈值→温暖」永远不会生效。
  it('把 ending.when 编译成通往该终局的出边条件', () => {
    const document = compiled()
    const pack = document.manifest.packs[document.manifest.mainPackId]!
    const toWarm = pack.graph.edges.filter((edge) => edge.target === 'node-ending-ending-warm')

    expect(toWarm.length).toBeGreaterThan(0)
    for (const edge of toWarm) {
      expect(edge.data?.condition).toEqual({
        all: [{ type: 'var', varId: 'kongmingWill', op: 'gte', value: 20 }],
      })
    }
  })

  it('没有 when 的终局保持无条件边，作为兜底出口', () => {
    const document = compiled()
    const pack = document.manifest.packs[document.manifest.mainPackId]!
    const toCold = pack.graph.edges.filter((edge) => edge.target === 'node-ending-ending-cold')

    expect(toCold.length).toBeGreaterThan(0)
    for (const edge of toCold) expect(edge.data?.condition).toBeUndefined()
  })

  it('每个挂上的元件都有落点，不留空挂', () => {
    const document = compiled()
    for (const node of document.graph.nodes) {
      for (const mount of node.data.overlayNodes ?? []) {
        const mountId = overlayMountId(mount)
        expect(mountId, `${node.id} 的挂载缺少稳定 id`).toBeTruthy()
      }
    }
  })

  it('把用到的事件接到出边上，没用到的招式置灰', () => {
    const document = compiled()
    const choice = nodeById(document, 'node-B01')!
    const ying = (choice.data.overlayNodes ?? []).some((mount) => (
      (mount.reactions ?? []).some((reaction) => (
        reaction.when.type === 'event' && (reaction.when.id === 'ying' || reaction.when.id.endsWith(':ying'))
      ))
    ))
    expect(ying, 'InkYingMo.ying 必须有挂载级 reaction').toBe(true)

    const combat = nodeById(document, 'node-B02')!
    const children = (combat.data.overlayNodes ?? []).flatMap((mount) => (
      resolveMountChildren(document.ui?.overlays, mount)
    ))
    const skill = children.find((child) => child.component === 'BattleSkill')
    expect(skill?.inputs?.meditCost).toBe(1)
    expect(skill?.inputs?.meditResource).toBe(0)
    expect(skill?.inputs?.ultCost).toBe(1)
    expect(skill?.inputs?.ultResource).toBe(0)
  })

  it('编译产物通过支柱确认前的可玩性审查', () => {
    const document = compiled()
    const issues = inspectCompiledPlayability(document, pillarMarkdown())
    expect(issues, issues.map((item) => `${item.code}: ${item.message}`).join('\n')).toEqual([])
  })

  it('共享结果节点上两条同 ms 的数值结算都能通过可玩性审查', () => {
    const markdown = `# 支柱

角色、场景、主循环、互动节拍。

\`\`\`pillar-interaction-contract
${JSON.stringify({
  schemaVersion: 4,
  title: '路线抉择',
  cast: [{ name: '孔明', summary: '羽扇纶巾立于船头，神色从容，调度草船队借箭' }],
  settings: [{ name: '江面', summary: '长江大雾锁江，草船隐没在水汽里只见轮廓，远处曹营灯火隐约可辨' }],
  variables: [
    { id: 'plan_progress', initial: 0, max: 10 },
    { id: 'trust', initial: 0, max: 10 },
  ],
  // 声明了的状态必须被某个条件消费，否则就是假选择：直行结局读进度，
  // 绕行结局读信任，两条路各自有人读。
  endings: [
    { id: 'ending-win', title: '抵达', when: 'var.plan_progress >= 2', summary: '草船靠岸，孔明收扇，鲁肃长舒一口气' },
    { id: 'ending-trust', title: '同舟', when: 'var.trust >= 2', summary: '鲁肃亲自扶孔明下船，两人相视而笑' },
    { id: 'ending-plain', title: '各自回营', summary: '两人在岸边拱手作别，谁也没多说一句' },
  ],
  beats: [
    {
      id: 'B01',
      narrativeIntent: '选择航路',
      staging: '大雾锁江，孔明立于船头，鲁肃在侧，两条航路在江雾中若隐若现。',
      playerInformation: ['当前进度'],
      uiCapabilities: ['剧情选择'],
      actions: [
        {
          id: 'B01-ying',
          intent: '北岸直行',
          stateMutationOwner: 'settlement',
          requiredRole: 'player-choice',
          effect: { target: 'var.plan_progress', op: 'add', value: 2 },
          feedbackSpec: { kind: 'hide-interface' },
          exit: { kind: 'ending', endingId: 'ending-win' },
          stateChange: '进度提升',
          immediateFeedback: '隐藏选择',
          downstreamPayoff: '更快抵达',
          exitIntent: '进入终局',
        },
        {
          id: 'B01-mo',
          intent: '南岸绕行',
          stateMutationOwner: 'settlement',
          requiredRole: 'player-choice',
          effect: { target: 'var.trust', op: 'add', value: 2 },
          feedbackSpec: { kind: 'hide-interface' },
          exit: { kind: 'beat', toBeatId: 'B02' },
          stateChange: '信任提升',
          immediateFeedback: '隐藏选择',
          downstreamPayoff: '更稳妥',
          exitIntent: '进入下一拍',
        },
      ],
      settlements: [
        {
          id: 'B01-ying-result',
          sourceActionId: 'B01-ying',
          trigger: 'at',
          triggerSpec: { type: 'at', ms: 900 },
          feedbackSpec: { kind: 'transient-component', component: 'StatusNotice' },
          source: '北岸命中帧',
          intent: '进度提升',
          feedback: '进度提示',
          exitIntent: '进入终局',
        },
        {
          id: 'B01-mo-result',
          sourceActionId: 'B01-mo',
          trigger: 'at',
          triggerSpec: { type: 'at', ms: 900 },
          feedbackSpec: { kind: 'transient-component', component: 'StatusNotice' },
          source: '南岸命中帧',
          intent: '信任提升',
          feedback: '信任提示',
          exitIntent: '进入下一拍',
        },
      ],
    },
    {
      id: 'B02',
      narrativeIntent: '靠岸',
      staging: '草船靠岸，孔明收扇，鲁肃回望江面，雾气渐散。',
      playerInformation: ['靠岸'],
      uiCapabilities: ['剧情选择'],
      actions: [
        {
          id: 'B02-thank',
          intent: '先谢鲁肃',
          stateMutationOwner: 'none',
          requiredRole: 'player-choice',
          feedbackSpec: { kind: 'hide-interface' },
          exit: { kind: 'ending', endingId: 'ending-trust' },
          stateChange: '不改数值',
          immediateFeedback: '隐藏选择',
          downstreamPayoff: '两人相视而笑',
          exitIntent: '进入同舟结局',
        },
        {
          id: 'B02-continue',
          intent: '径自登岸',
          stateMutationOwner: 'none',
          requiredRole: 'player-choice',
          feedbackSpec: { kind: 'hide-interface' },
          exit: { kind: 'ending', endingId: 'ending-plain' },
          stateChange: '不改数值',
          immediateFeedback: '隐藏选择',
          downstreamPayoff: '拱手作别',
          exitIntent: '进入兜底结局',
        },
      ],
      settlements: [],
    },
  ],
})}
\`\`\`
`
    const result = compilePillar(parsePillarInteractionContract(markdown))
    expect(result.ok, result.ok ? '' : result.issues.map((issue) => issue.message).join('; ')).toBe(true)
    if (!result.ok) return
    const issues = inspectCompiledPlayability(result.document, markdown)
    expect(issues, issues.map((item) => `${item.code}: ${item.message}`).join('\n')).toEqual([])
  })

  /**
   * 覆盖率与状态生命周期这些字段是编译产物的属性，策划改支柱 IR 也补不上；所以
   * 一份把出口、反馈和消费条件都写全的支柱，必须能编译出连质量盖章一起零问题的
   * 蓝图。否则那道门只会把编译器的施工缺口记在策划账上。
   */
  it('一份写全出口与消费条件的支柱编译出的蓝图连质量盖章一起零问题', () => {
    const markdown = `# 支柱

角色、场景、主循环、互动节拍。

\`\`\`pillar-interaction-contract
${JSON.stringify({
  schemaVersion: 4,
  title: '白帝托孤',
  cast: [{ name: '刘备', summary: '斜倚龙榻，面色灰败，须发散乱，眼底仍压着试探，每说一句都要停下来喘息' }],
  settings: [{ name: '永安宫', summary: '烛火摇曳的寝殿，帷幕低垂遮住半边榻，药香混着江风从殿门渗进来' }],
  mainLoop: '每一拍先读刘备的心力，再决定说什么，说完的代价当场兑现在心力与信任上。',
  variables: [
    { id: 'liubeiWill', label: '刘备心力', initial: 60, min: 0, max: 60 },
    { id: 'trust', label: '君臣信任', initial: 5, min: 0, max: 10 },
  ],
  formulas: [
    { id: 'dmg_ult', expression: 'floor(20 + rand() * 10)' },
    { id: 'trust_gain', expression: '2' },
    { id: 'trust_loss', expression: '1' },
  ],
  endings: [
    { id: 'ending-warm', title: '苍凉中的温暖', when: 'var.trust >= 6', summary: '君臣相得，诸葛亮伏地长拜，刘备终于闭眼' },
    { id: 'ending-cold', title: '苍凉中的苍凉', summary: '无言以对，殿内只剩烛火，谁都没有说出那句话' },
  ],
  beats: [
    {
      id: 'B01',
      narrativeIntent: '第一次试探',
      staging: '永安宫烛火摇曳，刘备斜倚龙榻，诸葛亮跪在榻前与他对视。',
      playerInformation: ['刘备的心力'],
      uiCapabilities: ['剧情选择'],
      actions: [
        {
          id: 'B01-ying',
          intent: '以诚相告，直言愿扶幼主',
          stateMutationOwner: 'settlement',
          requiredRole: 'player-choice',
          carrier: { component: 'InkYingMo', event: 'ying' },
          effect: { target: 'var.trust', op: 'add', formulaId: 'trust_gain' },
          feedbackSpec: { kind: 'state-binding', component: 'StatusNotice', target: 'var.trust' },
          exit: { kind: 'beat', toBeatId: 'B02' },
          stateChange: '信任上升',
          immediateFeedback: '信任提示',
          downstreamPayoff: '刘备神色稍缓',
          exitIntent: '进入心理交锋',
        },
        {
          id: 'B01-mo',
          intent: '沉默不接，以退为进',
          stateMutationOwner: 'settlement',
          requiredRole: 'player-choice',
          carrier: { component: 'InkYingMo', event: 'mo' },
          effect: { target: 'var.trust', op: 'sub', formulaId: 'trust_loss' },
          exit: { kind: 'beat', toBeatId: 'B02' },
          stateChange: '信任下降',
          immediateFeedback: '信任提示',
          downstreamPayoff: '刘备眼底寒了一分',
          exitIntent: '进入心理交锋',
        },
      ],
      settlements: [
        {
          id: 'B01-ying-result',
          sourceActionId: 'B01-ying',
          trigger: 'at',
          triggerSpec: { type: 'at', ms: 900 },
          feedbackSpec: { kind: 'transient-component', component: 'StatusNotice' },
          source: '以诚相告的落句帧',
          intent: '应用信任上升',
          feedback: '提示信任上升',
          exitIntent: '进入心理交锋',
        },
        {
          id: 'B01-mo-result',
          sourceActionId: 'B01-mo',
          trigger: 'at',
          triggerSpec: { type: 'at', ms: 900 },
          feedbackSpec: { kind: 'transient-component', component: 'StatusNotice' },
          source: '沉默过后的抬眼帧',
          intent: '应用信任下降',
          feedback: '提示信任下降',
          exitIntent: '进入心理交锋',
        },
      ],
    },
    {
      id: 'B02',
      narrativeIntent: '心理交锋',
      staging: '殿内只剩君臣二人，镜头从榻前推到诸葛亮抬眼，空气里是药香。',
      playerInformation: ['刘备心力'],
      uiCapabilities: ['战斗指令'],
      actions: [{
        id: 'B02-ult',
        intent: '以命相誓，一句一句压过去',
        stateMutationOwner: 'settlement',
        requiredRole: 'combat-command',
        carrier: { component: 'BattleSkill', event: 'light' },
        effect: { target: 'var.liubeiWill', op: 'sub', formulaId: 'dmg_ult' },
        feedbackSpec: { kind: 'state-binding', component: 'BattleEnemyHpBar', target: 'var.liubeiWill' },
        exit: { kind: 'beat', toBeatId: 'B02' },
        stateChange: '刘备心力下降',
        immediateFeedback: '心力条下降并显示数值',
        downstreamPayoff: '刘备喘息渐重',
        exitIntent: '继续交锋',
      }],
      settlements: [
        {
          id: 'B02-ult-result',
          sourceActionId: 'B02-ult',
          trigger: 'at',
          triggerSpec: { type: 'at', ms: 900 },
          feedbackSpec: { kind: 'transient-component', component: 'DamageFloatText' },
          source: '以辞破之的命中帧',
          intent: '应用心力削减',
          feedback: '心力条下降并显示数值',
          exitIntent: '返回交锋回合',
        },
        {
          id: 'B02-will-terminal',
          trigger: 'state',
          triggerSpec: { type: 'state', condition: { all: [{ type: 'var', varId: 'liubeiWill', op: 'lte', value: 0 }] } },
          feedbackSpec: { kind: 'transient-component', component: 'StatusNotice' },
          source: 'liubeiWill',
          intent: '心力耗尽，刘备再说不出话',
          feedback: '提示刘备心力耗尽',
          exitIntent: '进入托孤之后',
          exit: { kind: 'beat', toBeatId: 'B03' },
        },
      ],
      loop: { progress: '每回合诸葛亮说一句，刘备心力下降一截', exitConditions: ['刘备心力归零'] },
    },
    {
      id: 'B03',
      narrativeIntent: '托孤之后',
      staging: '刘备的手垂下去，诸葛亮仍跪在榻前，殿外天光将亮。',
      playerInformation: ['君臣信任'],
      uiCapabilities: ['剧情选择'],
      actions: [
        {
          id: 'B03-ying',
          intent: '伏地长拜，应下托孤',
          stateMutationOwner: 'none',
          requiredRole: 'player-choice',
          carrier: { component: 'InkYingMo', event: 'ying' },
          exit: { kind: 'ending', endingId: 'ending-warm' },
          stateChange: '不改数值',
          immediateFeedback: '收起本拍界面',
          downstreamPayoff: '君臣相得的收束',
          exitIntent: '进入温暖结局',
        },
        {
          id: 'B03-mo',
          intent: '起身退出，什么都不说',
          stateMutationOwner: 'none',
          requiredRole: 'player-choice',
          carrier: { component: 'InkYingMo', event: 'mo' },
          exit: { kind: 'ending', endingId: 'ending-cold' },
          stateChange: '不改数值',
          immediateFeedback: '收起本拍界面',
          downstreamPayoff: '无言以对的收束',
          exitIntent: '进入苍凉结局',
        },
      ],
      settlements: [],
    },
  ],
})}
\`\`\`
`
    const result = compilePillar(parsePillarInteractionContract(markdown))
    expect(result.ok, result.ok ? '' : result.issues.map((issue) => issue.message).join('; ')).toBe(true)
    if (!result.ok) return
    const issues = inspectCompiledPlayability(result.document, markdown, { includeQualityStamps: true })
    expect(issues, issues.map((item) => `${item.code}: ${item.message}`).join('\n')).toEqual([])
  })
})
