import { injectStyleOnce } from '@/editor/styles/injectStyle'
import { AssetCatalogPanel, ASSET_CATALOG_PANEL_CSS } from '../assets/AssetCatalogPanel'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { CATALOG_CSS } from './catalogCss'

const ASSET_CARD_DIALOG_LAYOUT_CSS = `
.gc-rule-delete-dialog > p { display:block; padding-top:16px; }
.acp-card-dialog.gc-rule-rename-dialog {
  width:min(450px,100%);
  height:300px;
  min-height:300px;
  padding:40px;
}
.acp-card-dialog.gc-rule-rename-dialog .gc-rule-dialog-input { padding:0 48px 0 16px; }
`

/** Catalog is the only assets workspace. It never reads the legacy asset-library contract. */
export function GraphAssetView(): JSX.Element {
  injectStyleOnce('graph-asset-catalog', ASSET_CATALOG_PANEL_CSS)
  injectStyleOnce('graph-asset-rule-dialog', CATALOG_CSS)
  injectStyleOnce('graph-asset-card-dialog-layout', ASSET_CARD_DIALOG_LAYOUT_CSS)
  const gameId = useGraphScenario((state) => state.game)
  return <AssetCatalogPanel gameId={gameId} />
}
