import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UiTreeView, type UiTreeViewNode } from '../UiTreeView'

const nodes: UiTreeViewNode[] = [{
  id: 'folder-root',
  kind: 'folder',
  name: '战斗界面',
  children: [{
    id: 'folder-nested',
    kind: 'folder',
    name: '首领战',
    children: [{ id: 'scheme-node', kind: 'scheme', overlayId: 'scheme-boss' }],
  }],
}]

const overlays = {
  'scheme-boss': { id: 'scheme-boss', title: '首领 HUD', children: [] },
}

afterEach(cleanup)

function setup(overrides: Partial<Parameters<typeof UiTreeView>[0]> = {}) {
  const props = {
    nodes,
    overlays,
    selectedTreeNodeId: null,
    onSelect: vi.fn(),
    onAddScheme: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }
  render(<UiTreeView {...props} />)
  return props
}

describe('UiTreeView', () => {
  it('renders folders collapsed by default and expands them one level at a time', () => {
    setup()
    expect(screen.getByText('战斗界面')).toBeTruthy()
    expect(screen.queryByText('首领战')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '展开战斗界面' }))
    expect(screen.getByText('首领战')).toBeTruthy()
    expect(screen.queryByText('首领 HUD')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '展开首领战' }))
    expect(screen.getByText('首领 HUD')).toBeTruthy()
    expect(screen.getByText('首领 HUD').closest('.uit-main')?.querySelector('.uit-toggle')).toBeNull()
  })

  it('collapses and expands a folder without selecting it', () => {
    const props = setup()
    expect(screen.queryByText('首领战')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '展开战斗界面' }))
    expect(screen.getByText('首领战')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '收起战斗界面' }))
    expect(screen.queryByText('首领战')).toBeNull()
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it('clicking a folder row toggles expand/collapse without selecting (main-tree parity)', () => {
    // 与左栏主树 activateRow 对齐：文件夹行点击只展开/收起，不选中、不切页。
    const props = setup()
    expect(screen.queryByText('首领战')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '战斗界面 文件夹' }))
    expect(screen.getByText('首领战')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '战斗界面 文件夹' }))
    expect(screen.queryByText('首领战')).toBeNull()
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it('selects a scheme with both tree and overlay identity', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: '展开战斗界面' }))
    fireEvent.click(screen.getByRole('button', { name: '展开首领战' }))
    fireEvent.click(screen.getByRole('button', { name: '选择界面方案 首领 HUD' }))
    expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({
      id: 'scheme-node',
      overlayId: 'scheme-boss',
    }))
  })

  it('uses 8px hierarchy steps aligned with the sidebar nav tree', () => {
    setup({ selectedTreeNodeId: 'scheme-node' })
    fireEvent.click(screen.getByRole('button', { name: '展开战斗界面' }))
    fireEvent.click(screen.getByRole('button', { name: '展开首领战' }))

    const label = screen.getByText('首领 HUD')
    expect(label.getAttribute('title')).toBe('首领 HUD')
    expect(label.closest('.uit-row')).toHaveClass('is-selected')
    // depth 2（root→nested→scheme）× 8px，与左栏主树 depth*8 保持同一梯度。
    expect(label.closest('.uit-row')).toHaveStyle({ paddingLeft: '16px' })
    expect(screen.getByLabelText('删除 首领 HUD')).toBeTruthy()
  })

  it('offsets the whole subtree by baseDepth so it nests under the 界面 row', () => {
    setup({ selectedTreeNodeId: 'scheme-node', baseDepth: 1 })
    fireEvent.click(screen.getByRole('button', { name: '展开战斗界面' }))
    fireEvent.click(screen.getByRole('button', { name: '展开首领战' }))

    // baseDepth=1 时根层从 8px 起算，最深层 (1+2)*8 = 24px。
    const label = screen.getByText('首领 HUD')
    expect(label.closest('.uit-row')).toHaveStyle({ paddingLeft: '24px' })
  })

  it('exposes inline rename and delete actions without native dialogs', () => {
    const props = setup()
    expect(screen.getByLabelText('重命名 战斗界面')).toBeTruthy()
    expect(screen.getByLabelText('删除 战斗界面')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('重命名 战斗界面'))
    fireEvent.change(screen.getByRole('textbox', { name: '重命名文件夹' }), {
      target: { value: '战斗 HUD' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(props.onRename).toHaveBeenCalledWith('folder-root', '战斗 HUD')

    fireEvent.click(screen.getByLabelText('删除 战斗界面'))
    expect(screen.getByRole('dialog', { name: '删除战斗界面' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(props.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'folder-root' }))
  })

  it('composes a named interface below a folder and omits add actions from schemes', () => {
    const props = setup()

    fireEvent.click(screen.getByLabelText('新增界面 战斗界面'))
    fireEvent.click(screen.getByRole('button', { name: '展开首领战' }))
    const input = screen.getByPlaceholderText('新建界面名称')
    fireEvent.change(input, { target: { value: '战斗结算' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(props.onAddScheme).toHaveBeenCalledWith('folder-root', '战斗结算')
    expect(screen.queryByLabelText('新增界面 首领 HUD')).toBeNull()
    expect(screen.getByLabelText('重命名 首领 HUD')).toBeTruthy()
    expect(screen.getByLabelText('删除 首领 HUD')).toBeTruthy()
  })

  it.each([0, 3])('keeps generated-control deletion at the far right when usage is %i', (usage) => {
    const onDeleteProjectComponent = vi.fn()
    setup({
      nodes: [{
        id: 'basic-controls',
        kind: 'folder',
        name: '控件',
        readOnly: true,
        children: [{
          id: 'option-v3-node',
          kind: 'scheme',
          overlayId: 'base:OptionButtonV3',
          readOnly: true,
        }],
      }],
      overlays: {
        'base:OptionButtonV3': {
          id: 'base:OptionButtonV3',
          title: '选项按钮 V3',
          children: [{ id: 'OptionButtonV3-0', component: 'OptionButtonV3' }],
        },
      },
      usageByOverlay: { 'base:OptionButtonV3': usage },
      projectComponentLabels: { OptionButtonV3: '选项按钮 V3' },
      onDeleteProjectComponent,
    })

    fireEvent.click(screen.getByRole('button', { name: '展开控件' }))
    const deleteButton = screen.getByRole('button', { name: '删除控件 选项按钮 V3' })
    const row = deleteButton.closest('.uit-row')
    expect(row?.lastElementChild).toBe(deleteButton)
    expect(row?.querySelector('.uit-usage')).toBe(usage > 0 ? screen.getByText(`⇢${usage}`) : null)

    fireEvent.click(deleteButton)
    expect(onDeleteProjectComponent).toHaveBeenCalledWith(
      'OptionButtonV3',
      '选项按钮 V3',
      deleteButton,
    )
  })

  it('does not expose project deletion for a built-in control', () => {
    setup({
      nodes: [{ id: 'dialogue-node', kind: 'scheme', overlayId: 'base:Dialogue', readOnly: true }],
      overlays: {
        'base:Dialogue': {
          id: 'base:Dialogue',
          title: '字幕',
          children: [{ id: 'Dialogue-0', component: 'Dialogue' }],
        },
      },
      projectComponentLabels: {},
      onDeleteProjectComponent: vi.fn(),
    })

    expect(screen.queryByRole('button', { name: '删除控件 字幕' })).toBeNull()
  })
})
