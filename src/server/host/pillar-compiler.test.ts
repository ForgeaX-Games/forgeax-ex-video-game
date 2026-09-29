import { describe, expect, it } from 'vitest'
import type { PillarInteractionContract } from '@/authoring/documents/pillar-interaction-contract'
import { compilePillar } from './pillar-compiler'

/**
 * 编译器取代「证明器 + 下游 LLM 重画」这条链路。
 *
 * 旧结构里 Host 先用 probe 占位（`entity.probe.attr.value` / `ms: 1200` /
 * `StatusNotice`）证明「至少存在一种画法」，然后把那张画丢掉，让总脉络 peer
 * 重新画一张不同的——证明覆盖不到新画的那张，于是 node-10 那类死结要到几十分钟
 * 后才暴露。编译器把证明产物本身变成交付物，占位符全部由支柱 IR 的真值取代。
 */
const v4: PillarInteractionContract = {
  schemaVersion: 4,
  title: '草船借箭',
  cast: [
    { name: '诸葛亮', summary: '羽扇纶巾，从容调度' },
    { name: '鲁肃', summary: '随船观阵' },
  ],
  settings: [{ name: '长江雾夜', summary: '大雾锁江，草船隐没' }],
  variables: [{ id: 'arrowCount', initial: 0, max: 100000 }],
  formulas: [{ id: 'gain_arrows_heavy', expression: 'floor(20000 + var.stamina * 500)' }],
  endings: [{ id: 'ending-win', title: '十万齐备', when: 'var.arrowCount >= 100000', summary: '箭满归营' }],
  beats: [
    {
      id: 'B01',
      narrativeIntent: '雾夜受箭',
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
}

/** 回合制战斗：动作出口指回本节拍，系统结算负责在条件满足时离场。 */
const combatLoop: PillarInteractionContract = {
  ...v4,
  beats: [
    {
      ...v4.beats[0]!,
      actions: [{ ...v4.beats[0]!.actions[0]!, exit: { kind: 'beat', toBeatId: 'B01' } }],
      settlements: [
        v4.beats[0]!.settlements[0]!,
        {
          id: 'arrow-threshold',
          trigger: 'state',
          triggerSpec: {
            type: 'state',
            condition: { all: [{ type: 'var', varId: 'arrowCount', op: 'gte', value: 100000 }] },
          },
          feedbackSpec: { kind: 'transient-component', component: 'StatusNotice' },
          source: 'arrowCount',
          intent: '箭满离场',
          feedback: '箭支已足，下令撤退',
          exitIntent: '进入交箭交差',
          exit: { kind: 'beat', toBeatId: 'B02' },
        },
      ],
    },
    v4.beats[1]!,
  ],
}

function settledActionSpec(contract: PillarInteractionContract) {
  return compileOk(contract).plan.configurations
    .flatMap((configuration) => configuration.actions)
    .find((candidate) => candidate.pillarActionId === 'heavy')
    ?.feedbackSpec
}

function withActionFeedbackSpec(
  spec: NonNullable<PillarInteractionContract['beats'][number]['actions'][number]['feedbackSpec']>,
  effect?: PillarInteractionContract['beats'][number]['actions'][number]['effect'],
): PillarInteractionContract {
  return {
    ...v4,
    entities: [{ id: 'player', attrs: [{ id: 'hp', initial: 40, min: 0, max: 40 }] }],
    beats: [
      {
        ...v4.beats[0]!,
        actions: [{
          ...v4.beats[0]!.actions[0]!,
          ...(effect ? { effect } : {}),
          feedbackSpec: spec,
        }],
      },
      v4.beats[1]!,
    ],
  }
}

function compileOk(contract: PillarInteractionContract) {
  const result = compilePillar(contract)
  if (!result.ok) {
    throw new Error(`编译应当成功，实际失败：${result.issues.map((issue) => issue.message).join('; ')}`)
  }
  return result
}

describe('pillar compiler', () => {
  it('compiles a v4 contract into a committable blueprint document', () => {
    expect(compileOk(v4).document).toBeDefined()
  })

  it('carries the pillar effect through instead of the probe placeholder', () => {
    const action = compileOk(v4).plan.configurations
      .flatMap((configuration) => configuration.actions)
      .find((candidate) => candidate.pillarActionId === 'heavy')
    expect(action?.effect).toEqual({
      target: 'var.arrowCount',
      op: 'add',
      formulaId: 'gain_arrows_heavy',
    })
    expect(JSON.stringify(action)).not.toContain('probe')
  })

  it('carries the pillar triggerSpec through instead of the fixed 1200ms probe', () => {
    const resolution = compileOk(v4).plan.configurations
      .flatMap((configuration) => configuration.resolvesActions)
      .find((candidate) => candidate.pillarActionId === 'heavy')
    expect(resolution?.triggerSpec).toEqual({ type: 'at', ms: 900 })
  })

  // A settlement's feedback (damage float text) is not the source action's
  // feedback (lock/hide the interface). Before v4 the result node reused the
  // action's spec because the pillar had no way to state its own.
  it('carries the pillar settlement feedbackSpec instead of reusing the action spec', () => {
    const resolution = compileOk(v4).plan.configurations
      .flatMap((configuration) => configuration.resolvesActions)
      .find((candidate) => candidate.pillarActionId === 'heavy')
    expect(resolution?.feedbackSpec).toEqual({ kind: 'transient-component', component: 'GainFloatText' })
  })

  /**
   * 结果节点承接数值时，玩家看见的那一下就是配对结算弹出的飘字/提示——动作没有
   * 第二份独立反馈。支柱把它写成 state-binding 飘字时不能照抄：飘字只能 spawn，
   * 静态挂载会被 `ui.floattext.static-mount` 拦下。
   */
  it('stamps a settled action feedback from its paired settlement when the declared widget is spawn-only', () => {
    expect(settledActionSpec(withActionFeedbackSpec({
      kind: 'state-binding',
      component: 'StatusNotice',
      target: 'var.arrowCount',
    }))).toEqual({ kind: 'transient-component', component: 'GainFloatText' })
  })

  it('stamps a settled action feedback from its paired settlement when the pillar declared none', () => {
    const beat = v4.beats[0]!
    const { feedbackSpec: _dropped, ...action } = beat.actions[0]!
    expect(settledActionSpec({
      ...v4,
      beats: [{ ...beat, actions: [action] }, v4.beats[1]!],
    })).toEqual({ kind: 'transient-component', component: 'GainFloatText' })
  })

  // 血条是常驻控件：它能真的挂在结果节点上，所以作者的声明就是能兑现的那一份。
  it('keeps a persistent state-binding feedback the pillar declared on a settled action', () => {
    expect(settledActionSpec(withActionFeedbackSpec(
      { kind: 'state-binding', component: 'BattlePlayerHpBar', target: 'entity.player.attr.hp' },
      { target: 'entity.player.attr.hp', op: 'sub', value: 4 },
    ))).toEqual({
      kind: 'state-binding',
      component: 'BattlePlayerHpBar',
      target: 'entity.player.attr.hp',
    })
  })

  /**
   * 回合闭合的凭据是真实回边，而回边编译器一直都在连（结果节点 → 互动节点）；
   * 缺的只是 `loop.backTo` 这一章。没有它，战斗节点在审查里看起来没有回合。
   */
  it('stamps loop.backTo when an action exit routes back to its own beat', () => {
    const { document } = compileOk(combatLoop)
    const pack = document.manifest.packs[document.manifest.mainPackId]!
    const combat = pack.graph.nodes.find((node) => node.id === 'node-B01')

    expect(combat?.data.interaction?.loop?.backTo).toBe('node-B01')
    expect(pack.graph.edges.some((edge) => (
      edge.source === 'node-B01-result' && edge.target === 'node-B01'
    ))).toBe(true)
  })

  it('leaves loop.backTo off a beat whose actions all move forward', () => {
    const { document } = compileOk(v4)
    const combat = document.graph.nodes.find((node) => node.id === 'node-B01')

    expect(combat?.data.interaction?.loop).toBeUndefined()
  })

  // The 76-minute node-10 loop: a terminal chapter needs an outgoing edge, and
  // every candidate target created a cycle. An ending exit compiles to a
  // terminal node, so no edge is required and no cycle can exist.
  it('compiles an ending exit into a terminal node with no outgoing route', () => {
    const compiled = compileOk(v4)
    const endingNodeId = compiled.plan.endingNodeIds['ending-win']
    expect(endingNodeId).toBeDefined()
    const endingConfiguration = compiled.plan.configurations
      .find((configuration) => configuration.nodeId === endingNodeId)
    expect(endingConfiguration?.outgoingRoutes).toEqual([])
  })

  // A settlement-owned action lands on its same-beat result node first, and the
  // result node is what carries the pillar exit onward.
  it('routes a beat exit from the result node to the target beat node', () => {
    const compiled = compileOk(v4)
    const resultConfiguration = compiled.plan.configurations
      .find((configuration) => configuration.nodeId === 'node-B01-result')
    expect(resultConfiguration?.outgoingRoutes).toEqual([{
      id: 'edge-node-B01-result-exit-heavy',
      target: compiled.plan.beatNodeIds.B02,
      producer: { kind: 'settlement', ref: 'heavy-result' },
    }])
  })

  // Rules were a separate LLM activity (`rules.catalog`) re-deriving formulas
  // from prose. Numbers are design decisions, so v4 states them in the pillar
  // and the compiler emits the catalog straight into the document.
  it('compiles the pillar variables into the document rule catalog', () => {
    const { document } = compileOk(v4)
    expect(document.variables?.arrowCount).toMatchObject({ id: 'arrowCount', initial: 0, max: 100000 })
  })

  it('compiles the pillar formula expression into a persisted formula AST', () => {
    const { document } = compileOk(v4)
    const formula = document.formulas?.gain_arrows_heavy as { id: string; ast: unknown } | undefined
    expect(formula?.id).toBe('gain_arrows_heavy')
    expect(formula?.ast).toBeDefined()
  })

  it('compiles declared rule entities into the document catalog', () => {
    const { document } = compileOk({
      ...v4,
      entities: [{
        id: 'player',
        label: '诸葛亮',
        attrs: [{ id: 'hp', label: '心力', initial: 40, min: 0, max: 40 }],
      }],
    })
    expect(document.entities?.player).toMatchObject({
      id: 'player',
      name: '诸葛亮',
      attrs: { hp: 40 },
      attrMeta: { hp: { label: '心力', initial: 40, min: 0, max: 40 } },
    })
  })

  it('compiles an entity attr effect instead of dropping it', () => {
    const { document } = compileOk({
      ...v4,
      entities: [{
        id: 'player',
        attrs: [{ id: 'hp', initial: 40, min: 0, max: 40 }],
      }],
      beats: [
        {
          ...v4.beats[0]!,
          actions: [{
            ...v4.beats[0]!.actions[0]!,
            effect: { target: 'entity.player.attr.hp', op: 'sub', formulaId: 'gain_arrows_heavy' },
            feedbackSpec: { kind: 'state-binding', component: 'BattlePlayerHpBar', target: 'entity.player.attr.hp' },
          }],
        },
        v4.beats[1]!,
      ],
    })
    const resultNode = document.graph.nodes.find((node) => node.id === 'node-B01-result')
    const settlement = (resultNode?.data.reactions ?? []).find((reaction) => reaction.when.type === 'at')
    expect(settlement?.do).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'effect',
        effects: expect.arrayContaining([
          expect.objectContaining({
            kind: 'attr',
            entityId: 'player',
            attr: 'hp',
          }),
        ]),
      }),
    ]))
  })

  it('names the compiled pack after the pillar title', () => {
    const compiled = compileOk(v4)
    expect(compiled.document.manifest.packs['bp-main']?.title).toBe('草船借箭')
  })

  it('drops an ending that no action routes to, instead of leaving a floating node', () => {
    const compiled = compileOk({
      ...v4,
      endings: [
        ...(v4.endings ?? []),
        { id: 'ending-orphan', title: '打虎英雄', summary: '没有出口指向这里' },
      ],
    })
    expect(compiled.document.graph.nodes.some((node) => node.data.name === '打虎英雄')).toBe(false)
    expect(compiled.plan.endingNodeIds['ending-orphan']).toBeUndefined()
    expect(compiled.document.graph.nodes.some((node) => node.data.name === '十万齐备')).toBe(true)
  })

  it('stamps a cinematic video prompt and story text onto every compiled node', () => {
    const compiled = compileOk(v4)
    for (const node of compiled.document.graph.nodes) {
      expect(node.data.storyText?.trim().length).toBeGreaterThan(0)
      expect(node.data.media?.kind).toBe('video')
      expect((node.data.media as { prompt?: string } | undefined)?.prompt?.length).toBeGreaterThan(20)
      expect((node.data.media as { prompt?: string } | undefined)?.prompt).not.toBe(node.data.name)
      expect((node.data.media as { prompt?: string } | undefined)?.prompt).not.toBe(node.data.chapterSummary)
    }
  })

  it('names blueprint chapters after the story beat, not the beat id', () => {
    const compiled = compileOk(v4)
    const interactive = compiled.document.graph.nodes.find((node) => node.id === compiled.plan.beatNodeIds.B01)
    const result = compiled.document.graph.nodes.find((node) => node.id === 'node-B01-result')
    const pass = compiled.document.graph.nodes.find((node) => node.id === compiled.plan.beatNodeIds.B02)
    expect(interactive?.data.name).toBe('雾夜受箭')
    expect(result?.data.name).toBe('雾夜受箭 · 聚船受箭')
    expect(pass?.data.name).toBe('交箭交差')
  })

  it('binds pillar cast and settings onto every compiled chapter so previews have targets', () => {
    const compiled = compileOk(v4)
    const interactive = compiled.document.graph.nodes.find((node) => node.id === compiled.plan.beatNodeIds.B01)
    expect(interactive?.data.cast).toEqual([
      { characterId: 'character-1', role: 'primary', onScreen: true },
      { characterId: 'character-2', role: 'supporting', onScreen: true },
    ])
    expect(interactive?.data.scenes).toEqual([
      { sceneId: 'scene-1', role: 'primary', useAsVideoReference: true },
    ])
  })

  it('does not invent a result node for a pass beat that mutates nothing', () => {
    const compiled = compileOk(v4)
    expect(compiled.document.graph.nodes.some((node) => node.id.includes('handover-result'))).toBe(false)
  })

  it('rejects a formula expression the authoring parser cannot read', () => {
    const broken: PillarInteractionContract = {
      ...v4,
      formulas: [{ id: 'gain_arrows_heavy', expression: 'floor(20000 +' }],
    }
    const result = compilePillar(broken)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((issue) => issue.message).join(' ')).toMatch(/gain_arrows_heavy/u)
  })

  // The prover swallowed its own exceptions (`catch { return [] }`) so a bug in
  // the prover silently passed an unbuildable pillar. A compiler must never
  // fail open: a throw is a compile failure, not an approval.
  it('fails closed when a beat exit points at a beat that was never declared', () => {
    const dangling: PillarInteractionContract = {
      ...v4,
      beats: [
        { ...v4.beats[0]!, actions: [{ ...v4.beats[0]!.actions[0]!, exit: { kind: 'beat', toBeatId: 'B99' } }] },
        v4.beats[1]!,
      ],
    }
    const result = compilePillar(dangling)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((issue) => issue.message).join(' ')).toMatch(/B99/u)
  })

  // A declared capability gap is the author saying "the catalog cannot carry
  // this". Quietly falling back to the default role would compile a game that
  // is not the one they designed.
  it('refuses to compile an action that declared a capability gap', () => {
    const unsupported: PillarInteractionContract = {
      ...v4,
      beats: [
        {
          ...v4.beats[0]!,
          actions: [{
            ...v4.beats[0]!.actions[0]!,
            requiredRole: undefined,
            capabilityGap: { need: '拖动排序输入', why: '目录没有拖拽控件' },
          }],
        },
        v4.beats[1]!,
      ],
    }
    const result = compilePillar(unsupported)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]?.code).toBe('document.pillar.role-unsupported')
  })

  it('compiles a short 10-beat pillar when pass beats were written before branches', () => {
    const pass = (id: string, intent: string): PillarInteractionContract['beats'][number] => ({
      id,
      narrativeIntent: intent,
      playerInformation: [intent],
      uiCapabilities: ['player-choice'],
      actions: [{
        id: `${id}-continue`,
        intent,
        stateMutationOwner: 'none',
        requiredRole: 'player-choice',
        stateChange: intent,
        immediateFeedback: intent,
        downstreamPayoff: intent,
        exitIntent: intent,
      }],
      settlements: [],
    })
    const noneAction = (
      id: string,
      intent: string,
      toBeatId: string,
    ): PillarInteractionContract['beats'][number]['actions'][number] => ({
      id,
      intent,
      stateMutationOwner: 'none',
      requiredRole: 'player-choice',
      exit: { kind: 'beat', toBeatId },
      stateChange: intent,
      immediateFeedback: intent,
      downstreamPayoff: intent,
      exitIntent: intent,
    })
    const shuffled: PillarInteractionContract = {
      schemaVersion: 4,
      title: '草船借箭 · 三日赌局',
      cast: [{ name: '诸葛亮', summary: '羽扇纶巾，从容调度草船受箭' }],
      settings: [{ name: '长江雾夜', summary: '大雾锁江，草船隐没在火光里' }],
      variables: [{ id: 'arrow_count', initial: 0, min: 0, max: 100000 }],
      entities: [{ id: 'fleet', attrs: [{ id: 'hp', initial: 50 }] }],
      formulas: [{ id: 'arrow_gain', expression: 'randInt(30000, 50000)' }],
      endings: [
        { id: 'ending-main', title: '雾满载归', summary: '满载十万箭回营交差' },
        { id: 'ending-fail', title: '功亏一篑', when: 'var.arrow_count < 100000', summary: '未能取回足够箭矢' },
      ],
      beats: [
        pass('B01', '立状'),
        pass('B03', '鲁肃探营'),
        pass('B04', '夜观天象'),
        pass('B05', '布设草船'),
        pass('B06', '第二日将尽'),
        pass('B09', '满载而归'),
        {
          id: 'B02',
          narrativeIntent: '第一日抉择',
          playerInformation: ['第一日抉择'],
          uiCapabilities: ['player-choice'],
          actions: [
            noneAction('B02-ying', '登高观天象', 'B03'),
            noneAction('B02-mo', '勘察江面', 'B04'),
          ],
          settlements: [],
        },
        {
          id: 'B07',
          narrativeIntent: '出发时机抉择',
          playerInformation: ['出发时机抉择'],
          uiCapabilities: ['player-choice'],
          actions: [
            noneAction('B07-ying', '立即出发', 'B08'),
            noneAction('B07-mo', '再等半个时辰', 'B06'),
          ],
          settlements: [],
        },
        {
          id: 'B08',
          narrativeIntent: '雾中行船',
          playerInformation: ['雾中行船'],
          uiCapabilities: ['combat-command'],
          actions: [{
            id: 'B08-light',
            intent: '稳紮收箭',
            stateMutationOwner: 'settlement',
            requiredRole: 'combat-command',
            effect: { target: 'var.arrow_count', op: 'add', formulaId: 'arrow_gain' },
            feedbackSpec: { kind: 'transient-component', component: 'GainFloatText' },
            exit: { kind: 'beat', toBeatId: 'B08' },
            stateChange: '收箭',
            immediateFeedback: '收箭飘字',
            downstreamPayoff: '箭数上升',
            exitIntent: '返回战斗回合',
          }, {
            id: 'B08-heavy',
            intent: '冒险逼近',
            stateMutationOwner: 'settlement',
            requiredRole: 'combat-command',
            effect: { target: 'entity.fleet.attr.hp', op: 'add', value: -10 },
            feedbackSpec: { kind: 'state-binding', component: 'BattlePlayerHpBar', target: 'entity.fleet.attr.hp' },
            exit: { kind: 'beat', toBeatId: 'B08' },
            stateChange: '船队受损',
            immediateFeedback: '血条下降',
            downstreamPayoff: '耐久下降',
            exitIntent: '返回战斗回合',
          }],
          settlements: [
            {
              id: 'B08-light-result',
              sourceActionId: 'B08-light',
              trigger: 'at',
              triggerSpec: { type: 'at', ms: 800 },
              feedbackSpec: { kind: 'transient-component', component: 'GainFloatText' },
              source: '轻击命中帧',
              intent: '轻击收箭结算',
              feedback: '显示收箭飘字',
              exitIntent: '返回战斗回合',
            },
            {
              id: 'B08-heavy-result',
              sourceActionId: 'B08-heavy',
              trigger: 'at',
              triggerSpec: { type: 'at', ms: 800 },
              feedbackSpec: { kind: 'transient-component', component: 'DamageFloatText' },
              source: '重击命中帧',
              intent: '重击受损结算',
              feedback: '显示船队受损',
              exitIntent: '返回战斗回合',
            },
            {
              id: 'B08-win',
              trigger: 'state',
              triggerSpec: { type: 'state', condition: { all: [{ type: 'var', varId: 'arrow_count', op: 'gte', value: 100000 }] } },
              feedbackSpec: { kind: 'transient-component', component: 'StatusNotice' },
              source: 'arrow_count',
              intent: '收箭满十万获胜',
              feedback: '收箭完成提示',
              exitIntent: '进入满载而归',
            },
            {
              id: 'B08-lose',
              trigger: 'state',
              triggerSpec: { type: 'state', condition: { all: [{ type: 'entity', entityId: 'fleet', attr: 'hp', op: 'lte', value: 0 }] } },
              feedbackSpec: { kind: 'transient-component', component: 'StatusNotice' },
              source: 'fleet.hp',
              intent: '船队耐久归零失败',
              feedback: '船队沉没提示',
              exitIntent: '进入失败结局',
            },
          ],
          loop: {
            progress: '每回合草船收取箭矢',
            exitConditions: ['var.arrow_count >= 100000', 'entity.fleet.attr.hp <= 0'],
          },
        },
        {
          ...pass('B10', '复命交差'),
          actions: [{
            id: 'B10-continue',
            intent: '呈上十万箭交差',
            stateMutationOwner: 'none',
            requiredRole: 'player-choice',
            exit: { kind: 'ending', endingId: 'ending-main' },
            stateChange: '交差',
            immediateFeedback: '交差',
            downstreamPayoff: '交差',
            exitIntent: '进入主线结局',
          }],
        },
      ],
    }
    const compiled = compilePillar(shuffled)
    expect(compiled.ok, compiled.ok ? '' : compiled.issues.map((issue) => issue.message).join('; ')).toBe(true)
    if (!compiled.ok) return
    expect(compiled.plan.beatNodeIds.B07).toBe('node-B07')
    expect(compiled.plan.beatNodeIds.B09).toBe('node-B09')
    expect(compiled.plan.beatNodeIds.B10).toBe('node-B10')
    expect(compiled.plan.endingNodeIds['ending-fail']).toBeDefined()
  })
})
