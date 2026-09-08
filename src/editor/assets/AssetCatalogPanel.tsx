import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { tf, useT } from '../../i18n'
import { AssetCardActionsMenu, AssetCardDialog, type AssetCardAnchor } from './AssetCardActions'
import {
  VISIBLE_CATALOG_TAB_KINDS,
  catalogFolderChildren,
  catalogItemsIn,
  catalogRootTarget,
  useAssetCatalog,
  type CatalogAsset,
  type CatalogFolder,
  type CatalogItemRow,
  type CatalogTabKind,
} from './asset-catalog'
import { canAcceptCatalogItemDrag, canDropCatalogItem, catalogDragPoint, readCatalogItemDrag, setCatalogItemDragImage, writeCatalogItemDrag } from './asset-catalog-drag'
import { useCatalogNav, type CatalogNavLocation } from '../persist/catalogNavStore'
import { requestImageGenerationTarget } from './generation/imageGenerationNavigation'
import { requestCatalogVideoGenerationTarget } from './generation/videoGenerationNavigation'
import { useGraphView } from '../persist/graphViewStore'
import { VideoFullscreenDialog } from '../shell/VideoFullscreenDialog'
import { AudioCatalogPreview } from './AudioCatalogPreview'
import {
  createAssetCatalogOperations,
  type CatalogCardTarget,
  type CatalogUploadKind,
} from './asset-catalog-operations'
import externalToolbarIcon from '@/editor/ui-assets/asset-toolbar-external.svg?url'
import generateToolbarIcon from '@/editor/ui-assets/asset-toolbar-generate.svg?url'
import localToolbarIcon from '@/editor/ui-assets/asset-toolbar-local.svg?url'
import ruleToolbarAddIcon from '@/editor/ui-assets/rule-toolbar-add.svg'
import ruleToolbarSearchIcon from '@/editor/ui-assets/rule-toolbar-search.svg'
import videoPlayIcon from '@/editor/ui-assets/asset-video-play.svg?url'
import videoPreviewIcon from '@/editor/ui-assets/asset-video-preview.svg?url'
import characterPlaceholderIcon from '@/editor/ui-assets/asset-character-placeholder.svg?url'
import scenePlaceholderIcon from '@/editor/ui-assets/asset-scene-placeholder.svg?url'
import imagePlaceholderIcon from '@/editor/ui-assets/asset-image-placeholder.svg?url'
import textPlaceholderIcon from '@/editor/ui-assets/asset-text-placeholder.svg?url'
import audioPlaceholderIcon from '@/editor/ui-assets/asset-audio-placeholder.svg?url'
import cardMoreIcon from '@/editor/ui-assets/asset-card-more.svg?url'
import folderThumbnailIcon from '@/editor/ui-assets/asset-folder-thumbnail.svg?url'
import audioWaveformIcon from '@/editor/ui-assets/asset-audio-waveform.svg?url'
import { revealFirstVideoFrame } from '@/editor/video/revealFirstVideoFrame'
import { AudioWaveform } from '@/editor/video/audioWaveform'

export { ASSET_CATALOG_PANEL_CSS } from './assetCatalogPanelStyles'

const TAB_LABEL_KEYS: Record<CatalogTabKind, string> = {
  character: 'assetCatalog.root.character', scene: 'assetCatalog.root.scene', video: 'assetCatalog.root.video', image: 'assetCatalog.root.image', icon: 'assetCatalog.root.icon', control: 'assetCatalog.root.control', audio: 'assetCatalog.root.audio', font: 'assetCatalog.root.font',
}

const CATALOG_TAB_CAPABILITIES: Record<CatalogTabKind, {
  generation: 'image' | 'video' | null
  localImport: CatalogUploadKind | null
  externalImport: 'video' | null
}> = {
  character: { generation: 'image', localImport: 'image', externalImport: null },
  scene: { generation: 'image', localImport: 'image', externalImport: null },
  video: { generation: 'video', localImport: 'video', externalImport: 'video' },
  icon: { generation: 'image', localImport: 'image', externalImport: null },
  control: { generation: 'image', localImport: 'image', externalImport: null },
  audio: { generation: null, localImport: 'audio', externalImport: null },
  font: { generation: null, localImport: null, externalImport: null },
  image: { generation: 'image', localImport: 'image', externalImport: null },
}

