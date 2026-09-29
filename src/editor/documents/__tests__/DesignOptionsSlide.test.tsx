import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '../../../i18n'
import { setDesignOptionsGate } from '../design-options-gate'
import { applyHostInit, resetHostInjectionForTests } from '@/editor/host-init'
import { DesignOptionsSlide } from '../DesignOptionsSlide'

const mocks = vi.hoisted(() => ({
  applyDesignOptions: vi.fn(),
  fetchProjectDocument: vi.fn(),
}))

vi.mock('../document-client', () => ({
  applyDesignOptions: mocks.applyDesignOptions,
  fetchProjectDocument: mocks.fetchProjectDocument,
}))

const option = (id: 'A' | 'B' | 'C', recommended = false) => ({
  id,
  title: `方案 ${id}`,
  recommended,
  tags: ['赛虹废墟', '记忆流患', '阶层档格', '残缺人性'],
  genre: '东方奇幻',
  visualStyle: '游戏 CG',
  scale: '短篇',
  projectIntroduction: `项目介绍 ${id}`,
  themeExpression: `主题表达 ${id}`,
  mainLoop: `主循环 ${id}`,
  deliveryPromise: `交付承诺 ${id}`,
  pillarStance: { narrative: 'core' },
  markdown: `### 方案 ${id}\n\n> 钩子 ${id}`,
})

const content = JSON.stringify([option('A', true), option('B'), option('C')])

describe('DesignOptionsSlide apply preconditions', () => {
  beforeEach(() => {
    setLocale('zh')
    mocks.applyDesignOptions.mockReset()
    mocks.applyDesignOptions.mockResolvedValue({
      selectedOptionId: 'A',
      document: { id: 'doc-core', name: '核心', documentType: 'core', updatedAt: 1 },
    })
  })
  afterEach(() => {
    setDesignOptionsGate(null)
    resetHostInjectionForTests()
    setLocale('en')
  })

  // 回归：宿主挂载但门没接上时，旧实现会照常物化 core、盖章 core 门，然后
  // `gate?.onApplied?.()` 静默跳过唤醒——作者只看到弹窗消失却没有下文。
  it('refuses to apply when a hosted mount has no wake channel', async () => {
    applyHostInit({ host: {} as never })
    setDesignOptionsGate(null)
    render(<DesignOptionsSlide content={content} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /应用方案/ }))
      await Promise.resolve()
    })

    expect(mocks.applyDesignOptions).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('无法把你的选择告知造化')
  })

  it('applies through the host gate when the wake channel is wired', async () => {
    const onApplied = vi.fn(async () => {})
    applyHostInit({ host: {} as never })
    setDesignOptionsGate({ onApplied })
    render(<DesignOptionsSlide content={content} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /应用方案/ }))
      await Promise.resolve()
    })

    expect(mocks.applyDesignOptions).toHaveBeenCalledWith('A')
    expect(onApplied).toHaveBeenCalledWith('A', { title: '方案 A' })
  })

  // 独立形态（player / 本地预览）没有编排者要唤醒，应用仍然必须可用。
  it('still applies without a host attached', async () => {
    setDesignOptionsGate(null)
    render(<DesignOptionsSlide content={content} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /应用方案/ }))
      await Promise.resolve()
    })

    expect(mocks.applyDesignOptions).toHaveBeenCalledWith('A')
  })
})

describe('DesignOptionsSlide regenerate status', () => {
  beforeEach(() => {
    setLocale('zh')
    mocks.fetchProjectDocument.mockReset()
  })
  afterEach(() => {
    setDesignOptionsGate(null)
    resetHostInjectionForTests()
    setLocale('en')
  })

  it('shows “核心设计生成中…” while regenerating', async () => {
    let resolveRegenerate: (() => void) | null = null
    setDesignOptionsGate({
      onRegenerate: () => new Promise<void>((resolve) => { resolveRegenerate = resolve }),
    })
    render(<DesignOptionsSlide content={content} />)

    const regenerateButton = screen.getByRole('button', { name: /重新生成/ })
    await act(async () => {
      fireEvent.click(regenerateButton)
      await Promise.resolve()
    })

    expect(screen.getByText('核心设计生成中…')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '方案 A' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '方案 B' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '方案 C' })).toBeTruthy()
    expect(screen.getByText('正在处理，请稍候…')).toBeTruthy()

    await act(async () => {
      resolveRegenerate?.()
      await Promise.resolve()
      await Promise.resolve()
    })
  })

  it('refreshes the cards after regeneration rewrites the same document', async () => {
    vi.useFakeTimers()
    const refreshedContent = JSON.stringify([
      { ...option('A', true), title: '重新生成的方案 A' },
      { ...option('B'), title: '重新生成的方案 B' },
      { ...option('C'), title: '重新生成的方案 C' },
    ])
    mocks.fetchProjectDocument
      .mockResolvedValueOnce({ ...option('A', true), content })
      .mockResolvedValueOnce({
        id: 'doc-design-options',
        name: '核心方案候选',
        documentType: 'design-options',
        updatedAt: 2,
        content: refreshedContent,
      })

    let resolveRegenerate: (() => void) | null = null
    let rerender: (ui: ReactNode) => void = () => {}
    const onContentReload = vi.fn((next: { content: string }) => {
      rerender(<DesignOptionsSlide documentId="doc-design-options" content={next.content} onContentReload={onContentReload} />)
    })
    setDesignOptionsGate({
      onRegenerate: () => new Promise<void>((resolve) => { resolveRegenerate = resolve }),
    })
    const rendered = render(
      <DesignOptionsSlide
        documentId="doc-design-options"
        content={content}
        onContentReload={onContentReload}
      />,
    )
    rerender = rendered.rerender

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /重新生成/ }))
      resolveRegenerate?.()
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onContentReload).toHaveBeenCalledWith(expect.objectContaining({ content: refreshedContent }))
    expect(screen.getByText('重新生成的方案 A')).toBeTruthy()
  })
})
