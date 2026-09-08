import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyHostInit, resetHostInjectionForTests } from '@/editor/host-init'
import { useDocumentNav } from '../../persist/documentNavStore'
import { useProductionProjection } from '../../persist/productionProjectionStore'
import { DocumentLibraryView } from '../DocumentLibraryView'

const mocks = vi.hoisted(() => ({
  fetchProjectDocuments: vi.fn(),
  fetchProjectDocument: vi.fn(),
  applyDesignOptions: vi.fn(),
}))

const designOptions = [
  { id: 'A', title: '奈何', recommended: true, tags: ['赛虹废墟', '记忆流患', '阶层档格', '残缺人性'], genre: '东方奇幻 / 悬疑', visualStyle: '游戏 CG、3D 写实化风', scale: '短篇 · 预计游玩 25 分钟', projectIntroduction: '一个鬼市渡魂师在超度亡魂时发现自己也被执念所困。', themeExpression: '在执念与超脱之间，选择是渡人还是渡己', mainLoop: 'A 循环', deliveryPromise: 'A 承诺', pillarStance: { narrative: 'core' }, markdown: '### 方案 A · 奈何\n\n> 一句话钩子\n\n#### 项目介绍\n完整项目介绍' },
  { id: 'B', title: '回响', recommended: false, tags: ['记忆', '回合', '雨夜', '抉择'], genre: '悬疑 / 回合战斗', visualStyle: '3D 写实化风', scale: '中篇 · 预计游玩 40 分钟', projectIntroduction: 'B 项目', themeExpression: 'B 主题', mainLoop: 'B 循环', deliveryPromise: 'B 承诺', pillarStance: { narrative: 'support' }, markdown: '方案 B' },
  { id: 'C', title: '归潮', recommended: false, tags: ['潮汐', '旧城', '线索', '团圆'], genre: '探索 / 叙事', visualStyle: '游戏 CG', scale: '短篇 · 预计游玩 20 分钟', projectIntroduction: 'C 项目', themeExpression: 'C 主题', mainLoop: 'C 循环', deliveryPromise: 'C 承诺', pillarStance: { narrative: 'core' }, markdown: '方案 C' },
]

function mockDesignOptionsDocument(): void {
  mocks.fetchProjectDocuments.mockResolvedValue({
    documents: [{ id: 'doc-design-options', name: '核心方案候选', documentType: 'design-options', updatedAt: 1 }],
  })
  mocks.fetchProjectDocument.mockResolvedValue({
    id: 'doc-design-options', name: '核心方案候选', documentType: 'design-options', updatedAt: 1,
    content: JSON.stringify(designOptions),
  })
  useDocumentNav.setState({ documentType: 'design-options' })
}

vi.mock('../document-client', () => ({
  fetchProjectDocuments: mocks.fetchProjectDocuments,
  fetchProjectDocument: mocks.fetchProjectDocument,
  applyDesignOptions: mocks.applyDesignOptions,
}))

