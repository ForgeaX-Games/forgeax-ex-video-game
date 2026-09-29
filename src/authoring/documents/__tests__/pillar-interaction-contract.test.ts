import { describe, expect, test } from 'vitest'
import {
  collectPillarInteractionContractIssues,
  parsePillarInteractionContract,
  type PillarInteractionContract,
} from '../pillar-interaction-contract'

const valid = `
## 互动节拍

\`\`\`pillar-interaction-contract
{"schemaVersion":2,"beats":[{"id":"B01","narrativeIntent":"识破猛虎扑击","playerInformation":["猛虎正在蓄力","我方当前生命"],"uiCapabilities":["生命反馈","防反输入"],"actions":[{"id":"parry","intent":"在窗口内防反","stateMutationOwner":"settlement","stateChange":"成功时降低敌方生命","immediateFeedback":"血条下降并显示伤害","downstreamPayoff":"下游播放反击命中","exitIntent":"进入反击结果"}],"settlements":[{"id":"parry-result","sourceActionId":"parry","trigger":"at","source":"反击结果视频命中帧","intent":"应用防反伤害","feedback":"血条下降并显示伤害","exitIntent":"继续结果演出"},{"id":"defeat","trigger":"state","source":"player.hp <= 0","intent":"判定失败","feedback":"冻结输入并显示生命归零","exitIntent":"进入失败结局"}],"loop":{"progress":"每回合消耗双方资源","exitConditions":["敌方生命归零","玩家生命归零"]}}]}
\`\`\`
`

