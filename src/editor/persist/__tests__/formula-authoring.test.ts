import { describe, expect, it } from 'vitest'
import type { GameScenario } from '@/runtime/core/schema/graph-schema'
import {
  normalizeFormulaTextInput,
  parseFormulaText,
  previewFormula,
  toEditorScenarioDocument,
  toRuntimeScenario,
} from '@/authoring/blueprint/formula-authoring'

const base: GameScenario = {
  version: 'game-video.graph.v1',
  graph: { nodes: [], edges: [] },
}

describe('formula authoring document', () => {
  it('migrates interim editor metadata back to top-level formulas', () => {
    const doc = toEditorScenarioDocument({
      ...base,
      editor: {
        formulas: {
          damage: { id: 'damage', terms: [] },
        },
      },
    } as typeof base & { editor: { formulas: { damage: { id: string; terms: never[] } } } })
    expect(doc?.formulas?.damage?.id).toBe('damage')
  })

  it('keeps top-level formulas unchanged', () => {
    const legacy = {
      ...base,
      formulas: {
        damage: { id: 'damage', terms: [] },
      },
    }
    const doc = toEditorScenarioDocument(legacy)
    expect(doc?.formulas?.damage?.id).toBe('damage')
  })

  it('keeps runtime formulas and removes expression picks before execution', () => {
    const runtime = toRuntimeScenario({
      ...base,
      formulas: {
        damage: {
          id: 'damage',
          ast: { t: 'num', id: 'damage-value', v: 1 },
        },
      },
      graph: {
        nodes: [{
          id: 'n1',
          type: 'perf',
          position: { x: 0, y: 0 },
          inputs: [],
          outputs: [],
          data: {
            name: 'n1',
            reactions: [{
              when: { type: 'enter' },
              do: [{
                kind: 'effect',
                effects: [{
                  kind: 'attr',
                  entityId: 'player',
                  attr: 'hp',
                  op: 'add',
                  value: { expr: '1', pick: { mode: 'formula', formulaId: 'damage', holeBindings: {} } } as never,
                }],
              }],
            }],
          },
        }],
        edges: [],
      },
    })
    expect(runtime.formulas?.damage).toEqual({
      id: 'damage',
      ast: { t: 'num', id: 'damage-value', v: 1 },
    })
    const value = (runtime.graph.nodes[0]?.data.reactions?.[0]?.do[0] as { effects?: Array<{ value?: unknown }> }).effects?.[0]?.value
    expect(value).toEqual({ expr: '1' })
  })
})

describe('formula text ↔ AST round-trip (parseFormulaText / previewFormula)', () => {
  // 归一：解析成 AST 再预览回串，应与直接解析的语义一致（round-trip 收敛）。
  const roundtrip = (src: string) => previewFormula(parseFormulaText(src))

  it('纯表达式（无 hole）round-trip 收敛', () => {
    expect(roundtrip('1 + 2 * 3')).toBe(previewFormula(parseFormulaText('1 + 2 * 3')))
    expect(roundtrip('floor(entity.player.attr.hp / 2)')).toContain('entity.player.attr.hp')
    expect(roundtrip('var.gold + score')).toContain('var.gold')
    expect(roundtrip('var.gold + score')).toContain('score')
  })

  it('单个 ?参数 解析成 hole，预览回 ?参数', () => {
    const ast = parseFormulaText('floor(?系数 * entity.enemy.attr.attack)')
    // 收集到一个 hole
    const holes: string[] = []
    const walk = (n: ReturnType<typeof parseFormulaText>): void => {
      if (n.t === 'hole') holes.push(n.holeId)
      else if (n.t === 'unary') walk(n.x)
      else if (n.t === 'bin') { walk(n.a); walk(n.b) }
      else if (n.t === 'call') n.args.forEach(walk)
    }
    walk(ast)
    expect(holes).toEqual(['系数'])
    expect(previewFormula(ast)).toContain('?系数')
  })

  it('同名 ?参数 多次出现 = 同一 holeId', () => {
    const ast = parseFormulaText('?倍率 * ?倍率')
    const ids: string[] = []
    const walk = (n: ReturnType<typeof parseFormulaText>): void => {
      if (n.t === 'hole') ids.push(n.holeId)
      else if (n.t === 'bin') { walk(n.a); walk(n.b) }
    }
    walk(ast)
    expect(ids).toEqual(['倍率', '倍率'])
  })

  it('hole round-trip：?参数 → AST → 预览 → 再解析，holeId 稳定', () => {
    const once = parseFormulaText('?攻击 - ?防御')
    const preview = previewFormula(once)
    expect(preview).toContain('?攻击')
    expect(preview).toContain('?防御')
    // 预览串能被再次解析回 hole（写=看=可回解）
    const twice = parseFormulaText(preview)
    expect(previewFormula(twice)).toBe(preview)
  })

  it('多种引用 + 函数嵌套', () => {
    const ast = parseFormulaText('max(entity.a.attr.atk, var.buff) + min(score, 10)')
    const preview = previewFormula(ast)
    expect(preview).toContain('entity.a.attr.atk')
    expect(preview).toContain('var.buff')
    expect(preview).toContain('score')
    expect(preview).toMatch(/max\(/)
    expect(preview).toMatch(/min\(/)
  })

  it('归一全角数学标点并落成半角规范表达式', () => {
    expect(roundtrip('max（?攻击，0）')).toBe('max(?攻击, 0)')
    expect(roundtrip('（2＋3）×4')).toBe('(2 + 3) * 4')
    expect(normalizeFormulaTextInput('ｍａｘ（？攻击力　×　２，　０）'))
      .toBe('max(?攻击力 * 2, 0)')
    expect(roundtrip('　１\t＋\n２　')).toBe('1 + 2')
  })

  it('按目录最长引用区分短横线 id 与无空格减法', () => {
    const catalog = {
      entities: {
        'ent-player': {
          id: 'ent-player',
          attrs: { attack: 80, 'attack-power': 100 },
        },
      },
      variables: {
        qi: { id: 'qi', initial: 3 },
        'combo-count': { id: 'combo-count', initial: 2 },
      },
    }
    expect(normalizeFormulaTextInput(
      'entity.ent-player.attr.attack-10',
      catalog,
    )).toBe('entity.ent-player.attr.attack - 10')
    expect(normalizeFormulaTextInput(
      'entity.ent-player.attr.attack-power',
      catalog,
    )).toBe('entity.ent-player.attr.attack-power')
    expect(normalizeFormulaTextInput('var.qi-var.combo-count', catalog))
      .toBe('var.qi - var.combo-count')
  })

  it('解析失败抛错（供 UI 捕获提示）', () => {
    expect(() => parseFormulaText('1 + + 2')).toThrow()
    expect(() => parseFormulaText('floor(')).toThrow()
  })
})
