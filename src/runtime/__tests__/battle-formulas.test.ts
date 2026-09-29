import { describe, it, expect } from 'vitest'
import { evalExpr } from '../core/engine/expr'
import { createRng } from '../core/engine/rng'
import type { EvalCtx } from '../core/engine/expr'

/**
 * 战斗公式回归：伤害 = ⌊系数 × 攻击力 × 100 ÷ (100+防御力) × 浮动 × 暴击⌋；回血 = 12% 生命上限。
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

const EXPR = {
  pu: '-floor(1 * entity.ent-player.attr.attack * 100 / (100 + entity.ent-boss.attr.defense) * (0.85 + rand() * 0.3) * (1 + chance(0) * 0.5))',
  pu2: '-floor(entity.ent-player.attr.attack * 100 / (100 + entity.ent-boss.attr.defense) * ((0.25 * (var.combo == 1) + 0.3 * (var.combo == 2) + 0.35 * (var.combo == 3) + 0.4 * (var.combo == 4)) * (0.85 + rand() * 0.3)))',
  zhong: '-floor(1.8 * entity.ent-player.attr.attack * 100 / (100 + entity.ent-boss.attr.defense) * (0.85 + rand() * 0.3) * (1 + chance(0.05) * 0.5) * chance(0.95))',
  z2: '-floor(entity.ent-player.attr.attack * 100 / (100 + entity.ent-boss.attr.defense) * ((0.25 * (var.combo == 1) + 0.3 * (var.combo == 2) + 0.35 * (var.combo == 3) + 0.4 * (var.combo == 4)) * (0.85 + rand() * 0.3)))',
  ult: '-floor(3 * entity.ent-player.attr.attack * 100 / (100 + entity.ent-boss.attr.defense) * (0.85 + rand() * 0.3) * (1 + chance(0.05) * 0.5))',
  fuzhu: 'floor(entity.ent-player.attr.hpMax * 0.12)',
} as const

describe('战斗公式（严格按表）', () => {
  it('轻攻 pu = ⌊1.0 × 攻80 × 100 ÷ (100+防50) × 浮动 × 暴击⌋，基础≈53.3', () => {
    const v = evalExpr(EXPR.pu, ctx(1))
    expect(v).toBeLessThan(0)
    expect(Math.abs(v)).toBeGreaterThanOrEqual(45)
    expect(Math.abs(v)).toBeLessThan(62)
    expect(Number.isInteger(v)).toBe(true)
  })

  it('大招 ult 3.0× 约为轻攻 3 倍量级', () => {
    const light = Math.abs(evalExpr(EXPR.pu, ctx(7)))
    const ult = Math.abs(evalExpr(EXPR.ult, ctx(7)))
    expect(ult).toBeGreaterThan(light * 2.5)
  })

  it('连击分段 pu2：combo 段决定系数（combo=1→0.25, combo=3→0.35，段越高伤害越高）', () => {
    const c1 = Math.abs(evalExpr(EXPR.pu2, ctx(3, 1)))
    const c3 = Math.abs(evalExpr(EXPR.pu2, ctx(3, 3)))
    expect(c3).toBeGreaterThan(c1)
  })

  it('回血 fuzhu = ⌊生命上限300 × 12%⌋ = 36（确定值，无随机）', () => {
    expect(evalExpr(EXPR.fuzhu, ctx(1))).toBe(36)
  })

  it('所有技能伤害 expr 引用了正确的实体属性（攻方攻击力 + 守方防御力）', () => {
    for (const id of ['pu', 'pu2', 'zhong', 'z2', 'ult'] as const) {
      expect(EXPR[id]).toContain('entity.ent-player.attr.attack')
      expect(EXPR[id]).toContain('entity.ent-boss.attr.defense')
    }
  })
})
