/**
 * 场景视图 —— 与 `GraphCharacterView` 平行的一等目录页。
 *
 * 场景和角色是对称的：都是「总脉络声明 → 本线补全 → 出参考图」。角色有专属工作台页，
 * 场景此前只能从通用资产文件夹树里翻到 `scene_ref` 素材，两条线在 UI 上不对称。
 * 场景设定的写入归场景线（见 scenes/scene-authoring.ts），这里不编辑文本；
 * 但和角色卡片一样提供「重出这张图」入口——出图被上游审核拒过的场景最需要人手动修。
 */
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import { tf, useT } from '../../i18n'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { useEffect, useState } from 'react'
import { fetchRegistryAssets } from '../assets/registry-assets'
import { resolveAssetSrc } from './media'
import { createKinoAssetLibraryClient, useAssetLibrary } from '../assets/assetLibraryClient'
import { requestImageGenerationTarget } from '../assets/generation/imageGenerationNavigation'
import { useGraphView } from '../persist/graphViewStore'
import { useAssetCatalog } from '@/editor/assets/asset-catalog'

const kinoAssetLibraryClient = createKinoAssetLibraryClient()

const CSS = `
.gsv-root { display:flex; min-width:0; min-height:0; flex:1; flex-direction:column; overflow:hidden; color:#fff; background:#1a1a1a; }
.gsv-header { display:flex; min-height:54px; align-items:center; padding:0 24px; border-bottom:1px solid rgba(255,255,255,.1); background:#333; }
.gsv-header h1 { margin:0; font-size:18px; font-weight:500; }
.gsv-count { margin-left:10px; color:rgba(255,255,255,.4); font-size:12px; }
.gsv-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); align-content:start; gap:16px; overflow:auto; padding:24px; }
.gsv-card { position:relative; min-width:0; overflow:hidden; border:1px solid rgba(255,255,255,.1); border-radius:8px; background:#2c2c2c; }
.gsv-preview { display:grid; height:150px; place-items:center; overflow:hidden; color:#ff9c2a; background:#222; font-size:42px; }
.gsv-preview span { border-radius:6px; padding:6px 10px; color:rgba(255,255,255,.45); background:rgba(255,255,255,.05); font-size:12px; }
.gsv-preview img { width:100%; height:100%; object-fit:cover; }
.gsv-body { display:flex; flex-direction:column; gap:9px; padding:14px; }
.gsv-title { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.gsv-title h2 { min-width:0; margin:0; overflow:hidden; font-size:15px; font-weight:500; text-overflow:ellipsis; white-space:nowrap; }
.gsv-body p { display:-webkit-box; min-height:36px; margin:0; overflow:hidden; color:rgba(255,255,255,.6); font-size:12px; line-height:18px; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
.gsv-prompt { min-height:52px; border-radius:6px; padding:8px; color:rgba(255,255,255,.45); background:rgba(255,255,255,.05); font-size:11px; line-height:17px; }
.gsv-empty { display:grid; flex:1; place-items:center; color:rgba(255,255,255,.4); font-size:13px; }
.gsv-open { position:absolute; z-index:1; inset:0; border:0; background:transparent; cursor:pointer; }
.gsv-open:hover { background:rgba(255,156,42,.08); }
`

export function GraphSceneView(): JSX.Element {
  injectStyleOnce('graph-scene-view', CSS)
  const t = useT()
  // 选择器必须返回稳定引用：`?? {}` 会每次 getSnapshot 造新对象，触发 useSyncExternalStore 死循环。
  const gameId = useGraphScenario((state) => state.game)
  const { catalog } = useAssetCatalog(gameId)
  const setView = useGraphView((state) => state.setView)
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const providerAssets = useAssetLibrary(gameId, kinoAssetLibraryClient)
  const providerPreviewUrls = Object.fromEntries(providerAssets.items.flatMap(
    (asset) => asset.kind === 'image' && asset.url ? [[asset.id, asset.url]] : [],
  ))
  const resolvedPreviewUrls = { ...providerPreviewUrls, ...previewUrls }
  useEffect(() => {
    const controller = new AbortController()
    void fetchRegistryAssets(gameId, 'image', { signal: controller.signal })
      .then((assets) => setPreviewUrls(Object.fromEntries(
        assets.flatMap((asset) => {
          const src = asset.status === 'ready' ? resolveAssetSrc(asset, gameId) : undefined
          return src ? [[asset.id, src]] : []
        }),
      )))
      .catch(() => undefined)
    return () => controller.abort()
  }, [gameId])
  const items = Object.values(catalog.entities.scene).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  return (
    <section className="gsv-root" aria-label={t('scenes.ariaLabel')}>
      <header className="gsv-header">
        <h1>{t('scenes.title')}</h1><span className="gsv-count">{items.length}</span>
      </header>
      {items.length === 0 ? <div className="gsv-empty">{t('scenes.empty')}</div> : (
        <div className="gsv-grid">
          {items.map((scene) => {
            const previewAssetId = scene.current?.assetId
            const previewSrc = previewAssetId
              ? catalog.assets[previewAssetId]?.url ?? resolvedPreviewUrls[previewAssetId]
              : undefined
            return (
              <article className="gsv-card" key={scene.id} data-scene-id={scene.id}>
                <button
                  type="button"
                  className="gsv-open"
                  aria-label={tf('scenes.openGeneration', { name: scene.name })}
                  onClick={() => {
                    // 场景与角色对称：走 catalog 的 scene 业务实体通道（entityId + targetRoot=scene），
                    // 生成后由服务端原子更新 manifest 场景实体的 current/history。
                    requestImageGenerationTarget({
                      gameId,
                      entityId: scene.id,
                      targetRoot: 'scene',
                      ...(previewAssetId ? { assetId: previewAssetId } : {}),
                      returnView: 'assets',
                    })
                    setView('image-generate')
                  }}
                />
                <div className="gsv-preview" data-preview-asset-id={previewAssetId ?? ''}>
                  {previewSrc
                    ? <img src={previewSrc} alt={tf('scenes.previewAlt', { name: scene.name })} />
                    // 绑定了素材却取不到图（还没生成完 / 素材已失效）与从未出图是两件事，分别说清楚。
                    : <span>{t(previewAssetId ? 'scenes.previewMissing' : 'scenes.previewPending')}</span>}
                </div>
                <div className="gsv-body">
                  <div className="gsv-title">
                    <h2>{scene.name}</h2>
                  </div>
                  <p>{scene.summary || scene.description}</p>
                  <div className="gsv-prompt" title={scene.prompt}>
                    {scene.prompt}
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
