import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueprintDoc, GameGraph } from '@/runtime/core/schema/graph-schema'
import { useCatalogNav } from '../../persist/catalogNavStore'
import { findUiTreeNode } from '../../persist/ui-tree'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { useGraphView } from '../../persist/graphViewStore'
import { useDocumentNav } from '../../persist/documentNavStore'
import { useRuleSelection } from '../../persist/ruleSelectionStore'
import { useUiSelection } from '../../persist/uiSelectionStore'
import { NewSidebar } from '../NewSidebar'

import { parseAssetCatalog, type AssetCatalog } from '@/editor/assets/asset-catalog'

const assetCatalogMock = vi.hoisted(() => ({
  catalog: null as AssetCatalog | null,
}))

vi.mock('@/editor/assets/asset-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/editor/assets/asset-catalog')>()
  return {
    ...actual,
    useAssetCatalog: () => ({
      catalog: assetCatalogMock.catalog ?? actual.EMPTY_ASSET_CATALOG,
      loading: false,
      error: null,
      refresh: vi.fn(),
    }),
  }
})

const initialScenario = useGraphScenario.getState()
const emptyGraph: GameGraph = { nodes: [], edges: [] }
const main: BlueprintDoc = { id: 'main', title: '主蓝图', entry: 'entry', graph: emptyGraph }

beforeEach(() => {
  assetCatalogMock.catalog = null
  useGraphView.setState({ view: 'ui' })
  useCatalogNav.setState({ location: { kind: 'catalog-root', target: 'root:catalog' } })
  useDocumentNav.setState({ documentType: 'core' })
  useRuleSelection.setState({ section: 'entities', itemId: null })
  useUiSelection.getState().clearUiSelection()
  useGraphScenario.setState({
    booted: true,
    blueprints: { main },
    mainBlueprintId: 'main',
    activeBlueprintId: 'main',
    graph: emptyGraph,
    game: 'game-test',
    meta: {
      ui: {
        overlays: {
          hud: { id: 'hud', title: '战斗 HUD', children: [] },
        },
      },
      uiTree: {
        root: [{
          kind: 'folder',
          id: 'folder',
          name: '战斗',
          children: [{
            kind: 'folder',
            id: 'nested',
            name: '首领',
            children: [{ kind: 'scheme', id: 'hud-node', overlayId: 'hud' }],
          }],
        }],
      },
    },
  })
})

afterEach(() => {
  cleanup()
  useGraphScenario.setState(initialScenario, true)
  useUiSelection.getState().clearUiSelection()
})

function expandUiTree(): void {
  fireEvent.click(screen.getByRole('button', { name: '展开 界面' }))
}

