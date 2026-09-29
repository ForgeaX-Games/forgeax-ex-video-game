import { describe, expect, it } from 'vitest'
import type { RequirementContract } from '../../workflow/contracts'
import {
  derivePillarSkeleton,
  documentSlugFromDocumentRef,
  nextPillarWriteBatch,
  pillarContentOversizeError,
  rejectOffBatchPillarPatch,
} from './pillar-skeleton'

/**
 * 结构正确性从 LLM 手里拿走。
 *
 * 章节数、战斗回合数、终局数量都能从需求契约确定性推出，让 design peer 自己数
 * 只会产出「短篇设成 0 个战斗」「节点数超预算」这类要下游才发现的偏差。Host
 * 先给骨架，peer 只填叙事与玩法语义。
 */
function contractFor(workScale: string): RequirementContract {
  return {
    schemaVersion: 1,
    rawIntent: '草船借箭互动影游',
    dimensions: {
      work_scale: { value: workScale, source: 'author' },
      core_fun: { value: '回合战斗', source: 'author' },
    },
  } as unknown as RequirementContract
}

describe('derivePillarSkeleton', () => {
  it('derives the short-form chapter budget from the requirement contract', () => {
    const skeleton = derivePillarSkeleton(contractFor('短篇（10个章节）'))
    expect(skeleton.beats).toHaveLength(10)
    expect(skeleton.schemaVersion).toBe(4)
  })

  it('derives the micro-form budget as three beats', () => {
    expect(derivePillarSkeleton(contractFor('极短')).beats).toHaveLength(3)
  })

  // 短篇必须恰好 1 个主图战斗回合。让 peer 自己记这条规则的结果是它经常设成 0。
  it('marks exactly one combat beat for a short-form game', () => {
    const combat = derivePillarSkeleton(contractFor('短篇（10个章节）'))
      .beats.filter((beat) => beat.requiredRole === 'combat-command')
    expect(combat).toHaveLength(1)
  })

  it('leaves combat out when the budget does not require it', () => {
    const combat = derivePillarSkeleton(contractFor('极短'))
      .beats.filter((beat) => beat.requiredRole === 'combat-command')
    expect(combat).toHaveLength(0)
  })

  // The 76-minute loop started from a terminal beat with no player action. The
  // skeleton declares endings up front so the terminal exit always has a target.
  it('declares at least one ending so a terminal exit always has a target', () => {
    const skeleton = derivePillarSkeleton(contractFor('短篇（10个章节）'))
    expect(skeleton.endings.length).toBeGreaterThan(0)
    expect(skeleton.beats.at(-1)?.exitToEndingId).toBe(skeleton.endings[0]!.id)
  })

  it('gives every beat a stable id the peer must not renumber', () => {
    const ids = derivePillarSkeleton(contractFor('短篇（10个章节）')).beats.map((beat) => beat.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toMatch(/^B0?1$/u)
  })

  it('falls back to the short-form budget when work_scale is missing', () => {
    const skeleton = derivePillarSkeleton(undefined)
    expect(skeleton.beats).toHaveLength(10)
  })

  it('marks pass / branch / combat / ending so the peer does not write every beat at v4 density', () => {
    const skeleton = derivePillarSkeleton(contractFor('短篇（10个章节）'))
    const byKind = Object.fromEntries(
      (['pass', 'branch', 'combat', 'ending'] as const).map((kind) => [
        kind,
        skeleton.beats.filter((beat) => beat.kind === kind).map((beat) => beat.id),
      ]),
    )
    expect(byKind.combat).toEqual(['B08'])
    expect(byKind.ending).toEqual(['B10'])
    expect(byKind.branch).toEqual(['B02', 'B07'])
    expect(byKind.pass).toEqual(['B01', 'B03', 'B04', 'B05', 'B06', 'B09'])
    expect(skeleton.writeGuide.resultHeadroom).toBe(5)
    expect(skeleton.writeGuide.contentBudget).toBe(10_000)
  })

  it('extracts the ASCII document slug from the materialized core path', () => {
    expect(documentSlugFromDocumentRef('docs/caochuan-jiejian_core.md')).toBe('caochuan-jiejian')
    expect(documentSlugFromDocumentRef('docs/草船_core.md')).toBeUndefined()
  })

  it('tells the peer which fields to drop when the first upsert is over the hard limit', () => {
    expect(pillarContentOversizeError(23633)).toContain('kind=pass')
    expect(pillarContentOversizeError(23633)).toContain('23633')
    expect(pillarContentOversizeError(23633)).toContain('per contract batch')
    expect(pillarContentOversizeError(23633)).toContain('nextBeatIds')
  })
})

describe('nextPillarWriteBatch', () => {
  const skeleton = derivePillarSkeleton(contractFor('短篇（10个章节）'))

  it('asks for all remaining pass beats plus header on the first call', () => {
    const batch = nextPillarWriteBatch(skeleton, null)
    expect(batch).toEqual({
      beatIds: ['B01', 'B03', 'B04', 'B05', 'B06', 'B09'],
      includeHeader: true,
      kind: 'pass',
    })
  })

  it('then asks for one branch / combat / ending beat at a time', () => {
    const afterPass = { beats: ['B01', 'B03', 'B04', 'B05', 'B06', 'B09'].map((id) => ({ id })) }
    expect(nextPillarWriteBatch(skeleton, afterPass)?.beatIds).toEqual(['B02'])
    const afterB02 = { beats: [...afterPass.beats, { id: 'B02' }] }
    expect(nextPillarWriteBatch(skeleton, afterB02)?.beatIds).toEqual(['B07'])
    const afterB07 = { beats: [...afterB02.beats, { id: 'B07' }] }
    expect(nextPillarWriteBatch(skeleton, afterB07)?.beatIds).toEqual(['B08'])
    const afterB08 = { beats: [...afterB07.beats, { id: 'B08' }] }
    expect(nextPillarWriteBatch(skeleton, afterB08)?.beatIds).toEqual(['B10'])
    const complete = { beats: skeleton.beats.map((beat) => ({ id: beat.id })) }
    expect(nextPillarWriteBatch(skeleton, complete)).toBeNull()
  })

  it('accepts a complete skeleton in one atomic authoring submission', () => {
    const rejected = rejectOffBatchPillarPatch(
      skeleton,
      null,
      skeleton.beats.map((beat) => beat.id),
    )
    expect(rejected).toBeNull()
  })
})
