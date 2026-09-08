import { describe, expect, it } from 'vitest'
import {
  driftsFromChinese,
  languageConsistencyIssues,
  nodeLanguageIssues,
} from '@/authoring/blueprint/language-consistency'
import type { GameScenario } from '@/runtime/core/schema/graph-schema'

/**
 * 语言一致性（设计 §11.4）。
 *
 * 最容易漂的是出图 Prompt——它看起来像「给模型看的参数」，模型很自然就写成英文。
 * 但它会显示在角色卡与场景卡上，作者是要读的。
 *
 * 同样重要的是不误伤：中文句子里的 Boss、QTE、HP 是正常写法，报了反而没人再看告警。
 */

function scenario(overrides: Partial<GameScenario> = {}): GameScenario {
  return {
    variables: {},
    entities: {},
    formulas: {},
    ...overrides,
  } as GameScenario
}

describe('语言漂移判定', () => {
  it('通篇英文的句子算漂移', () => {
    expect(driftsFromChinese('A moonlit mountain path with a fierce tiger')).toBe(true)
  })

  it('含专有名词与缩写的中文句子不算漂移', () => {
    expect(driftsFromChinese('月夜山道，Boss 老虎出现，进入 QTE 反应窗口')).toBe(false)
    expect(driftsFromChinese('HP 归零即失败，需要用气力换取伤害窗口')).toBe(false)
  })

  it('标识符与短字符串不参与判定', () => {
    expect(driftsFromChinese('characters.c1.appearance')).toBe(false)
    expect(driftsFromChinese('wanted_level')).toBe(false)
    expect(driftsFromChinese('ok')).toBe(false)
  })
})

describe('内容平面语言扫描', () => {
  it('报出角色与场景的英文字段路径', () => {
    const issues = languageConsistencyIssues(scenario(), {
      characters: {
        c1: {
          id: 'c1',
          name: '武松',
          appearance: {
            description: '身形高大的行者，眉眼锋利',
            previewPrompt: 'A tall wandering monk with sharp eyes, ink painting style',
          },
        },
      },
      scenes: {
        s1: {
          id: 's1',
          name: '景阳冈',
          visual: {
            description: 'A moonlit mountain path shrouded in mist',
            previewPrompt: '月夜山道，雾气弥漫，水墨风格',
          },
        },
      },
    })

    expect(issues.map((item) => item.path)).toEqual([
      'assetCatalog.entities.character.c1.prompt',
      'assetCatalog.entities.scene.s1.description',
    ])
    expect(issues[0]!.message).toContain('出图提示词')
    expect(issues[0]!.sample).toContain('A tall wandering monk')
  })

  it('全中文项目零告警', () => {
    const issues = languageConsistencyIssues(scenario(), {
      characters: {
        c1: {
          id: 'c1',
          name: '武松',
          appearance: { description: '身形高大的行者', previewPrompt: '水墨风格的行者半身像，Boss 对峙氛围' },
        },
      },
      scenes: {
        s1: { id: 's1', name: '景阳冈', visual: { description: '月夜山道', previewPrompt: '月夜山道，16:9 构图' } },
      },
    })

    expect(issues).toEqual([])
  })

  it('扫描节点的章节文案与画面提示词', () => {
    const issues = nodeLanguageIssues([
      {
        id: 'n1',
        data: {
          name: '武松打虎',
          chapterSummary: 'Wu Song meets the tiger on the mountain path at night',
          storyText: '三碗不过冈',
          media: { kind: 'video', prompt: '武松挥拳，虎扑' },
        },
      },
    ], 'main')

    expect(issues.map((item) => item.path)).toEqual(['manifest.packs.main.nodes.n1.chapterSummary'])
  })
})
