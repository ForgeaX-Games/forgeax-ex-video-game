/**
 * AssetCatalogSection —— 新版资产库侧栏（读 `assets/manifest.json` 的 `assetCatalog` 段）。
 *
 * 直接消费扁平的 `AssetCatalog`（folders / placements / entities + manifest.assets 索引）递归出行，
 * 不再转成主导航的 `NavNode`：目录树形态由查询函数即时派生。
 * 行的视觉复用 `SidebarTreeRow`（与旧资产库共享 class）。
 *
 * 侧栏只导航目录：各 Tab 下只出文件夹行，条目（图片 / 视频等资源）只在右侧资产面板展示。
 *
 * 选中态用显式判别联合 `CatalogSelection`（侧栏不产出 item 选中）：
 * - catalog-root → target = `root:catalog`（整个资产库总根）
 * - tab-root     → target = `root:<tabKind>`
 * - folder       → 用户文件夹（parentId === null 表示挂在对应 Tab 根下）
 */

import { useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { t as translateUi, tf as formatUi } from '../../i18n'
import {
  CATALOG_ROOT_TARGET,
  VISIBLE_CATALOG_TAB_KINDS,
  catalogFolderChildren,
  catalogRootTarget,
  describeCatalogFolder,
  describeCatalogRoot,
  describeCatalogTabRoot,
  useAssetCatalog,
  type AssetCatalog,
  type CatalogPlacementTarget,
  type CatalogSelection,
  type CatalogTabKind,
} from '@/editor/assets/asset-catalog'
import { assetCatalogClient } from '@/editor/assets/asset-catalog-client'
import { canAcceptCatalogItemDrag, canDropCatalogItem, catalogDragPoint, readCatalogItemDrag } from '@/editor/assets/asset-catalog-drag'
import { SidebarTreeRow } from './SidebarTreeRow'
import { useGraphView } from '../persist/graphViewStore'
import { useCatalogNav, type CatalogNavLocation } from '../persist/catalogNavStore'
import { useProductionProjection } from '../persist/productionProjectionStore'
import type { ProductionProjection } from '../../workflow/contracts'

const TAB_LABEL_KEYS: Record<CatalogTabKind, string> = {
  character: 'assetCatalog.root.character',
  scene: 'assetCatalog.root.scene',
  video: 'assetCatalog.root.video',
  image: 'assetCatalog.root.image',
  icon: 'assetCatalog.root.icon',
  control: 'assetCatalog.root.control',
  audio: 'assetCatalog.root.audio',
  font: 'assetCatalog.root.font',
}

/** 生产流把资产库视为整体：一级入口解锁时一次展示全部二级分类。 */
export function visibleCatalogTabKinds(
  projection: ProductionProjection | null,
  _catalog: AssetCatalog,
): readonly CatalogTabKind[] {
  if (!projection) return VISIBLE_CATALOG_TAB_KINDS
  const assetsAvailability = projection.modules.assets?.availability
  return assetsAvailability !== undefined && assetsAvailability !== 'hidden'
    ? VISIBLE_CATALOG_TAB_KINDS
    : []
}

export function AssetCatalogSection({ gameId }: { gameId: string }): JSX.Element {
  const { catalog } = useAssetCatalog(gameId)
  const projection = useProductionProjection((state) => state.projection)
  const visibleTabKinds = visibleCatalogTabKinds(projection, catalog)
  const setView = useGraphView((state) => state.setView)
  const location = useCatalogNav((state) => state.location)
  const setLocation = useCatalogNav((state) => state.setLocation)
  // 默认收起：与旧资产库同级并列，展开后才铺开各 Tab，避免和旧库同名行相互干扰。
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [dropTarget, setDropTarget] = useState<{ rowId: string; label: string; x: number; y: number } | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)

  const moveOperationId = (): string => typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `catalog-drag-${Date.now()}`

  const dropHandlers = (
    rowId: string,
    label: string,
    tabKind: CatalogTabKind,
    target: CatalogPlacementTarget,
  ) => ({
    dropActive: dropTarget?.rowId === rowId,
    onDragEnter: (event: DragEvent<HTMLDivElement>) => {
      if (!canAcceptCatalogItemDrag(event.dataTransfer, tabKind)) return
      event.preventDefault()
      setDropTarget({ rowId, label, ...catalogDragPoint(event) })
    },
    onDragLeave: (event: DragEvent<HTMLDivElement>) => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
      setDropTarget((current) => current?.rowId === rowId ? null : current)
    },
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      if (!canAcceptCatalogItemDrag(event.dataTransfer, tabKind)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDropTarget({ rowId, label, ...catalogDragPoint(event) })
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      const payload = readCatalogItemDrag(event.dataTransfer)
      if (!canDropCatalogItem(payload, tabKind, target)) return
      event.preventDefault()
      setDropTarget(null)
      setMoveError(null)
      void assetCatalogClient.moveAsset({
        operationId: moveOperationId(),
        placementKey: payload.placementKey,
        folderId: target,
        sortKey: payload.name,
      }).then(() => {
        if (target !== catalogRootTarget(tabKind)) return
        setLocation({ kind: 'tab-root', tabKind, target: catalogRootTarget(tabKind) as `root:${CatalogTabKind}` })
      }).catch((cause: unknown) => {
        setMoveError(cause instanceof Error ? cause.message : translateUi('assetCatalog.operationFailed'))
      })
    },
  })

  const toggle = (id: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const select = (_rowId: string, selection: Exclude<CatalogSelection, { kind: 'item' }>): void => {
    const next: CatalogNavLocation = selection.kind === 'catalog-root'
      ? { kind: 'catalog-root', target: CATALOG_ROOT_TARGET }
      : selection.kind === 'tab-root'
        ? { kind: 'tab-root', tabKind: selection.tabKind, target: selection.target as `root:${CatalogTabKind}` }
        : { kind: 'folder', tabKind: selection.tabKind, folderId: selection.folderId, target: selection.target }
    setLocation(next)
    setView('assets')
  }

  // 面板里选中某个资源时，侧栏高亮落回它所在的目录行。
  const isActive = (rowId: string): boolean => {
    if (rowId === CATALOG_ROOT_TARGET) return location.kind === 'catalog-root'
    if (rowId.startsWith('catalog-folder:')) {
      const folderId = rowId.slice('catalog-folder:'.length)
      return (location.kind === 'folder' && location.folderId === folderId)
        || (location.kind === 'item' && location.target === folderId)
    }
    return (location.kind === 'tab-root' || location.kind === 'item') && location.target === rowId
  }

  // 树里只剩目录 → 能展开的唯一理由是还有子目录。
  const hasSubfolders = (tabKind: CatalogTabKind, target: CatalogPlacementTarget): boolean =>
    catalogFolderChildren(catalog, target, tabKind).length > 0

  const renderFolders = (
    tabKind: CatalogTabKind,
    target: CatalogPlacementTarget,
    depth: number,
  ): JSX.Element[] => catalogFolderChildren(catalog, target, tabKind).flatMap((folder) => {
    const rowId = `catalog-folder:${folder.id}`
    return [
      <SidebarTreeRow
        key={rowId}
        depth={depth}
        label={folder.name}
        active={isActive(rowId)}
        expandable={hasSubfolders(tabKind, folder.id)}
        expanded={expanded.has(rowId)}
        {...dropHandlers(rowId, folder.name, tabKind, folder.id)}
        onActivate={() => {
          toggle(rowId)
          const selection = describeCatalogFolder(catalog, tabKind, folder.id)
          if (selection) select(rowId, selection)
        }}
        onToggle={() => toggle(rowId)}
      />,
      ...(expanded.has(rowId) ? renderFolders(tabKind, folder.id, depth + 1) : []),
    ]
  })

  const sectionExpanded = expanded.has(CATALOG_ROOT_TARGET)

  return (
    <>
      <SidebarTreeRow
        depth={0}
        label={translateUi('assetCatalog.title')}
        active={isActive(CATALOG_ROOT_TARGET)}
        expandable
        expanded={sectionExpanded}
        leading="asset-library"
        onActivate={() => {
          toggle(CATALOG_ROOT_TARGET)
          select(CATALOG_ROOT_TARGET, describeCatalogRoot(catalog))
        }}
        onToggle={() => toggle(CATALOG_ROOT_TARGET)}
      />
      {sectionExpanded
        ? visibleTabKinds.flatMap((tabKind) => {
          const target = catalogRootTarget(tabKind)
          const label = translateUi(TAB_LABEL_KEYS[tabKind])
          return [
            <SidebarTreeRow
              key={target}
              depth={1}
              label={label}
              active={isActive(target)}
              expandable={hasSubfolders(tabKind, target)}
              expanded={expanded.has(target)}
              {...dropHandlers(target, label, tabKind, target)}
              onActivate={() => {
                toggle(target)
                select(target, describeCatalogTabRoot(catalog, tabKind, label))
              }}
              onToggle={() => toggle(target)}
            />,
            ...(expanded.has(target) ? renderFolders(tabKind, target, 2) : []),
          ]
        })
        : null}
      {moveError ? <p className="ns-catalog-drag-error" role="alert">{moveError}</p> : null}
      {dropTarget && typeof document !== 'undefined'
        ? createPortal(
          <span className="ns-catalog-drag-hint" style={{ left: dropTarget.x + 12, top: dropTarget.y + 12 }}>
            {formatUi('assetCatalog.moveTo', { name: dropTarget.label })}
          </span>,
          document.body,
        )
        : null}
    </>
  )
}
