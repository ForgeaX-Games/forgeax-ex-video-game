import assetsFixture from './fixtures/nodia.assets.json'

export interface NodiaBundledVideoAsset {
  id: string
  kind: 'video'
  productionType: 'bundled_video'
  status: 'ready'
  file: {
    provider: 'extension'
    key: string
    mime: 'video/mp4'
  }
}

export interface NodiaAssetsManifest {
  version: 2
  assets: NodiaBundledVideoAsset[]
}

/** Extension-owned, build-generated source data. Callers must clone before use. */
export const NODIA_ASSETS_MANIFEST = assetsFixture as NodiaAssetsManifest
