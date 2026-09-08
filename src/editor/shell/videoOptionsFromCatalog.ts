import type { AssetCatalog } from '@/editor/assets/asset-catalog'
import type { VideoOption } from './node-inspector/shared'

/**
 * 资产目录 → 节点卡片「演出」行的展示名候选。
 *
 * 画布只拿到 `node.data.media.ref`（一个 id），把它投影成人看的名字全靠这份候选表；表缺了
 * 就回落显示原始 id。编辑器和试玩浮层用的是同一个 GraphCanvas，这份投影必须同源，否则同一
 * 个节点在两处显示两种东西。
 */
export function videoOptionsFromCatalog(
  catalog: Pick<AssetCatalog, 'assets' | 'entities'>,
): VideoOption[] {
  const options = new Map<string, VideoOption>()
  const entities = Object.values(catalog.entities.video).sort((left, right) => compareText(left.id, right.id))

  for (const entity of entities) {
    // Blueprint performance selects an entity's applied version. Historical
    // versions remain available in the asset editor, but must not appear as
    // independent performances in this dropdown.
    const assetId = entity.current?.assetId
    if (!assetId || options.has(assetId)) continue
    const asset = catalog.assets[assetId]
    if (!asset || asset.kind !== 'video') continue
    const previewUnavailable = new Set(['placeholder', 'generating', 'failed']).has(asset.status ?? '')
    options.set(asset.id, {
      id: asset.id,
      label: entity.name.trim() || asset.name.trim() || asset.id,
      ...(asset.url && !previewUnavailable ? { previewUrl: asset.url } : {}),
    })
  }
  return [...options.values()]
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}