describe('pillar interaction contract', () => {
  test('parses a complete cross-domain beat contract', () => {
    expect(parsePillarInteractionContract(valid).beats[0]).toMatchObject({
      id: 'B01',
      actions: [{ id: 'parry', stateMutationOwner: 'settlement' }],
      settlements: [
        { id: 'parry-result', sourceActionId: 'parry', trigger: 'at' },
        { id: 'defeat', trigger: 'state' },
      ],
    })
  })

  test('rejects a beat without feedback-producing actions or settlements', () => {
    expect(() => parsePillarInteractionContract(
      '```pillar-interaction-contract\n{"schemaVersion":1,"beats":[{"id":"B01","narrativeIntent":"x","playerInformation":["x"],"uiCapabilities":["x"],"actions":[],"settlements":[]}]}\n```',
    )).toThrow(/至少需要一个玩家动作或系统结算/u)
  })

  test('rejects duplicate action and settlement ids inside one beat', () => {
    expect(() => parsePillarInteractionContract(valid.replace('"id":"defeat"', '"id":"parry"')))
      .toThrow(/动作\/结算 ID 重复/u)
  })

  test('rejects an action-resolution settlement pointing to an unknown action', () => {
    expect(() => parsePillarInteractionContract(valid.replace('"sourceActionId":"parry"', '"sourceActionId":"missing"')))
      .toThrow(/sourceActionId 未命中同一节拍动作/u)
  })

  test('merges every canonical contract block instead of silently dropping later beats', () => {
    const secondBeat = {
      schemaVersion: 3,
      beats: [{
        id: 'B07',
        narrativeIntent: '进入战斗回合',
        playerInformation: ['双方生命'],
        uiCapabilities: ['战斗技能'],
        actions: [{
          id: 'light-attack',
          intent: '轻击',
          stateMutationOwner: 'settlement',
          requiredRole: 'combat-command',
          stateChange: '敌方生命下降',
          immediateFeedback: '显示伤害',
          downstreamPayoff: '进入轻击结果',
          exitIntent: '进入结果节点',
        }],
        settlements: [{
          id: 'light-result',
          sourceActionId: 'light-attack',
          trigger: 'at',
          source: '轻击命中帧',
          intent: '结算伤害',
          feedback: '敌方生命下降',
          exitIntent: '继续战斗',
        }],
      }],
    }
    const source = valid
      .replace('"schemaVersion":2', '"schemaVersion":3')
      .replace('"id":"parry","intent"', '"id":"parry","requiredRole":"timed-input","intent"')
    const merged = `${source}\n\n` + '```pillar-interaction-contract\n'
      + JSON.stringify(secondBeat) + '\n```'

    expect(parsePillarInteractionContract(merged)).toMatchObject({
      schemaVersion: 3,
      beats: [
        { id: 'B01' },
        { id: 'B07', actions: [{ id: 'light-attack', requiredRole: 'combat-command' }] },
      ],
    })
  })

  test('rejects contract blocks with inconsistent schema versions', () => {
    const second = valid.replace('"schemaVersion":2', '"schemaVersion":3')
    expect(() => parsePillarInteractionContract(`${valid}\n${second}`))
      .toThrow(/schemaVersion 在多个契约块之间必须一致/u)
  })

  test('keeps legacy v1 contracts readable while v2 requires an explicit mutation owner', () => {
    const legacy = valid.replace('"schemaVersion":2', '"schemaVersion":1').replace(',"stateMutationOwner":"settlement"', '')
    expect(parsePillarInteractionContract(legacy).schemaVersion).toBe(1)
    expect(() => parsePillarInteractionContract(valid.replace(',"stateMutationOwner":"settlement"', '')))
      .toThrow(/stateMutationOwner 必须是 none\/settlement/u)
  })

  // Regression (bug 01a0666a): the parser used to throw on the FIRST error,
  // so the Host could only feed back one contract problem at a time and the
  // peer re-submitted the whole pillar once per fix — 17 tool calls for one
  // document. The collect entry point must surface every issue in a single pass.
  test('collects every contract issue in one pass instead of stopping at the first', () => {
    const broken = `
\`\`\`pillar-interaction-contract
{"schemaVersion":2,"beats":[
  {"id":"B01","narrativeIntent":"x","playerInformation":["x"],"uiCapabilities":["x"],
   "actions":[{"id":"a1","intent":"x","stateChange":"x","immediateFeedback":"x","downstreamPayoff":"x","exitIntent":"x"}],
   "settlements":[]},
  {"id":"B02","narrativeIntent":"x","playerInformation":["x"],"uiCapabilities":["x"],
   "actions":[{"id":"a2","intent":"x","stateChange":"x","immediateFeedback":"x","downstreamPayoff":"x","exitIntent":"x"}],
   "settlements":[]}
]}
\`\`\`
`
    const issues = collectPillarInteractionContractIssues(broken)
    expect(issues).toHaveLength(4)
    expect(issues.filter((message) => message.includes('stateMutationOwner 必须是 none/settlement'))).toHaveLength(2)
    expect(issues.filter((message) => message.includes('至少需要一个玩家动作或系统结算'))).toHaveLength(2)
  })

  test('returns an empty issue list for a valid contract', () => {
    expect(collectPillarInteractionContractIssues(valid)).toEqual([])
  })
})

const v3 = valid
  .replace('"schemaVersion":2', '"schemaVersion":3')
  .replace('"id":"parry","intent"', '"id":"parry","requiredRole":"timed-input","intent"')

