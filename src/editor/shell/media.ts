/**
 * Resolves a node media reference to a playable URL.
 *  - Existing http/blob/data/absolute URLs pass through unchanged.
 *  - Bundled zhandou basenames resolve first, including legacy `m-` refs.
 *  - Hydrated Kino video resources resolve to the native CDN URL from their DTO.
 *  - Audio registry ids retain their product playback path until audio resources gain
 *    the same URL cache. Unknown video ids stay unresolved instead of fabricating a
 *    `/resources/:id/content` route that Kino does not provide.
 * Uploaded images use the shared resource API; image and generation registry operations
 * continue to use host-bound extension routes.
 */
import { zhandouUrl } from '../assets/catalog'
import {
  createKinoVideoClient,
  KinoClientError,
  MAX_KINO_RESOURCE_PAGE_SIZE,
  type KinoVideoClient,
} from '../assets/kino-api'
import { fetchRegistryAssets } from '../assets/registry-assets'
import { useKinoVideoCache } from '../assets/kinoVideoCacheStore'
import type { MediaAsset, MediaKind, StyleAxes } from '@/authoring/assets/registry-types'
import { resolveCatalogEntityAsset, type AssetCatalog } from '@/editor/assets/asset-catalog'
import { ExtensionResponseError, getExtensionHost, readExtensionJson } from '../../lib/extension-host'
import { pluginFetch, pluginUrl } from '../../lib/plugin-http'

let defaultKinoClient: KinoVideoClient | undefined

function kinoClient(): KinoVideoClient {
  defaultKinoClient ??= createKinoVideoClient()
  return defaultKinoClient
}

/** Stable Kino playback URL for a video resource id. */
export function kinoVideoContentUrl(resourceId: string, game?: string): string {
  void game
  return kinoClient().playbackUrl(resourceId, game ?? '')
}

/**
 * 共享素材层自产资产 id 的形状（`makeAssetId` = `a-<tag>-<t>-<r>`）。按**形状**而非 kind 分流：
 * 解析器手里只有一个 id（引擎不传 kind），而 registry 里的 video / image / audio 播放地址同构
 * （extension media route）——所以别按 kind 过滤，否则床轨 id 会掉进只认视频的 Kino 端点。
 */
const AUDIO_REGISTRY_ASSET_ID = /^a-aud-/

export function resolveMediaSrc(ref: string | undefined, game?: string): string | undefined {
  if (!ref) return undefined
  if (/^(https?:|blob:|data:)/.test(ref)) return ref
  if (ref.startsWith('/')) return pluginUrl(ref)
  // Bundled demo references use the zhandou basename; legacy data may add `m-`.
  const bare = ref.startsWith('m-') ? ref.slice(2) : ref
  const local = zhandouUrl(bare)
  if (local) return local
  if (!game) return undefined
  const kinoResource = useKinoVideoCache.getState().byGame[game]?.items.find(
    (item) => item.resource_id === ref,
  )
  if (kinoResource?.url) return kinoResource.url
  if (AUDIO_REGISTRY_ASSET_ID.test(ref)) return registryMediaUrl(ref, game)
  return undefined
}

/**
 * Resolve a blueprint media ref through the manifest-backed catalog first.
 * Blueprint refs are manifest asset ids; Kino resource ids are provider details and
 * must never replace those stable ids in graph data.
 */
export function resolveCatalogMediaSrc(
  ref: string | undefined,
  catalog: Pick<AssetCatalog, 'assets' | 'entities'>,
  game?: string,
): string | undefined {
  if (!ref) return undefined
  const entityAsset = resolveCatalogEntityAsset(catalog as AssetCatalog, 'audio', ref)
  const directAsset = catalog.assets[ref]
  const asset = entityAsset ?? (directAsset?.kind === 'audio' ? undefined : directAsset)
  if (asset?.url && /^(https?:|blob:|data:)/.test(asset.url)) return asset.url
  if (asset?.url?.startsWith('/')) return pluginUrl(asset.url)
  return resolveMediaSrc(ref, game)
}

