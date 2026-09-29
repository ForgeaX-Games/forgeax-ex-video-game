import { describe, expect, it } from 'vitest'
import type { PillarInteractionContract } from '@/authoring/documents/pillar-interaction-contract'
import { pillarBuildabilityIssues } from './pillar-buildability'

/**
 * 支柱可执行性的**构造式证明**：Host 用下游那套真代码，按最小方案把支柱画一遍。
 *
 * 为什么不是再写一批规则：点状规则会和总脉络的规则漂移，漂移出来的缺口正是
 * 09-03 / 09-04 / 09-07 三次死锁的共同形状——支柱过门、下游画不出来、且没有
 * 合法工具序列能自救。让 Host 自己画一遍，"画得出来"就不再是推断而是事实。
 */

function beat(
  id: string,
  overrides: Partial<PillarInteractionContract['beats'][number]> = {},
): PillarInteractionContract['beats'][number] {
  return {
    id,
    narrativeIntent: `${id} 的叙事意图`,
    playerInformation: ['当前局势'],
    uiCapabilities: ['选择反馈'],
    actions: [],
    settlements: [],
    ...overrides,
  }
}

const SETTLED_ACTION = {
  id: 'hear',
  intent: '恳切陈词',
  stateMutationOwner: 'settlement' as const,
  requiredRole: 'player-choice' as const,
  stateChange: '信任 +15',
  immediateFeedback: '锁定选项',
  downstreamPayoff: '孙权动容',
  exitIntent: '进入应答结果',
}

const PAIRED_SETTLEMENT = {
  id: 'b01-hear-result',
  sourceActionId: 'hear',
  trigger: 'at' as const,
  source: '恳切陈词',
  intent: '结算信任增益',
  feedback: '信任飘字 +15',
  exitIntent: '进入下一节拍',
}

const buildable: PillarInteractionContract = {
  schemaVersion: 3,
  beats: [
    beat('B01', { actions: [SETTLED_ACTION], settlements: [PAIRED_SETTLEMENT] }),
    beat('B02', {
      settlements: [{
        id: 'b02-end',
        trigger: 'state',
        source: 'player.hp <= 0',
        intent: '判定终局',
        feedback: '冻结输入',
        exitIntent: '进入结局',
      }],
    }),
  ],
}

describe('支柱可执行性证明', () => {
  it('Host 能按最小方案画出来时不报问题', () => {
    expect(pillarBuildabilityIssues(buildable)).toEqual([])
  })

  it('v1/v2 支柱没有 requiredRole 时按默认承载画，不误伤', () => {
    const legacy: PillarInteractionContract = {
      schemaVersion: 1,
      beats: [beat('B01', {
        actions: [{
          id: 'parry',
          intent: '防反',
          stateChange: '敌方生命下降',
          immediateFeedback: '血条变化',
          downstreamPayoff: '呈现反击命中',
          exitIntent: '进入结果演出',
        }],
      })],
    }

    expect(pillarBuildabilityIssues(legacy)).toEqual([])
  })

  it('战斗动作用目录里真的具备 combat-command 的组件承载', () => {
    const combat: PillarInteractionContract = {
      schemaVersion: 3,
      beats: [beat('B01', {
        actions: [{ ...SETTLED_ACTION, id: 'strike', requiredRole: 'combat-command' }],
        settlements: [{ ...PAIRED_SETTLEMENT, id: 'b01-strike-result', sourceActionId: 'strike' }],
      })],
    }

    expect(pillarBuildabilityIssues(combat)).toEqual([])
  })

  it('目录里没有任何组件能承载该角色时，支柱阶段就说清缺口', () => {
    const unsupported = {
      schemaVersion: 3,
      beats: [{
        ...beat('B01', { settlements: [PAIRED_SETTLEMENT] }),
        actions: [{ ...SETTLED_ACTION, requiredRole: 'mind-reading' }],
      }],
    } as unknown as PillarInteractionContract

    const issues = pillarBuildabilityIssues(unsupported)

    expect(issues).toHaveLength(1)
    expect(issues[0]!.code).toBe('document.pillar.role-unsupported')
    expect(issues[0]!.message).toContain('mind-reading')
    expect(issues[0]!.message).toContain('hear')
  })

  // 自洽：支柱里写下的每个动作和结算，都必须在派生出的总脉络里有落点。
  // 落不下去的结算等于一条永远兑现不了的设计承诺，下游只会反复报 missing。
  it('结算在最小方案里没有落点时判定为不自洽', () => {
    const orphaned = {
      schemaVersion: 3,
      beats: [
        beat('B01', { actions: [SETTLED_ACTION] }),
        beat('B02', { settlements: [PAIRED_SETTLEMENT] }),
      ],
    } as unknown as PillarInteractionContract

    const issues = pillarBuildabilityIssues(orphaned)

    expect(issues.map((entry) => entry.code)).toContain('document.pillar.not-buildable')
    const text = issues.map((entry) => entry.message).join('\n')
    expect(text).toContain('b01-hear-result')
    expect(text).toContain('B02')
  })

  // Host 画不出来时必须把下游的原始报错原样带上来。只说「不可执行」会让 peer
  // 重蹈 09-07 的覆辙：按症状猜出一个不存在的规则，然后一路返工上游。
  it('Host 画不出来时带出下游的原始报错', () => {
    const conflicting = {
      schemaVersion: 3,
      beats: [beat('B01', { actions: [SETTLED_ACTION], settlements: [PAIRED_SETTLEMENT] }), beat('B01')],
    } as unknown as PillarInteractionContract

    const issues = pillarBuildabilityIssues(conflicting)

    expect(issues.length).toBeGreaterThan(0)
    expect(issues.every((entry) => entry.code === 'document.pillar.not-buildable')).toBe(true)
    expect(issues.map((entry) => entry.message).join('\n')).toContain('B01')
  })
})