describe('NewSidebar interface tree', () => {
  it('keeps add available while hiding rename and delete for the built-in Templates folder', () => {
    useGraphScenario.setState((state) => ({
      meta: {
        ...state.meta,
        uiTree: {
          root: [
            { kind: 'folder', id: 'ui-folder:custom', name: '模板', children: [] },
            { kind: 'folder', id: 'ui-folder:basic', name: '控件', children: [] },
          ],
        },
      },
    }))

    render(<NewSidebar />)
    expandUiTree()

    expect(screen.getByLabelText('新增界面 模板')).toBeTruthy()
    expect(screen.queryByLabelText('重命名 模板')).toBeNull()
    expect(screen.queryByLabelText('删除 模板')).toBeNull()
  })

  it('uses a 220px default rail and exposes the manifest asset catalog hierarchy', () => {
    render(<NewSidebar />)

    const sidebar = screen.getByRole('complementary', { name: /视频游戏工坊/ })
    expect(sidebar).toBeTruthy()
    const sidebarCss = document.querySelector('style[data-reel-style="new-sidebar"]')?.textContent ?? ''
    const sidebarRule = sidebarCss.match(/\.ns-sidebar\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(sidebarRule).toContain('width: 220px')
    expect(sidebarRule).toContain('min-width: 220px')
    expect(sidebarRule).not.toContain('max-width')
    expect(sidebarCss).toMatch(/\.ns-label\s*\{[^}]*font-size:\s*16px[^}]*line-height:\s*24px/)
    expect(sidebarCss).toContain('.ns-row:not([data-depth="0"]) .ns-label')
    expect(sidebar.querySelector('.ns-label[title="蓝图"]')?.textContent).toContain('蓝图')
    expect(sidebar.querySelector('.ns-label[title="界面"]')?.textContent).toContain('界面')
    expect(sidebar.querySelector('.ns-label[title="文档"]')?.textContent).toContain('文档')
    // Top-level order: 文档 → 蓝图 → 界面 → 规则 → 资产库（试玩已改由顶部视图切换器承载，侧栏不再列）
    const allTreeLabels = [...sidebar.querySelectorAll('[role="treeitem"] .ns-label')]
      .map((el) => el.getAttribute('title'))
    expect(allTreeLabels).not.toContain('试玩')
    expect(allTreeLabels.indexOf('文档')).toBeLessThan(allTreeLabels.indexOf('蓝图'))
    expect(allTreeLabels.indexOf('蓝图')).toBeLessThan(allTreeLabels.indexOf('界面'))
    expect(allTreeLabels.indexOf('界面')).toBeLessThan(allTreeLabels.indexOf('规则'))
    expect(allTreeLabels.indexOf('规则')).toBeLessThan(allTreeLabels.indexOf('资产库'))
    fireEvent.click(screen.getByRole('button', { name: '展开 资产库' }))
    expect(sidebar.querySelector('.ns-label[title="视频"]')?.textContent).toContain('视频')
    expect(sidebar.querySelector('.ns-label[title="控件"]')?.textContent).toContain('控件')
    // 资产目录子项顺序由 CATALOG_TAB_KINDS 固定：角色 → 场景 → 视频 → 图片 → 图标 → 控件 → 音频
    const assetsIdx = allTreeLabels.indexOf('资产库')
    const expandedTreeLabels = [...sidebar.querySelectorAll('[role="treeitem"] .ns-label')]
      .map((el) => el.getAttribute('title'))
    expect(expandedTreeLabels.slice(assetsIdx + 1, assetsIdx + 8)).toEqual([
      '角色', '场景', '视频', '图片', '图标', '控件', '音频',
    ])
    expect(expandedTreeLabels).not.toContain('字体')
    for (const label of ['图标', '控件', '视频', '音频', '图片']) {
      expect(screen.queryByLabelText(`重命名 ${label}`)).toBeNull()
      expect(screen.queryByLabelText(`删除 ${label}`)).toBeNull()
    }
  })

  it('routes expandable asset categories and the asset-library root', () => {
    render(<NewSidebar />)
    fireEvent.click(screen.getByRole('button', { name: '展开 资产库' }))

    for (const [label, root] of [
      ['图标', 'icon'],
      ['控件', 'control'],
      ['音频', 'audio'],
      ['场景', 'scene'],
      ['视频', 'video'],
      ['角色', 'character'],
      ['图片', 'image'],
    ] as const) {
      fireEvent.click(screen.getByText(label).closest('[role="treeitem"]')!)
      expect(useGraphView.getState().view).toBe('assets')
      expect(useCatalogNav.getState()).toMatchObject({
        location: { kind: 'tab-root', tabKind: root, target: `root:${root}` },
      })
      expect(screen.getByText(label).closest('[role="treeitem"]')).toHaveAttribute('aria-selected', 'true')
    }

    fireEvent.click(screen.getByText('资产库').closest('[role="treeitem"]')!)
    expect(useGraphView.getState().view).toBe('assets')
    expect(useCatalogNav.getState()).toMatchObject({
      location: { kind: 'catalog-root', target: 'root:catalog' },
    })
  })

  it('keeps catalog asset entities out of every tab, routing tabs to the asset view instead', () => {
    assetCatalogMock.catalog = parseAssetCatalog({
      version: 2,
      assets: [
        { id: 'icon-image', kind: 'image', label: '技能图标' },
        { id: 'character-image', kind: 'image', label: '角色立绘' },
      ],
      assetCatalog: {
        version: 1,
        folders: [],
        placements: {
          'icon:icon-asset': { folderId: 'root:icon', sortKey: 'a0', createdAt: 1, updatedAt: 1 },
          'character:character-asset': { folderId: 'root:character', sortKey: 'a0', createdAt: 1, updatedAt: 1 },
        },
        entities: {
          icon: {
            'icon-asset': {
              id: 'icon-asset', name: '技能图标', current: { assetId: 'icon-image' }, history: [], createdAt: 1, updatedAt: 1,
            },
          },
          character: {
            'character-asset': {
              id: 'character-asset', name: '角色立绘', current: { assetId: 'character-image' }, history: [], createdAt: 1, updatedAt: 1,
            },
          },
        },
      },
    })!
    render(<NewSidebar />)

    fireEvent.click(screen.getByRole('button', { name: '展开 资产库' }))
    // 没有子目录的 Tab 不再给箭头，条目本身也不进树。
    expect(screen.queryByRole('button', { name: '展开 图标' })).toBeNull()
    expect(screen.queryByText('技能图标')).toBeNull()

    fireEvent.click(screen.getByText('角色').closest('[role="treeitem"]')!)
    expect(screen.queryByText('角色立绘')).toBeNull()
    expect(useGraphView.getState().view).toBe('assets')
    expect(useCatalogNav.getState()).toMatchObject({
      location: { kind: 'tab-root', tabKind: 'character', target: 'root:character' },
    })
  })

  it('reserves the disclosure icon column for leaves', () => {
    render(<NewSidebar />)

    fireEvent.click(screen.getByRole('button', { name: '展开 文档' }))
    const leafRow = screen.getByText('核心设计').closest('[role="treeitem"]')
    expect(leafRow?.querySelector('.ns-chev-spacer')).toBeTruthy()
  })

  it('shows only core and pillar in Documents even when the project has no documents', () => {
    render(<NewSidebar />)
    fireEvent.click(screen.getByRole('button', { name: '展开 文档' }))
    expect(screen.getByText('核心设计')).toBeTruthy()
    expect(screen.getByText('支柱设计')).toBeTruthy()
    expect(screen.queryByText('需求')).toBeNull()
    expect(screen.queryByText('问询')).toBeNull()
    expect(screen.queryByText('核心方案候选')).toBeNull()
    fireEvent.click(screen.getByText('核心设计'))

    expect(useGraphView.getState().view).toBe('documents')
    expect(useDocumentNav.getState().documentType).toBe('core')
  })

  it('keeps the built-in core and pillar documents selectable but read-only', () => {
    render(<NewSidebar />)
    fireEvent.click(screen.getByRole('button', { name: '展开 文档' }))

    expect(screen.queryByLabelText('重命名 核心设计')).toBeNull()
    expect(screen.queryByLabelText('删除 核心设计')).toBeNull()
    expect(screen.queryByLabelText('重命名 支柱设计')).toBeNull()
    expect(screen.queryByLabelText('删除 支柱设计')).toBeNull()

    fireEvent.click(screen.getByText('支柱设计'))
    expect(useGraphView.getState().view).toBe('documents')
    expect(useDocumentNav.getState().documentType).toBe('pillar')
  })

  it.each([
    ['core', '核心设计'],
    ['pillar', '支柱设计'],
  ] as const)('expands Documents and selects %s when opened programmatically', (documentType, label) => {
    render(<NewSidebar />)

    act(() => {
      useDocumentNav.getState().setDocumentType(documentType)
      useGraphView.getState().setView('documents')
    })

    expect(screen.getByText('文档').closest('[role="treeitem"]')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(label).closest('[role="treeitem"]')).toHaveAttribute('aria-selected', 'true')
  })

  it('normalizes internal intake and inquiry navigation to core', () => {
    act(() => useDocumentNav.getState().setDocumentType('intake'))
    expect(useDocumentNav.getState().documentType).toBe('core')

    act(() => useDocumentNav.getState().setDocumentType('inquiry'))
    expect(useDocumentNav.getState().documentType).toBe('core')

    // 三选一 Slide 仍由 author gate 程序化打开，但不出现在 Documents 菜单。
    act(() => useDocumentNav.getState().setDocumentType('design-options'))
    expect(useDocumentNav.getState().documentType).toBe('design-options')
  })

  it('setPendingDocumentTypes marks sidebar leaf', async () => {
    const { setPendingDocumentTypes, resetPendingDocumentTypes } = await import(
      '../../persist/pendingDocumentsStore'
    )
    act(() => resetPendingDocumentTypes())
    render(<NewSidebar />)
    fireEvent.click(screen.getByRole('button', { name: '展开 文档' }))

    expect(
      screen.getByText('核心设计').closest('[role="treeitem"]')?.getAttribute('data-pending'),
    ).toBeNull()

    act(() => setPendingDocumentTypes(['core']))
    expect(
      screen.getByText('核心设计').closest('[role="treeitem"]')?.getAttribute('data-pending'),
    ).toBe('true')

    act(() => setPendingDocumentTypes([]))
    expect(
      screen.getByText('核心设计').closest('[role="treeitem"]')?.getAttribute('data-pending'),
    ).toBeNull()
    act(() => resetPendingDocumentTypes())
  })

  it('renders the real recursive tree and publishes scheme selection', () => {
    render(<NewSidebar />)
    expect(screen.queryByText('自定义界面')).toBeNull()
    expandUiTree()
    expect(screen.getByText('战斗')).toBeTruthy()
    expect(screen.queryByText('首领')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '展开战斗' }))
    expect(screen.getByText('首领')).toBeTruthy()
    expect(screen.queryByText('战斗 HUD')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '展开首领' }))

    fireEvent.click(screen.getByRole('button', { name: '选择界面方案 战斗 HUD' }))
    expect(useUiSelection.getState()).toMatchObject({
      selectedTreeNodeId: 'hud-node',
      selectedOverlayId: 'hud',
    })
    // 选中具体方案后，主树「界面」父行不应高亮（activeId 指向方案节点 id，不在 navTree 里）——
    // 与蓝图选中具体蓝图时「蓝图」父行不高亮一致。
    const uiRow = screen.getByRole('button', { name: '折叠 界面' }).closest('.ns-row')
    expect(uiRow).not.toHaveClass('is-active')
  })

  it('clears interface selection when a non-ui leaf (blueprint) is selected', () => {
    render(<NewSidebar />)
    expandUiTree()
    fireEvent.click(screen.getByRole('button', { name: '展开战斗' }))
    fireEvent.click(screen.getByRole('button', { name: '展开首领' }))
    fireEvent.click(screen.getByRole('button', { name: '选择界面方案 战斗 HUD' }))
    expect(useUiSelection.getState().selectedTreeNodeId).toBe('hud-node')

    // 切去点蓝图叶子（非 ui 视图）：界面选中态应被清空，界面子树行不再高亮。
    fireEvent.click(screen.getByRole('button', { name: '展开 蓝图' }))
    fireEvent.click(screen.getByText('主蓝图'))
    expect(useUiSelection.getState().selectedTreeNodeId).toBeNull()
  })

  it('shows interface children when its arrow is clicked from the rule view', () => {
    useGraphView.setState({ view: 'rule' })
    render(<NewSidebar />)

    expect(screen.getByRole('button', { name: '展开 界面' })).toBeTruthy()
    expect(screen.queryByText('首领')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '展开 界面' }))

    expect(useGraphView.getState().view).toBe('rule')
    expect(screen.getByRole('button', { name: '折叠 界面' })).toBeTruthy()
    expect(screen.getByText('战斗')).toBeTruthy()
    expect(screen.queryByText('首领')).toBeNull()
    expect(screen.getByRole('button', { name: '展开战斗' })).toBeTruthy()
  })

  // 界面行加号已隐藏；以下两个测试暂时注释（界面树的文件夹/方案创建由 UiTreeView 内部管理）。
  /*
  it('creates top-level folders from the 界面 add button before schemes can be added inside', () => {
    render(<NewSidebar />)
    fireEvent.click(screen.getByRole('button', { name: '新增 界面 子项' }))
    const input = screen.getByPlaceholderText('新建界面组名称')
    fireEvent.change(input, { target: { value: '过场界面' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    const selectedId = useUiSelection.getState().selectedTreeNodeId!
    const meta = useGraphScenario.getState().meta
    expect(findUiTreeNode(meta.uiTree!, selectedId)).toMatchObject({
      kind: 'folder',
      name: '过场界面',
    })
    expect(meta.uiTree?.root.some((node) => node.id === selectedId)).toBe(true)
    expect(useGraphView.getState().view).toBe('ui')
  })

  it('creates a named overlay from the folder add button', () => {
    render(<NewSidebar />)
    expandUiTree()
    fireEvent.click(screen.getByLabelText('新增界面 战斗'))
    const input = screen.getByPlaceholderText('新建界面名称')
    fireEvent.change(input, { target: { value: '战斗结算' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    const selection = useUiSelection.getState()
    expect(selection.selectedOverlayId).toBeTruthy()
    const meta = useGraphScenario.getState().meta
    expect(meta.ui?.overlays?.[selection.selectedOverlayId!]).toMatchObject({
      id: selection.selectedOverlayId,
      title: '战斗结算',
      children: [],
    })
    expect(findUiTreeNode(meta.uiTree!, selection.selectedTreeNodeId!)).toMatchObject({
      kind: 'scheme',
      overlayId: selection.selectedOverlayId,
    })
  })

  it('does not flicker selection when creating a new overlay (no heal-back to another scheme)', () => {
    // 回归：新建方案后，选中态应直接落在新方案，不出现「先被自愈抢回第一个方案、再回跳」的中间态。
    // 修复前 GraphConfigView 的自愈 effect 会与 add-scheme 的 selectUiNode 抢态，trace 里会出现别的 overlayId。
    const trace: Array<string | null> = []
    let last: string | null = useUiSelection.getState().selectedOverlayId
    trace.push(last)
    const unsub = useUiSelection.subscribe((next) => {
      if (next.selectedOverlayId !== last) {
        last = next.selectedOverlayId
        trace.push(last)
      }
    })

    render(<NewSidebar />)
    expandUiTree()
    fireEvent.click(screen.getByLabelText('新增界面 战斗'))
    const input = screen.getByPlaceholderText('新建界面名称')
    fireEvent.change(input, { target: { value: '战斗结算' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    unsub()

    const selection = useUiSelection.getState()
    expect(selection.selectedOverlayId).toBeTruthy()
    // 末态就是新方案。
    expect(trace[trace.length - 1]).toBe(selection.selectedOverlayId)
    // 新建过程中不应出现「先选中别的方案、再回跳到新方案」——trace 里新方案 id 只应在末尾出现一次。
    const finalId = selection.selectedOverlayId!
    const firstFinalIndex = trace.indexOf(finalId)
    expect(firstFinalIndex).toBe(trace.length - 1)
  })

/*
    render(<NewSidebar />)
    fireEvent.click(screen.getByRole('button', { name: '新增 界面 子项' }))
    const input = screen.getByPlaceholderText('新建界面组名称')
    fireEvent.change(input, { target: { value: '新文件夹' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const folderId = useUiSelection.getState().selectedTreeNodeId!
    expect(findUiTreeNode(useGraphScenario.getState().meta.uiTree!, folderId)).toMatchObject({
      kind: 'folder',
      name: '新文件夹',
    })

    fireEvent.click(screen.getByLabelText('重命名 新文件夹'))
    fireEvent.change(screen.getByRole('textbox', { name: '重命名文件夹' }), {
      target: { value: '过场界面' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(findUiTreeNode(useGraphScenario.getState().meta.uiTree!, folderId)).toMatchObject({
      name: '过场界面',
    })

    fireEvent.click(screen.getByLabelText('删除 过场界面'))
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(findUiTreeNode(useGraphScenario.getState().meta.uiTree!, folderId)).toBeUndefined()
  */

  it('deletes a scheme reference and its overlay together', () => {
    render(<NewSidebar />)
    expandUiTree()
    fireEvent.click(screen.getByRole('button', { name: '展开战斗' }))
    fireEvent.click(screen.getByRole('button', { name: '展开首领' }))
    fireEvent.click(screen.getByLabelText('删除 战斗 HUD'))
    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    const meta = useGraphScenario.getState().meta
    expect(meta.ui?.overlays?.hud).toBeUndefined()
    expect(findUiTreeNode(meta.uiTree!, 'hud-node')).toBeUndefined()
  })

  it('routes the formula navigation leaf to the formula rule section', () => {
    render(<NewSidebar />)

    fireEvent.click(screen.getByRole('button', { name: '展开 规则' }))
    for (const label of ['实体', '变量', '公式']) {
      expect(screen.queryByLabelText(`重命名 ${label}`)).toBeNull()
      expect(screen.queryByLabelText(`删除 ${label}`)).toBeNull()
    }
    fireEvent.click(screen.getByText('公式'))

    expect(useGraphView.getState().view).toBe('rule')
    expect(useRuleSelection.getState()).toMatchObject({
      section: 'formulas',
      itemId: null,
    })
  })
})