/**
 * 优先序解析（D8 目标态，手里已有 MediaAsset 时用）：
 *   1. `asset.url`（manifest 稳定可播地址）—— 上传能力就绪后成片走这里；
 *   2. （D9 兜底，暂留）扩展媒体流 / zhandou basename。
 * graph/blueprint 只挂 id；URL 只住 manifest —— 引擎只抛 id，壳层在此 resolve。
 */
export function resolveAssetSrc(asset: Pick<MediaAsset, 'id' | 'url'>, game?: string): string | undefined {
  if (asset.url && /^(https?:|blob:|data:)/.test(asset.url)) return asset.url
  if (asset.url?.startsWith('/')) return pluginUrl(asset.url)
  return resolveMediaSrc(asset.id, game)
}

/** 共享素材层某资产的宿主绑定播放路径。 */
export function registryMediaUrl(id: string, game?: string): string {
  return kinoVideoContentUrl(id, game)
}

/**
 * Lists Kino video resource ids for the node video picker.
 * API failures are surfaced to callers instead of appearing as an empty list.
 */
export async function listVideoAssets(game?: string): Promise<string[]> {
  return (await listVideoAssetInfos(game)).map((a) => a.id)
}

export interface VideoAssetInfo {
  id: string
  bytes?: number
  mimeType?: string
  label?: string
  status?: MediaAsset['status']
  productionType?: MediaAsset['productionType']
  sceneNodeId?: string
}

export interface ListVideoAssetInfosOptions {
  signal?: AbortSignal
  maxPages?: number
}

/** Kino service contract: `/resources` accepts at most 100 items per page. */
/** Lists all Kino video resources with picker metadata. */
export async function listVideoAssetInfos(
  game?: string,
  options: ListVideoAssetInfosOptions = {},
): Promise<VideoAssetInfo[]> {
  if (!game) {
    return []
  }
  const client = kinoClient()
  const pageSize = MAX_KINO_RESOURCE_PAGE_SIZE
  const maxPages = Math.max(1, options.maxPages ?? 100)
  const resources = new Map<string, VideoAssetInfo>()

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const page = await client.list({
      game_id: game,
      media_type: 'video',
      page: pageNumber,
      page_size: pageSize,
    }, { signal: options.signal })

    for (const item of page.items) {
      resources.set(item.resource_id, {
        id: item.resource_id,
        bytes: undefined,
        mimeType: item.source_meta?.mime_type,
        label: item.name,
        status: 'ready',
        productionType: undefined,
        sceneNodeId: undefined,
      })
    }

    if (page.items.length === 0 || resources.size >= page.total) {
      break
    }
  }

  return [...resources.values()]
}

/** Fetch one Kino video resource; surfaces API errors to callers. */
export async function getKinoVideoResource(game: string, resourceId: string) {
  void game
  try {
    return await kinoClient().get(resourceId, game)
  } catch (error) {
    if (error instanceof KinoClientError) {
      throw error
    }
    throw new KinoClientError(
      error instanceof Error ? error.message : 'Failed to load video resource',
      502,
      'upstream_unavailable',
    )
  }
}

/** Lists the shared registry assets for graph views and placeholder cards. */
export async function listRegistryAssets(
  game?: string,
  kind?: MediaKind,
  options: { signal?: AbortSignal } = {},
): Promise<MediaAsset[]> {
  return fetchRegistryAssets(game, kind, options)
}

/** 取单条 registry 资产（轮询生成状态用）。 */
export async function getRegistryAsset(game: string, id: string): Promise<MediaAsset | null> {
  void game
  try {
    const r = await pluginFetch(`assets/${encodeURIComponent(id)}`)
    const j = await readExtensionJson(r) as { asset?: MediaAsset | null }
    return j.asset ?? null
  } catch (error) {
    if (error instanceof ExtensionResponseError && error.status === 404) return null
    throw error
  }
}

