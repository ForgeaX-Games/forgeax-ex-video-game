import { describe, expect, it } from 'vitest'
import { parsePillarInteractionContract } from '@/authoring/documents/pillar-interaction-contract'
import { compilePillar } from './pillar-compiler'
import { derivePillarSkeleton } from './pillar-skeleton'

/**
 * design peer 把完整 v4 IR 一次塞进 upsert_document，会在 zaohua-pro 约 8k
 * 输出上限上把 JSON 截断。创作面只该写节拍意图和出口；机械字段由 Host 补全。
 */
function compactMarkdown(beats: unknown[], endings?: unknown[]): string {
  const contract = {
    schemaVersion: 4,
    beats,
    ...(endings ? { endings } : {}),
  }
  return [
    '# 支柱',
    '## 角色',
    '诸葛亮、曹操。',
    '## 场景',
    '长江江面。',
    '## 主循环',
    '玩家在每拍做一个选择，推动草船借箭。',
    '## 互动节拍',
    '```pillar-interaction-contract',
    JSON.stringify(contract),
    '```',
  ].join('\n')
}

function compactBeat(id: string, requiredRole: 'player-choice' | 'combat-command', intent: string) {
  return {
    id,
    narrativeIntent: intent,
    staging: `${id} 江面夜雾里船队缓行，火把映在水上，主角在船头做出这一拍的关键动作。`,
    actions: [{
      id: `${id}-act`,
      intent,
      requiredRole,
      stateMutationOwner: requiredRole === 'combat-command' ? 'settlement' : 'none',
    }],
  }
}

