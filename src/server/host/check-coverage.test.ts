import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACTIVITY_CONTRACTS } from '../../workflow/activity-contracts'
import { expandCheckIds } from '../../workflow/validation-check-groups'

/**
 * 防复发：活动契约声明的每个 hardCheck 都必须有校验器实现。
 *
 * 为什么单独立一条：校验器对未知 check 返回 `check.unknown` 失败（fail-closed），
 * 所以「声明了但没实现」不会放水，而是让该活动**永远完不成**——流程直接卡死，
 * 且失败信息只说「未知校验项」，很难定位到是漏了实现。
 */
describe('校验器覆盖率', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, 'project-inspection.ts'),
    'utf8',
  )
  const implemented = new Set(
    [...source.matchAll(/checks\.set\(\s*[`'"]([^`'"]+)[`'"]/g)].map((match) => match[1]!),
  )
  // 模板字符串形式的动态登记（document.<type>.ready）需要展开。
  const dynamic = [...source.matchAll(/checks\.set\(\s*`document\.\$\{documentType\}\.ready`/g)]
  if (dynamic.length > 0) {
    for (const type of ['intake', 'core', 'inquiry', 'pillar']) implemented.add(`document.${type}.ready`)
  }

  it('每个活动声明的 hardCheck 都有实现', () => {
    const gaps: string[] = []
    for (const [activity, contract] of Object.entries(ACTIVITY_CONTRACTS)) {
      for (const checkId of expandCheckIds(contract.hardChecks)) {
        if (!implemented.has(checkId)) gaps.push(`${activity} → ${checkId}`)
      }
    }
    expect(gaps).toEqual([])
  })

  it('总脉络的规模与结构闸门都在', () => {
    for (const checkId of [
      'outline.graph-connected',
      'outline.choice-consequence',
      'outline.node-summary-complete',
      'outline.node-count-matches-scale',
      'outline.declarations-complete',
      'outline.declaration-budget',
    ]) {
      expect(implemented.has(checkId), checkId).toBe(true)
    }
  })

  it('汇总整装的 finalization 闸门与选择语义校验都在', () => {
    const finalization = [...implemented].filter((checkId) => checkId.startsWith('finalization.'))
    expect(finalization).toHaveLength(13)
    expect(finalization).toContain('finalization.work-scale-budget')
    expect(finalization).toContain('finalization.plan-wired')
    expect(ACTIVITY_CONTRACTS['game.finalizing']?.hardChecks).toContain('graph.choice-consequence')
  })

  it('玩法契约的三段闸门都有实现', () => {
    // 契约由总脉络声明、数值线交付、整装落地，缺任一段就退回「各自猜」。
    for (const checkId of ['outline.interaction-plan', 'rules.plan-formulas', 'finalization.plan-wired']) {
      expect(implemented.has(checkId), checkId).toBe(true)
    }
  })

  it('场景与角色的完成门对称', () => {
    expect(implemented.has('scenes.catalog.valid')).toBe(true)
    expect(implemented.has('scenes.references.ready')).toBe(true)
    expect(implemented.has('characters.catalog.valid')).toBe(true)
    expect(implemented.has('characters.references.ready')).toBe(true)
  })
})