/** Narrowed to what `media/capabilities` advertises today; the policy table also allows ogg/m4a/aac. */
const AUDIO_UPLOAD_ACCEPT = 'audio/mpeg,audio/wav'

/** A card the hover "more" menu can act on. Folders and items share the menu. */
type CardTarget = CatalogCardTarget

type UploadAttempt = {
  file: File
  register?: () => Promise<void>
}

function cardTargetKey(target: CardTarget): string {
  return target.kind === 'folder' ? `folder:${target.folder.id}` : target.row.placementKey
}

function cardTargetName(target: CardTarget): string {
  return target.kind === 'folder' ? target.folder.name : target.row.name
}

function parentLocation(catalog: ReturnType<typeof useAssetCatalog>['catalog'], location: CatalogNavLocation): CatalogNavLocation | null {
  if (location.kind === 'catalog-root') return null
  if (location.kind === 'tab-root') return { kind: 'catalog-root', target: 'root:catalog' }
  if (location.kind === 'item') {
    return location.target === catalogRootTarget(location.tabKind)
      ? { kind: 'tab-root', tabKind: location.tabKind, target: catalogRootTarget(location.tabKind) as `root:${CatalogTabKind}` }
      : parentLocation(catalog, { kind: 'folder', tabKind: location.tabKind, folderId: location.target, target: location.target })
  }
  const folder = catalog.folders.find((candidate) => candidate.id === location.folderId)
  if (!folder || folder.parentId === null) return { kind: 'tab-root', tabKind: location.tabKind, target: catalogRootTarget(location.tabKind) as `root:${CatalogTabKind}` }
  return { kind: 'folder', tabKind: location.tabKind, folderId: folder.parentId, target: folder.parentId }
}

function breadcrumbLabel(
  catalog: ReturnType<typeof useAssetCatalog>['catalog'],
  location: CatalogNavLocation,
  t: ReturnType<typeof useT>,
): string {
  if (location.kind === 'catalog-root') return t('assetCatalog.title')
  if (location.kind === 'tab-root') return t(TAB_LABEL_KEYS[location.tabKind])
  if (location.kind === 'folder') return catalog.folders.find((folder) => folder.id === location.folderId)?.name ?? t('assetCatalog.folder')
  if (location.tabKind === 'image') return catalog.assets[location.itemId]?.name ?? location.itemId
  return catalog.entities[location.tabKind]?.[location.itemId]?.name ?? location.itemId
}

function nextFolderName(siblingFolders: CatalogFolder[], formatName: (number: number) => string): string {
  const existingNames = new Set(siblingFolders.map((folder) => folder.name))
  let suffix = 1
  while (existingNames.has(formatName(suffix))) suffix += 1
  return formatName(suffix)
}

function preview(asset: CatalogAsset | null, emptyLabel: string, t: ReturnType<typeof useT>, controls = false): JSX.Element {
  if (!asset?.url) return <>{emptyLabel}</>
  if (asset.kind === 'video') return <video src={asset.url} muted controls={controls} playsInline preload="metadata" aria-label={t('assetComponents.preview.videoAria')} onLoadedMetadata={(event) => revealFirstVideoFrame(event.currentTarget)} />
  if (asset.kind === 'audio') return <AudioWaveform src={asset.url} width={110} height={32} color="rgba(255,255,255,.86)" variant="bars" className="acp-audio-waveform" fallbackSrc={audioWaveformIcon} />
  return <img src={asset.url} alt={asset.name} />
}

type FolderPreviewEntry =
  | { kind: 'folder'; folder: CatalogFolder }
  | { kind: 'item'; row: CatalogItemRow }

function folderPreviewEntries(
  catalog: ReturnType<typeof useAssetCatalog>['catalog'],
  target: string,
  tabKind: CatalogTabKind,
): FolderPreviewEntry[] {
  return [
    ...catalogFolderChildren(catalog, target, tabKind).map((folder): FolderPreviewEntry => ({ kind: 'folder', folder })),
    ...catalogItemsIn(catalog, target, tabKind).map((row): FolderPreviewEntry => ({ kind: 'item', row })),
  ].slice(0, 6)
}

