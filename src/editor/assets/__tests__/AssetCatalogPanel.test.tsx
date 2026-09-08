import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssetCatalogPanel } from '../AssetCatalogPanel'
import { useCatalogNav } from '../../persist/catalogNavStore'
import { consumeImageGenerationTarget } from '../generation/imageGenerationNavigation'
import { consumeCatalogVideoGenerationTarget } from '../generation/videoGenerationNavigation'
import { useGraphView } from '../../persist/graphViewStore'
import { ASSET_CATALOG_PANEL_CSS } from '../assetCatalogPanelStyles'

const assetCatalogClientMock = vi.hoisted(() => ({
  createFolder: vi.fn(async () => {}),
  registerGenerated: vi.fn(async (_input: unknown) => {}),
  moveAsset: vi.fn(async () => {}),
  renameAsset: vi.fn(async () => {}),
  renameEntity: vi.fn(async () => {}),
  renameFolder: vi.fn(async () => {}),
  deleteAsset: vi.fn(async () => {}),
  deleteEntity: vi.fn(async () => {}),
  deleteFolder: vi.fn(async () => {}),
}))

vi.mock('../asset-catalog-client', () => ({ assetCatalogClient: assetCatalogClientMock }))

const uploadProviderResourceMock = vi.hoisted(() => vi.fn())

vi.mock('../kino-api', () => ({ createKinoVideoClient: vi.fn(() => ({})) }))
vi.mock('../video-upload', () => ({ uploadProviderResource: uploadProviderResourceMock }))

function createDataTransfer(): DataTransfer {
  const values = new Map<string, string>()
  return {
    dropEffect: 'none',
    effectAllowed: 'none',
    getData: (type: string) => values.get(type) ?? '',
    setData: (type: string, value: string) => values.set(type, value),
    setDragImage: vi.fn(),
    get types() { return [...values.keys()] },
  } as unknown as DataTransfer
}

vi.mock('../asset-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../asset-catalog')>()
  const stamps = { createdAt: 1, updatedAt: 1 }
  const catalog = actual.parseAssetCatalog({
    assets: [
      { id: 'asset-v1', kind: 'image', label: '庭院', url: 'https://cdn.test/courtyard.jpg', prompt: '雨后庭院', ...stamps },
      { id: 'asset-character-preview', kind: 'image', label: '赤羽剑客', url: 'https://cdn.test/hero.jpg', ...stamps },
      {
        id: 'asset-character-generating', kind: 'image', productionType: 'character_ref',
        status: 'generating', label: '赤羽剑客', ...stamps,
        meta: { catalogGeneration: { scope: { targetRoot: 'character', entityId: 'pending' } } },
      },
      { id: 'asset-video-generating', kind: 'video', productionType: 'video_clip', status: 'generating', label: '雨夜追逐', ...stamps },
      { id: 'asset-video-ready', kind: 'video', productionType: 'video_clip', status: 'ready', label: '开场', url: 'https://cdn.test/intro.mp4', meta: { posterUrl: 'https://cdn.test/intro-poster.jpg' }, ...stamps },
      { id: 'asset-audio-ready', kind: 'audio', productionType: 'audio_track', status: 'ready', label: '主题曲', url: 'https://cdn.test/theme.mp3', ...stamps },
    ],
    assetCatalog: {
      version: 1,
      folders: [
        { id: 'folder-character', parentId: null, tabKind: 'character', name: '角色收纳', sortKey: 'a1', ...stamps },
        { id: 'folder-character-new', parentId: null, tabKind: 'character', name: '新文件夹1', sortKey: 'a2', ...stamps },
        { id: 'folder-character-new-2', parentId: null, tabKind: 'character', name: '新文件夹2', sortKey: 'a3', ...stamps },
        { id: 'folder-video', parentId: null, tabKind: 'video', name: '视频收纳', sortKey: 'a0', ...stamps },
      ],
      placements: {
        'character:hero': { folderId: 'root:character', sortKey: 'a0', ...stamps },
        'character:pending': { folderId: 'root:character', sortKey: 'a1', ...stamps },
        'scene:valley': { folderId: 'root:scene', sortKey: 'a0', ...stamps },
        'video:pending-video': { folderId: 'root:video', sortKey: 'a0', ...stamps },
        'video:intro': { folderId: 'root:video', sortKey: 'a1', ...stamps },
        'audio:theme': { folderId: 'root:audio', sortKey: 'a0', ...stamps },
      },
      entities: {
        character: {
          hero: { id: 'hero', name: '主角', current: { assetId: 'asset-v1' }, history: [{ assetId: 'asset-v1', appliedAt: 1 }], ...stamps },
          pending: { id: 'pending', name: '赤羽剑客', description: '红发剑客', prompt: '红发剑客，黑金轻甲', history: [], ...stamps },
        },
        scene: {
          valley: { id: 'valley', name: '山谷', current: { assetId: 'asset-v1' }, history: [{ assetId: 'asset-v1', appliedAt: 1 }], ...stamps },
        },
        video: {
          'pending-video': { id: 'pending-video', name: '雨夜追逐', current: { assetId: 'asset-video-generating' }, history: [{ assetId: 'asset-video-generating', appliedAt: 1 }], ...stamps },
          intro: { id: 'intro', name: '开场', current: { assetId: 'asset-video-ready' }, history: [{ assetId: 'asset-video-ready', appliedAt: 1 }], ...stamps },
        },
        audio: {
          theme: { id: 'theme', name: '主题曲', current: { assetId: 'asset-audio-ready' }, history: [{ assetId: 'asset-audio-ready', appliedAt: 1 }], ...stamps },
        },
      },
    },
  })!
  return { ...actual, useAssetCatalog: () => ({ catalog, loading: false, error: null, refresh: vi.fn() }) }
})