describe('hydrate compact pillar authoring into a compilable v4 IR', () => {
  it('parses a skeleton-sized compact pillar without v4 mechanical fields', () => {
    const skeleton = derivePillarSkeleton({
      schemaVersion: 1,
      rawIntent: '草船借箭',
      dimensions: {
        work_scale: { value: '短篇（10个章节）', source: 'author' },
        core_fun: { value: '回合战斗', source: 'author' },
      },
    } as never)
    const beats = skeleton.beats.map((beat) => compactBeat(
      beat.id,
      beat.requiredRole === 'combat-command' ? 'combat-command' : 'player-choice',
      `${beat.id} 推进剧情`,
    ))
    const markdown = compactMarkdown(beats)
    expect(markdown.length).toBeLessThan(8000)

    const contract = parsePillarInteractionContract(markdown)
    expect(contract.beats).toHaveLength(10)
    expect(contract.beats[0]?.actions[0]?.exit).toEqual({ kind: 'beat', toBeatId: 'B02' })
    expect(contract.beats.at(-1)?.actions[0]?.exit?.kind).toBe('ending')
    expect(contract.beats[0]?.actions[0]?.feedbackSpec).toBeDefined()
  })

  it('compiles the hydrated compact pillar into a blueprint', () => {
    const skeleton = derivePillarSkeleton({
      schemaVersion: 1,
      rawIntent: '草船借箭',
      dimensions: {
        work_scale: { value: '短篇（10个章节）', source: 'author' },
        core_fun: { value: '回合战斗', source: 'author' },
      },
    } as never)
    const beats = skeleton.beats.map((beat) => compactBeat(
      beat.id,
      beat.requiredRole === 'combat-command' ? 'combat-command' : 'player-choice',
      `${beat.id} 推进剧情`,
    ))
    const compiled = compilePillar(parsePillarInteractionContract(compactMarkdown(beats)))
    expect(compiled.ok, compiled.ok ? '' : compiled.issues.map((issue) => issue.message).join('; ')).toBe(true)
  })

  it('uses settlement feedback rather than statically mounting StatusNotice for a generic effect', () => {
    const markdown = compactMarkdown([
      {
        id: 'B01',
        narrativeIntent: '试探',
        staging: '帐中烛火摇曳，刘备试探让位，诸葛亮必须当场表态。',
        actions: [{
          id: 'B01-act',
          intent: '接下让位',
          requiredRole: 'player-choice',
          stateMutationOwner: 'settlement',
          effect: { target: 'var.trust', op: 'sub', value: 1 },
        }],
      },
    ])
    const action = parsePillarInteractionContract(markdown).beats[0]?.actions[0]
    expect(action?.feedbackSpec).toEqual({ kind: 'hide-interface' })
  })

  it('repairs an empty combat loop into the deterministic default exit conditions', () => {
    const markdown = compactMarkdown([{
      ...compactBeat('B01', 'combat-command', '雾中接舷作战'),
      loop: { progress: '敌我轮流消耗生命', exitConditions: [] },
    }])
    const combat = parsePillarInteractionContract(markdown).beats[0]
    expect(combat?.loop?.exitConditions).toEqual(['敌方生命归零', '玩家生命归零'])
  })

  it('keeps an explicit v4 exit instead of rewriting it', () => {
    const markdown = compactMarkdown([
      {
        ...compactBeat('B01', 'player-choice', '直接终局'),
        actions: [{
          id: 'B01-act',
          intent: '直接终局',
          requiredRole: 'player-choice',
          stateMutationOwner: 'none',
          exit: { kind: 'ending', endingId: 'ending-main' },
        }],
      },
    ], [{ id: 'ending-main', title: '主线结局', summary: '收束' }])
    expect(parsePillarInteractionContract(markdown).beats[0]?.actions[0]?.exit)
      .toEqual({ kind: 'ending', endingId: 'ending-main' })
  })

  it('defaults omitted exits to the next skeleton beat id, not insertion order', () => {
    const markdown = compactMarkdown([
      compactBeat('B01', 'player-choice', '立状推进剧情'),
      compactBeat('B03', 'player-choice', '探营推进剧情'),
      compactBeat('B02', 'player-choice', '抉择推进剧情'),
    ])
    const contract = parsePillarInteractionContract(markdown)
    expect(contract.beats.map((beat) => beat.id)).toEqual(['B01', 'B02', 'B03'])
    expect(contract.beats[0]?.actions[0]?.exit).toEqual({ kind: 'beat', toBeatId: 'B02' })
    expect(contract.beats[1]?.actions[0]?.exit).toEqual({ kind: 'beat', toBeatId: 'B03' })
  })

  it('routes combat win/lose system settlements to the next beat and fail ending', () => {
    const markdown = compactMarkdown([
      compactBeat('B01', 'player-choice', '立状推进剧情'),
      {
        id: 'B02',
        narrativeIntent: '雾中行船',
        staging: '长江江面浓雾弥漫，草船逼近曹军水寨，箭雨扑面而来。',
        actions: [{
          id: 'B02-light',
          intent: '稳紮收箭',
          requiredRole: 'combat-command',
          stateMutationOwner: 'settlement',
          exit: { kind: 'beat', toBeatId: 'B02' },
        }],
        settlements: [
          {
            id: 'B02-win',
            trigger: 'state',
            source: 'arrow_count',
            intent: '收箭满十万获胜',
            feedback: '收箭完成提示',
            exitIntent: '进入满载而归',
            triggerSpec: { type: 'state', condition: { all: [{ type: 'var', varId: 'arrow_count', op: 'gte', value: 100000 }] } },
          },
          {
            id: 'B02-lose',
            trigger: 'state',
            source: 'fleet.hp',
            intent: '船队耐久归零失败',
            feedback: '船队沉没提示',
            exitIntent: '进入失败结局',
            triggerSpec: { type: 'state', condition: { all: [{ type: 'entity', entityId: 'fleet', attr: 'hp', op: 'lte', value: 0 }] } },
          },
        ],
      },
      compactBeat('B03', 'player-choice', '满载而归交差'),
    ], [
      { id: 'ending-main', title: '雾满载归', summary: '满载十万箭回营交差' },
      { id: 'ending-fail', title: '功亏一篑', summary: '未能取回足够箭矢' },
    ])
    const combat = parsePillarInteractionContract(markdown).beats.find((beat) => beat.id === 'B02')
    expect(combat?.settlements.find((settlement) => settlement.id === 'B02-win')?.exit)
      .toEqual({ kind: 'beat', toBeatId: 'B03' })
    expect(combat?.settlements.find((settlement) => settlement.id === 'B02-lose')?.exit)
      .toEqual({ kind: 'ending', endingId: 'ending-fail' })
  })
})
