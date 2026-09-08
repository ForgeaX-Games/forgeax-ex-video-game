import { injectStyleOnce } from '@/editor/styles/injectStyle'
import { AssetCatalogPanel, ASSET_CATALOG_PANEL_CSS } from '../assets/AssetCatalogPanel'
import { useGraphScenario } from '../persist/graphScenarioStore'

/** Catalog is the only assets workspace. It never reads the legacy asset-library contract. */
export function GraphAssetView(): JSX.Element {
  injectStyleOnce('graph-asset-catalog', ASSET_CATALOG_PANEL_CSS)
  const gameId = useGraphScenario((state) => state.game)
  return <AssetCatalogPanel gameId={gameId} />
}