afterEach(cleanup)

beforeEach(() => {
  for (const mock of Object.values(assetCatalogClientMock)) mock.mockClear()
  uploadProviderResourceMock.mockReset()
  window.sessionStorage.clear()
  useCatalogNav.setState({ location: { kind: 'tab-root', tabKind: 'character', target: 'root:character' } })
  useGraphView.setState({ view: 'assets', lastEditView: 'assets' })
})

function openCardMenu(name: string): HTMLElement {
  const card = screen.getByText(name).closest<HTMLElement>('.acp-card')!
  fireEvent.click(within(card).getByRole('button', { name: `打开${name}的操作` }))
  return screen.getByRole('menu', { name: `打开${name}的操作` })
}

async function chooseCardAction(name: string, action: '重命名' | '删除'): Promise<HTMLElement> {
  const menu = openCardMenu(name)
  await act(async () => { fireEvent.click(within(menu).getByRole('menuitem', { name: action })) })
  return screen.getByRole('dialog')
}

describe('AssetCatalogPanel', () => {
  it('moves a dragged asset card into a highlighted folder', async () => {
    const { container } = render(<AssetCatalogPanel gameId="demo" />)
    const assetCard = screen.getByText('主角').closest<HTMLElement>('.acp-card')!
    const folderCard = screen.getByText('角色收纳').closest<HTMLElement>('.acp-card')!
    const dataTransfer = createDataTransfer()
    let dragImageOpacity = ''
    vi.mocked(dataTransfer.setDragImage).mockImplementation((image) => {
      dragImageOpacity = (image as HTMLElement).style.opacity
    })
    vi.spyOn(assetCard.querySelector<HTMLElement>('.acp-thumb')!, 'getBoundingClientRect')
      .mockReturnValue({ width: 140, height: 140 } as DOMRect)

    fireEvent.dragStart(assetCard, { dataTransfer })
    expect(assetCard).toHaveClass('is-dragging')
    expect(dataTransfer.setDragImage).toHaveBeenCalledWith(assetCard.querySelector('.acp-thumb'), 140, 140)
    expect(dragImageOpacity).toBe('0.72')
    expect(assetCard.querySelector('.acp-thumb')).not.toHaveStyle({ opacity: '0.72' })
    fireEvent.dragOver(folderCard, { dataTransfer, clientX: 40, clientY: 50 })
    expect(folderCard).toHaveClass('is-drop-target')
    expect(container.querySelector('.acp-drag-hint')).toHaveTextContent('移动至-角色收纳')
    fireEvent.drop(folderCard, { dataTransfer })

    await waitFor(() => expect(assetCatalogClientMock.moveAsset).toHaveBeenCalledWith(expect.objectContaining({
      placementKey: 'character:hero',
      folderId: 'folder-character',
      sortKey: '主角',
    })))
    expect(folderCard).not.toHaveClass('is-drop-target')
  })

  it('keeps the catalog visual contract scoped to the panel root', () => {
    expect(ASSET_CATALOG_PANEL_CSS).not.toContain('!important')
    expect(ASSET_CATALOG_PANEL_CSS).toContain('height: 58px;')
    expect(ASSET_CATALOG_PANEL_CSS).toContain('gap: 16px;')
    expect(ASSET_CATALOG_PANEL_CSS).toContain('width: 221px;')
    expect(ASSET_CATALOG_PANEL_CSS).toContain('grid-template-columns: repeat(auto-fill, 140px);')
    expect(ASSET_CATALOG_PANEL_CSS).toContain('gap: 24px 52px;')
    expect(ASSET_CATALOG_PANEL_CSS).toContain('padding: 20px 24px 26px;')
    expect(ASSET_CATALOG_PANEL_CSS).toContain('padding: 40px 24px 26px;')
    expect(ASSET_CATALOG_PANEL_CSS).toContain('padding: 24px 24px 26px;')
    expect(ASSET_CATALOG_PANEL_CSS).toContain('background: rgba(10,10,10,.72);')
    expect(ASSET_CATALOG_PANEL_CSS).toContain('.acp-root .acp-thumb {\n  position: relative;')
    expect(ASSET_CATALOG_PANEL_CSS).toContain('width: 121px; height: 78px; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); gap: 8px;')
    expect(ASSET_CATALOG_PANEL_CSS).toContain('position: fixed;')
    expect(ASSET_CATALOG_PANEL_CSS).toContain('width: 64px;')
    expect(ASSET_CATALOG_PANEL_CSS).toContain('height: 32px;')
    expect(ASSET_CATALOG_PANEL_CSS).not.toContain('.acp-card-more { background: transparent; }')

    for (const selector of ASSET_CATALOG_PANEL_CSS.matchAll(/(^|})\s*([^@{}]+)\{/g)) {
      const selectorText = selector[2]
      if (!selectorText) continue
      for (const part of selectorText.split(',')) {
        expect(part.trim()).toMatch(/^\.acp-root(?:\b|\s|:)/)
      }
    }
  })

  it('renders the Figma catalog root as searchable folder cards without changing the contract order', () => {
    useCatalogNav.setState({ location: { kind: 'catalog-root', target: 'root:catalog' } })
    const { container } = render(<AssetCatalogPanel gameId="demo" />)

    expect(container.querySelector('.acp-root')).toHaveClass('acp-catalog-root')
    expect(screen.getByRole('searchbox', { name: '搜索' })).toBeTruthy()
    const cards = Array.from(container.querySelectorAll<HTMLButtonElement>('.acp-root-card'))
    expect(cards).toHaveLength(7)
    expect(cards.map((card) => card.querySelector('strong')?.textContent)).toEqual(['角色', '场景', '视频', '图片', '图标', '控件', '音频'])
    expect(cards.every((card) => card.querySelector('.acp-folder-thumb'))).toBe(true)
    expect(cards[0]?.querySelector('.acp-folder-preview-folder')).toBeTruthy()

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索' }), { target: { value: '视频' } })
    expect(container.querySelectorAll('.acp-root-card')).toHaveLength(1)
    expect(screen.getByRole('button', { name: '视频' })).toBeTruthy()
  })

  it('opens the image editor from the asset itself and keeps preview as a separate action', () => {
    const { container } = render(<AssetCatalogPanel gameId="demo" />)

    expect(screen.getByText('主角')).toBeTruthy()
    const card = screen.getByText('主角').closest('.acp-card')
    expect(card).toBeTruthy()
    fireEvent.pointerEnter(card as HTMLElement)
    expect(screen.getByRole('button', { name: '预览主角' })).toHaveStyle({ top: '-40px' })
    expect(within(card as HTMLElement).queryByRole('button', { name: '使用 AI 编辑主角' })).toBeNull()
    expect(within(card as HTMLElement).getByRole('button', { name: '打开主角的操作' })).toBeTruthy()
    fireEvent.click((card as HTMLElement).querySelector('.acp-card-main')!)

    expect(useGraphView.getState().view).toBe('image-generate')
    expect(consumeImageGenerationTarget('demo')).toMatchObject({
      assetId: 'asset-v1',
      entityId: 'hero',
      characterId: 'hero',
      targetRoot: 'character',
      returnView: 'assets',
    })
    expect(screen.queryByTestId('asset-catalog-detail')).toBeNull()
    expect(screen.getByTestId('asset-catalog-grid')).toBeTruthy()
    expect(useCatalogNav.getState().location).toMatchObject({ kind: 'tab-root', tabKind: 'character' })

    fireEvent.click(screen.getByRole('button', { name: '预览主角' }))
    const dialog = screen.getByRole('dialog', { name: '主角' })
    expect(within(dialog).getByRole('img', { name: '主角' })).toHaveAttribute('src', 'https://cdn.test/courtyard.jpg')
  })

  it('offers manifest characters without a current asset as generation targets', async () => {
    render(<AssetCatalogPanel gameId="demo" />)

    expect(screen.getByText('赤羽剑客')).toBeTruthy()
    const card = screen.getByText('赤羽剑客').closest<HTMLElement>('.acp-card')!
    await act(async () => {
      fireEvent.click(card.querySelector('.acp-card-main')!)
    })
    expect(window.sessionStorage.getItem('game-video:image-generation-target:v1')).toBeTruthy()
    expect(consumeImageGenerationTarget('demo')).toMatchObject({
      entityId: 'pending',
      targetRoot: 'character',
    })
  })

  it('opens one external video import form from the video toolbar', () => {
    useCatalogNav.setState({ location: { kind: 'tab-root', tabKind: 'video', target: 'root:video' } })
    const { container } = render(<AssetCatalogPanel gameId="demo" />)

    expect(container.querySelectorAll('.acp-form input')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '外部' }))
    expect(container.querySelectorAll('.acp-form input')).toHaveLength(2)
  })

  it('creates an empty folder immediately with the next available sibling name', async () => {
    const { container } = render(<AssetCatalogPanel gameId="demo" />)

    expect(screen.queryByRole('textbox', { name: '文件夹名称' })).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '新建文件夹' })) })

    expect(assetCatalogClientMock.createFolder).toHaveBeenCalledWith(expect.objectContaining({
      tabKind: 'character',
      parentId: null,
      name: '新文件夹3',
      sortKey: '新文件夹3',
    }))
    expect(container.querySelector('.acp-form input[aria-label="文件夹名称"]')).toBeNull()

    act(() => useCatalogNav.getState().setLocation({
      kind: 'tab-root',
      tabKind: 'scene',
      target: 'root:scene',
    }))
    expect(screen.queryByRole('textbox', { name: '文件夹名称' })).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '新建文件夹' })) })
    expect(assetCatalogClientMock.createFolder).toHaveBeenLastCalledWith(expect.objectContaining({
      tabKind: 'scene',
      parentId: null,
      name: '新文件夹1',
      sortKey: '新文件夹1',
    }))
  })

  it('allows folder creation only at a tab root and hides folder management inside it', () => {
    const { container } = render(<AssetCatalogPanel gameId="demo" />)

    expect(screen.getByRole('button', { name: '新建文件夹' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('角色收纳'))

    expect(screen.queryByRole('button', { name: '新建文件夹' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '重命名文件夹' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '目标文件夹' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除文件夹' })).not.toBeInTheDocument()
    expect(container.querySelector('.acp-browser > .acp-form')).toBeNull()
  })

  it('renders the Figma video toolbar and card contract without media controls', () => {
    useCatalogNav.setState({ location: { kind: 'tab-root', tabKind: 'video', target: 'root:video' } })
    const { container } = render(<AssetCatalogPanel gameId="demo" />)

    expect(container.querySelector('.acp-root')).toHaveClass('acp-video-list')
    expect(screen.getByRole('button', { name: '生成' }).querySelector('img')).toBeTruthy()
    expect(screen.getByRole('button', { name: '本地' }).querySelector('img')).toBeTruthy()
    expect(screen.getByRole('button', { name: '外部' }).querySelector('img')).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: '搜索' })).toBeTruthy()
    expect(container.querySelector('video[controls]')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('生成中')
    expect(screen.getByText('雨夜追逐').closest('.acp-card')).toHaveClass('is-generating')
  })

  it('shows an entity as generating from its scoped pending asset without replacing current', () => {
    const { container } = render(<AssetCatalogPanel gameId="demo" />)

    const pendingCard = screen.getByText('赤羽剑客').closest<HTMLElement>('.acp-card')!
    expect(pendingCard).toHaveClass('is-generating')
    expect(within(pendingCard).getByRole('status')).toHaveTextContent('生成中')
    expect(container.querySelectorAll('.acp-card.is-generating')).toHaveLength(1)
  })

  it('uploads every selected local video, registers successful files, and retries only failed files', async () => {
    useCatalogNav.setState({ location: { kind: 'tab-root', tabKind: 'video', target: 'root:video' } })
    uploadProviderResourceMock
      .mockResolvedValueOnce({ resource_id: 'video-1', name: 'first.mp4', url: 'https://cdn.test/first.mp4' })
      .mockRejectedValueOnce(new Error('upload failed'))
      .mockResolvedValueOnce({ resource_id: 'video-3', name: 'third.mp4', url: 'https://cdn.test/third.mp4' })
      .mockResolvedValueOnce({ resource_id: 'video-2', name: 'second.mp4', url: 'https://cdn.test/second.mp4' })
    const { container } = render(<AssetCatalogPanel gameId="demo" />)
    const files = [
      new File(['one'], 'first.mp4', { type: 'video/mp4' }),
      new File(['two'], 'second.mp4', { type: 'video/mp4' }),
      new File(['three'], 'third.mp4', { type: 'video/mp4' }),
    ]
    const input = container.querySelector<HTMLInputElement>('input[accept="video/mp4"]')!

    expect(input).toHaveAttribute('multiple')
    await act(async () => { fireEvent.change(input, { target: { files } }) })

    await waitFor(() => expect(uploadProviderResourceMock).toHaveBeenCalledTimes(3))
    expect(assetCatalogClientMock.registerGenerated).toHaveBeenCalledTimes(2)
    expect(screen.getByText('second.mp4: upload failed')).toBeTruthy()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重试登记' })) })
    await waitFor(() => expect(uploadProviderResourceMock).toHaveBeenCalledTimes(4))
    expect(uploadProviderResourceMock.mock.calls[3]?.[0]).toMatchObject({ file: files[1], mediaType: 'video' })
    expect(assetCatalogClientMock.registerGenerated).toHaveBeenCalledTimes(3)
    expect(screen.queryByText('second.mp4: upload failed')).toBeNull()
  })

  it('retries a failed single-file catalog registration without uploading the video again', async () => {
    useCatalogNav.setState({ location: { kind: 'tab-root', tabKind: 'video', target: 'root:video' } })
    uploadProviderResourceMock.mockResolvedValue({ resource_id: 'video-1', name: 'first.mp4', url: 'https://cdn.test/first.mp4' })
    assetCatalogClientMock.registerGenerated.mockRejectedValueOnce(new Error('registration failed'))
    const { container } = render(<AssetCatalogPanel gameId="demo" />)
    const file = new File(['one'], 'first.mp4', { type: 'video/mp4' })
    const input = container.querySelector<HTMLInputElement>('input[accept="video/mp4"]')!

    await act(async () => { fireEvent.change(input, { target: { files: [file] } }) })
    await waitFor(() => expect(assetCatalogClientMock.registerGenerated).toHaveBeenCalledTimes(1))
    expect(uploadProviderResourceMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText('first.mp4: registration failed')).toBeTruthy()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重试登记' })) })
    await waitFor(() => expect(assetCatalogClientMock.registerGenerated).toHaveBeenCalledTimes(2))
    expect(uploadProviderResourceMock).toHaveBeenCalledTimes(1)
  })

  it('gives video folders the same more action as video cards without an AI button', () => {
    useCatalogNav.setState({ location: { kind: 'tab-root', tabKind: 'video', target: 'root:video' } })
    render(<AssetCatalogPanel gameId="demo" />)

    const folderCard = screen.getByText('视频收纳').closest<HTMLElement>('.acp-card')!
    expect(within(folderCard).getByRole('button', { name: '打开视频收纳的操作' })).toBeTruthy()
    expect(folderCard.querySelector('.acp-card-ai-edit')).toBeNull()
  })

  it('opens a ready video with the existing fullscreen video player', () => {
    useCatalogNav.setState({ location: { kind: 'tab-root', tabKind: 'video', target: 'root:video' } })
    render(<AssetCatalogPanel gameId="demo" />)

    const card = screen.getByText('开场').closest<HTMLElement>('.acp-card')!
    fireEvent.pointerEnter(card)
    fireEvent.click(screen.getByRole('button', { name: '预览开场' }))

    const dialog = screen.getByRole('dialog', { name: '开场' })
    const video = within(dialog).getByLabelText('开场 视频预览') as HTMLVideoElement
    Object.defineProperty(video, 'duration', { configurable: true, value: 4 })
    fireEvent.loadedMetadata(video)
    expect(video).toHaveAttribute('src', 'https://cdn.test/intro.mp4')
    expect(video).not.toHaveAttribute('poster')
    expect(video).not.toHaveAttribute('controls')
    expect(video.currentTime).toBe(0.001)
  })

  it('opens an audio card in the waveform preview from its hover action', () => {
    useCatalogNav.setState({ location: { kind: 'tab-root', tabKind: 'audio', target: 'root:audio' } })
    render(<AssetCatalogPanel gameId="demo" />)

    const card = screen.getByText('主题曲').closest<HTMLElement>('.acp-card')!
    fireEvent.pointerEnter(card)
    fireEvent.click(screen.getByRole('button', { name: '预览主题曲' }))

    expect(screen.getByRole('dialog', { name: '主题曲' })).toBeTruthy()
    expect(screen.getByLabelText('主题曲 音频预览')).toHaveAttribute('src', 'https://cdn.test/theme.mp3')
    expect(screen.getByRole('button', { name: '全屏' })).toBeDisabled()
  })

  it('uses the paused video first frame for the catalog preview without rendering its poster as an image', () => {
    useCatalogNav.setState({ location: { kind: 'tab-root', tabKind: 'video', target: 'root:video' } })
    render(<AssetCatalogPanel gameId="demo" />)

    const card = screen.getByText('开场').closest<HTMLElement>('.acp-card')!
    const video = card.querySelector('video') as HTMLVideoElement
    Object.defineProperty(video, 'duration', { configurable: true, value: 4 })
    fireEvent.loadedMetadata(video)
    expect(video).toHaveAttribute('src', 'https://cdn.test/intro.mp4')
    expect(video).not.toHaveAttribute('poster')
    expect(video.currentTime).toBe(0.001)
    expect(card.querySelector('.acp-thumb > img')).toBeNull()
  })

  it('renders the Figma character toolbar with the asset-library breadcrumb and empty preview', () => {
    useCatalogNav.setState({ location: { kind: 'tab-root', tabKind: 'character', target: 'root:character' } })
    const { container } = render(<AssetCatalogPanel gameId="demo" />)

    expect(container.querySelector('.acp-root')).toHaveClass('acp-character-list')
    expect(screen.getByRole('button', { name: '生成' }).querySelector('img')).toBeTruthy()
    expect(screen.getByRole('button', { name: '本地' }).querySelector('img')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '外部' })).toBeNull()
    const breadcrumb = screen.getByRole('navigation', { name: '资产库位置' })
    expect(breadcrumb).toHaveTextContent('资产库›角色')
    expect(breadcrumb).not.toHaveTextContent('设定')
    expect(container.querySelector('.acp-type-placeholder.is-character')).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: '搜索' })).toBeTruthy()
  })

  it.each([
    ['character', true, true, false, '角色'],
    ['scene', true, true, false, '场景'],
    ['video', true, true, true, '视频'],
    ['icon', true, true, false, '图标'],
    ['control', true, true, false, '控件'],
    ['audio', false, true, false, '音频'],
    ['image', true, true, false, '图片'],
  ] as const)('uses the unified list toolbar and breadcrumb for %s assets', (tabKind, canGenerate, canImportLocal, canImportExternal, label) => {
    useCatalogNav.setState({ location: { kind: 'tab-root', tabKind, target: `root:${tabKind}` } })
    const { container } = render(<AssetCatalogPanel gameId="demo" />)

    expect(container.querySelector('.acp-root')).toHaveClass('acp-designed-list')
    expect(!!screen.queryByRole('button', { name: '生成' })).toBe(canGenerate)
    expect(!!screen.queryByRole('button', { name: '本地' })).toBe(canImportLocal)
    expect(!!screen.queryByRole('button', { name: '外部' })).toBe(canImportExternal)
    expect(screen.getByRole('button', { name: '新建文件夹' })).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: '搜索' })).toBeTruthy()
    const breadcrumb = screen.getByRole('navigation', { name: '资产库位置' })
    expect(breadcrumb).toHaveTextContent(`资产库›${label}`)
    expect(breadcrumb).not.toHaveTextContent('设定')
  })

  it('registers a local audio upload as an audio_track asset bound to an audio entity', async () => {
    useCatalogNav.setState({ location: { kind: 'tab-root', tabKind: 'audio', target: 'root:audio' } })
    uploadProviderResourceMock.mockResolvedValue({ resource_id: 'audio-1', name: 'bgm.mp3', url: 'https://cdn.test/bgm.mp3' })
    const { container } = render(<AssetCatalogPanel gameId="demo" />)
    const file = new File(['beat'], 'bgm.mp3', { type: 'audio/mpeg' })
    const input = container.querySelector<HTMLInputElement>('input[accept="audio/mpeg,audio/wav"]')!

    await act(async () => { fireEvent.change(input, { target: { files: [file] } }) })

    await waitFor(() => expect(assetCatalogClientMock.registerGenerated).toHaveBeenCalledTimes(1))
    expect(uploadProviderResourceMock.mock.calls[0]?.[0]).toMatchObject({ file, mediaType: 'audio', gameId: 'demo' })
    const registration = assetCatalogClientMock.registerGenerated.mock.calls[0]?.[0] as {
      placement: { placementKey: string }
      apply: { entityId: string }
    }
    expect(registration).toMatchObject({
      asset: { id: 'asset_upload_audio-1', kind: 'audio', productionType: 'audio_track', label: 'bgm', url: 'https://cdn.test/bgm.mp3' },
      placement: { folderId: 'root:audio' },
      apply: { mode: 'catalog', tabKind: 'audio', source: 'upload' },
    })
    expect(registration.apply.entityId).toMatch(/^audio_/)
    expect(registration.placement.placementKey).toBe(`audio:${registration.apply.entityId}`)
  })

  it('shows the entity display name in the breadcrumb instead of the internal item id', () => {
    useCatalogNav.setState({
      location: {
        kind: 'item',
        tabKind: 'scene',
        itemId: 'valley',
        placementKey: 'scene:valley',
        target: 'root:scene',
      },
    })
    render(<AssetCatalogPanel gameId="demo" />)

    const breadcrumb = screen.getByRole('navigation', { name: '资产库位置' })
    expect(breadcrumb).toHaveTextContent('资产库›场景›山谷')
    expect(breadcrumb).not.toHaveTextContent('valley')
  })

  it('defines the Figma placeholder variants from one shared type contract', () => {
    for (const variant of ['video', 'scene', 'character', 'text', 'audio']) {
      expect(ASSET_CATALOG_PANEL_CSS).toContain(`.is-${variant}`)
    }
    expect(ASSET_CATALOG_PANEL_CSS).toContain('background: rgba(0,0,0,.2);')
    expect(ASSET_CATALOG_PANEL_CSS).toContain('width: 122px;')
    expect(ASSET_CATALOG_PANEL_CSS).toContain('width: 40px;')
    expect(ASSET_CATALOG_PANEL_CSS).toContain('width: 60px; height: 63px;')
    expect(ASSET_CATALOG_PANEL_CSS).toContain('.acp-audio-waveform-fallback')
  })

  it('defines the Figma hover and selected asset states', () => {
    expect(ASSET_CATALOG_PANEL_CSS).toContain('.acp-card:hover .acp-card-hover-actions')
    expect(ASSET_CATALOG_PANEL_CSS).toContain('.acp-card.is-selected .acp-thumb')
    expect(ASSET_CATALOG_PANEL_CSS).toContain('box-shadow: inset 0 0 0 1px rgba(255,156,42,.6);')
    expect(ASSET_CATALOG_PANEL_CSS).toContain('width: 18px;')
  })

  it('opens rename and delete actions from the card more button', () => {
    render(<AssetCatalogPanel gameId="demo" />)
    expect(screen.queryByRole('menu')).toBeNull()

    const menu = openCardMenu('主角')
    expect(within(menu).getByRole('menuitem', { name: '重命名' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: '删除' })).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('renames an entity-backed card through the entity operation', async () => {
    render(<AssetCatalogPanel gameId="demo" />)

    const dialog = await chooseCardAction('主角', '重命名')
    const input = within(dialog).getByLabelText('资源名称')
    expect(input).toHaveValue('主角')

    fireEvent.change(input, { target: { value: '  白骨夫人  ' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '确认' })) })

    expect(assetCatalogClientMock.renameEntity).toHaveBeenCalledWith(expect.objectContaining({
      tabKind: 'character', entityId: 'hero', name: '白骨夫人',
    }))
    expect(assetCatalogClientMock.renameAsset).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renames an image card through the asset operation', async () => {
    useCatalogNav.setState({ location: { kind: 'tab-root', tabKind: 'image', target: 'root:image' } })
    render(<AssetCatalogPanel gameId="demo" />)

    const dialog = await chooseCardAction('庭院', '重命名')
    fireEvent.change(within(dialog).getByLabelText('资源名称'), { target: { value: '后院' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '确认' })) })

    expect(assetCatalogClientMock.renameAsset).toHaveBeenCalledWith(expect.objectContaining({
      assetId: 'asset-v1', name: '后院',
    }))
    expect(assetCatalogClientMock.renameEntity).not.toHaveBeenCalled()
  })

  it('deletes an entity-backed card after confirming the named dialog', async () => {
    render(<AssetCatalogPanel gameId="demo" />)

    const dialog = await chooseCardAction('主角', '删除')
    expect(within(dialog).getByRole('heading', { name: '删除文件' })).toBeTruthy()
    expect(dialog).toHaveTextContent('确认删除[主角]吗？其他蓝图中对此资产的调用引用将被清除。')

    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '删除' })) })

    expect(assetCatalogClientMock.deleteEntity).toHaveBeenCalledWith(expect.objectContaining({
      tabKind: 'character', entityId: 'hero',
    }))
    expect(assetCatalogClientMock.deleteAsset).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the delete dialog open and reports the reason when the host refuses', async () => {
    assetCatalogClientMock.deleteEntity.mockRejectedValueOnce(new Error('Asset asset-v1 is still referenced by blueprint.characters.hero'))
    render(<AssetCatalogPanel gameId="demo" />)

    const dialog = await chooseCardAction('主角', '删除')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '删除' })) })

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('alert')).toHaveTextContent('still referenced by blueprint.characters.hero')
  })

  it('renames and deletes folders from the folder card menu', async () => {
    render(<AssetCatalogPanel gameId="demo" />)

    const renameDialog = await chooseCardAction('角色收纳', '重命名')
    const input = within(renameDialog).getByLabelText('文件夹名称')
    expect(input).toHaveValue('角色收纳')
    fireEvent.change(input, { target: { value: '反派收纳' } })
    await act(async () => { fireEvent.click(within(renameDialog).getByRole('button', { name: '确认' })) })
    expect(assetCatalogClientMock.renameFolder).toHaveBeenCalledWith(expect.objectContaining({
      folderId: 'folder-character', name: '反派收纳',
    }))

    const deleteDialog = await chooseCardAction('角色收纳', '删除')
    expect(within(deleteDialog).getByRole('heading', { name: '删除文件夹' })).toBeTruthy()
    expect(deleteDialog).toHaveTextContent('确认删除[角色收纳]吗？其他蓝图中对此资产的调用引用将被清除。')
    await act(async () => { fireEvent.click(within(deleteDialog).getByRole('button', { name: '删除' })) })
    expect(assetCatalogClientMock.deleteFolder).toHaveBeenCalledWith(expect.objectContaining({
      folderId: 'folder-character',
    }))
  })

  it('opens video editing from the asset itself and previews only ready media', () => {
    useCatalogNav.setState({ location: { kind: 'tab-root', tabKind: 'video', target: 'root:video' } })
    render(<AssetCatalogPanel gameId="demo" />)

    const generatingCard = screen.getByText('雨夜追逐').closest<HTMLElement>('.acp-card')!
    const readyCard = screen.getByText('开场').closest<HTMLElement>('.acp-card')!
    expect(within(generatingCard).queryByRole('button', { name: '使用 AI 编辑雨夜追逐' })).toBeNull()
    expect(within(generatingCard).getByRole('button', { name: '打开雨夜追逐的操作' })).toBeTruthy()
    fireEvent.pointerEnter(readyCard)
    expect(screen.getByRole('button', { name: '预览开场' })).toBeTruthy()
    expect(within(readyCard).queryByRole('button', { name: '使用 AI 编辑开场' })).toBeNull()
    expect(within(readyCard).getByRole('button', { name: '打开开场的操作' })).toBeTruthy()
    fireEvent.click(readyCard.querySelector('.acp-card-main')!)
    expect(useGraphView.getState().view).toBe('video-generate')
    expect(consumeCatalogVideoGenerationTarget('demo')).toMatchObject({
      entityId: 'intro',
      assetId: 'asset-video-ready',
    })
  })

  it('offers batch selection only for the image asset tab', () => {
    render(<AssetCatalogPanel gameId="demo" />)
    expect(screen.queryByRole('checkbox')).toBeNull()

    act(() => useCatalogNav.getState().setLocation({
      kind: 'tab-root',
      tabKind: 'image',
      target: 'root:image',
    }))
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })
})
