import { injectStyleOnce } from '@/editor/styles/injectStyle'
import { tf, useT } from '../../i18n'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { useEffect, useMemo, useState } from 'react'
import { fetchRegistryAssets } from '../assets/registry-assets'
import { createKinoVideoClient } from '../assets/kino-api'
import type { MediaAsset } from '@/authoring/assets/registry-types'
import { resolveAssetSrc } from './media'
import { useGraphView } from '../persist/graphViewStore'
import { requestImageGenerationTarget } from '../assets/generation/imageGenerationNavigation'
import { useAssetCatalog } from '@/editor/assets/asset-catalog'

const kinoVideoClient = createKinoVideoClient()

const CSS = `
.gcv-root { display:flex; min-width:0; min-height:0; flex:1; flex-direction:column; overflow:hidden; color:#fff; background:#1a1a1a; }
.gcv-header { display:flex; min-height:54px; align-items:center; padding:0 24px; border-bottom:1px solid rgba(255,255,255,.1); background:#333; }
.gcv-header h1 { margin:0; font-size:18px; font-weight:500; }
.gcv-count { margin-left:10px; color:rgba(255,255,255,.4); font-size:12px; }
.gcv-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); align-content:start; gap:16px; overflow:auto; padding:24px; }
.gcv-card { position:relative; min-width:0; overflow:hidden; border:1px solid rgba(255,255,255,.1); border-radius:8px; background:#2c2c2c; }
.gcv-card:has(.gcv-open:hover),.gcv-card:has(.gcv-open:focus-visible) { border-color:rgba(232,134,74,.72); box-shadow:0 0 0 1px rgba(232,134,74,.24); }
.gcv-open { position:absolute; inset:0; z-index:2; border:0; border-radius:inherit; background:transparent; cursor:pointer; }
.gcv-open:focus-visible { outline:2px solid #e8864a; outline-offset:-2px; }
.gcv-preview { display:grid; height:150px; place-items:center; overflow:hidden; color:#ff9c2a; background:#222; font-size:42px; }
.gcv-preview span { display:grid; width:64px; height:64px; place-items:center; border-radius:50%; background:rgba(255,156,42,.12); }
.gcv-preview img { width:100%; height:100%; object-fit:cover; }
.gcv-body { display:flex; flex-direction:column; gap:9px; padding:14px; }
.gcv-title { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.gcv-title h2 { min-width:0; margin:0; overflow:hidden; font-size:15px; font-weight:500; text-overflow:ellipsis; white-space:nowrap; }
.gcv-linked { flex:none; border-radius:4px; padding:2px 6px; color:#9bd0a8; background:rgba(84,168,104,.14); font-size:11px; }
.gcv-body p { display:-webkit-box; min-height:36px; margin:0; overflow:hidden; color:rgba(255,255,255,.6); font-size:12px; line-height:18px; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
.gcv-prompt { min-height:52px; border-radius:6px; padding:8px; color:rgba(255,255,255,.45); background:rgba(255,255,255,.05); font-size:11px; line-height:17px; }
.gcv-empty { display:grid; flex:1; place-items:center; color:rgba(255,255,255,.4); font-size:13px; }
`

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Resolve a character_ref preview URL the same way the asset library does. */
export function resolveCharacterPreviewUrl(
  asset: MediaAsset,
  gameId: string,
  kinoUrlByResourceId: ReadonlyMap<string, string>,
): string | undefined {
  const direct = asset.status === 'ready' ? resolveAssetSrc(asset, gameId) : undefined
  if (direct) return direct
  const hostLocator = nonEmptyString(
    asset.meta?.hostMedia && typeof asset.meta.hostMedia === 'object' && !Array.isArray(asset.meta.hostMedia)
      ? (asset.meta.hostMedia as { locator?: unknown }).locator
      : undefined,
  )
  if (hostLocator && /^(https?:|blob:|data:)/.test(hostLocator)) return hostLocator
  const kinoResourceId = nonEmptyString(asset.meta?.kinoResourceId)
    ?? (asset.provider?.kind === 'kino' ? nonEmptyString(asset.provider.upstreamResourceId ?? asset.provider.ref) : undefined)
  if (kinoResourceId) return kinoUrlByResourceId.get(kinoResourceId)
  return undefined
}

export function GraphCharacterView(): JSX.Element {
  injectStyleOnce('graph-character-view', CSS)
  const t = useT()
  // 选择器必须返回稳定引用：`?? {}` 会每次 getSnapshot 造新对象，触发 useSyncExternalStore 死循环。
  const gameId = useGraphScenario((state) => state.game)
  const { catalog } = useAssetCatalog(gameId)
  const setView = useGraphView((state) => state.setView)
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const items = useMemo(
    () => Object.values(catalog.entities.character).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
    [catalog.entities.character],
  )
  const previewAssetKey = useMemo(
    () => items.map((character) => character.current?.assetId ?? '').join('\0'),
    [items],
  )
  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      fetchRegistryAssets(gameId, 'image', { signal: controller.signal }),
      kinoVideoClient.list({
        game_id: gameId,
        media_type: 'image',
        page: 1,
        page_size: 100,
      }, { signal: controller.signal }).catch(() => ({ items: [] as Array<{ resource_id: string; url?: string }> })),
    ]).then(([assets, kinoImages]) => {
      if (controller.signal.aborted) return
      const kinoUrlByResourceId = new Map(
        kinoImages.items.flatMap((resource) => (
          resource.url ? [[resource.resource_id, resource.url] as const] : []
        )),
      )
      setPreviewUrls(Object.fromEntries(assets.flatMap((asset) => {
        const src = resolveCharacterPreviewUrl(asset, gameId, kinoUrlByResourceId)
        return src ? [[asset.id, src]] : []
      })))
    }).catch(() => {
      if (!controller.signal.aborted) setPreviewUrls({})
    })
    return () => controller.abort()
  }, [gameId, previewAssetKey])
  return (
    <section className="gcv-root" aria-label={t('characters.ariaLabel')}>
      <header className="gcv-header">
        <h1>{t('characters.title')}</h1><span className="gcv-count">{items.length}</span>
      </header>
      {items.length === 0 ? <div className="gcv-empty">{t('characters.empty')}</div> : (
        <div className="gcv-grid">
          {items.map((character) => {
            const previewAssetId = character.current?.assetId
            const previewUrl = previewAssetId
              ? catalog.assets[previewAssetId]?.url ?? previewUrls[previewAssetId]
              : undefined
            return (
              <article className="gcv-card" key={character.id} data-character-id={character.id}>
                <button
                  type="button"
                  className="gcv-open"
                  aria-label={tf('characters.openGeneration', { name: character.name })}
                  onClick={() => {
                    requestImageGenerationTarget({
                      gameId,
                      characterId: character.id,
                      ...(previewAssetId ? { assetId: previewAssetId } : {}),
                      returnView: 'characters',
                    })
                    setView('image-generate')
                  }}
                />
                <div className="gcv-preview" data-preview-asset-id={previewAssetId ?? ''}>
                  {previewUrl
                    ? <img src={previewUrl} alt={tf('characters.previewAlt', { name: character.name })} />
                    : <span aria-hidden>{character.name.slice(0, 1)}</span>}
                </div>
                <div className="gcv-body">
                  <div className="gcv-title">
                    <h2>{character.name}</h2>
                    {character.entityId ? <span className="gcv-linked">{t('characters.entityLinked')}</span> : null}
                  </div>
                  <p>{character.summary || character.description}</p>
                  <div className="gcv-prompt" title={character.prompt}>
                    {character.prompt}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