describe('NewSidebar blueprint folder interactions', () => {
  it('opens rename from the main blueprint pencil action', () => {
    render(<NewSidebar />)
    fireEvent.click(document.querySelector('.ns-label[title="蓝图"]')!.closest('[role="treeitem"]')!)

    expect(screen.queryByLabelText('设为入口 主蓝图')).toBeNull()
    expect(screen.queryByLabelText('删除 主蓝图')).toBeNull()
    fireEvent.click(screen.getByLabelText('重命名 主蓝图'))

    expect(screen.getByRole('textbox', { name: '重命名蓝图' })).toHaveValue('主蓝图')
  })

  it('exposes set-entry and delete as direct row actions for secondary blueprints', () => {
    useGraphScenario.getState().createBlueprint('支线 A')
    const branchId = Object.values(useGraphScenario.getState().blueprints)
      .find((blueprint) => blueprint.title === '支线 A')!.id
    render(<NewSidebar />)
    fireEvent.click(document.querySelector('.ns-label[title="蓝图"]')!.closest('[role="treeitem"]')!)

    fireEvent.click(screen.getByLabelText('设为入口 支线 A'))

    expect(useGraphScenario.getState().mainBlueprintId).toBe(branchId)
  })

  it('opens the existing delete confirmation from the blueprint trash action', () => {
    useGraphScenario.getState().createBlueprint('支线 B')
    render(<NewSidebar />)
    fireEvent.click(document.querySelector('.ns-label[title="蓝图"]')!.closest('[role="treeitem"]')!)
    const trigger = screen.getByLabelText('删除 支线 B')
    fireEvent.click(trigger)

    expect(screen.getByRole('dialog', { name: '删除蓝图' })).toHaveTextContent('确定删除「支线 B」？')
    expect(trigger).toHaveClass('is-on')
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '删除蓝图' })).toBeNull()
    expect(trigger).toHaveFocus()
  })

  it('closes the delete confirmation when its trash trigger is clicked again', () => {
    useGraphScenario.getState().createBlueprint('支线 D')
    render(<NewSidebar />)
    fireEvent.click(document.querySelector('.ns-label[title="蓝图"]')!.closest('[role="treeitem"]')!)
    const trigger = screen.getByLabelText('删除 支线 D')
    fireEvent.click(trigger)

    fireEvent.click(trigger)

    expect(screen.queryByRole('dialog', { name: '删除蓝图' })).toBeNull()
  })

  it('adds a blueprint from + while the folder is collapsed', () => {
    render(<NewSidebar />)
    expect(screen.queryByText('主蓝图')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '新增 蓝图 子项' }))
    const input = screen.getByPlaceholderText('新建蓝图名称')
    fireEvent.change(input, { target: { value: '支线 A' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    const state = useGraphScenario.getState()
    const created = Object.values(state.blueprints).find((doc) => doc.title === '支线 A')
    expect(created).toBeTruthy()
    expect(screen.getByText('支线 A')).toBeTruthy()
    expect(screen.getByText('主蓝图')).toBeTruthy()
  })

  it('toggles the blueprint folder on row click without selecting a child', () => {
    useGraphView.setState({ view: 'ui' })
    render(<NewSidebar />)
    const folderLabel = document.querySelector('.ns-label[title="蓝图"]')
    expect(folderLabel).toBeTruthy()
    const folder = folderLabel!.closest('[role="treeitem"]') as HTMLElement
    expect(folder).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('主蓝图')).toBeNull()

    fireEvent.click(folder)
    expect(folder).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('主蓝图')).toBeTruthy()
    // 展开只是展示子项，不切视图、不选中某个蓝图
    expect(useGraphView.getState().view).toBe('ui')
    expect(useGraphScenario.getState().activeBlueprintId).toBe('main')

    fireEvent.click(folder)
    expect(folder).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('主蓝图')).toBeNull()
    expect(useGraphView.getState().view).toBe('ui')
  })

  it('switches view only after clicking a blueprint leaf', () => {
    useGraphView.setState({ view: 'ui' })
    render(<NewSidebar />)
    fireEvent.click(document.querySelector('.ns-label[title="蓝图"]')!.closest('[role="treeitem"]')!)
    expect(useGraphView.getState().view).toBe('ui')

    fireEvent.click(screen.getByText('主蓝图'))
    expect(useGraphView.getState().view).toBe('graph')
    expect(useGraphScenario.getState().activeBlueprintId).toBe('main')
  })
})
