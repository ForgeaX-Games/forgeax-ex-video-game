import { describe, expect, it } from 'vitest'
import { evalExpr, parseExpr, serializeExpr, collectRefs } from '../core/engine/expr'
import { createRng } from '../core/engine/rng'

const ctx = () => ({
  vars: { qi: 3, lizhi: 5 },
  entities: {
    'ent-player': { attrs: { attack: 80, defense: 40, hp: 300 } },
    'ent-boss': { attrs: { attack: 75, defense: 50, hp: 700 } },
  },
  flags: { lotusClue: 1 },
  score: 120,
  rng: createRng(1),
})

describe('evalExpr', () => {
  it('arithmetic + refs (damage formula)', () => {
    expect(
      evalExpr('entity.ent-player.attr.attack * 2 - entity.ent-boss.attr.defense', ctx()),
    ).toBe(110)
    expect(evalExpr('var.qi + 1', ctx())).toBe(4)
    expect(evalExpr('score / 2', ctx())).toBe(60)
    expect(evalExpr('entity.ent-boss.attr.hp', ctx())).toBe(700)
  })

  it('precedence and parentheses', () => {
    expect(evalExpr('2 + 3 * 4', ctx())).toBe(14)
    expect(evalExpr('(2 + 3) * 4', ctx())).toBe(20)
    expect(evalExpr('-var.qi + 10', ctx())).toBe(7)
  })

  it('comparisons & logic return 1/0', () => {
    expect(evalExpr('var.qi >= 3 && flag.lotusClue == 1', ctx())).toBe(1)
    expect(evalExpr('entity.ent-boss.attr.hp <= 0', ctx())).toBe(0)
    expect(evalExpr('var.qi < 3 || score > 100', ctx())).toBe(1)
    expect(evalExpr('var.qi != 3', ctx())).toBe(0)
  })

  it('rng functions reproducible via ctx.rng seed', () => {
    expect(evalExpr('randInt(1,6)', ctx())).toBe(evalExpr('randInt(1,6)', ctx()))
    const c = ctx()
    const v = evalExpr('chance(1)', c)
    expect(v).toBe(1)
  })

  it('unknown symbol throws', () => {
    expect(() => evalExpr('var.nope + 1', ctx())).toThrow()
    expect(() => evalExpr('entity.ghost.hp', ctx())).toThrow()
  })

  it('resolves formula references from runtime formula ASTs', () => {
    const formulaContext = {
      ...ctx(),
      formulas: {
        light_damage: {
          id: 'light_damage',
          ast: {
            t: 'bin',
            id: 'root',
            op: '-',
            a: { t: 'num', id: 'base', v: 10 },
            b: {
              t: 'ref',
              id: 'defense',
              ref: { kind: 'entityAttr', entityId: 'ent-boss', attr: 'defense' },
            },
          },
        },
      },
    }
    expect(evalExpr('formula.light_damage', formulaContext)).toBe( -40)
    expect(evalExpr('-formula.light_damage', formulaContext)).toBe(40)
  })

  it('rejects missing and incomplete formula references', () => {
    expect(() => evalExpr('formula.missing', { formulas: {} })).toThrow()
    expect(() => evalExpr('formula.incomplete', {
      formulas: {
        incomplete: {
          ast: { t: 'hole', id: 'hole', holeId: 'damage', kind: 'number' },
        },
      },
    })).toThrow()
  })

  it('parse error throws', () => {
    expect(() => parseExpr('2 +')).toThrow()
    expect(() => parseExpr('(2 + 3')).toThrow()
  })

  it('collectRefs lists referenced symbols (for validator)', () => {
    const refs = collectRefs('var.qi + entity.ent-boss.attr.defense - score')
    expect(refs.vars).toContain('qi')
    expect(refs.entities).toContain('ent-boss')
    expect(refs.usesScore).toBe(true)
  })
})

describe('serializeExpr (AST → 源码, parseExpr 的逆)', () => {
  // 覆盖：函数调用 / 嵌套除法 / 一元 / 优先级 / 比较+逻辑 / 伤害公式全串。
  const CASES = [
    '1',
    '-5',
    'var.qi + 1',
    '2 + 3 * 4',
    '(2 + 3) * 4',
    '100 / (100 + entity.ent-boss.attr.defense)',
    'entity.ent-player.attr.attack * 2 - entity.ent-boss.attr.defense',
    'a - (b - c)',
    'a - b - c',
    '-(var.qi + 10)',
    '!(var.qi >= 3)',
    'var.qi >= 3 && flag.lotusClue == 1',
    'floor(1.8 * entity.ent-player.attr.attack)',
    'chance(entity.ent-player.attr.critChance + 0.05)',
    '0.9 + rand() * 0.2',
    'min(max(var.qi, 0), 10)',
    // 验收样本：伤害公式全串（RATIO=1.8 / CRITBONUS=0.05 / HIT=0.95 已代入）
    'floor(1.8 * entity.ent-player.attr.attack * 100 / (100 + entity.ent-boss.attr.defense) * (0.9 + rand() * 0.2) * (1 + chance(entity.ent-player.attr.critChance + 0.05) * (entity.ent-player.attr.critMult - 1))) * chance(0.95)',
  ]

  it('round-trip idempotent: serialize(parse(s)) 再 parse+serialize 不变', () => {
    for (const s of CASES) {
      const once = serializeExpr(parseExpr(s))
      const twice = serializeExpr(parseExpr(once))
      expect(twice).toBe(once)
    }
  })

  it('round-trip 保值：eval(serialize(parse(s))) === eval(s)（抽象符号两边同样抛错）', () => {
    const evalOr = (src: string): number | 'throw' => {
      try {
        return evalExpr(src, ctx())
      } catch {
        return 'throw'
      }
    }
    for (const s of CASES) {
      const canon = serializeExpr(parseExpr(s))
      expect(evalOr(canon)).toBe(evalOr(s))
    }
  })

  it('最小括号化：只在必要处加括号', () => {
    expect(serializeExpr(parseExpr('2 + 3 * 4'))).toBe('2 + 3 * 4')
    expect(serializeExpr(parseExpr('(2 + 3) * 4'))).toBe('(2 + 3) * 4')
    expect(serializeExpr(parseExpr('((a - b) - c)'))).toBe('a - b - c')
    expect(serializeExpr(parseExpr('a - (b - c)'))).toBe('a - (b - c)')
    expect(serializeExpr(parseExpr('100 / (100 + var.qi)'))).toBe('100 / (100 + var.qi)')
  })
})