describe('pillar capability contract v3', () => {
  test('accepts an action that declares the input role its carrier must have', () => {
    expect(parsePillarInteractionContract(v3).beats[0]?.actions[0]).toMatchObject({
      id: 'parry',
      requiredRole: 'timed-input',
    })
  })

  test('accepts an action that admits a capability gap instead of a role', () => {
    const gap = v3.replace(
      '"requiredRole":"timed-input"',
      '"capabilityGap":{"need":"拖动排序输入","why":"目录没有任何拖拽类控件"}',
    )
    expect(parsePillarInteractionContract(gap).beats[0]?.actions[0]).toMatchObject({
      capabilityGap: { need: '拖动排序输入', why: '目录没有任何拖拽类控件' },
    })
  })

  test('rejects an action that declares neither a role nor a gap', () => {
    expect(() => parsePillarInteractionContract(v3.replace('"requiredRole":"timed-input",', '')))
      .toThrow(/必须声明 requiredRole 或 capabilityGap/u)
  })

  test('rejects an action that declares both a role and a gap', () => {
    const both = v3.replace(
      '"requiredRole":"timed-input"',
      '"requiredRole":"timed-input","capabilityGap":{"need":"x","why":"y"}',
    )
    expect(() => parsePillarInteractionContract(both)).toThrow(/不能同时声明 requiredRole 和 capabilityGap/u)
  })

  test('rejects an output role, because an action is always a player input', () => {
    expect(() => parsePillarInteractionContract(v3.replace('"timed-input"', '"state-feedback"')))
      .toThrow(/requiredRole 必须是 player-choice\/combat-command\/timed-input/u)
  })

  test('treats uiCapabilities as optional now that requiredRole carries the signal', () => {
    const without = v3.replace('"uiCapabilities":["生命反馈","防反输入"],', '')
    expect(parsePillarInteractionContract(without).beats[0]?.uiCapabilities).toEqual([])
  })

  // v2 gated these on `schemaVersion === 2`; v3 must inherit them rather than
  // silently loosening as the version advances.
  test('still enforces the mutation owner rules inherited from v2', () => {
    expect(() => parsePillarInteractionContract(v3.replace(',"stateMutationOwner":"settlement"', '')))
      .toThrow(/stateMutationOwner 必须是 none\/settlement/u)
    expect(() => parsePillarInteractionContract(v3.replace('"sourceActionId":"parry",', '')))
      .toThrow(/没有 sourceActionId 配对结算/u)
  })

  test('rejects a narrative-only action that still carries a paired settlement', () => {
    expect(() => parsePillarInteractionContract(valid.replace('"stateMutationOwner":"settlement"', '"stateMutationOwner":"none"')))
      .toThrow(/纯剧情分流.*却带了 sourceActionId 配对结算/u)
  })

  test('rejects a payoff that points the result at the next chapter', () => {
    expect(() => parsePillarInteractionContract(valid.replace('下游播放反击命中', '在下一幕呈现反击命中')))
      .toThrow(/结果节点必须与源动作同 beatId/u)
  })

  test('allows a later-scene narrative payoff that is not a next-chapter pointer', () => {
    expect(parsePillarInteractionContract(valid.replace('下游播放反击命中', '鲁肃后续更愿配合')).beats[0]?.actions[0]?.downstreamPayoff)
      .toBe('鲁肃后续更愿配合')
  })
})

