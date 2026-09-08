import { describe, it, expect } from 'vitest'
import demo from '../../editor/demo/__tests__/fixtures/nodia.graph.json'
import { evalExpr } from '../core/engine/expr'
import { createRng } from '../core/engine/rng'
import type { EvalCtx } from '../core/engine/expr'
import { getSubProcess } from '../core/schema/graph-schema'

/**
 * 战斗公式回归：nodia demo 的 6 个技能节点伤害/回血 expr 严格按技能表求值。
 * 表：伤害 = ⌊系数 × 攻击力 × 100 ÷ (100+防御力) × 浮动 × 暴击⌋；回血 = 12% 生命上限。
 * 浮动/暴击含 rand/chance → 固定 seed 断言确定值。
 */
function ctx(seed: number, combo = 2): EvalCtx {
  return {
    entities: {
      'ent-player': { attrs: { attack: 80, defense: 40, hp: 300, hpMax: 300 } },
      'ent-boss': { attrs: { attack: 75, defense: 50, hp: 700, hpMax: 700 } },
    },
    vars: { combo, qi: 0, critRate: 0.1, myTurn: 0, healCd: 0 },
    flags: {},
    score: 0,
    rng: createRng(seed),
  }
}

const playerTurn = getSubProcess((demo as any).graph.nodes.find((n: any) => n.id === 'a_my')?.data)!.graph

function dmgExpr(nodeId: string): string {
  const node = playerTurn.nodes.find((n) => n.id === nodeId)! as any
  const val = node.data.reactions[0].do[0].effects[0].value
  return val.expr as string
}

describe('nodia 战斗公式（严格按表）', () => {
  it('轻攻 pu = ⌊1.0 × 攻80 × 100 ÷ (100+防50) × 浮动 × 暴击⌋，基础≈53.3', () => {
    // 攻方 ent-player attack80、守方 ent-boss defense50 → 80*100/150 = 53.33；浮动∈[0.85,1.15)
    const v = evalExpr(dmgExpr('pu'), ctx(1))
    expect(v).toBeLessThan(0) // 施加到 hp 是负值
    expect(Math.abs(v)).toBeGreaterThanOrEqual(45) // 53.3 * 0.85
    expect(Math.abs(v)).toBeLessThan(62) // 53.3 * 1.15
    expect(Number.isInteger(v)).toBe(true) // floor 取整
  })

  it('大招 ult 3.0× 约为轻攻 3 倍量级', () => {
    const light = Math.abs(evalExpr(dmgExpr('pu'), ctx(7)))
    const ult = Math.abs(evalExpr(dmgExpr('ult'), ctx(7)))
    // 同 seed 下浮动一致，倍率 3.0 vs 1.0 → ult ≈ 3×light（暴击项差异容忍）
    expect(ult).toBeGreaterThan(light * 2.5)
  })

  it('连击分段 pu2：combo 段决定系数（combo=1→0.25, combo=3→0.35，段越高伤害越高）', () => {
    const c1 = Math.abs(evalExpr(dmgExpr('pu2'), ctx(3, 1)))
    const c3 = Math.abs(evalExpr(dmgExpr('pu2'), ctx(3, 3)))
    expect(c3).toBeGreaterThan(c1) // 0.35 段 > 0.25 段（同 seed 浮动一致）
  })

  it('回血 fuzhu = ⌊生命上限300 × 12%⌋ = 36（确定值，无随机）', () => {
    const node = playerTurn.nodes.find((n) => n.id === 'fuzhu')! as any
    const healExpr = node.data.reactions[0].do[0].effects[0].value.expr
    expect(evalExpr(healExpr, ctx(1))).toBe(36)
  })

  it('所有技能伤害 expr 引用了正确的实体属性（攻方攻击力 + 守方防御力）', () => {
    for (const id of ['pu', 'pu2', 'zhong', 'z2', 'ult']) {
      const e = dmgExpr(id)
      expect(e).toContain('entity.ent-player.attr.attack')
      expect(e).toContain('entity.ent-boss.attr.defense')
    }
  })
})
