/**
 * 新版资产库侧栏：每一层（库入口 / Tab / 文件夹 / 条目）点下去都必须把该层信息交出来。
 * 顶层用显式 `root:catalog` + `kind: 'catalog-root'` 识别，不再靠隐式 section id。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssetCatalogSection } from '../AssetCatalogSection'
import { useCatalogNav } from '../../persist/catalogNavStore'
import { useGraphView } from '../../persist/graphViewStore'
import { writeCatalogItemDrag } from '@/editor/assets/asset-catalog-drag'

const assetCatalogClientMock = vi.hoisted(() => ({ moveAsset: vi.fn(async () => {}) }))

vi.mock('@/editor/assets/asset-catalog-client', () => ({ assetCatalogClient: assetCatalogClientMock }))

function createDataTransfer(): DataTransfer {
  const values = new Map<string, string>()
  return {
    dropEffect: 'none',
    effectAllowed: 'none',
    getData: (type: string) => values.get(type) ?? '',
    setData: (type: string, value: string) => values.set(type, value),
    get types() { return [...values.keys()] },
  } as unknown as DataTransfer
}

// 工厂会被提升到文件顶部，固定数据只能写在工厂内部。
vi.mock('@/editor/assets/asset-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/editor/assets/asset-catalog')>()
  const stamps = { createdAt: 1, updatedAt: 1 }
  const catalog = actual.parseAssetCatalog({
    version: 2,
    assets: [
      { id: 'img-yard-v1', kind: 'image', label: '院子 v1', url: 'https://example.com/yard.png', ...stamps },
    ],
    assetCatalog: {
      version: 1,
      folders: [
        { id: 'folder-scene-images', parentId: null, tabKind: 'image', name: '场景图片', sortKey: 'a0', ...stamps },
        { id: 'folder-scene-images-night', parentId: 'folder-scene-images', tabKind: 'image', name: '夜景', sortKey: 'a0', ...stamps },
      ],
      placements: {
        'image:img-yard-v1': { folderId: 'folder-scene-images-night', sortKey: 'a0', ...stamps },
      },
      entities: {},
    },
  })!
  return {
    ...actual,
    useAssetCatalog: () => ({ catalog, loading: false, error: null, refresh: async () => {} }),
  }
})

const clickRow = (label: string): void => {
  fireEvent.click(screen.getByText(label).closest('[role="treeitem"]')!)
}

beforeEach(() => {
  assetCatalogClientMock.moveAsset.mockClear()
  useCatalogNav.setState({ location: { kind: 'catalog-root', target: 'root:catalog' } })
  useGraphView.setState({ view: 'graph', lastEditView: 'graph' })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AssetCatalogSection', () => {
  it('moves a dragged nested-folder asset back to its asset-type root and navigates there after success', async () => {
    render(<AssetCatalogSection gameId="demo" />)
    clickRow('资产库')
    const imageRow = screen.getByText('图片').closest<HTMLElement>('[role="treeitem"]')!
    act(() => useCatalogNav.setState({ location: { kind: 'folder', tabKind: 'image', folderId: 'folder-scene-images-night', target: 'folder-scene-images-night' } }))
    const dataTransfer = createDataTransfer()
    writeCatalogItemDrag(dataTransfer, {
      placementKey: 'image:img-yard-v1',
      tabKind: 'image',
      name: '院子 v1',
      sourceTarget: 'folder-scene-images-night',
    })

    fireEvent.dragOver(imageRow, { dataTransfer, clientX: 24, clientY: 48 })
    expect(imageRow).toHaveClass('is-drop-target')
    expect(screen.getByText('移动至-图片')).toBeTruthy()
    await act(async () => { fireEvent.drop(imageRow, { dataTransfer }) })

    await waitFor(() => expect(assetCatalogClientMock.moveAsset).toHaveBeenCalledWith(expect.objectContaining({
      placementKey: 'image:img-yard-v1',
      folderId: 'root:image',
      sortKey: '院子 v1',
    })))
    await waitFor(() => expect(useCatalogNav.getState().location).toEqual({
      kind: 'tab-root',
      tabKind: 'image',
      target: 'root:image',
    }))
    expect(imageRow).not.toHaveClass('is-drop-target')
  })

  it('keeps the current nested-folder location when moving to a tab root fails', async () => {
    assetCatalogClientMock.moveAsset.mockRejectedValueOnce(new Error('move refused'))
    render(<AssetCatalogSection gameId="demo" />)
    clickRow('资产库')
    const imageRow = screen.getByText('图片').closest<HTMLElement>('[role="treeitem"]')!
    const nestedLocation = { kind: 'folder' as const, tabKind: 'image' as const, folderId: 'folder-scene-images-night', target: 'folder-scene-images-night' }
    act(() => useCatalogNav.setState({ location: nestedLocation }))
    const dataTransfer = createDataTransfer()
    writeCatalogItemDrag(dataTransfer, {
      placementKey: 'image:img-yard-v1',
      tabKind: 'image',
      name: '院子 v1',
      sourceTarget: 'folder-scene-images-night',
    })

    await act(async () => { fireEvent.drop(imageRow, { dataTransfer }) })

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('move refused'))
    expect(useCatalogNav.getState().location).toEqual(nestedLocation)
  })

  it('selects the catalog root and opens the shared asset view', () => {
    render(<AssetCatalogSection gameId="demo" />)

    clickRow('资产库')

    expect(useCatalogNav.getState().location).toMatchObject({
      kind: 'catalog-root',
      target: 'root:catalog',
    })
    expect(useGraphView.getState().view).toBe('assets')
  })

  it('shares tab-root / folder selections with the asset panel', () => {
    render(<AssetCatalogSection gameId="demo" />)

    clickRow('资产库')
    clickRow('图片')
    expect(useCatalogNav.getState().location).toMatchObject({ kind: 'tab-root', tabKind: 'image', target: 'root:image' })

    clickRow('场景图片')
    expect(useCatalogNav.getState().location).toMatchObject({
        kind: 'folder',
        tabKind: 'image',
        folderId: 'folder-scene-images',
      })

    clickRow('夜景')
    expect(useCatalogNav.getState().location).toMatchObject({
        kind: 'folder',
        tabKind: 'image',
        folderId: 'folder-scene-images-night',
      })
  })

  it('lists folders only: asset rows never enter the navigation tree', () => {
    render(<AssetCatalogSection gameId="demo" />)

    clickRow('资产库')
    clickRow('图片')
    clickRow('场景图片')
    clickRow('夜景')

    expect(screen.queryByText('院子 v1')).toBeNull()
  })

  it('highlights the containing folder when the panel selects an asset inside it', () => {
    render(<AssetCatalogSection gameId="demo" />)
    clickRow('资产库')
    clickRow('图片')
    clickRow('场景图片')

    act(() => useCatalogNav.setState({
      location: {
        kind: 'item',
        tabKind: 'image',
        itemId: 'img-yard-v1',
        placementKey: 'image:img-yard-v1',
        target: 'folder-scene-images-night',
      },
    }))

    expect(screen.getByText('夜景').closest('[role="treeitem"]')).toHaveAttribute('aria-selected', 'true')
  })
})