function typePlaceholder(tabKind: CatalogTabKind): JSX.Element | null {
  const placeholder = tabKind === 'video'
    ? { icon: videoPlayIcon, className: 'video' }
    : tabKind === 'scene'
      ? { icon: scenePlaceholderIcon, className: 'scene' }
      : tabKind === 'character'
        ? { icon: characterPlaceholderIcon, className: 'character' }
        : tabKind === 'image' || tabKind === 'icon' || tabKind === 'control'
          ? { icon: imagePlaceholderIcon, className: 'image' }
        : tabKind === 'font'
          ? { icon: textPlaceholderIcon, className: 'text' }
          : tabKind === 'audio'
            ? { icon: audioPlaceholderIcon, className: 'audio' }
            : null
  return placeholder ? <span className={`acp-type-placeholder is-${placeholder.className}`} aria-hidden><img src={placeholder.icon} alt="" /></span> : null
}

export function AssetCatalogPanel({ gameId }: { gameId: string }): JSX.Element {
  const t = useT()
  const { catalog, loading, error, refresh } = useAssetCatalog(gameId)
  const location = useCatalogNav((state) => state.location)
  const setLocation = useCatalogNav((state) => state.setLocation)
  const setView = useGraphView((state) => state.setView)
  const operations = useMemo(() => createAssetCatalogOperations(), [])
  const [query, setQuery] = useState('')
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())
  const [selectedPlacementKey, setSelectedPlacementKey] = useState<string | null>(() => location.kind === 'item' ? location.placementKey : null)
  const [previewingRow, setPreviewingRow] = useState<CatalogItemRow | null>(null)
  const [previewAnchor, setPreviewAnchor] = useState<{ row: CatalogItemRow; top: number; left: number } | null>(null)
  const [externalUrl, setExternalUrl] = useState('')
  const [externalName, setExternalName] = useState('')
  const [externalForm, setExternalForm] = useState(false)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ folderId: string; label: string; x: number; y: number } | null>(null)
  const [cardMenu, setCardMenu] = useState<{ target: CardTarget; anchor: AssetCardAnchor } | null>(null)
  const [cardDialog, setCardDialog] = useState<{ mode: 'rename' | 'delete'; target: CardTarget } | null>(null)
  const retryRef = useRef<(() => Promise<void>) | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const previewCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const videoInput = useRef<HTMLInputElement>(null)
  const audioInput = useRef<HTMLInputElement>(null)
  const externalUrlInput = useRef<HTMLInputElement>(null)

  const clearPreviewCloseTimer = (): void => {
    if (!previewCloseTimerRef.current) return
    clearTimeout(previewCloseTimerRef.current)
    previewCloseTimerRef.current = null
  }
  const openPreviewAnchor = (row: CatalogItemRow, card: HTMLElement): void => {
    const thumb = card.querySelector<HTMLElement>('.acp-thumb')
    if (!thumb) return
    clearPreviewCloseTimer()
    const rect = thumb.getBoundingClientRect()
    setPreviewAnchor({ row, top: rect.top - 40, left: rect.left + rect.width / 2 })
  }
  const schedulePreviewClose = (): void => {
    clearPreviewCloseTimer()
    previewCloseTimerRef.current = setTimeout(() => setPreviewAnchor(null), 120)
  }

  useEffect(() => () => clearPreviewCloseTimer(), [])

  const content = useMemo(() => {
    if (location.kind === 'catalog-root') return { title: t('assetCatalog.title'), folders: [] as CatalogFolder[], items: [] as CatalogItemRow[] }
    const target = location.kind === 'tab-root' ? catalogRootTarget(location.tabKind) : location.target
    const folders = catalogFolderChildren(catalog, target, location.tabKind)
    const items = catalogItemsIn(catalog, target, location.tabKind)
    const needle = query.trim().toLocaleLowerCase()
    return {
      title: location.kind === 'tab-root' ? t(TAB_LABEL_KEYS[location.tabKind]) : location.kind === 'folder' ? catalog.folders.find((folder) => folder.id === location.folderId)?.name ?? t('assetCatalog.folder') : '',
      folders: needle ? folders.filter((folder) => folder.name.toLocaleLowerCase().includes(needle)) : folders,
      items: needle ? items.filter((row) => `${row.name} ${row.entity?.prompt ?? row.asset?.prompt ?? ''}`.toLocaleLowerCase().includes(needle)) : items,
    }
  }, [catalog, location, query, t])

  const selectedRow = content.items.find((row) => row.placementKey === selectedPlacementKey) ?? null

  const canBatchSelect = location.kind !== 'catalog-root' && location.tabKind === 'image'

  useEffect(() => {
    if (!canBatchSelect) {
      setSelectedKeys((current) => current.size ? new Set() : current)
      return
    }
    const valid = new Set(content.items.map((row) => row.placementKey))
    setSelectedKeys((current) => {
      const next = new Set([...current].filter((key) => valid.has(key)))
      return next.size === current.size ? current : next
    })
  }, [canBatchSelect, content.items])

  useEffect(() => {
    retryRef.current = null
    setOperationError(null)
    setExternalForm(false)
    setCardMenu(null)
    setSelectedPlacementKey(location.kind === 'item' ? location.placementKey : null)
  }, [location])

  const mutate = async (action: () => Promise<void>, after?: () => void, retry?: () => Promise<void>): Promise<void> => {
    const previousRetry = retryRef.current
    setBusy(true)
    setOperationError(null)
    try { await action(); retryRef.current = null; after?.() } catch (cause) {
      const evolvedRetry = retryRef.current !== previousRetry ? retryRef.current : null
      retryRef.current = retry ?? evolvedRetry ?? action
      setOperationError(cause instanceof Error ? cause.message : t('assetCatalog.operationFailed'))
    } finally { setBusy(false) }
  }

  const openGeneration = (tabKind: CatalogTabKind, entityId?: string, assetId?: string): void => {
    const generation = CATALOG_TAB_CAPABILITIES[tabKind].generation
    if (generation === 'video') {
      requestCatalogVideoGenerationTarget({ gameId, ...(entityId ? { entityId } : {}), ...(assetId ? { assetId } : {}) })
      setView('video-generate')
      return
    }
    if (generation !== 'image') return
    requestImageGenerationTarget({ gameId, ...(assetId ? { assetId } : {}), ...(tabKind === 'character' && entityId ? { characterId: entityId } : {}), ...(entityId ? { entityId } : {}), targetRoot: tabKind as 'image' | 'scene' | 'icon' | 'control' | 'character', returnView: 'assets' })
    setView('image-generate')
  }

  const createUploadRegistration = async (file: File, kind: CatalogUploadKind, targetTabKind: CatalogTabKind = kind): Promise<() => Promise<void>> => {
    return operations.createUploadRegistration({
      gameId,
      location,
      file,
      kind,
      targetTabKind,
    })
  }

  const registerUploads = async (uploads: readonly UploadAttempt[], kind: CatalogUploadKind, targetTabKind: CatalogTabKind = kind): Promise<void> => {
    const failed: Array<UploadAttempt & { cause: unknown }> = []
    setBusy(true)
    setOperationError(null)
    retryRef.current = null
    try {
      for (const upload of uploads) {
        let register = upload.register
        try {
          register ??= await createUploadRegistration(upload.file, kind, targetTabKind)
          await register()
        } catch (cause) {
          failed.push({ file: upload.file, ...(register ? { register } : {}), cause })
        }
      }
      if (failed.length) {
        retryRef.current = () => registerUploads(failed, kind, targetTabKind)
        setOperationError(failed.map(({ file, cause }) => `${file.name}: ${cause instanceof Error ? cause.message : t('assetCatalog.operationFailed')}`).join('；'))
      }
    } finally {
      setBusy(false)
    }
  }

  const openLocalImport = (kind: CatalogUploadKind): void => {
    const input = kind === 'video' ? videoInput : kind === 'audio' ? audioInput : imageInput
    input.current?.click()
  }

  const importExternalVideo = async (): Promise<void> => {
    if (!externalUrl.trim()) return
    let registration: (() => Promise<void>) | undefined
    const sourceUrl = externalUrl.trim()
    const sourceName = externalName.trim()
    const execute = async (): Promise<void> => {
      registration = await operations.createExternalVideoRegistration({
        gameId,
        url: sourceUrl,
        name: sourceName,
      })
      retryRef.current = registration
      await registration()
    }
    setBusy(true)
    setOperationError(null)
    retryRef.current = null
    try {
      await execute()
      setExternalUrl(''); setExternalName('')
      setExternalForm(false)
    } catch (cause) {
      retryRef.current = registration ?? execute
      setOperationError(cause instanceof Error ? cause.message : t('assetCatalog.operationFailed'))
    } finally {
      setBusy(false)
    }
  }

  const createFolder = async (): Promise<void> => {
    if (location.kind !== 'tab-root') return
    const tabKind = location.tabKind
    const name = nextFolderName(
      catalogFolderChildren(catalog, location.target, tabKind),
      (number) => tf('assetCatalog.defaultFolderName', { number }),
    )
    await mutate(() => operations.createFolder(tabKind, name))
  }

  const moveCatalogItem = async (row: CatalogItemRow, folderId: string): Promise<void> => {
    await mutate(() => operations.moveCatalogItem(row, folderId))
  }

  const folderDropHandlers = (folder: CatalogFolder) => ({
    onDragEnter: (event: DragEvent<HTMLDivElement>) => {
      if (!canAcceptCatalogItemDrag(event.dataTransfer, folder.tabKind)) return
      event.preventDefault()
      setDropTarget({ folderId: folder.id, label: folder.name, ...catalogDragPoint(event) })
    },
    onDragLeave: (event: DragEvent<HTMLDivElement>) => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
      setDropTarget((current) => current?.folderId === folder.id ? null : current)
    },
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      if (!canAcceptCatalogItemDrag(event.dataTransfer, folder.tabKind)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDropTarget({ folderId: folder.id, label: folder.name, ...catalogDragPoint(event) })
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      const payload = readCatalogItemDrag(event.dataTransfer)
      if (!canDropCatalogItem(payload, folder.tabKind, folder.id)) return
      event.preventDefault()
      event.stopPropagation()
      setDropTarget(null)
      const row = content.items.find((candidate) => candidate.placementKey === payload.placementKey)
      if (row) void moveCatalogItem(row, folder.id)
    },
  })

  const toggleCardMenu = (target: CardTarget, event: MouseEvent<HTMLButtonElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    setCardMenu((current) => current && cardTargetKey(current.target) === cardTargetKey(target)
      ? null
      : { target, anchor: { x: rect.left, y: rect.bottom + 6 } })
  }

  const cardMoreButton = (target: CardTarget): JSX.Element => <button
    type="button"
    className="acp-card-more"
    aria-label={tf('assetCatalog.openAssetActions', { name: cardTargetName(target) })}
    aria-haspopup="menu"
    aria-expanded={!!cardMenu && cardTargetKey(cardMenu.target) === cardTargetKey(target)}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => toggleCardMenu(target, event)}
  ><img src={cardMoreIcon} alt="" /></button>

  // Card rename/delete deliberately bypass `mutate`: the dialog owns the busy
  // state and shows the host's refusal (asset_in_use, folder_not_empty) inline
  // instead of dropping a banner behind a modal the user is still looking at.
  const submitCardRename = async (target: CardTarget, name: string): Promise<void> => {
    await operations.renameCard(target, name)
  }

  const submitCardDelete = async (target: CardTarget): Promise<void> => {
    await operations.deleteCard(target)
    if (target.kind === 'folder') return
    const { row } = target
    if (location.kind === 'item' && location.placementKey === row.placementKey) {
      setLocation({ kind: 'tab-root', tabKind: row.tabKind, target: catalogRootTarget(row.tabKind) as `root:${CatalogTabKind}` })
    }
  }

  const deleteSelected = async (): Promise<void> => {
    if (location.kind === 'catalog-root' || location.tabKind !== 'image' || !selectedKeys.size) return
    const selectedRows = content.items.filter((row) => selectedKeys.has(row.placementKey))
    if (selectedRows.length === 0) {
      setSelectedKeys(new Set())
      return
    }
    await mutate(() => operations.deleteImageRows(selectedRows), () => setSelectedKeys(new Set()))
  }

  const renderBreadcrumb = (current: CatalogNavLocation): JSX.Element => {
    const chain: CatalogNavLocation[] = []
    let cursor: CatalogNavLocation | null = current
    while (cursor) { chain.unshift(cursor); cursor = parentLocation(catalog, cursor) }
    return <nav className="acp-breadcrumb" aria-label={t('assetCatalog.breadcrumb')}>
      {chain.map((crumb, index) => <span className="acp-breadcrumb-item" key={`${crumb.kind}:${crumb.target}`}>
        <button type="button" onClick={() => setLocation(crumb)}>{breadcrumbLabel(catalog, crumb, t)}</button>
        {index < chain.length - 1 ? <span aria-hidden="true">›</span> : null}
      </span>)}
    </nav>
  }

  if (loading) return <div className="acp-root"><p className="acp-empty">{t('assetCatalog.loading')}</p></div>
  if (error) return <div className="acp-root"><p className="acp-empty">{error}</p></div>
  const isCatalogRoot = location.kind === 'catalog-root'
  const isVideoList = location.kind !== 'catalog-root' && location.tabKind === 'video'
  const isCharacterList = location.kind !== 'catalog-root' && location.tabKind === 'character'
  const isDesignedList = !isCatalogRoot
  const currentTabKind = isCatalogRoot ? null : location.tabKind
  const currentCapabilities = currentTabKind ? CATALOG_TAB_CAPABILITIES[currentTabKind] : null
  const localImportKind = currentCapabilities?.localImport ?? null
  const searchLabel = t('assetCatalog.search')
  const catalogTabNeedle = query.trim().toLocaleLowerCase()
  const visibleCatalogTabs = VISIBLE_CATALOG_TAB_KINDS.filter((tabKind) => !catalogTabNeedle || t(TAB_LABEL_KEYS[tabKind]).toLocaleLowerCase().includes(catalogTabNeedle))
  const designedListHeader = currentTabKind && currentCapabilities ? <><header className="acp-head acp-designed-head"><div className="acp-toolbar acp-designed-sources">{currentCapabilities.generation ? <button type="button" onClick={() => openGeneration(currentTabKind)}><span className="acp-toolbar-icon" aria-hidden><img src={generateToolbarIcon} alt="" /></span>{t('assetCatalog.generate')}</button> : null}{localImportKind ? <button type="button" disabled={busy} onClick={() => openLocalImport(localImportKind)}><span className="acp-toolbar-icon" aria-hidden><img src={localToolbarIcon} alt="" /></span>{t('assetCatalog.local')}</button> : null}{currentCapabilities.externalImport ? <button type="button" onClick={() => setExternalForm((value) => !value)}><span className="acp-toolbar-icon" aria-hidden><img src={externalToolbarIcon} alt="" /></span>{t('assetCatalog.external')}</button> : null}</div><div className="acp-toolbar acp-designed-actions">{selectedKeys.size ? <button type="button" onClick={() => void deleteSelected()} disabled={busy}>{t('assetCatalog.batchDelete')}</button> : null}{location.kind === 'tab-root' ? <button type="button" disabled={busy} onClick={() => void createFolder()}><span className="acp-toolbar-icon" aria-hidden><img src={ruleToolbarAddIcon} alt="" /></span>{t('assetCatalog.newFolder')}</button> : null}<label className="acp-search"><span aria-hidden><img src={ruleToolbarSearchIcon} alt="" /></span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchLabel} aria-label={searchLabel} /></label></div></header>{isVideoList && externalForm ? <div className="acp-form"><input autoFocus ref={externalUrlInput} value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} placeholder={t('assetCatalog.externalUrl')} aria-label={t('assetCatalog.externalUrl')} /><input value={externalName} onChange={(event) => setExternalName(event.target.value)} placeholder={t('assetCatalog.externalName')} aria-label={t('assetCatalog.externalName')} /><button type="button" onClick={() => void importExternalVideo()} disabled={busy}>{t('assetCatalog.importVideo')}</button></div> : null}<div className="acp-designed-breadcrumb">{renderBreadcrumb(location)}</div></> : null
  return <div ref={rootRef} className={`acp-root${isCatalogRoot ? ' acp-catalog-root' : ''}${isDesignedList ? ' acp-designed-list' : ''}${isVideoList ? ' acp-video-list' : ''}${isCharacterList ? ' acp-character-list' : ''}`}><div className="acp-browser">{isCatalogRoot ? <header className="acp-head acp-catalog-head"><label className="acp-search"><span aria-hidden><img src={ruleToolbarSearchIcon} alt="" /></span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchLabel} aria-label={searchLabel} /></label></header> : designedListHeader}
    <div className="acp-grid" data-testid="asset-catalog-grid">
      {isCatalogRoot ? visibleCatalogTabs.map((tabKind) => { const tabPreview = folderPreviewEntries(catalog, catalogRootTarget(tabKind), tabKind); return <button className="acp-card acp-root-card" type="button" key={tabKind} onClick={() => setLocation({ kind: 'tab-root', tabKind, target: catalogRootTarget(tabKind) as `root:${CatalogTabKind}` })}><div className="acp-thumb acp-folder-thumb"><span className="acp-folder-preview" aria-hidden>{tabPreview.map((entry) => <span className={entry.kind === 'folder' ? 'is-folder-preview' : undefined} key={entry.kind === 'folder' ? entry.folder.id : entry.row.placementKey}>{entry.kind === 'folder' ? <img className="acp-folder-preview-folder" src={folderThumbnailIcon} alt="" /> : entry.row.asset?.kind === 'image' || entry.row.asset?.kind === 'video' ? preview(entry.row.asset, '', t) : null}</span>)}</span></div><strong>{t(TAB_LABEL_KEYS[tabKind])}</strong></button> }) : null}
      {content.folders.map((folder) => { const folderPreview = isDesignedList ? folderPreviewEntries(catalog, folder.id, folder.tabKind) : []; return <div className={`acp-card${dropTarget?.folderId === folder.id ? ' is-drop-target' : ''}`} key={folder.id} {...folderDropHandlers(folder)}><button className="acp-card-main" type="button" onClick={() => setLocation({ kind: 'folder', tabKind: folder.tabKind, folderId: folder.id, target: folder.id })}><div className={`acp-thumb${isDesignedList ? ' acp-folder-thumb' : ''}`}>{isDesignedList ? <span className="acp-folder-preview" aria-hidden>{folderPreview.map((entry) => <span className={entry.kind === 'folder' ? 'is-folder-preview' : undefined} key={entry.kind === 'folder' ? entry.folder.id : entry.row.placementKey}>{entry.kind === 'folder' ? <img className="acp-folder-preview-folder" src={folderThumbnailIcon} alt="" /> : entry.row.asset?.kind === 'image' || entry.row.asset?.kind === 'video' ? preview(entry.row.asset, '', t) : null}</span>)}</span> : t('assetCatalog.folder')}</div><strong>{folder.name}</strong>{isDesignedList ? null : <small>{t(TAB_LABEL_KEYS[folder.tabKind])}</small>}</button><div className="acp-card-hover-actions">{cardMoreButton({ kind: 'folder', folder })}</div></div> })}
      {content.items.map((row) => { const isSelected = selectedKeys.has(row.placementKey) || selectedRow?.placementKey === row.placementKey; const canEdit = CATALOG_TAB_CAPABILITIES[row.tabKind].generation !== null; const canPreview = !!row.asset?.url && (row.asset.kind === 'image' || row.asset.kind === 'video' || row.asset.kind === 'audio'); const isGenerating = row.asset?.status === 'generating' || row.pendingAsset !== null; return <div className={`acp-card${isSelected ? ' is-selected' : ''}${isGenerating ? ' is-generating' : ''}${draggingKey === row.placementKey ? ' is-dragging' : ''}`} draggable={!busy && !isGenerating} key={row.placementKey} onPointerEnter={(event) => { if (canPreview) openPreviewAnchor(row, event.currentTarget) }} onPointerLeave={() => { if (canPreview) schedulePreviewClose() }} onDragStart={(event) => { writeCatalogItemDrag(event.dataTransfer, { placementKey: row.placementKey, tabKind: row.tabKind, name: row.name, sourceTarget: row.placement.folderId }); setCatalogItemDragImage(event.dataTransfer, event.currentTarget); setDraggingKey(row.placementKey) }} onDragEnd={() => { setDraggingKey(null); setDropTarget(null) }}>{canBatchSelect ? <input className="acp-check" type="checkbox" aria-label={tf('assetComponents.asset.openAria', { name: row.name })} checked={selectedKeys.has(row.placementKey)} onChange={(event) => setSelectedKeys((current) => { const next = new Set(current); if (event.target.checked) next.add(row.placementKey); else next.delete(row.placementKey); return next })} /> : null}<button className="acp-card-main" type="button" onClick={() => canEdit ? openGeneration(row.tabKind, row.entity?.id, row.asset?.id) : setSelectedPlacementKey(row.placementKey)}><div className={`acp-thumb${!row.asset?.url ? ' has-type-placeholder' : ''}`}>{!row.asset?.url ? typePlaceholder(row.tabKind) ?? t('assetCatalog.noPreview') : row.asset.kind === 'font' ? t('assetCatalog.previewFont') : preview(row.asset, t('assetCatalog.noPreview'), t)}{isGenerating ? <span className="acp-card-generation-status" role="status"><span aria-hidden />{t('assetCatalog.statusGenerating')}</span> : null}</div><strong>{row.name}</strong>{isDesignedList ? null : <small>{row.entity?.prompt ?? row.asset?.prompt ?? row.asset?.kind ?? t('assetCatalog.asset')}</small>}</button><div className="acp-card-hover-actions">{cardMoreButton({ kind: 'asset', row })}</div></div> })}
    </div>
    {!content.folders.length && !content.items.length && location.kind !== 'catalog-root' ? <p className="acp-empty">{t('assetCatalog.empty')}</p> : null}
    {dropTarget ? <span className="acp-drag-hint" style={{ left: dropTarget.x + 12, top: dropTarget.y + 12 }}>{tf('assetCatalog.moveTo', { name: dropTarget.label })}</span> : null}
    {cardMenu ? <AssetCardActionsMenu
      name={cardTargetName(cardMenu.target)}
      anchor={cardMenu.anchor}
      onRename={() => { setCardDialog({ mode: 'rename', target: cardMenu.target }); setCardMenu(null) }}
      onDelete={() => { setCardDialog({ mode: 'delete', target: cardMenu.target }); setCardMenu(null) }}
      onClose={() => setCardMenu(null)}
    /> : null}
    {cardDialog ? <AssetCardDialog
      mode={cardDialog.mode}
      folder={cardDialog.target.kind === 'folder'}
      preserveMedia={cardDialog.target.kind === 'folder' ? cardDialog.target.folder.tabKind !== 'image' : cardDialog.target.row.tabKind !== 'image'}
      name={cardTargetName(cardDialog.target)}
      onSubmit={(name) => cardDialog.mode === 'rename' ? submitCardRename(cardDialog.target, name) : submitCardDelete(cardDialog.target)}
      onClose={() => setCardDialog(null)}
    /> : null}
    {operationError ? <p className="acp-error">{operationError}{retryRef.current ? <button type="button" onClick={() => { const retry = retryRef.current; if (retry) void mutate(retry) }} disabled={busy}>{t('assetCatalog.retryOperation')}</button> : null}</p> : null}
    <input ref={imageInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file && currentTabKind && CATALOG_TAB_CAPABILITIES[currentTabKind].localImport === 'image') void registerUploads([{ file }], 'image', currentTabKind); event.currentTarget.value = '' }} />
    <input ref={videoInput} hidden type="file" accept="video/mp4" multiple onChange={(event) => { const files = [...(event.target.files ?? [])]; if (files.length) void registerUploads(files.map((file) => ({ file })), 'video'); event.currentTarget.value = '' }} />
    <input ref={audioInput} hidden type="file" accept={AUDIO_UPLOAD_ACCEPT} multiple onChange={(event) => { const files = [...(event.target.files ?? [])]; if (files.length) void registerUploads(files.map((file) => ({ file })), 'audio'); event.currentTarget.value = '' }} />
    </div>{previewAnchor && rootRef.current ? createPortal(<button type="button" className="acp-card-preview" style={{ top: previewAnchor.top, left: previewAnchor.left }} aria-label={tf('assetCatalog.previewAsset', { name: previewAnchor.row.name })} onPointerEnter={clearPreviewCloseTimer} onPointerLeave={schedulePreviewClose} onClick={() => { setPreviewingRow(previewAnchor.row); setPreviewAnchor(null) }}><img src={videoPreviewIcon} alt="" /></button>, rootRef.current) : null}{previewingRow?.asset?.kind === 'audio' && previewingRow.asset.url ? <AudioCatalogPreview open src={previewingRow.asset.url} label={previewingRow.name} onClose={() => setPreviewingRow(null)} /> : previewingRow?.asset ? <VideoFullscreenDialog open src={previewingRow.asset.url} label={previewingRow.name} onClose={() => setPreviewingRow(null)}>{previewingRow.asset.kind === 'image' ? <img className="vfd-image" src={previewingRow.asset.url} alt={previewingRow.name} /> : undefined}</VideoFullscreenDialog> : null}</div>
}
