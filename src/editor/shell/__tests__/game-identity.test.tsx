import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraphScenario } from '../../persist/graphScenarioStore'

const { assetCatalogProps, injectedStyles } = vi.hoisted(() => ({
  assetCatalogProps: [] as string[],
  injectedStyles: [] as unknown[][],
}))

vi.mock('../../assets/AssetCatalogPanel', () => ({
  ASSET_CATALOG_PANEL_CSS: '.acp-root { display: flex; }',
  AssetCatalogPanel: ({ gameId }: { gameId: string }) => {
    assetCatalogProps.push(gameId)
    return <div data-testid="asset-catalog" />
  },
}))
vi.mock('@/editor/styles/injectStyle', () => ({
  injectStyleOnce: (...args: unknown[]) => injectedStyles.push(args),
}))

import { GraphAssetView } from '../GraphAssetView'

describe('editor game identity', () => {
  beforeEach(() => {
    assetCatalogProps.length = 0
    injectedStyles.length = 0
    useGraphScenario.setState({ game: 'handshake-game' })
  })

  it('passes the handshake game from the shared store to the asset catalog', () => {
    render(<GraphAssetView />)
    expect(assetCatalogProps).toEqual(['handshake-game'])
  })

  it('mounts the catalog panel with its own stylesheet', () => {
    render(<GraphAssetView />)
    expect(injectedStyles).toContainEqual([
      'graph-asset-catalog',
      '.acp-root { display: flex; }',
    ])
  })
})
