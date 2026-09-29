import { describe, expect, it } from 'vitest'
import type { PillarInteractionBeatContract } from '../pillar-interaction-contract'
import {
  collectBeatOverlayPlan,
  duplicateMountedOverlayComponents,
} from '../pillar-overlay-plan'

function beat(overrides: Partial<PillarInteractionBeatContract>): PillarInteractionBeatContract {
  return {
    id: 'B01',
    narrativeIntent: '试探',
    playerInformation: ['试探'],
    uiCapabilities: [],
    actions: [],
    settlements: [],
    ...overrides,
  }
}

describe('collectBeatOverlayPlan', () => {
  it('collapses multiple actions that share one input overlay', () => {
    const plan = collectBeatOverlayPlan(beat({
      actions: [
        {
          id: 'a',
          intent: '应',
          carrier: { component: 'InkYingMo', event: 'ying' },
          stateChange: '应',
          immediateFeedback: '应',
          downstreamPayoff: '应',
          exitIntent: '应',
        },
        {
          id: 'b',
          intent: '默',
          carrier: { component: 'InkYingMo', event: 'mo' },
          stateChange: '默',
          immediateFeedback: '默',
          downstreamPayoff: '默',
          exitIntent: '默',
        },
      ],
    }))
    expect(plan.filter((row) => row.role === 'input')).toEqual([
      { component: 'InkYingMo', role: 'input' },
    ])
  })

  it('treats the same component as input and HUD as a duplicate mount', () => {
    const sample = beat({
      actions: [{
        id: 'a',
        intent: '攻',
        carrier: { component: 'BattleSkill', event: 'heavy' },
        feedbackSpec: { kind: 'state-binding', component: 'BattleSkill', target: 'var.hp' },
        stateChange: '攻',
        immediateFeedback: '攻',
        downstreamPayoff: '攻',
        exitIntent: '攻',
      }],
    })
    expect(duplicateMountedOverlayComponents(sample)).toEqual(['BattleSkill'])
  })

  it('does not treat a transient spawn as a duplicate of a mounted HUD', () => {
    const sample = beat({
      actions: [{
        id: 'a',
        intent: '攻',
        carrier: { component: 'BattleSkill', event: 'heavy' },
        feedbackSpec: { kind: 'state-binding', component: 'BattleEnemyHpBar', target: 'var.hp' },
        stateChange: '攻',
        immediateFeedback: '攻',
        downstreamPayoff: '攻',
        exitIntent: '攻',
      }],
      settlements: [{
        id: 'a-result',
        sourceActionId: 'a',
        trigger: 'at',
        feedbackSpec: { kind: 'transient-component', component: 'DamageFloatText' },
        source: '命中',
        intent: '结算',
        feedback: '飘字',
        exitIntent: '继续',
      }],
    })
    expect(duplicateMountedOverlayComponents(sample)).toEqual([])
    expect(collectBeatOverlayPlan(sample).map((row) => row.role)).toEqual([
      'input',
      'hud',
      'transient',
    ])
  })
})