describe('DocumentLibraryView', () => {
  beforeEach(() => {
    mocks.fetchProjectDocuments.mockReset()
    mocks.fetchProjectDocument.mockReset()
    mocks.applyDesignOptions.mockReset()
    useDocumentNav.setState({ documentType: 'intake' })
    useProductionProjection.setState({ projection: null, expanded: new Set(), followMode: true })
    resetHostInjectionForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    resetHostInjectionForTests()
  })

  it('shows a read-only empty state when a new project has no Markdown documents', async () => {
    mocks.fetchProjectDocuments.mockResolvedValue({ documents: [] })

    const { container } = render(<DocumentLibraryView />)

    await waitFor(() => {
      expect(screen.getByText('当前项目尚无需求。')).toBeTruthy()
    })
    expect(container.querySelector('.gdx-header')).toBeNull()
    expect(container.querySelector('.gdx-title')).toBeNull()
    expect(screen.queryByRole('button', { name: /创建|上传|编辑|采用/ })).toBeNull()
  })

  it('renders the Figma empty state while the core document is being generated', async () => {
    mocks.fetchProjectDocuments.mockResolvedValue({ documents: [] })
    useDocumentNav.setState({ documentType: 'core' })
    useProductionProjection.setState({
      projection: {
        schemaVersion: 1,
        gameId: 'game-doc-streaming',
        workflowRevision: 2,
        phase: 'planning-design',
        phaseRevision: 1,
        phaseStatus: 'working',
        activity: 'document.core',
        activityRevision: 1,
        activityStatus: 'working',
        activeActivities: ['document.core'],
        group: { id: 'design', status: 'working', revision: 1 },
        phases: {
          'requirements-collection': { status: 'complete', revision: 1 },
          'planning-design': { status: 'working', revision: 1 },
          'feature-development': { status: 'not-started', revision: 0 },
          'asset-generation': { status: 'not-started', revision: 0 },
        },
        modules: {
          documents: { availability: 'working' },
          'document.core': { availability: 'working' },
        },
        gates: {},
        artifacts: [],
      },
    })

    const { container } = render(<DocumentLibraryView />)

    await waitFor(() => expect(mocks.fetchProjectDocuments).toHaveBeenCalled())
    expect(container.querySelector('.gdx-content')).toHaveClass('is-document-empty')
    expect(container.querySelector('.gdx-document-empty img')).toHaveAttribute('src')
    expect(screen.getByText('暂无内容')).toBeTruthy()
    expect(container.querySelector('.gdx-empty')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mocks.fetchProjectDocument).not.toHaveBeenCalled()
  })

  it.each([
    ['core'],
    ['pillar'],
  ] as const)('renders the Figma empty state for an empty %s document', async (documentType) => {
    mocks.fetchProjectDocuments.mockResolvedValue({ documents: [] })
    useDocumentNav.setState({ documentType })

    const { container } = render(<DocumentLibraryView />)

    await waitFor(() => {
      expect(container.querySelector('.gdx-content')).toHaveClass('is-document-empty')
    })
    expect(screen.getByText('暂无内容')).toBeTruthy()
  })

  it('renders the Figma empty state when the core document list cannot load', async () => {
    mocks.fetchProjectDocuments.mockRejectedValue(new Error('读取项目文档失败'))
    useDocumentNav.setState({ documentType: 'core' })

    const { container } = render(<DocumentLibraryView />)

    await waitFor(() => {
      expect(container.querySelector('.gdx-content')).toHaveClass('is-document-empty')
    })
    expect(screen.getByText('暂无内容')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([
    ['core', 'document.core', '核心方案'],
    ['pillar', 'document.pillar', '支柱方案'],
  ] as const)('refetches %s when generation makes the active document ready', async (
    documentType,
    activeModule,
    documentName,
  ) => {
    const documentId = `doc-${documentType}`
    mocks.fetchProjectDocuments
      .mockResolvedValueOnce({ documents: [] })
      .mockResolvedValueOnce({
        documents: [{ id: documentId, name: documentName, documentType, updatedAt: 2 }],
      })
    mocks.fetchProjectDocument.mockResolvedValue({
      id: documentId,
      name: documentName,
      documentType,
      updatedAt: 2,
      content: `# ${documentName}`,
    })
    useDocumentNav.setState({ documentType })
    useProductionProjection.setState({
      projection: {
        schemaVersion: 1,
        gameId: 'game-doc-streaming',
        workflowRevision: 2,
        phase: 'planning-design',
        phaseRevision: 1,
        phaseStatus: 'working',
        activity: activeModule,
        activityRevision: 1,
        activityStatus: 'working',
        activeActivities: [activeModule],
        group: { id: 'design', status: 'working', revision: 1 },
        phases: {
          'requirements-collection': { status: 'complete', revision: 1 },
          'planning-design': { status: 'working', revision: 1 },
          'feature-development': { status: 'not-started', revision: 0 },
          'asset-generation': { status: 'not-started', revision: 0 },
        },
        modules: {
          documents: { availability: 'working', count: 0 },
          'document.core': activeModule === 'document.core'
            ? { availability: 'working', count: 0 }
            : { availability: 'hidden' },
          'document.pillar': activeModule === 'document.pillar'
            ? { availability: 'working', count: 0 }
            : { availability: 'hidden' },
        },
        gates: {},
        artifacts: [],
      },
    })

    render(<DocumentLibraryView />)

    await waitFor(() => expect(mocks.fetchProjectDocuments).toHaveBeenCalledTimes(1))
    const current = useProductionProjection.getState().projection
    expect(current).not.toBeNull()
    act(() => {
      useProductionProjection.setState({
        projection: {
          ...current!,
          workflowRevision: 3,
          activityStatus: 'complete',
          activeActivities: [],
          modules: {
            ...current!.modules,
            documents: { availability: 'ready', count: 1 },
            [activeModule]: { availability: 'ready', count: 1 },
          },
        },
      })
    })

    await waitFor(() => expect(mocks.fetchProjectDocuments).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('heading', { level: 1, name: documentName })).toBeTruthy()
    expect(mocks.fetchProjectDocument).toHaveBeenCalledWith(documentId)
  })

  it('renders a single registered document for the active type', async () => {
    mocks.fetchProjectDocuments.mockResolvedValue({
      documents: [
        { id: 'doc-core', name: '核心方案', documentType: 'core', updatedAt: 1 },
      ],
    })
    mocks.fetchProjectDocument.mockResolvedValue({
      id: 'doc-core', name: '核心方案', documentType: 'core', updatedAt: 1, content: '# 核心',
    })
    useDocumentNav.setState({ documentType: 'core' })

    render(<DocumentLibraryView />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: '核心' })).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: '采用' })).toBeNull()
  })

  it.each([
    ['core', '核心正文'],
    ['pillar', '支柱正文'],
  ] as const)('renders %s with the shared Figma author reader', async (documentType, body) => {
    mocks.fetchProjectDocuments.mockResolvedValue({
      documents: [{ id: `doc-${documentType}`, name: body, documentType, updatedAt: 1 }],
    })
    mocks.fetchProjectDocument.mockResolvedValue({
      id: `doc-${documentType}`,
      name: body,
      documentType,
      updatedAt: 1,
      content: `# ${body}`,
    })
    useDocumentNav.setState({ documentType })

    const { container } = render(<DocumentLibraryView />)

    expect(await screen.findByRole('heading', { level: 1, name: body })).toBeTruthy()
    expect(container.querySelector('.gdx-author-frame')).toBeTruthy()
    expect(container.querySelector('.gdx-paper')).toBeTruthy()

    const css = document.querySelector('style[data-reel-style="game-author-document"]')?.textContent ?? ''
    expect(css).toMatch(/padding:\s*24px 120px 40px/)
    expect(css).toMatch(/max-width:\s*862px/)
    expect(css).toMatch(/height:\s*100%/)
    expect(css).toMatch(/overflow-y:\s*auto/)
    expect(css).toMatch(/font-size:\s*16px/)
    expect(css).toMatch(/line-height:\s*1\.5/)
  })

  it('renders chapter dividers below headings with 30px chapter spacing', async () => {
    mocks.fetchProjectDocuments.mockResolvedValue({
      documents: [{ id: 'doc-pillar', name: '支柱', documentType: 'pillar', updatedAt: 1 }],
    })
    mocks.fetchProjectDocument.mockResolvedValue({
      id: 'doc-pillar',
      name: '支柱',
      documentType: 'pillar',
      updatedAt: 1,
      content: '# 支柱设计\n\n---\n\n## 五、场景清单\n\n场景正文',
    })
    useDocumentNav.setState({ documentType: 'pillar' })

    const { container } = render(<DocumentLibraryView />)

    expect(await screen.findByRole('heading', { level: 2, name: '五、场景清单' })).toBeTruthy()
    expect(container.querySelector('.gdx-prose hr')).toBeTruthy()

    const style = document.querySelector('style[data-reel-style="game-author-document"]') as HTMLStyleElement | null
    const rules = Array.from(style?.sheet?.cssRules ?? []) as CSSStyleRule[]
    const chapterRule = rules.find((rule) => rule.selectorText === '.gdx-prose h2')
    const legacyDividerRule = rules.find((rule) => rule.selectorText === '.gdx-prose hr')

    expect(chapterRule?.style.getPropertyValue('margin-top')).toBe('30px')
    expect(chapterRule?.style.getPropertyValue('border-top')).toBe('')
    expect(style?.textContent).toContain(
      'border-bottom:1px solid var(--20,rgba(255,255,255,.20))',
    )
    expect(legacyDividerRule?.style.getPropertyValue('display')).toBe('none')
  })

  it('refetches the document list when the active type changes', async () => {
    mocks.fetchProjectDocuments
      .mockResolvedValueOnce({
        documents: [
          { id: 'doc-intake', name: '需求', documentType: 'intake', updatedAt: 1 },
        ],
      })
      .mockResolvedValueOnce({
        documents: [
          { id: 'doc-intake', name: '需求', documentType: 'intake', updatedAt: 1 },
          { id: 'doc-pillar', name: '支柱', documentType: 'pillar', updatedAt: 3 },
        ],
      })
    mocks.fetchProjectDocument.mockImplementation(async (id: string) => (
      id === 'doc-pillar'
        ? { id, name: '支柱', documentType: 'pillar', updatedAt: 3, content: '支柱正文' }
        : { id, name: '需求', documentType: 'intake', updatedAt: 1, content: '需求正文' }
    ))

    render(<DocumentLibraryView />)

    await waitFor(() => {
      expect(screen.getByText('需求正文')).toBeTruthy()
    })

    act(() => {
      useDocumentNav.setState({ documentType: 'pillar' })
    })

    await waitFor(() => {
      expect(screen.getByText('支柱正文')).toBeTruthy()
    })
    expect(mocks.fetchProjectDocuments).toHaveBeenCalledTimes(2)
    expect(mocks.fetchProjectDocument).toHaveBeenCalledWith('doc-pillar')
    expect(screen.queryByText('需求正文')).toBeNull()
    expect(screen.queryByText('当前项目尚无支柱。')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders only the author-visible layer of the active document', async () => {
    mocks.fetchProjectDocuments.mockResolvedValue({
      documents: [
        { id: 'doc-pillar', name: '支柱', documentType: 'pillar', updatedAt: 3 },
      ],
    })
    mocks.fetchProjectDocument.mockResolvedValue({
      id: 'doc-pillar',
      name: '支柱',
      documentType: 'pillar',
      updatedAt: 3,
      content: [
        '# 黑神话 · 支柱设计',
        '',
        '    schema_version: 1',
        '    based_on_option: A',
        '',
        '<!-- ========== 作者可见层（确认门渲染此段） ========== -->',
        '',
        '### 序：五行山下',
        '',
        '五百年前那一架没打完。',
        '',
        '<!-- ========== 契约层（作者界面默认折叠） ========== -->',
        '',
        '| 字段 | 值 |',
        '| --- | --- |',
        '| ap_cost | 3 |',
      ].join('\n'),
    })
    useDocumentNav.setState({ documentType: 'pillar' })

    render(<DocumentLibraryView />)

    await waitFor(() => {
      expect(screen.getByText('五百年前那一架没打完。')).toBeTruthy()
    })
    const prose = screen.getByText('五百年前那一架没打完。').closest('.gdx-prose')
    expect(prose).toBeTruthy()
    expect(prose?.textContent ?? '').not.toContain('schema_version')
    expect(prose?.textContent ?? '').not.toContain('<!--')
    expect(prose?.textContent ?? '').not.toContain('ap_cost')
  })

  it('hosts docActionSlotEl without header chrome before the document content', async () => {
    mocks.fetchProjectDocuments.mockResolvedValue({ documents: [] })
    const slot = document.createElement('div')
    slot.textContent = 'HOST_BAR'
    applyHostInit({ docActionSlotEl: slot })

    render(<DocumentLibraryView />)

    const hostBar = await screen.findByText('HOST_BAR')
    const root = hostBar.closest('.gdx-root')
    const slotHost = screen.getByTestId('doc-action-slot-host')
    expect(root).toBeTruthy()
    expect(slotHost.parentElement).toBe(root)
    expect(slotHost.nextElementSibling?.classList.contains('gdx-content')).toBe(true)
    expect(root?.querySelector('.gdx-header')).toBeNull()
    expect(slotHost.contains(slot)).toBe(true)
  })

  it('renders design-options as an A/B/C Slide with the Figma card fields', async () => {
    mockDesignOptionsDocument()

    const { container } = render(<DocumentLibraryView />)

    expect(await screen.findByText('选择一个核心设计进行应用')).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 1, name: '核心方案候选' })).toBeNull()
    expect([...container.querySelectorAll('.gdo-badge')].map((badge) => badge.textContent)).toEqual([
      '方案 A · 推荐',
      '方案 B',
      '方案 C',
    ])
    expect(container.querySelector('.gdo-root')?.textContent).not.toContain('{id}')
    expect(screen.getByText('奈何')).toBeTruthy()
    expect(screen.getByText('一句话钩子')).toBeTruthy()
    expect(screen.getAllByText('项目介绍').length).toBeGreaterThan(0)
    expect(screen.getAllByText('一个鬼市渡魂师在超度亡魂时发现自己也被执念所困。').length).toBe(1)
    expect(screen.getAllByText('主题表达').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /应用方案/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /重新生成/ })).toBeTruthy()
    expect(container.querySelector('.gdx-content')).toHaveClass('is-design-options')
    expect(container.querySelector('.gdo-root')).toBeTruthy()
    expect(container.querySelector('.gdx-author-frame')).toBeNull()

    const optionA = container.querySelector('[data-option-id="A"]')
    const optionB = container.querySelector('[data-option-id="B"]')
    const optionC = container.querySelector('[data-option-id="C"]')
    expect(optionA).toHaveAttribute('data-carousel-slot', 'center')
    expect(optionB).toHaveAttribute('data-carousel-slot', 'right')
    expect(optionC).toHaveAttribute('data-carousel-slot', 'left')

    const carousel = container.querySelector('.gdo-carousel') as HTMLElement
    const centerStyle = window.getComputedStyle(optionA as Element)
    const leftStyle = window.getComputedStyle(optionC as Element)
    const rightStyle = window.getComputedStyle(optionB as Element)
    const cardStyle = window.getComputedStyle(optionA?.querySelector('.gdo-card') as Element)
    const badgeStyle = window.getComputedStyle(optionA?.querySelector('.gdo-badge') as Element)
    expect(centerStyle.width).toBe('640px')
    expect(centerStyle.height).toBe('654px')
    expect(centerStyle.borderRadius).toBe('12px')
    expect(cardStyle.paddingTop).toBe('32px')
    expect(cardStyle.paddingRight).toBe('32px')
    expect(cardStyle.paddingBottom).toBe('40px')
    expect(cardStyle.paddingLeft).toBe('32px')
    expect(badgeStyle.paddingTop).toBe('4px')
    expect(badgeStyle.paddingRight).toBe('16px')
    expect(badgeStyle.paddingBottom).toBe('4px')
    expect(badgeStyle.paddingLeft).toBe('16px')
    expect(badgeStyle.borderRadius).toBe('8px')
    expect(badgeStyle.fontSize).toBe('16px')
    expect(badgeStyle.lineHeight).toBe('24px')
    expect(leftStyle.width).toBe(centerStyle.width)
    expect(leftStyle.height).toBe(centerStyle.height)
    expect(leftStyle.transform).toContain('translate(-92%,-50%)')
    expect(rightStyle.transform).toContain('translate(-8%,-50%)')

    fireEvent.click(screen.getByRole('button', { name: '下一个方案' }))
    expect(optionA).toHaveAttribute('data-carousel-slot', 'left')
    expect(optionB).toHaveAttribute('data-carousel-slot', 'center')
    expect(optionC).toHaveAttribute('data-carousel-slot', 'right')
    expect(container.querySelector('[data-option-id="A"]')).toBe(optionA)

    fireEvent.click(screen.getByRole('button', { name: '下一个方案' }))
    expect(optionB).toHaveAttribute('data-carousel-slot', 'center')

    fireEvent.transitionEnd(optionB as Element)
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '下一个方案' }))
    expect(optionC).toHaveAttribute('data-carousel-slot', 'center')
    fireEvent.click(screen.getByRole('button', { name: '下一个方案' }))
    expect(optionC).toHaveAttribute('data-carousel-slot', 'center')
    act(() => vi.advanceTimersByTime(600))
    fireEvent.click(screen.getByRole('button', { name: '下一个方案' }))
    expect(optionA).toHaveAttribute('data-carousel-slot', 'center')
    fireEvent.transitionEnd(optionA as Element)
    fireEvent.click(screen.getByRole('button', { name: '上一个方案' }))
    expect(optionC).toHaveAttribute('data-carousel-slot', 'center')
  })

  it('uses the core sidebar entry for the A/B/C chooser until a core is applied', async () => {
    mocks.fetchProjectDocuments
      .mockResolvedValueOnce({
        documents: [{ id: 'doc-design-options', name: '核心方案候选', documentType: 'design-options', updatedAt: 1 }],
      })
      .mockResolvedValueOnce({
        documents: [
          { id: 'doc-design-options', name: '核心方案候选', documentType: 'design-options', updatedAt: 1 },
          { id: 'doc-core', name: '核心', documentType: 'core', updatedAt: 2 },
        ],
      })
    mocks.fetchProjectDocument.mockImplementation(async (id: string) => (
      id === 'doc-core'
        ? { id, name: '核心', documentType: 'core', updatedAt: 2, content: '# 人间棋局 · 核心设计\n\n    selected_option: B' }
        : { id, name: '核心方案候选', documentType: 'design-options', updatedAt: 1, content: JSON.stringify(designOptions) }
    ))
    mocks.applyDesignOptions.mockResolvedValue({
      selectedOptionId: 'B',
      document: { id: 'doc-core', name: '核心', documentType: 'core', updatedAt: 2 },
    })
    useDocumentNav.setState({ documentType: 'core' })

    render(<DocumentLibraryView />)

    expect(await screen.findByText('选择一个核心设计进行应用')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下一个方案' }))
    fireEvent.transitionEnd(screen.getByText('回响').closest('[data-option-id="B"]') as Element)
    fireEvent.click(screen.getByRole('button', { name: /应用方案/ }))

    expect(await screen.findByRole('heading', { level: 1, name: '人间棋局 · 核心设计' })).toBeTruthy()
    expect(useDocumentNav.getState().documentType).toBe('core')
    expect(screen.queryByLabelText('核心方案候选')).toBeNull()
  })

  it('does not let a placeholder core hide ready design-options', async () => {
    mocks.fetchProjectDocuments.mockResolvedValue({
      documents: [
        { id: 'doc-design-options', name: '核心方案候选', documentType: 'design-options', updatedAt: 1 },
        { id: 'doc-core-placeholder', name: '哪吒闹海核心方案', documentType: 'core', updatedAt: 2 },
      ],
    })
    mocks.fetchProjectDocument.mockImplementation(async (id: string) => (
      id === 'doc-core-placeholder'
        ? { id, name: '哪吒闹海核心方案', documentType: 'core', updatedAt: 2, content: '# 哪吒闹海核心方案\n\n方案A和方案B和方案C' }
        : { id, name: '核心方案候选', documentType: 'design-options', updatedAt: 1, content: JSON.stringify(designOptions) }
    ))
    useDocumentNav.setState({ documentType: 'core' })

    render(<DocumentLibraryView />)

    expect(await screen.findByText('选择一个核心设计进行应用')).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 1, name: '哪吒闹海核心方案' })).toBeNull()
  })

  it('removes hidden compact side cards from keyboard and accessibility navigation', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query === '(max-width: 760px)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    mockDesignOptionsDocument()

    const { container } = render(<DocumentLibraryView />)
    await screen.findByText('选择一个核心设计进行应用')

    const center = container.querySelector('[data-carousel-slot="center"]')
    const sides = [...container.querySelectorAll('[data-carousel-slot="left"], [data-carousel-slot="right"]')]
    expect(center).not.toHaveAttribute('aria-hidden')
    for (const side of sides) {
      expect(side).toHaveAttribute('aria-hidden', 'true')
      expect(side.querySelector('button')).toHaveAttribute('tabindex', '-1')
    }
  })

  it('responds to reduced-motion changes without waiting for transition completion', async () => {
    let reduceListener: ((event: MediaQueryListEvent) => void) | undefined
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn((type, listener) => {
        if (query === '(prefers-reduced-motion: reduce)' && type === 'change') {
          reduceListener = listener as (event: MediaQueryListEvent) => void
        }
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    mockDesignOptionsDocument()

    const { container } = render(<DocumentLibraryView />)
    await screen.findByText('选择一个核心设计进行应用')
    act(() => reduceListener?.({ matches: true } as MediaQueryListEvent))
    fireEvent.click(screen.getByRole('button', { name: '下一个方案' }))
    fireEvent.click(screen.getByRole('button', { name: '下一个方案' }))

    expect(container.querySelector('[data-option-id="C"]')).toHaveAttribute('data-carousel-slot', 'center')
  })

  it('uses the same carousel direction for keyboard and touch navigation', async () => {
    mockDesignOptionsDocument()

    const { container } = render(<DocumentLibraryView />)
    const root = await screen.findByLabelText('核心方案候选')
    fireEvent.keyDown(root, { key: 'ArrowLeft' })
    const optionC = container.querySelector('[data-option-id="C"]')
    expect(optionC).toHaveAttribute('data-carousel-slot', 'center')

    fireEvent.transitionEnd(optionC as Element)
    fireEvent.touchStart(root, { touches: [{ clientX: 300 }] })
    fireEvent.touchEnd(root, { changedTouches: [{ clientX: 100 }] })
    expect(container.querySelector('[data-option-id="A"]')).toHaveAttribute('data-carousel-slot', 'center')
  })

  it('keeps the chooser visible until the author gate approval settles', async () => {
    let finishApproval = (): void => {}
    const approvalPending = new Promise<void>((resolve) => { finishApproval = resolve })
    const onApplied = vi.fn(() => approvalPending)
    mocks.fetchProjectDocuments
      .mockResolvedValueOnce({
        documents: [{ id: 'doc-design-options', name: '核心方案候选', documentType: 'design-options', updatedAt: 1 }],
      })
      .mockResolvedValueOnce({
        documents: [{ id: 'doc-core', name: '核心', documentType: 'core', updatedAt: 2 }],
      })
    mocks.fetchProjectDocument.mockImplementation(async (id: string) => (
      id === 'doc-core'
        ? { id, name: '核心', documentType: 'core', updatedAt: 2, content: '# 回响核心\n\nB 项目' }
        : { id, name: '核心方案候选', documentType: 'design-options', updatedAt: 1, content: JSON.stringify(designOptions) }
    ))
    mocks.applyDesignOptions.mockResolvedValue({
      selectedOptionId: 'B',
      document: { id: 'doc-core', name: '核心', documentType: 'core', updatedAt: 2 },
    })
    applyHostInit({ designOptionsGate: { onApplied } })
    useDocumentNav.setState({ documentType: 'design-options' })

    try {
      render(<DocumentLibraryView />)
      fireEvent.click(await screen.findByRole('button', { name: '下一个方案' }))
      fireEvent.transitionEnd(screen.getByText('回响').closest('[data-option-id="B"]') as Element)
      fireEvent.click(await screen.findByRole('button', { name: /应用方案/ }))

      await waitFor(() => expect(onApplied).toHaveBeenCalledWith('B', { title: '回响' }))
      expect(useDocumentNav.getState().documentType).toBe('design-options')
      expect(screen.getByLabelText('核心方案候选')).toBeTruthy()
      expect(mocks.applyDesignOptions).toHaveBeenCalledWith('B')

      await act(async () => {
        finishApproval()
        await approvalPending
      })

      expect(useDocumentNav.getState().documentType).toBe('core')
      expect(await screen.findByRole('heading', { level: 1, name: '回响核心' })).toBeTruthy()
      expect(screen.queryByLabelText('核心方案候选')).toBeNull()
    } finally {
      finishApproval()
    }
  })

  it('keeps the chooser retryable when the author gate approval fails', async () => {
    let rejectApproval = (_cause: Error): void => {}
    const approvalPending = new Promise<void>((_resolve, reject) => {
      rejectApproval = reject
    })
    const onApplied = vi.fn(() => approvalPending)
    mockDesignOptionsDocument()
    mocks.applyDesignOptions.mockResolvedValue({
      selectedOptionId: 'A',
      document: { id: 'doc-core', name: '核心', documentType: 'core', updatedAt: 2 },
    })
    applyHostInit({ designOptionsGate: { onApplied } })

    render(<DocumentLibraryView />)
    const applyButton = await screen.findByRole('button', { name: /应用方案/ })
    await act(async () => {
      fireEvent.click(applyButton)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith('A', { title: '奈何' }))
    await act(async () => {
      rejectApproval(new Error('方案审核未完成，请重试'))
      await approvalPending.catch(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('方案审核未完成，请重试')
    expect(useDocumentNav.getState().documentType).toBe('design-options')
    expect(screen.getByLabelText('核心方案候选')).toBeTruthy()
  })

  it('re-fetches and displays updated design options when workflow projection advances after regeneration', async () => {
    const regeneratedOptions = [
      { id: 'A', title: '虎影三叹', recommended: true, tags: ['内心情绪', '心理压迫', '绝境', '狂化'], genre: '动作 / 心理', visualStyle: '东方玄幻 3D', scale: '短篇', projectIntroduction: '虎影三叹介绍', themeExpression: '心绪博弈', mainLoop: 'A 循环', deliveryPromise: 'A 承诺', pillarStance: { narrative: 'core' }, markdown: '### 方案 A · 虎影三叹\n\n> 心理压迫\n\n#### 项目介绍\n虎影三叹介绍' },
      { id: 'B', title: '冈上擂台', recommended: false, tags: ['见招拆招', '格斗博弈', '拳脚', '拆招'], genre: '动作', visualStyle: '东方玄幻 3D', scale: '短篇', projectIntroduction: '冈上擂台介绍', themeExpression: '格斗博弈', mainLoop: 'B 循环', deliveryPromise: 'B 承诺', pillarStance: { narrative: 'support' }, markdown: '方案 B' },
      { id: 'C', title: '绝冈擂鼓', recommended: false, tags: ['节奏流', '鼓点', '连续', '酣畅'], genre: '节奏 / 动作', visualStyle: '东方玄幻 3D', scale: '短篇', projectIntroduction: '绝冈擂鼓介绍', themeExpression: '节奏酣畅', mainLoop: 'C 循环', deliveryPromise: 'C 承诺', pillarStance: { narrative: 'core' }, markdown: '方案 C' },
    ]

    mocks.fetchProjectDocuments.mockResolvedValue({
      documents: [{ id: 'doc-design-options', name: '核心方案候选', documentType: 'design-options', updatedAt: 1 }],
    })
    mocks.fetchProjectDocument.mockImplementation(async (id: string) => {
      if (id === 'doc-design-options') {
        return {
          id: 'doc-design-options',
          name: '核心方案候选',
          documentType: 'design-options',
          updatedAt: 1,
          content: JSON.stringify(designOptions),
        }
      }
      return null
    })

    useDocumentNav.setState({ documentType: 'design-options' })
    useProductionProjection.setState({
      projection: {
        schemaVersion: 1,
        gameId: 'g1',
        workflowRevision: 1,
        phase: 'planning-design',
        phaseRevision: 1,
        phaseStatus: 'working',
        activity: 'document.core',
        activityRevision: 1,
        activityStatus: 'awaiting-user',
        activeActivities: ['document.core'],
        group: { id: 'design', status: 'working', revision: 1 },
        phases: {
          'requirements-collection': { status: 'complete', revision: 1 },
          'planning-design': { status: 'working', revision: 1 },
          'feature-development': { status: 'not-started', revision: 0 },
          'asset-generation': { status: 'not-started', revision: 0 },
        },
        modules: {
          'document.core': { availability: 'ready', count: 1 },
        },
        gates: {},
        artifacts: [],
      },
    })

    render(<DocumentLibraryView />)
    expect(await screen.findByText('奈何')).toBeTruthy()

    // Agent finishes regeneration: document content changes, workflow revision and activity status update
    mocks.fetchProjectDocuments.mockResolvedValue({
      documents: [{ id: 'doc-design-options', name: '核心方案候选', documentType: 'design-options', updatedAt: 2 }],
    })
    mocks.fetchProjectDocument.mockImplementation(async (id: string) => {
      if (id === 'doc-design-options') {
        return {
          id: 'doc-design-options',
          name: '核心方案候选',
          documentType: 'design-options',
          updatedAt: 2,
          content: JSON.stringify(regeneratedOptions),
        }
      }
      return null
    })

    act(() => {
      useProductionProjection.setState({
        projection: {
          schemaVersion: 1,
          gameId: 'g1',
          workflowRevision: 3,
          phase: 'planning-design',
          phaseRevision: 1,
          phaseStatus: 'working',
          activity: 'document.core',
          activityRevision: 2,
          activityStatus: 'awaiting-user',
          activeActivities: ['document.core'],
          group: { id: 'design', status: 'working', revision: 1 },
          phases: {
            'requirements-collection': { status: 'complete', revision: 1 },
            'planning-design': { status: 'working', revision: 1 },
            'feature-development': { status: 'not-started', revision: 0 },
            'asset-generation': { status: 'not-started', revision: 0 },
          },
          modules: {
            'document.core': { availability: 'ready', count: 1 },
          },
          gates: {},
          artifacts: [],
        },
      })
    })

    expect(await screen.findByText('虎影三叹')).toBeTruthy()
    expect(screen.queryByText('奈何')).toBeNull()
  })
})