export interface GenerateVideoRequest {
  sceneNodeId: string
  nodeName: string
  seedancePrompt?: string
  storyText?: string
  durationSeconds?: number
  artStyle?: string
  styleKeywords?: string[]
  characterRefIds: string[]
  sceneRefIds: string[]
  continuityFirstFrameId?: string
  label?: string
  generateAudio?: boolean
  /** 节点级风格三轴覆盖（P3）；不传用游戏级 manifest.styleAxes。 */
  styleAxes?: StyleAxes
  /** 显式续接段（P5）：前置 V-PROMPT-15 延长块。 */
  extend?: boolean
  transitionHint?: string
}

/** 读游戏级风格三轴（manifest.styleAxes）。离线/无端点返回 null。 */
export async function getGameStyleAxes(game: string): Promise<StyleAxes | null> {
  void game
  const r = await pluginFetch('style-axes')
  const j = await readExtensionJson(r) as { styleAxes?: StyleAxes | null }
  return j.styleAxes ?? null
}

/** 浅合并写游戏级风格三轴，返回合并后结果。 */
export async function setGameStyleAxes(game: string, axes: StyleAxes): Promise<StyleAxes | null> {
  void game
  const r = await pluginFetch('style-axes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(axes),
  })
  const j = await readExtensionJson(r) as { styleAxes?: StyleAxes | null }
  return j.styleAxes ?? null
}

/**
 * 触发一节点的真实视频生成（服务端 headless 编排，落共享素材层 video_clip）。
 * 立刻返回：成功给 asset（status 从 generating 起，需再轮询到 ready）；失败给 error。
 */
export async function requestGenerateVideo(
  game: string,
  input: GenerateVideoRequest,
): Promise<{ asset?: MediaAsset; error?: string }> {
  void game
  return toolResult('game-video:generate-video', input)
}

export interface GenerateKeyframeRequest {
  sceneNodeId: string
  nodeName: string
  beat: string
  seedancePrompt?: string
  variant?: 'video_first_frame' | 'choice_pressure_frame'
  artStyle?: string
  styleKeywords?: string[]
  perspective?: 'first' | 'third'
  povCharacterName?: string
  location?: string
  refAssetIds?: string[]
  label?: string
  /** 节点级风格三轴覆盖（P3）。 */
  styleAxes?: StyleAxes
  /** P4：'keyframe'（默认单帧）| 'grid_storyboard'（6 面板黑白 previs 故事板）。 */
  mode?: 'keyframe' | 'grid_storyboard'
  /** P4：grid 模式额外入参（nodeRole/endingKind/choiceRevealMoment/panelLabels…）。 */
  grid?: Record<string, unknown>
}

/** 触发一节点的分镜图/关键帧生成（落 shot_image）。 */
export async function requestGenerateKeyframe(
  game: string,
  input: GenerateKeyframeRequest,
): Promise<{ asset?: MediaAsset; error?: string }> {
  void game
  return toolResult('game-video:generate-keyframe', input)
}

/** 跨模块只读拿料：把 character 立绘登记成 character_ref。返回登记的 ref 列表。 */
export async function importCharacterRefs(game: string): Promise<{ refs: MediaAsset[]; error?: string }> {
  void game
  return toolRefs('game-video:import-character-refs')
}

/** 跨模块只读拿料：把场景模块贴图登记成 scene_ref。 */
export async function importSceneRefs(game: string): Promise<{ refs: MediaAsset[]; error?: string }> {
  void game
  return toolRefs('game-video:import-scene-refs')
}

async function toolRefs(toolId: string): Promise<{ refs: MediaAsset[]; error?: string }> {
  try {
    const j = await getExtensionHost().tool.call(toolId, {}) as { refs?: MediaAsset[]; error?: string }
    return { refs: Array.isArray(j.refs) ? j.refs : [], error: j.error }
  } catch (e) {
    return { refs: [], error: (e as Error).message }
  }
}

async function toolResult(
  toolId: string,
  body: unknown,
): Promise<{ asset?: MediaAsset; error?: string }> {
  try {
    const j = await getExtensionHost().tool.call(toolId, body) as { asset?: MediaAsset; error?: string }
    return j
  } catch (e) {
    return { error: (e as Error).message }
  }
}
