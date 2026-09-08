import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueprintDoc, GameGraph } from '@/runtime/core/schema/graph-schema'
import { parseAssetCatalog, type AssetCatalog } from '@/editor/assets/asset-catalog'
import { useCatalogNav } from '../../persist/catalogNavStore'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { useGraphView } from '../../persist/graphViewStore'
import { NewSidebar } from '../NewSidebar'

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

function videoCatalog(): AssetCatalog {
  return parseAssetCatalog({
    version: 2,
    assets: [
      { id: 'video-outdoor-asset', kind: 'video', label: '户外运镜.mp4', url: '/outdoor.mp4' },
      { id: 'video-root-asset', kind: 'video', label: '无标签视频.mp4', url: '/root.mp4' },
    ],
    assetCatalog: {
      version: 1,
      folders: [{ id: 'folder-outdoor', parentId: null, tabKind: 'video', name: '户外', sortKey: 'a0', createdAt: 1, updatedAt: 1 }],
      placements: {
        'video:video-outdoor': { folderId: 'folder-outdoor', sortKey: 'a0', createdAt: 1, updatedAt: 1 },
        'video:video-root': { folderId: 'root:video', sortKey: 'a1', createdAt: 1, updatedAt: 1 },
      },
      entities: {
        video: {
          'video-outdoor': {
            id: 'video-outdoor', name: '户外运镜.mp4', current: { assetId: 'video-outdoor-asset' }, history: [], createdAt: 1, updatedAt: 1,
          },
          'video-root': {
            id: 'video-root', name: '无标签视频.mp4', current: { assetId: 'video-root-asset' }, history: [], createdAt: 1, updatedAt: 1,
          },
        },
      },
    },
  })!
}

beforeEach(() => {
  assetCatalogMock.catalog = videoCatalog()
  useGraphView.setState({ view: 'graph' })
  useCatalogNav.setState({ location: { kind: 'catalog-root', target: 'root:catalog' } })
  useGraphScenario.setState({
    game: 'demo',
    booted: true,
    blueprints: { main },
    mainBlueprintId: 'main',
    activeBlueprintId: 'main',
    graph: emptyGraph,
    meta: {},
  })
})

afterEach(() => {
  cleanup()
  useGraphScenario.setState(initialScenario, true)
  useCatalogNav.setState({ location: { kind: 'catalog-root', target: 'root:catalog' } })
})

describe('NewSidebar manifest video catalog hierarchy', () => {
  it('renders manifest video folders — never the videos themselves — under the catalog video tab', () => {
    render(<NewSidebar />)

    const sidebar = screen.getByRole('complementary', { name: /视频游戏工坊/ })
    const css = document.querySelector('style[data-reel-style="new-sidebar"]')?.textContent
    const sidebarRule = css?.match(/\.ns-sidebar\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(sidebarRule).toContain('width: 220px')
    expect(sidebarRule).toContain('min-width: 220px')
    expect(sidebarRule).not.toContain('max-width')
    expect(css).toContain('padding: 0')
    expect(css).toContain('.ns-sidebar button.ns-leading svg { display: block; width: 12px; height: 12px; flex: none; }')
    expect(css).toContain('.ns-sidebar button.ns-chev')
    expect(css).toContain('.ns-sidebar button.ns-add')
    expect(css).toContain('.ns-sidebar button.ns-act')
    const assetLibraryIcon = sidebar.querySelector('.ns-leading > svg')
    expect(sidebar.querySelector('.ns-leading img')).toBeNull()
    expect(assetLibraryIcon).toHaveAttribute('width', '12')
    expect(assetLibraryIcon).toHaveAttribute('height', '12')
    expect(assetLibraryIcon?.querySelector('path')).toHaveAttribute('fill', 'currentColor')
    expect(screen.queryByText('新增文件夹')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '展开 资产库' }))
    fireEvent.click(screen.getByRole('button', { name: '展开 视频' }))

    const folderRow = screen.getByText('户外').closest<HTMLElement>('.ns-row')!
    expect(folderRow.style.paddingLeft).toBe('16px')
    expect(screen.queryByText('无标签视频.mp4')).toBeNull()
    expect(screen.queryByText('户外运镜.mp4')).toBeNull()
    // 只有子目录才让目录行可展开：户外只装视频，所以没有箭头可点。
    expect(screen.queryByRole('button', { name: '展开 户外' })).toBeNull()
  })

  it('routes video roots and folders through catalog navigation', () => {
    render(<NewSidebar />)
    fireEvent.click(screen.getByRole('button', { name: '展开 资产库' }))
    fireEvent.click(screen.getByText('视频').closest<HTMLElement>('.ns-row')!)

    expect(useGraphView.getState().view).toBe('assets')
    expect(useCatalogNav.getState()).toMatchObject({
      location: { kind: 'tab-root', tabKind: 'video', target: 'root:video' },
    })

    expect(screen.queryByText('无标签视频.mp4')).toBeNull()

    fireEvent.click(screen.getByText('户外').closest<HTMLElement>('.ns-row')!)
    expect(useCatalogNav.getState()).toMatchObject({
      location: { kind: 'folder', tabKind: 'video', folderId: 'folder-outdoor', target: 'folder-outdoor' },
    })

    expect(screen.queryByText('户外运镜.mp4')).toBeNull()
  })
})