// v4 turns the pillar from a half-prose document into a fully compilable IR.
// Every field the downstream compiler used to fake with a probe placeholder
// (effect / triggerSpec / feedbackSpec / carrier / exit) must now come from the
// pillar itself, so the blueprint is derived rather than re-invented.
const v4Contract: PillarInteractionContract = {
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
        carrier: { component: 'BattleSkill', event: 'heavy' },
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
        triggerSpec: { type: 'at', ms: 1200 },
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
        carrier: { component: 'InkYingMo', event: 'ying' },
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

function v4(mutate: (draft: PillarInteractionContract) => void = () => {}): string {
  const draft = JSON.parse(JSON.stringify(v4Contract)) as PillarInteractionContract
  mutate(draft)
  return `\`\`\`pillar-interaction-contract\n${JSON.stringify(draft)}\n\`\`\``
}

describe('pillar compilable IR v4', () => {
  test('parses carrier, effect, feedbackSpec, triggerSpec and exit as structured values', () => {
    const contract = parsePillarInteractionContract(v4())
    expect(contract.schemaVersion).toBe(4)
    expect(contract.beats[0]?.actions[0]).toMatchObject({
      carrier: { component: 'BattleSkill', event: 'heavy' },
      effect: { target: 'var.arrowCount', op: 'add', formulaId: 'gain_arrows_heavy' },
      feedbackSpec: { kind: 'hide-interface' },
      exit: { kind: 'beat', toBeatId: 'B02' },
    })
    expect(contract.beats[0]?.settlements[0]).toMatchObject({
      triggerSpec: { type: 'at', ms: 1200 },
      feedbackSpec: { kind: 'transient-component', component: 'GainFloatText' },
    })
  })

  test('carries variables, formulas and endings on the contract root', () => {
    const contract = parsePillarInteractionContract(v4())
    expect(contract.variables).toEqual([{ id: 'arrowCount', initial: 0, max: 100000 }])
    expect(contract.formulas).toEqual([
      { id: 'gain_arrows_heavy', expression: 'floor(20000 + var.stamina * 500)' },
    ])
    expect(contract.endings).toEqual([
      { id: 'ending-win', title: '十万齐备', when: 'var.arrowCount >= 100000', summary: '箭满归营' },
    ])
  })

  // The 76-minute node-10 loop: the pillar said `exitIntent: "终局结束"`, and the
  // outline had to invent an outgoing edge for a terminal node — every target
  // created a cycle. An ending is a first-class exit, so the cycle cannot exist.
  test('lets a terminal action exit to an ending instead of another node', () => {
    expect(parsePillarInteractionContract(v4()).beats[1]?.actions[0]?.exit)
      .toEqual({ kind: 'ending', endingId: 'ending-win' })
  })

  test('rejects an exit pointing at an unknown ending', () => {
    expect(() => parsePillarInteractionContract(v4((draft) => {
      draft.beats[1]!.actions[0]!.exit = { kind: 'ending', endingId: 'ending-missing' }
    }))).toThrow(/exit\.endingId 未命中 endings：ending-missing/u)
  })

  test('rejects an exit pointing at an unknown beat', () => {
    expect(() => parsePillarInteractionContract(v4((draft) => {
      draft.beats[0]!.actions[0]!.exit = { kind: 'beat', toBeatId: 'B09' }
    }))).toThrow(/exit\.toBeatId 未命中节拍：B09/u)
  })

  test('fills a missing v4 action exit to the next beat', () => {
    const contract = parsePillarInteractionContract(v4((draft) => {
      delete (draft.beats[0]!.actions[0] as unknown as Record<string, unknown>).exit
    }))
    expect(contract.beats[0]?.actions[0]?.exit).toEqual({ kind: 'beat', toBeatId: 'B02' })
  })

  test('fills a combat loop when the peer omitted it', () => {
    expect(parsePillarInteractionContract(v4()).beats[0]?.loop).toEqual({
      progress: '每回合消耗双方生命',
      exitConditions: ['敌方生命归零', '玩家生命归零'],
    })
  })

  test('rejects a branch whose choices collapse to the same exit and effect', () => {
    expect(() => parsePillarInteractionContract(v4((draft) => {
      const first = draft.beats[0]!.actions[0]!
      draft.beats[0]!.actions = [
        { ...first, id: 'ying', intent: '接下', exit: { kind: 'beat', toBeatId: 'B02' } },
        { ...first, id: 'mo', intent: '沉默', exit: { kind: 'beat', toBeatId: 'B02' } },
      ]
      draft.beats[0]!.settlements = [
        { ...draft.beats[0]!.settlements[0]!, id: 'ying-result', sourceActionId: 'ying' },
        { ...draft.beats[0]!.settlements[0]!, id: 'mo-result', sourceActionId: 'mo' },
      ]
    }))).toThrow(/出口相同且数值后果无差异/u)
  })

  test('accepts a branch that shares an exit but applies opposite effects', () => {
    const contract = parsePillarInteractionContract(v4((draft) => {
      draft.variables!.push({ id: 'trust', initial: 3, min: 0, max: 10 })
      const first = draft.beats[0]!.actions[0]!
      draft.beats[0]!.actions = [
        {
          ...first,
          id: 'ying',
          intent: '接下',
          requiredRole: 'player-choice',
          effect: { target: 'var.trust', op: 'sub', value: 1 },
          exit: { kind: 'beat', toBeatId: 'B02' },
        },
        {
          ...first,
          id: 'mo',
          intent: '沉默',
          requiredRole: 'player-choice',
          effect: { target: 'var.trust', op: 'add', value: 2 },
          exit: { kind: 'beat', toBeatId: 'B02' },
        },
      ]
      draft.beats[0]!.settlements = [
        { ...draft.beats[0]!.settlements[0]!, id: 'ying-result', sourceActionId: 'ying' },
        { ...draft.beats[0]!.settlements[0]!, id: 'mo-result', sourceActionId: 'mo' },
      ]
    }))
    expect(contract.beats[0]?.actions).toHaveLength(2)
  })

  test('fills a missing settlement-owned effect so compact pillars still compile', () => {
    const contract = parsePillarInteractionContract(v4((draft) => {
      delete (draft.beats[0]!.actions[0] as unknown as Record<string, unknown>).effect
    }))
    expect(contract.beats[0]?.actions[0]?.effect).toEqual({
      target: 'var.arrowCount',
      op: 'sub',
      value: 20,
    })
  })

  test('fills a missing settlement triggerSpec', () => {
    const contract = parsePillarInteractionContract(v4((draft) => {
      delete (draft.beats[0]!.settlements[0] as unknown as Record<string, unknown>).triggerSpec
    }))
    expect(contract.beats[0]?.settlements[0]?.triggerSpec).toEqual({ type: 'at', ms: 900 })
  })

  test('rejects an effect whose formulaId is not defined on the contract', () => {
    expect(() => parsePillarInteractionContract(v4((draft) => {
      const action = draft.beats[0]!.actions[0]! as { effect: { formulaId: string } }
      action.effect.formulaId = 'gain_unknown'
    }))).toThrow(/effect\.formulaId 未命中 formulas：gain_unknown/u)
  })

  test('rejects a formula that calls a function the runtime does not support', () => {
    expect(() => parsePillarInteractionContract(v4((draft) => {
      draft.formulas![0]!.expression = 'sqrt(var.stamina)'
    }))).toThrow(/不支持的函数 sqrt/u)
  })

  test('rejects a variable id the runtime cannot address', () => {
    expect(() => parsePillarInteractionContract(v4((draft) => {
      draft.variables![0]!.id = '9arrows'
    }))).toThrow(/variables\[0\]\.id 格式无效：9arrows/u)
  })

  test('rejects a v4 beat whose staging is too thin for downstream video prompts', () => {
    expect(() => parsePillarInteractionContract(v4((draft) => {
      draft.beats[0]!.staging = '过场'
    }))).toThrow(/staging 太短/u)
  })

  test('rejects a v4 cast entry whose summary is only a job title', () => {
    expect(() => parsePillarInteractionContract(v4((draft) => {
      (draft as { cast?: Array<{ name: string; summary: string }> }).cast = [
        { name: '诸葛亮', summary: '军师' },
      ]
    }))).toThrow(/summary 太短/u)
  })

  test('parses declared rule entities and accepts entity attr effect targets', () => {
    const contract = parsePillarInteractionContract(v4((draft) => {
      (draft as { entities?: unknown }).entities = [{
        id: 'player',
        label: '诸葛亮',
        attrs: [{ id: 'hp', label: '心力', initial: 40, min: 0, max: 40 }],
      }]
      const action = draft.beats[0]!.actions[0]! as {
        effect: { target: string; op: string; formulaId?: string; value?: number }
        feedbackSpec: { kind: string; component?: string; target?: string }
      }
      action.effect = { target: 'entity.player.attr.hp', op: 'sub', value: 8 }
      action.feedbackSpec = { kind: 'state-binding', component: 'BattlePlayerHpBar', target: 'entity.player.attr.hp' }
    }))
    expect(contract.entities).toEqual([{
      id: 'player',
      label: '诸葛亮',
      attrs: [{ id: 'hp', label: '心力', initial: 40, min: 0, max: 40 }],
    }])
    expect(contract.beats[0]?.actions[0]?.effect?.target).toBe('entity.player.attr.hp')
  })

  test('rejects an effect that targets an undeclared entity', () => {
    expect(() => parsePillarInteractionContract(v4((draft) => {
      const action = draft.beats[0]!.actions[0]! as { effect: { target: string } }
      action.effect.target = 'entity.missing.attr.hp'
    }))).toThrow(/未命中 entities：missing/u)
  })

  test('rejects mounting the same overlay component as both input and HUD', () => {
    expect(() => parsePillarInteractionContract(v4((draft) => {
      const action = draft.beats[0]!.actions[0]! as {
        carrier: { component: string; event: string }
        feedbackSpec: { kind: string; component?: string; target?: string }
      }
      action.carrier = { component: 'BattleSkill', event: 'heavy' }
      action.feedbackSpec = { kind: 'state-binding', component: 'BattleSkill', target: 'var.arrowCount' }
    }))).toThrow(/重复使用覆盖物组件 BattleSkill/u)
  })

  test('allows a declared duplicate overlay when the beat opts in', () => {
    expect(parsePillarInteractionContract(v4((draft) => {
      (draft.beats[0] as { allowDuplicateOverlays?: boolean }).allowDuplicateOverlays = true
      const action = draft.beats[0]!.actions[0]! as {
        carrier: { component: string; event: string }
        feedbackSpec: { kind: string; component?: string; target?: string }
      }
      action.carrier = { component: 'BattleSkill', event: 'heavy' }
      action.feedbackSpec = { kind: 'state-binding', component: 'BattleSkill', target: 'var.arrowCount' }
    })).beats[0]?.allowDuplicateOverlays).toBe(true)
  })

  test('authoring patches default schemaVersion to 4 so a single ending beat can merge', () => {
    const patch = '```pillar-interaction-contract\n'
      + JSON.stringify({
        beats: [{
          id: 'B10',
          narrativeIntent: '满载归营',
          staging: '晨雾散开，草船满载箭矢靠岸，鲁肃在渡口翘首，诸葛亮收扇一礼。',
          actions: [{
            id: 'B10-close',
            intent: '复命交差',
            stateMutationOwner: 'none',
            requiredRole: 'player-choice',
            exit: { kind: 'ending', endingId: 'ending-main' },
          }],
        }],
      })
      + '\n```'
    expect(parsePillarInteractionContract(patch, { authoring: true })).toMatchObject({
      schemaVersion: 4,
      beats: [{ id: 'B10' }],
    })
  })

  test('authoring patches ignore blank settlement prose and blank loop conditions', () => {
    const patch = '```pillar-interaction-contract\n'
      + JSON.stringify({
        beats: [{
          id: 'B10',
          narrativeIntent: '满载归营',
          staging: '晨雾散开，草船满载箭矢靠岸，鲁肃在渡口翘首，诸葛亮收扇一礼。',
          actions: [{
            id: 'B10-close',
            intent: '复命交差',
            stateMutationOwner: 'none',
            requiredRole: 'player-choice',
            exit: { kind: 'ending', endingId: 'ending-main' },
          }],
          settlements: [{
            id: 'B10-win',
            trigger: 'state',
            source: '',
            intent: '',
            feedback: '',
            exitIntent: '',
          }],
          loop: { progress: '收束', exitConditions: ['箭矢交齐', ''] },
        }],
      })
      + '\n```'
    const contract = parsePillarInteractionContract(patch, { authoring: true })
    expect(contract.beats[0]?.id).toBe('B10')
    expect(contract.beats[0]?.settlements[0]?.exitIntent).toBe('B10-win')
    expect(contract.beats[0]?.loop?.exitConditions).toEqual(['箭矢交齐'])
  })
})
