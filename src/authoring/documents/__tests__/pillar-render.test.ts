import { describe, expect, it } from 'vitest'
import type { PillarInteractionContract } from '../pillar-interaction-contract'
import { composePillarDocument, renderAuthorPillarMarkdown } from '../pillar-render'

function sampleContract(): PillarInteractionContract {
  return {
    schemaVersion: 4,
    title: '草船借箭',
    cast: [{ name: '诸葛亮', summary: '蜀汉军师' }, { name: '周瑜', summary: '东吴大都督' }],
    settings: [{ name: '长江江面' }],
    mainLoop: '看片后抉择，状态累积到借箭成败。',
    variables: [{ id: 'trust', initial: 5, min: 0, max: 10 }],
    endings: [{ id: 'ending-main', title: '草船万箭', summary: '满载而归' }],
    beats: [
      {
        id: 'B01',
        narrativeIntent: '周瑜设局',
        playerInformation: ['周瑜设局'],
        uiCapabilities: ['player-choice'],
        actions: [{
          id: 'a1',
          intent: '立下军令状',
          stateMutationOwner: 'none',
          requiredRole: 'player-choice',
          stateChange: '立下军令状',
          immediateFeedback: '立下军令状',
          downstreamPayoff: '立下军令状',
          exitIntent: '立下军令状',
          exit: { kind: 'beat', toBeatId: 'B02' },
        }],
        settlements: [],
      },
    ],
  }
}

function combatContract(): PillarInteractionContract {
  return {
    schemaVersion: 4,
    title: '草船借箭',
    cast: [{ name: '诸葛亮' }],
    settings: [{ name: '长江江面' }],
    mainLoop: '受箭累积，箭数达标交差。',
    variables: [
      { id: 'arrowCount', label: '箭矢', initial: 0, min: 0, max: 100000 },
      { id: 'enemyHp', label: '曹军士气', initial: 100, min: 0, max: 100 },
    ],
    formulas: [{ id: 'gain_arrows', expression: 'floor(20000 + rand() * 5000)', summary: '本回合获箭' }],
    endings: [
      { id: 'ending-win', title: '十万齐备', when: 'var.arrowCount >= 100000', summary: '箭满归营' },
    ],
    beats: [
      {
        id: 'B07',
        narrativeIntent: '雾夜受箭',
        playerInformation: ['当前箭矢数', '曹军乱箭将至'],
        uiCapabilities: ['combat-command'],
        actions: [{
          id: 'heavy',
          intent: '聚船受箭',
          stateMutationOwner: 'settlement',
          requiredRole: 'combat-command',
          carrier: { component: 'BattleCommandPanel', event: 'command' },
          effect: { target: 'var.arrowCount', op: 'add', formulaId: 'gain_arrows' },
          feedbackSpec: { kind: 'state-binding', component: 'BattleEnemyHpBar', target: 'var.arrowCount' },
          exit: { kind: 'stay' },
          stateChange: '箭矢累积',
          immediateFeedback: '血条与飘字',
          downstreamPayoff: '箭雨扎满草人',
          exitIntent: '留在战斗回合',
        }],
        settlements: [{
          id: 'heavy-result',
          sourceActionId: 'heavy',
          trigger: 'at',
          triggerSpec: { type: 'at', ms: 900 },
          feedbackSpec: { kind: 'transient-component', component: 'GainFloatText' },
          source: '受箭命中帧',
          intent: '把获箭量写入箭矢',
          feedback: '飘字显示获箭量',
          exitIntent: '继续受箭或离开',
        }, {
          id: 'win-when-full',
          trigger: 'state',
          triggerSpec: { type: 'state', condition: { all: [{ type: 'score', op: 'gte', value: 100000 }] } },
          source: 'var.arrowCount >= 100000',
          intent: '箭数达标则交差',
          feedback: '收起战斗界面',
          exitIntent: '进入十万齐备',
        }],
        loop: { progress: '每回合箭矢上升', exitConditions: ['箭矢达到十万'] },
      },
    ],
  }
}

describe('renderAuthorPillarMarkdown', () => {
  it('writes the author chapters from IR and does not dump JSON into the visible layer', () => {
    const rendered = renderAuthorPillarMarkdown(sampleContract())
    expect(rendered).toContain('## 角色')
    expect(rendered).toContain('诸葛亮')
    expect(rendered).toContain('## 场景')
    expect(rendered).toContain('长江江面')
    expect(rendered).toContain('## 主循环')
    expect(rendered).toContain('## 数值')
    expect(rendered).toContain('## 实体')
    expect(rendered).toContain('## 互动节拍')
    expect(rendered).toContain('周瑜设局')
    expect(rendered).not.toContain('schemaVersion')
    expect(rendered).not.toContain('stateMutationOwner')
  })

  it('turns each beat into tables for UI, settlements, variables, and formulas', () => {
    const rendered = renderAuthorPillarMarkdown(combatContract())
    expect(rendered).toContain('**界面配置**')
    expect(rendered).toContain('**界面运用**')
    expect(rendered).toContain('BattleCommandPanel')
    expect(rendered).toContain('常驻覆盖')
    expect(rendered).toContain('聚船受箭')
    expect(rendered).toContain('**条件结算**')
    expect(rendered).toContain('把获箭量写入箭矢')
    expect(rendered).toContain('GainFloatText')
    expect(rendered).toContain('**本拍用到的变量 / 公式 / 实体**')
    expect(rendered).toContain('箭矢')
    expect(rendered).toContain('floor(20000 + rand() * 5000)')
    expect(rendered).toContain('## 结局')
    expect(rendered).toContain('十万齐备')
    expect(rendered).toContain('本拍是战斗回合')
    expect(rendered).not.toContain('schemaVersion')
  })

  it('stores the IR in a machine fence after the author chapters', () => {
    const composed = composePillarDocument(sampleContract())
    expect(composed).toContain('## 数值')
    expect(composed).toContain('**界面配置**')
    expect(composed).toContain('```pillar-interaction-contract')
    expect(composed).toContain('"schemaVersion":4')
    expect(composed.indexOf('## 角色')).toBeLessThan(composed.indexOf('```pillar-interaction-contract'))
  })
})
