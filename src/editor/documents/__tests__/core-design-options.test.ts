import { describe, expect, it } from 'vitest'
import {
  hasSelectedDesignOption,
  materializeCoreMarkdown,
  parseDesignOptions,
  type DesignOption,
} from '@/authoring/documents/core-design-options'

const option = (id: 'A' | 'B' | 'C', recommended = false): DesignOption => ({
  id,
  title: `方案 ${id}`,
  recommended,
  tags: ['赛虹废墟', '记忆流患', '阶层档格', '残缺人性'],
  markdown: `### 方案 ${id} · 奈何\n\n> 一句话钩子\n\n**类型**：东方奇幻 / 悬疑\n\n**视觉风格**：游戏 CG、3D 写实化风\n\n**篇幅大小**：短篇 · 预计游玩 25 分钟\n\n#### 项目介绍\n项目介绍 ${id}\n\n#### 主题表达\n主题表达 ${id}`,
  genre: '东方奇幻 / 悬疑 / 解谜 / 回合战斗',
  visualStyle: '游戏 CG、3D 写实化风',
  scale: '短篇 · 预计游玩 25 分钟',
  projectIntroduction: `项目介绍 ${id}`,
  themeExpression: `主题表达 ${id}`,
  mainLoop: `主循环 ${id}`,
  deliveryPromise: `交付承诺 ${id}`,
  pillarStance: { narrative: 'core', combat: 'support' },
})

describe('design-options parser/materializer', () => {
  it('parses a JSON array from a fenced document and preserves markdown', () => {
    const content = `# 核心方案\n\n\`\`\`json\n${JSON.stringify([option('A', true), option('B'), option('C')])}\n\`\`\``
    expect(parseDesignOptions(content)).toEqual([option('A', true), option('B'), option('C')])
  })

  it('accepts the prompt contract without internal pillar stance metadata', () => {
    const withoutPillarStance = (item: DesignOption) => {
      const { pillarStance: _pillarStance, ...promptOption } = item
      return promptOption
    }
    const content = JSON.stringify([
      withoutPillarStance(option('A', true)),
      withoutPillarStance(option('B')),
      withoutPillarStance(option('C')),
    ])

    expect(parseDesignOptions(content).map((item) => item.pillarStance)).toEqual([{}, {}, {}])
  })

  it('rejects malformed or non-renderable option arrays', () => {
    expect(() => parseDesignOptions(JSON.stringify([option('A', true), option('B')]))).toThrow(/exactly three/i)
    expect(() => parseDesignOptions(JSON.stringify([option('A', true), option('B'), { ...option('C'), tags: ['only-one'] }]))).toThrow(/tags/i)
    expect(() => parseDesignOptions(JSON.stringify([option('A'), option('B'), option('C')]))).toThrow(/recommended/i)
    expect(() => parseDesignOptions(JSON.stringify([
      { ...option('A', true), pillarStance: 'core' },
      option('B'),
      option('C'),
    ]))).toThrow(/A\.pillarStance must be an object/i)
  })

  it('materializes only the selected option as the formal core document', () => {
    const options = [option('A', true), option('B'), option('C')]
    const markdown = materializeCoreMarkdown(options, 'B')
    expect(markdown).toContain('selected_option: B')
    expect(markdown).toContain('项目介绍 B')
    expect(markdown).not.toContain('项目介绍 A')
    expect(markdown).not.toContain('项目介绍 C')
    expect(markdown).toContain('> 一句话钩子')
    expect(markdown).not.toContain('阶段 2 · 已应用设计 Slide 方案')
    expect(markdown).not.toContain('### 方案 B · 奈何')
  })

  it('recognizes a materialized core without treating a placeholder as finalized', () => {
    expect(hasSelectedDesignOption('    selected_option: B')).toBe(true)
    expect(hasSelectedDesignOption('# 哪吒闹海核心方案\n\n方案A和方案B和方案C')).toBe(false)
    expect(hasSelectedDesignOption('    selected_option: null')).toBe(false)
  })

  it('rejects applying an option that is not in the current array', () => {
    expect(() => materializeCoreMarkdown([option('A', true), option('B'), option('C')], 'D' as never)).toThrow(/option/i)
  })
})
