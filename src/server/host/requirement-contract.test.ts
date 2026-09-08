import { describe, expect, it } from 'vitest'
import { normalizeRequirementContract } from './workflow-state'

/**
 * 需求契约（设计 §9.10.3）。
 *
 * 删除 `document.intake` 后它是需求唯一的留存形态，所以两件事必须钉死：
 * 每一维的来源要留下（这是 intake 文档原本的核心价值），
 * 以及长度有上限——它是生产输入记录，不是第二份策划文档。
 */
describe('需求契约归一化', () => {
  it('保留原始首句与每一维的来源标记', () => {
    const contract = normalizeRequirementContract({
      rawIntent: '我想做一个武松打虎的互动短片',
      locale: 'zh-CN',
      visualStyle: { id: 'ink', name: '水墨' },
      dimensions: {
        core_fun: { value: '回合战斗与反应窗口', source: 'author' },
        work_scale: { value: '短篇', source: 'default' },
      },
    })!

    expect(contract.rawIntent).toBe('我想做一个武松打虎的互动短片')
    expect(contract.dimensions.core_fun).toEqual({ value: '回合战斗与反应窗口', source: 'author' })
    expect(contract.dimensions.work_scale?.source).toBe('default')
    expect(contract.visualStyle).toEqual({ id: 'ink', name: '水墨' })
    expect(contract.schemaVersion).toBe(1)
    expect(contract.collectedAt).toBeTruthy()
  })

  it('来源缺失或非法时记为推断，不静默丢维度', () => {
    const contract = normalizeRequirementContract({
      rawIntent: '做个游戏',
      dimensions: { tone: { value: '悲壮' }, broken: { value: '未知', source: '瞎猜' } },
    })!

    expect(contract.dimensions.tone?.source).toBe('inferred')
    expect(contract.dimensions.broken?.source).toBe('inferred')
  })

  it('超长输入截断并置位 truncated，不让契约膨胀成策划文档', () => {
    const contract = normalizeRequirementContract({
      rawIntent: '长'.repeat(5000),
      dimensions: { tone: { value: '细'.repeat(2000), source: 'author' } },
    })!

    expect(contract.rawIntent.length).toBe(2000)
    expect(contract.dimensions.tone?.value.length).toBe(500)
    expect(contract.truncated).toBe(true)
  })

  it('缺少原始首句时不写入半成品契约', () => {
    expect(normalizeRequirementContract({ dimensions: {} })).toBeNull()
    expect(normalizeRequirementContract({ rawIntent: '   ' })).toBeNull()
    expect(normalizeRequirementContract(null)).toBeNull()
  })

  it('locale 缺省为中文，显式给出时以调用方为准', () => {
    expect(normalizeRequirementContract({ rawIntent: '做个游戏' })!.locale).toBe('zh-CN')
    expect(normalizeRequirementContract({ rawIntent: 'make a game', locale: 'en-US' })!.locale).toBe('en-US')
  })
})
