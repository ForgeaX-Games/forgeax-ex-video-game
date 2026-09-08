import { describe, expect, it } from 'vitest'
import { extractAuthorVisible } from '../extractAuthorVisible'

const PILLAR = [
  '# 黑神话 · 支柱设计',
  '',
  '> 阶段 3 · 基于核心方案 A · 待作者确认',
  '',
  '    schema_version: 1',
  '    based_on_option: A',
  '    pillars_included: [narrative, combat]',
  '',
  '<!-- ========== 作者可见层（确认门渲染此段，影游大纲级具体） ========== -->',
  '',
  '## 黑神话 · 故事大纲',
  '',
  '### 序：五行山下',
  '',
  '五百年前那一架没打完。',
  '',
  '### 内容卡   <!-- 战斗/探索非 off 时必写；数值折叠到契约层 -->',
  '',
  '- **唤回**：把濒临崩溃的人拉回人性',
  '',
  '<!-- ========== 契约层（作者界面默认折叠） ========== -->',
  '',
  '## 契约层',
  '',
  '| 字段 | 值 |',
  '| --- | --- |',
  '| ap_cost | 3 |',
].join('\n')

describe('extractAuthorVisible', () => {
  it('keeps the pillar author layer and drops contract yaml, comments, and contract sections', () => {
    const result = extractAuthorVisible(PILLAR)

    expect(result).toContain('# 黑神话 · 支柱设计')
    expect(result).toContain('> 阶段 3 · 基于核心方案 A · 待作者确认')
    expect(result).toContain('### 序：五行山下')
    expect(result).toContain('五百年前那一架没打完。')
    expect(result).toContain('- **唤回**：把濒临崩溃的人拉回人性')

    expect(result).not.toContain('schema_version')
    expect(result).not.toContain('based_on_option')
    expect(result).not.toContain('<!--')
    expect(result).not.toContain('## 契约层')
    expect(result).not.toContain('ap_cost')
  })

  it('keeps the 内容卡 heading text while stripping its inline comment', () => {
    const result = extractAuthorVisible(PILLAR)

    expect(result).toContain('### 内容卡')
    expect(result).not.toContain('数值折叠到契约层')
  })

  it('hides pillar frontmatter and the trailing pillar summary from authors', () => {
    const pillar = [
      '---',
      'character_preview_estimate:',
      '  image_count: 5',
      '  characters:',
      '    - 武松',
      '    - 妖虎',
      'pillar_stance:',
      '  narrative: core',
      '  combat: core',
      '  exploration: support',
      '  system: placeholder',
      '---',
      '',
      '# 武松打虎 · 支柱设计',
      '',
      '> 山君噬瞳，武松在断腕或合瞳之间抉择。',
      '',
      '## 一、故事大纲',
      '',
      '节拍 1 · 酒肆寒灯',
      '',
      '---',
      '',
      '*支柱档位：narrative·core / combat·core / exploration·support / system·placeholder selected_option: A · 山君噬瞳*',
    ].join('\n')

    expect(extractAuthorVisible(pillar)).toBe([
      '# 武松打虎 · 支柱设计',
      '',
      '> 山君噬瞳，武松在断腕或合瞳之间抉择。',
      '',
      '## 一、故事大纲',
      '',
      '节拍 1 · 酒肆寒灯',
    ].join('\n'))
  })

  it('keeps the core author options and drops the 下游备忘 section', () => {
    const core = [
      '# 黑神话 · 核心设计',
      '',
      '> 阶段 1 生成 · 候选方案共 3 份，待作者择一',
      '',
      '    schema_version: 1',
      '    option_count: 3',
      '    selected_option: null',
      '',
      '<!-- ========== 以下每份方案：作者可见层（择案卡只渲染此段） ========== -->',
      '',
      '## 方案 A · 破天棍',
      '',
      '### 故事梗概',
      '',
      '你替悟空把那一架打完。',
      '',
      '<!-- ========== 下游备忘（作者界面默认折叠/不展示） ========== -->',
      '',
      '## 下游备忘 · 方案 A',
      '',
      '- **支柱档位**：narrative core / combat core',
    ].join('\n')

    const result = extractAuthorVisible(core)

    expect(result).toContain('## 方案 A · 破天棍')
    expect(result).toContain('你替悟空把那一架打完。')
    expect(result).not.toContain('下游备忘')
    expect(result).not.toContain('支柱档位')
    expect(result).not.toContain('option_count')
  })

  it('keeps intake body when the document has no layer markers', () => {
    const intake = [
      '# 黑神话 · 需求收集',
      '',
      '> 阶段 0 · 契约已锁定，待生成核心设计',
      '',
      '    schema_version: 1',
      '    visual_style: null',
      '    work_scale: 16-25',
      '',
      '## 需求总结',
      '',
      '画风待定，核心乐趣是读招反打。',
      '',
      '## 原始意图',
      '',
      '> 想搞个黑神话',
    ].join('\n')

    const result = extractAuthorVisible(intake)

    expect(result).toContain('## 需求总结')
    expect(result).toContain('画风待定，核心乐趣是读招反打。')
    expect(result).toContain('## 原始意图')
    expect(result).not.toContain('schema_version')
    expect(result).not.toContain('visual_style')
  })

  it('leaves only title and phase line for a contract-only inquiry document', () => {
    const inquiry = [
      '# 黑神话 · 选后问询结果',
      '',
      '> 阶段 2 · 基于方案 A',
      '',
      '    schema_version: 1',
      '    based_on_option: A',
      '    answers:',
      '      - key: choice_density',
      '        value: low',
    ].join('\n')

    expect(extractAuthorVisible(inquiry)).toBe(
      '# 黑神话 · 选后问询结果\n\n> 阶段 2 · 基于方案 A',
    )
  })

  it('drops a fenced contract block but keeps unrelated fenced code', () => {
    const doc = [
      '# 标题',
      '',
      '```yaml',
      'schema_version: 1',
      'based_on_option: A',
      '```',
      '',
      '## 故事大纲',
      '',
      '```text',
      '五行山下',
      '```',
    ].join('\n')

    const result = extractAuthorVisible(doc)

    expect(result).not.toContain('schema_version')
    expect(result).toContain('```text')
    expect(result).toContain('五行山下')
  })

  it('returns an empty string for empty or whitespace-only input', () => {
    expect(extractAuthorVisible('')).toBe('')
    expect(extractAuthorVisible('   \n\n  \n')).toBe('')
  })
})
