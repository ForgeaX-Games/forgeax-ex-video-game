/**
 * asset-registry —— 游戏级共享素材层中 game-video 资产域的服务端 CRUD。
 *
 * 文件开头保留旧式 node:fs helper；Extension 路径从下方
 * `createHostAssetRegistry()` 开始，只使用宿主注入的 bounded files/media capability。
 * 旧式 helper 的磁盘布局（`.forgeax/games/<slug>/assets/`）：
 *   - `manifest.json`       = { version:2, assets: AssetRecord[] }
 *   - `media/<id>.<ext>`    = game-video 自产的图/视频二进制
 *
 * 被两处共享（SSOT）：
 *   - `src/server/tool-handlers.ts` 的 game-video:* 工具 + `src/server/generation/*` 编排（写）
 *
 * Extension intake 对人设图/场景图的源目录保持只读，并把字节副本交给 host media
 * capability 持久化；不会把宿主媒体 URL 当作权威身份。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream, statSync, renameSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import type {
  MediaAsset as HostMediaAsset,
  MediaBody,
  MediaReference,
  MediaWriteInput,
} from '@forgeax/extension-host/contracts'
import type {
  BoundedGameFiles,
  ExtensionContext,
} from '@forgeax/extension-host/node'
import type {
  AssetManifest,
  AssetProvenance,
  AssetRecipe,
  DocumentRecord,
  DocumentType,
  JsonValue,
  MediaAsset,
  MediaKind,
  MediaProductionType,
  StyleAxes,
} from '@/authoring/assets/registry-types'
import { parseDesignOptions } from '@/authoring/documents/core-design-options'
import {
  appendMutationReceipt,
  nextAssetManifestRevision,
  readAssetManifestRevision,
  readAssetManifestScopeRevisions,
  readMutationReceipts,
  stampAssetManifestRevision,
  type MutationReceipt,
  type ScopeRevisions,
} from './host/document-revision'

const GAME_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/

/** 从起点目录向上找含 `.forgeax/games` 的工程根（与 tool-handlers / vite 同一约定）。 */
export function findProjectRoot(start: string): string | null {
  let dir = start
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, '.forgeax', 'games'))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** 素材层根目录：`<root>/.forgeax/games/<slug>/assets`；缺工程根或非法 slug 则 null。 */
export function assetsDir(projectRoot: string | null, slug: string | null): string | null {
  if (!projectRoot || !slug || !GAME_SLUG_RE.test(slug)) return null
  return resolve(projectRoot, '.forgeax', 'games', slug, 'assets')
}

function manifestPath(dir: string): string {
  return resolve(dir, 'manifest.json')
}

function mediaDir(dir: string): string {
  return resolve(dir, 'media')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isDocumentType(value: unknown): value is DocumentType {
  return value === 'intake'
    || value === 'design-options'
    || value === 'core'
    || value === 'inquiry'
    || value === 'pillar'
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 16 || value === null) return value === null
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return true
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1))
  return isRecord(value) && Object.values(value).every((item) => isJsonValue(item, depth + 1))
}

function isAssetRecipe(value: unknown): value is AssetRecipe {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.parameters) || !isJsonValue(value.parameters)) {
    return false
  }
  return value.inputs === undefined || (
    Array.isArray(value.inputs)
    && value.inputs.every((input) => (
      isRecord(input)
      && typeof input.assetId === 'string'
      && input.assetId.length > 0
      && typeof input.role === 'string'
      && input.role.length > 0
    ))
  )
}

function isAssetProvenance(value: unknown): value is AssetProvenance {
  if (!isRecord(value) || !['upload', 'generation', 'import', 'derived'].includes(String(value.origin))) {
    return false
  }
  if (value.source !== undefined && (
    !isRecord(value.source)
    || (value.source.module !== undefined && typeof value.source.module !== 'string')
    || (value.source.assetId !== undefined && typeof value.source.assetId !== 'string')
  )) return false
  return value.recipe === undefined || isAssetRecipe(value.recipe)
}

/**
 * 文档只允许位于 docs/ 下，且不可通过 manifest 引用任意游戏文件。
 */
function isDocumentPath(value: unknown): value is string {
  return typeof value === 'string'
    && /^docs\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/i.test(value)
}

export function isDocumentRecord(value: unknown): value is DocumentRecord {
  if (!isRecord(value) || value.kind !== 'document') return false
  return (
    typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.name === 'string'
    && value.name.length > 0
    && value.status === 'ready'
    && value.mimeType === 'text/markdown'
    && isRecord(value.provider)
    && value.provider.kind === 'local'
    && isDocumentPath(value.provider.ref)
    && typeof value.createdAt === 'number'
    && typeof value.updatedAt === 'number'
    && isRecord(value.meta)
    && isDocumentType(value.meta.documentType)
    && (value.provenance === undefined || isAssetProvenance(value.provenance))
  )
}

function isMediaAsset(value: unknown): value is MediaAsset {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (value.kind === 'image' || value.kind === 'video' || value.kind === 'audio') &&
    // Shared provider-backed uploads predate the editor-only productionType
    // field. They are still valid media records and must remain visible in the
    // library rather than being silently dropped during normalization.
    (typeof value.productionType === 'string' || isProviderBacked(value))
  )
}

function isProviderBacked(value: unknown): boolean {
  return isRecord(value) && isRecord(value.provider)
}

function normalizeMediaAsset(value: unknown): MediaAsset | null {
  if (!isMediaAsset(value)) return null
  const source = value as MediaAsset & { name?: unknown; mimeType?: unknown }
  const providerBacked = isProviderBacked(source)
  return {
    ...source,
    productionType: source.productionType
      ?? (source.kind === 'video' ? 'video_clip' : source.kind === 'audio' ? 'audio_track' : 'shot_image'),
    label: source.label ?? (typeof source.name === 'string' ? source.name : undefined),
    mime: source.mime ?? (typeof source.mimeType === 'string' ? source.mimeType : undefined),
    meta: providerBacked ? { ...(source.meta ?? {}), upload: true } : source.meta,
    ...(source.provenance !== undefined && isAssetProvenance(source.provenance)
      ? { provenance: source.provenance }
      : {}),
  }
}

function validateAssetRecords(assets: unknown[]): void {
  const ids = new Set<string>()
  for (const asset of assets) {
    if (!isRecord(asset)) throw new Error('Invalid shared asset manifest record')
    if (
      typeof asset.id !== 'string' ||
      asset.id.length === 0 ||
      typeof asset.kind !== 'string' ||
      asset.kind.length === 0 ||
      (asset.provenance !== undefined && !isAssetProvenance(asset.provenance)) ||
      ids.has(asset.id)
    ) {
      throw new Error('Invalid or duplicate shared asset id')
    }
    ids.add(asset.id)
  }
}

/** 读共享 manifest；其它资产域的记录原样保留，损坏时 fail loud。 */
export function readManifest(dir: string): AssetManifest {
  const path = manifestPath(dir)
  if (!existsSync(path)) return { version: 2, assets: [] }
  let parsed: Partial<AssetManifest>
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<AssetManifest>
  } catch (error) {
    throw new Error(`Invalid shared asset manifest JSON: ${path}`, { cause: error })
  }
  if (parsed.version !== 2 || !Array.isArray(parsed.assets)) {
    throw new Error(`Unsupported shared asset manifest: ${path}`)
  }
  validateAssetRecords(parsed.assets)
  return { ...parsed, version: 2, assets: parsed.assets } as AssetManifest
}

function writeManifest(dir: string, manifest: AssetManifest): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const target = manifestPath(dir)
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temp, `${JSON.stringify({ ...manifest, version: 2 }, null, 2)}\n`)
  renameSync(temp, target)
}

export interface AssetFilter {
  kind?: MediaKind
  productionType?: MediaProductionType
  sceneNodeId?: string
}

export interface RegistryAssetRemoval {
  asset: MediaAsset | null
  clearedReferences: string[]
}

/**
 * 角色/场景引用只持久化在 shared manifest 的生成物元数据与 recipe inputs 中。
 * 不扫描 blueprint：图节点仅引用 video_clip，不保存 character_ref / scene_ref id。
 */
export function clearManifestAssetReferences(
  manifest: AssetManifest,
  deletedId: string,
): { manifest: AssetManifest, clearedReferences: string[] } {
  const clearedReferences: string[] = []
  const assets = manifest.assets.map((entry) => {
    if (!isRecord(entry) || entry.id === deletedId) return entry
    let next: Record<string, unknown> = entry
    const meta = isRecord(entry.meta) ? entry.meta : undefined
    if (meta) {
      const nextMeta = { ...meta }
      for (const key of ['refIds', 'characterRefIds', 'sceneRefIds']) {
        if (!Array.isArray(nextMeta[key])) continue
        const filtered = nextMeta[key].filter((value) => value !== deletedId)
        if (filtered.length !== nextMeta[key].length) {
          nextMeta[key] = filtered
          clearedReferences.push(`${String(entry.id)}.meta.${key}`)
        }
      }
      next = { ...next, meta: nextMeta }
    }
    const provenance = isAssetProvenance(entry.provenance) ? entry.provenance : undefined
    if (provenance?.recipe?.inputs) {
      const inputs = provenance.recipe.inputs.filter((input) => input.assetId !== deletedId)
      if (inputs.length !== provenance.recipe.inputs.length) {
        next = {
          ...next,
          provenance: {
            ...provenance,
            recipe: { ...provenance.recipe, inputs },
          },
        }
        clearedReferences.push(`${String(entry.id)}.provenance.recipe.inputs`)
      }
    }
    return next as typeof manifest.assets[number]
  })
  const placements = manifest.assetLibrary?.placements
  const assetLibrary = placements && Object.prototype.hasOwnProperty.call(placements, deletedId)
    ? {
        ...manifest.assetLibrary!,
        placements: Object.fromEntries(
          Object.entries(placements).filter(([assetId]) => assetId !== deletedId),
        ),
      }
    : manifest.assetLibrary
  if (assetLibrary !== manifest.assetLibrary) clearedReferences.push('assetLibrary.placements')
  const catalog = isRecord(manifest.assetCatalog) ? manifest.assetCatalog : undefined
  let assetCatalog = manifest.assetCatalog
  if (catalog) {
    let changed = false
    const rawEntities = isRecord(catalog.entities) ? catalog.entities : {}
    const entities = Object.fromEntries(Object.entries(rawEntities).map(([kind, table]) => {
      if (!isRecord(table)) return [kind, table]
      const nextTable = Object.fromEntries(Object.entries(table).map(([entityId, value]) => {
        if (!isRecord(value)) return [entityId, value]
        const current = isRecord(value.current) && value.current.assetId === deletedId
          ? undefined
          : value.current
        const originalHistory = Array.isArray(value.history) ? value.history : undefined
        const filteredHistory = originalHistory
          ? originalHistory.filter((entry) => !isRecord(entry) || entry.assetId !== deletedId)
          : undefined
        const history = filteredHistory && originalHistory && filteredHistory.length !== originalHistory.length
          ? filteredHistory
          : value.history
        if (current === value.current && history === value.history) return [entityId, value]
        changed = true
        clearedReferences.push(`assetCatalog.entities.${kind}.${entityId}`)
        const { current: _current, ...withoutCurrent } = value
        return [entityId, {
          ...withoutCurrent,
          ...(current ? { current } : {}),
          ...(history ? { history } : {}),
          updatedAt: Date.now(),
        }]
      }))
      return [kind, nextTable]
    }))
    const catalogPlacements = isRecord(catalog.placements) ? catalog.placements : {}
    const imagePlacementKey = `image:${deletedId}`
    const nextPlacements = Object.prototype.hasOwnProperty.call(catalogPlacements, imagePlacementKey)
      ? Object.fromEntries(Object.entries(catalogPlacements).filter(([key]) => key !== imagePlacementKey))
      : catalogPlacements
    if (nextPlacements !== catalogPlacements) {
      changed = true
      clearedReferences.push(`assetCatalog.placements.${imagePlacementKey}`)
    }
    if (changed) assetCatalog = { ...catalog, entities, placements: nextPlacements } as AssetManifest['assetCatalog']
  }
  return {
    manifest: {
      ...manifest,
      assets: assets as AssetManifest['assets'],
      ...(assetLibrary ? { assetLibrary } : {}),
      ...(assetCatalog ? { assetCatalog } : {}),
    },
    clearedReferences,
  }
}

/** 列资产（可选过滤）。 */
export function listAssets(dir: string, filter?: AssetFilter): MediaAsset[] {
  let out = readManifest(dir).assets
    .map(normalizeMediaAsset)
    .filter((asset): asset is MediaAsset => asset !== null)
  if (filter?.kind) out = out.filter((a) => a.kind === filter.kind)
  if (filter?.productionType) out = out.filter((a) => a.productionType === filter.productionType)
  if (filter?.sceneNodeId) out = out.filter((a) => a.sceneNodeId === filter.sceneNodeId)
  return out
}

export function getAsset(dir: string, id: string): MediaAsset | null {
  const asset = readManifest(dir).assets.find((a) => isRecord(a) && a.id === id)
  return normalizeMediaAsset(asset)
}

/** upsert 一条资产（按 id 覆盖或追加），返回落盘后的资产。 */
export function upsertAsset(dir: string, asset: MediaAsset): MediaAsset {
  const m = readManifest(dir)
  const idx = m.assets.findIndex((a) => a.id === asset.id)
  if (idx >= 0 && (!isMediaAsset(m.assets[idx]) || isProviderBacked(m.assets[idx]))) {
    throw new Error(`Asset id is owned by another asset domain: ${asset.id}`)
  }
  const now = Date.now()
  const next: MediaAsset = { ...asset, updatedAt: now, createdAt: asset.createdAt || now }
  if (idx >= 0) m.assets[idx] = next
  else m.assets.push(next)
  writeManifest(dir, m)
  return next
}

/** patch 一条资产（浅合并）；不存在返回 null。 */
export function updateAsset(dir: string, id: string, patch: Partial<MediaAsset>): MediaAsset | null {
  const m = readManifest(dir)
  const idx = m.assets.findIndex((a) => isMediaAsset(a) && !isProviderBacked(a) && a.id === id)
  if (idx < 0) return null
  const merged: MediaAsset = { ...m.assets[idx], ...patch, id, updatedAt: Date.now() } as MediaAsset
  m.assets[idx] = merged
  writeManifest(dir, m)
  return merged
}

export function deleteAsset(dir: string, id: string): boolean {
  const m = readManifest(dir)
  const next = m.assets.filter((a) => !isMediaAsset(a) || isProviderBacked(a) || a.id !== id)
  if (next.length === m.assets.length) return false
  writeManifest(dir, { ...m, assets: next })
  return true
}

/** 读游戏级风格三轴（manifest.styleAxes）；缺省 undefined。 */
export function getStyleAxes(dir: string): StyleAxes | undefined {
  return readManifest(dir).styleAxes
}

/** 写/合并游戏级风格三轴（浅合并，传 undefined 字段不清空已存值）。 */
export function setStyleAxes(dir: string, axes: StyleAxes): StyleAxes {
  const m = readManifest(dir)
  const merged: StyleAxes = { ...(m.styleAxes ?? {}), ...axes }
  writeManifest(dir, { ...m, styleAxes: merged })
  return merged
}

/**
 * 写一份自产媒体二进制到 `media/<id>.<ext>`，返回相对 `assets/` 根的 file 路径。
 * ext 不含点（如 'mp4' / 'png'）。
 */
export function writeMediaFile(dir: string, id: string, ext: string, bytes: Uint8Array): string {
  const md = mediaDir(dir)
  if (!existsSync(md)) mkdirSync(md, { recursive: true })
  const cleanExt = ext.replace(/^\./, '').toLowerCase() || 'bin'
  const rel = `media/${id}.${cleanExt}`
  writeFileSync(resolve(dir, rel), bytes)
  return rel
}

/** 解析一条资产的绝对磁盘文件路径（自产 file 优先，其次跨模块 externalPath）。 */
export function resolveAssetFilePath(dir: string, asset: MediaAsset): string | null {
  if (asset.file) {
    const mediaRoot = resolve(dir, 'media')
    const candidate = resolve(dir, asset.file)
    const rel = relative(mediaRoot, candidate)
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) ? candidate : null
  }
  if (asset.externalPath && isAbsolute(asset.externalPath)) {
    const gameRoot = resolve(dir, '..')
    const candidate = resolve(asset.externalPath)
    const rel = relative(gameRoot, candidate)
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) ? candidate : null
  }
  return null
}

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

export function mimeForPath(p: string): string {
  return MIME_BY_EXT[extname(p).toLowerCase()] ?? 'application/octet-stream'
}

/** 便捷：读文件流 + 大小 + mime（供宿主媒体路由）。 */
export function openAssetFile(dir: string, id: string): { stream: ReturnType<typeof createReadStream>; size: number; mime: string } | null {
  const asset = getAsset(dir, id)
  if (!asset) return null
  const p = resolveAssetFilePath(dir, asset)
  if (!p || !existsSync(p)) return null
  try {
    const size = statSync(p).size
    return { stream: createReadStream(p), size, mime: asset.mime ?? mimeForPath(p) }
  } catch {
    return null
  }
}

// ── Extension host capability-backed registry ────────────────────────────────

const HOST_MANIFEST_PATH = 'assets/manifest.json'
export const HOST_MANIFEST_LOCK = 'game-video-assets-manifest'
const HOST_RECLAIM_JOURNAL_KEY = 'wbGameVideoReclaims'
const HOST_MEDIA_INTENT_JOURNAL_KEY = 'wbGameVideoMediaIntents'
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

type HostPersistedMediaSource =
  | 'game-video-reference'
  | 'game-video-generation'

type HostReclaimSource =
  | HostPersistedMediaSource
  | 'game-video-model-output'

interface HostMediaReclaim {
  readonly registryId: string
  readonly assetId: string
  readonly source: HostReclaimSource
  readonly operationId: string | null
  readonly fingerprint?: string
}

interface HostReclaimJournal {
  readonly version: 1
  readonly entries: readonly HostMediaReclaim[]
}

interface HostMediaIntent {
  readonly registryId: string
  readonly source: HostPersistedMediaSource
  readonly operationId: string
}

interface HostMediaIntentJournal {
  readonly version: 1
  readonly entries: readonly HostMediaIntent[]
}

interface KnownGeneratedSource {
  readonly asset: HostMediaAsset
  readonly body: MediaBody
}

interface GeneratedAssetRegistrationInput {
  readonly registryId: string
  // `scene_ref` 与 `character_ref` 同类：都是模型生成、供节点视频当参考图的语义资产。
  readonly productionType: 'character_ref' | 'scene_ref' | 'shot_image' | 'grid_storyboard' | 'video_clip'
  readonly sceneNodeId?: string
  readonly label: string
  readonly prompt: string
  readonly durationMs?: number
  readonly meta?: Record<string, unknown>
  readonly provenance?: AssetProvenance
}

function generatedKinoMetadata(asset: HostMediaAsset): Record<string, unknown> {
  if (!isRecord(asset.metadata) || asset.metadata.provider !== 'kino') return {}
  const resourceId = asset.metadata.kinoResourceId
  if (typeof resourceId !== 'string' || resourceId.trim() === '') return {}
  return {
    kinoResourceId: resourceId.trim(),
    ...(typeof asset.metadata.kinoGenerationId === 'string'
      ? { kinoGenerationId: asset.metadata.kinoGenerationId }
      : {}),
    ...(typeof asset.metadata.kinoStatus === 'string'
      ? { kinoStatus: asset.metadata.kinoStatus }
      : {}),
    ...(typeof asset.metadata.model === 'string'
      ? { kinoModel: asset.metadata.model }
      : {}),
  }
}

function kinoGeneratedResource(asset: HostMediaAsset): {
  readonly url: string
  readonly resourceId: string
} {
  if (!isRecord(asset.metadata) || asset.metadata.provider !== 'kino') {
    throw new Error('Generated asset is not a Kino resource')
  }
  const resourceId = asset.metadata.kinoResourceId
  const url = safeRemoteMediaUrl(asset.url)
  if (typeof resourceId !== 'string' || resourceId.trim() === '' || !url) {
    throw new Error('Generated Kino resource is missing its URL or resource id')
  }
  return { url, resourceId: resourceId.trim() }
}

function assertBoundedRelativePath(value: string, label = 'Game file path'): string {
  const normalized = value.replace(/\\/g, '/')
  if (
    normalized.length === 0
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new TypeError(`${label} must be a bounded relative path`)
  }
  return normalized
}

/**
 * 已被语义登记（角色图 / 场景图）占用的底层受控媒体资源 id。
 *
 * 必须读原始 manifest：公开投影出于安全会剥掉 `provider`，
 * 而这条对应关系正是判定去重的唯一依据（设计 §10.9.4 B）。
 */
export async function semanticallyRegisteredResourceIds(
  files: BoundedGameFiles,
): Promise<Set<string>> {
  const manifest = await readHostManifest(files)
  const claimed = new Set<string>()
  for (const asset of manifest.assets) {
    if (!isRecord(asset)) continue
    if (asset.productionType !== 'character_ref' && asset.productionType !== 'scene_ref') continue
    const provider = isRecord(asset.provider) ? asset.provider : undefined
    const upstream = typeof provider?.upstreamResourceId === 'string'
      ? provider.upstreamResourceId.trim()
      : undefined
    const meta = isRecord(asset.meta) ? asset.meta : undefined
    const mapped = typeof meta?.kinoResourceId === 'string' ? meta.kinoResourceId.trim() : undefined
    const hostMedia = isRecord(meta?.hostMedia) ? meta.hostMedia : undefined
    const hostAssetId = typeof hostMedia?.assetId === 'string' ? hostMedia.assetId.trim() : undefined
    for (const id of [upstream, mapped, hostAssetId]) if (id) claimed.add(id)
  }
  return claimed
}

export async function readHostManifest(files: BoundedGameFiles): Promise<AssetManifest> {
  const bytes = await files.read(HOST_MANIFEST_PATH)
  return parseHostManifest(bytes)
}

function parseHostManifest(bytes: Uint8Array | null): AssetManifest {
  if (!bytes) return { version: 2, assets: [] }
  let parsed: Partial<AssetManifest>
  try {
    parsed = JSON.parse(textDecoder.decode(bytes)) as Partial<AssetManifest>
  } catch (error) {
    throw new Error('Invalid shared asset manifest JSON', { cause: error })
  }
  if (parsed.version !== 2 || !Array.isArray(parsed.assets)) {
    throw new Error('Unsupported shared asset manifest')
  }
  validateAssetRecords(parsed.assets)
  const manifest = { ...parsed, version: 2, assets: parsed.assets } as AssetManifest
  hostMediaReclaims(manifest)
  hostMediaIntents(manifest)
  return manifest
}

export interface HostManifestSnapshot {
  manifest: AssetManifest
  revision: number
  scopeRevisions: ScopeRevisions
  receipts: MutationReceipt[]
}

export async function readHostManifestSnapshot(
  files: BoundedGameFiles,
): Promise<HostManifestSnapshot> {
  const bytes = await files.read(HOST_MANIFEST_PATH)
  return {
    manifest: parseHostManifest(bytes),
    revision: readAssetManifestRevision(bytes),
    scopeRevisions: readAssetManifestScopeRevisions(bytes),
    receipts: readMutationReceipts(bytes),
  }
}

export async function writeHostManifest(
  files: BoundedGameFiles,
  manifest: AssetManifest,
): Promise<void> {
  validateAssetRecords(manifest.assets)
  hostMediaReclaims(manifest)
  hostMediaIntents(manifest)
  await files.write(
    HOST_MANIFEST_PATH,
    textEncoder.encode(`${JSON.stringify({ ...manifest, version: 2 }, null, 2)}\n`),
  )
}

/**
 * Commit one logical asset-lane mutation. Callers must already hold
 * `HOST_MANIFEST_LOCK`; the revision check and this write then share the same
 * critical section without taking the graph lock.
 */
export async function writeHostManifestRevision(
  files: BoundedGameFiles,
  manifest: AssetManifest,
  options: {
    touchedScopes: readonly string[]
    receipt?: MutationReceipt
    receipts?: readonly MutationReceipt[]
  },
): Promise<number> {
  const current = await readHostManifestSnapshot(files)
  const revision = nextAssetManifestRevision(current.revision)
  const receipts = options.receipts
    ?? appendMutationReceipt(current.receipts, options.receipt)
  const stamped = stampAssetManifestRevision(
    manifest,
    revision,
    receipts,
    {
      previous: current.scopeRevisions,
      touched: options.touchedScopes,
    },
  )
  await writeHostManifest(files, stamped)
  return revision
}

/** 读取 manifest 中登记的项目文档；文档记录损坏时拒绝静默忽略。 */
export async function listHostDocuments(
  context: ExtensionContext,
): Promise<DocumentRecord[]> {
  const manifest = await readHostManifest(context.files)
  const documents: DocumentRecord[] = []
  for (const asset of manifest.assets) {
    if (!isRecord(asset) || asset.kind !== 'document') continue
    if (!isDocumentRecord(asset)) {
      throw new Error('Invalid project document manifest record')
    }
    documents.push(asset)
  }
  return documents
}

/** 读取一份已登记的 Markdown 文档；不存在的登记项或正文均返回 null。 */
export async function readHostDocument(
  context: ExtensionContext,
  id: string,
): Promise<{ document: DocumentRecord, content: string } | null> {
  const document = (await listHostDocuments(context)).find((entry) => entry.id === id)
  if (!document) return null
  const bytes = await context.files.read(document.provider.ref)
  if (!bytes) return null
  return { document, content: textDecoder.decode(bytes) }
}

const SLUG_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function defaultDocumentName(documentType: DocumentType): string {
  switch (documentType) {
    case 'intake': return '需求'
    case 'design-options': return '核心方案候选'
    case 'core': return '核心'
    case 'inquiry': return '问询'
    case 'pillar': return '支柱'
  }
}

async function upsertHostDocumentAtRef(
  context: ExtensionContext,
  input: {
    documentType: DocumentType
    content?: string
    name?: string
  },
  ref: string,
  validationContent?: string,
): Promise<DocumentRecord> {
  if (!isDocumentPath(ref)) throw new TypeError('Invalid document path')
  const id = `doc-${input.documentType}`
  const now = Date.now()

  let contentForValidation = input.content ?? validationContent
  if (contentForValidation === undefined) {
    const existing = await context.files.read(ref)
    if (!existing) throw new Error(`Document file missing: ${ref}`)
    contentForValidation = textDecoder.decode(existing)
  }

  if (input.documentType === 'design-options') {
    parseDesignOptions(contentForValidation)
  }

  if (input.content !== undefined) {
    await context.files.write(ref, textEncoder.encode(input.content))
  }
  return context.files.withLocks([HOST_MANIFEST_LOCK], async () => {
    const manifest = await readHostManifest(context.files)
    const previous = manifest.assets.find((asset): asset is DocumentRecord => (
      isDocumentRecord(asset) && asset.meta.documentType === input.documentType
    ))
    const next: DocumentRecord = {
      id,
      kind: 'document',
      name: input.name?.trim() || defaultDocumentName(input.documentType),
      status: 'ready',
      mimeType: 'text/markdown',
      provider: { kind: 'local', ref },
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      meta: { documentType: input.documentType },
    }
    const assets = manifest.assets.filter((asset) => !(
      isDocumentRecord(asset) && asset.meta.documentType === input.documentType
    ))
    assets.push(next)
    await writeHostManifest(context.files, { ...manifest, assets })
    return next
  })
}

/**
 * Callers own the filename slug; it is never inferred from project.json so the
 * on-disk document identity stays exactly what the author or agent asked for.
 * An illegal slug is rejected instead of being rewritten into a lookalike path.
 */
export async function upsertHostDocument(
  context: ExtensionContext,
  input: {
    documentType: DocumentType
    slug: string
    content?: string
    name?: string
  },
): Promise<DocumentRecord> {
  const slug = typeof input.slug === 'string' ? input.slug.trim() : ''
  if (!slug) throw new TypeError('slug is required')
  if (!SLUG_SEGMENT_RE.test(slug)) throw new TypeError(`Invalid document slug: ${slug}`)
  const ref = input.documentType === 'design-options'
    ? `docs/${slug}_design_options.md`
    : `docs/${slug}_${input.documentType}.md`
  return upsertHostDocumentAtRef(
    context,
    input,
    ref,
  )
}

export async function healMissingDocuments(
  context: ExtensionContext,
): Promise<DocumentRecord[]> {
  const existing = await listHostDocuments(context)
  const present = new Set(existing.map((document) => document.meta.documentType))
  let entries: string[]
  try {
    entries = await context.files.list('docs')
  } catch {
    entries = []
  }

  const orphanByType = new Map<DocumentType, string>()
  for (const filename of [...entries].sort()) {
    const match = /^(.+)_(intake|design_options|core|inquiry|pillar)\.md$/i.exec(filename)
    if (!match) continue
    // A filename we cannot register (spaces, unicode, …) must not take the
    // whole document list down with it.
    if (!isDocumentPath(`docs/${filename}`)) continue
    const rawType = match[2]!.toLowerCase()
    const documentType = (rawType === 'design_options' ? 'design-options' : rawType) as DocumentType
    if (present.has(documentType)) continue
    const selected = orphanByType.get(documentType)
    if (selected) {
      console.warn(
        `Multiple orphan ${documentType} documents found; using ${selected} instead of ${filename}`,
      )
      continue
    }
    orphanByType.set(documentType, filename)
  }

  for (const [documentType, filename] of orphanByType) {
    const ref = `docs/${filename}`
    const bytes = await context.files.read(ref)
    if (!bytes) continue
    const content = textDecoder.decode(bytes)
    if (documentType === 'design-options') {
      try {
        parseDesignOptions(content)
      } catch {
        // Streaming upsert exposes the target file before the tool has finished
        // writing valid JSON. An unregistered draft is not a list failure; a
        // later request will register it once the complete payload is readable.
        continue
      }
    }
    await upsertHostDocumentAtRef(context, { documentType }, ref, content)
  }
  return listHostDocuments(context)
}

function isHostReclaimSource(value: unknown): value is HostReclaimSource {
  return (
    value === 'game-video-reference'
    || value === 'game-video-generation'
    || value === 'game-video-model-output'
  )
}

function isHostPersistedMediaSource(
  value: unknown,
): value is HostPersistedMediaSource {
  return (
    value === 'game-video-reference'
    || value === 'game-video-generation'
  )
}

function hostMediaReclaims(manifest: AssetManifest): HostMediaReclaim[] {
  const value = manifest[HOST_RECLAIM_JOURNAL_KEY]
  if (value === undefined) return []
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.entries)) {
    throw new Error('Invalid game-video media reclaim journal')
  }
  const seenAssets = new Set<string>()
  return value.entries.map((entry): HostMediaReclaim => {
    if (
      !isRecord(entry)
      || typeof entry.registryId !== 'string'
      || entry.registryId.length === 0
      || typeof entry.assetId !== 'string'
      || entry.assetId.length === 0
      || !isHostReclaimSource(entry.source)
      || (
        entry.operationId !== null
        && (typeof entry.operationId !== 'string' || entry.operationId.length === 0)
      )
      || (
        entry.source === 'game-video-model-output'
          ? (
              typeof entry.operationId !== 'string'
              || typeof entry.fingerprint !== 'string'
              || !/^sha256:[a-f0-9]{64}$/.test(entry.fingerprint)
            )
          : entry.fingerprint !== undefined
      )
      || seenAssets.has(entry.assetId)
    ) {
      throw new Error('Invalid game-video media reclaim journal')
    }
    seenAssets.add(entry.assetId)
    return {
      registryId: entry.registryId,
      assetId: entry.assetId,
      source: entry.source,
      operationId: entry.operationId,
      ...(typeof entry.fingerprint === 'string'
        ? { fingerprint: entry.fingerprint }
        : {}),
    }
  })
}

function hostMediaIntents(manifest: AssetManifest): HostMediaIntent[] {
  const value = manifest[HOST_MEDIA_INTENT_JOURNAL_KEY]
  if (value === undefined) return []
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.entries)) {
    throw new Error('Invalid game-video media intent journal')
  }
  const seenRegistries = new Set<string>()
  return value.entries.map((entry): HostMediaIntent => {
    if (
      !isRecord(entry)
      || typeof entry.registryId !== 'string'
      || entry.registryId.length === 0
      || !isHostPersistedMediaSource(entry.source)
      || typeof entry.operationId !== 'string'
      || entry.operationId.length === 0
      || seenRegistries.has(`${entry.source}\0${entry.registryId}`)
    ) {
      throw new Error('Invalid game-video media intent journal')
    }
    seenRegistries.add(`${entry.source}\0${entry.registryId}`)
    return {
      registryId: entry.registryId,
      source: entry.source,
      operationId: entry.operationId,
    }
  })
}

function withHostMediaReclaims(
  manifest: AssetManifest,
  entries: readonly HostMediaReclaim[],
): AssetManifest {
  const next: AssetManifest = { ...manifest }
  if (entries.length === 0) {
    delete next[HOST_RECLAIM_JOURNAL_KEY]
  } else {
    const journal: HostReclaimJournal = {
      version: 1,
      entries: entries.map((entry) => ({ ...entry })),
    }
    next[HOST_RECLAIM_JOURNAL_KEY] = journal
  }
  return next
}

function withHostMediaIntents(
  manifest: AssetManifest,
  entries: readonly HostMediaIntent[],
): AssetManifest {
  const next: AssetManifest = { ...manifest }
  if (entries.length === 0) {
    delete next[HOST_MEDIA_INTENT_JOURNAL_KEY]
  } else {
    const journal: HostMediaIntentJournal = {
      version: 1,
      entries: entries.map((entry) => ({ ...entry })),
    }
    next[HOST_MEDIA_INTENT_JOURNAL_KEY] = journal
  }
  return next
}

function declaredHostMediaId(normalized: MediaAsset): string | undefined {
  const hostMedia = isRecord(normalized.meta?.hostMedia)
    ? normalized.meta.hostMedia
    : undefined
  return (
    hostMedia?.provenance === 'extension-media-capability'
    && typeof hostMedia.assetId === 'string'
    && normalized.provider?.kind === 'local'
    && normalized.provider.ref === hostMedia.assetId
  ) ? hostMedia.assetId : undefined
}

function trustedHostMediaId(
  normalized: MediaAsset,
  trustedMedia: ReadonlyMap<string, HostMediaAsset>,
): string | undefined {
  const hostAssetId = declaredHostMediaId(normalized)
  if (hostAssetId && trustedMedia.has(hostAssetId)) return hostAssetId
  if (normalized.provider?.kind !== 'local') return undefined
  const candidate = trustedMedia.get(normalized.provider.ref)
  return candidate
    && isRecord(candidate.metadata)
    && candidate.metadata.registryId === normalized.id
    && isHostPersistedMediaSource(candidate.metadata.source)
    ? candidate.id
    : undefined
}

function reclaimForHostMedia(
  registryId: string,
  asset: HostMediaAsset | undefined,
): HostMediaReclaim | undefined {
  if (!asset || !isRecord(asset.metadata)) return undefined
  const { source, operationId } = asset.metadata
  if (
    asset.metadata.registryId !== registryId
    || (
      !isHostPersistedMediaSource(source)
    )
    || (
      operationId !== undefined
      && (typeof operationId !== 'string' || operationId.length === 0)
    )
  ) {
    return undefined
  }
  return {
    registryId,
    assetId: asset.id,
    source,
    operationId: operationId ?? null,
  }
}

function sameHostMediaIntent(
  left: HostMediaIntent,
  right: HostMediaIntent,
): boolean {
  return (
    left.registryId === right.registryId
    && left.source === right.source
    && left.operationId === right.operationId
  )
}

function matchesHostMediaIntent(
  intent: HostMediaIntent,
  asset: HostMediaAsset,
): boolean {
  return (
    isRecord(asset.metadata)
    && asset.metadata.registryId === intent.registryId
    && asset.metadata.source === intent.source
    && asset.metadata.operationId === intent.operationId
  )
}

function sameHostMediaReclaim(
  left: HostMediaReclaim,
  right: HostMediaReclaim,
): boolean {
  return (
    left.registryId === right.registryId
    && left.assetId === right.assetId
    && left.source === right.source
    && left.operationId === right.operationId
    && left.fingerprint === right.fingerprint
  )
}

function enqueueHostMediaReclaim(
  manifest: AssetManifest,
  reclaim: HostMediaReclaim,
): AssetManifest {
  const entries = hostMediaReclaims(manifest)
  const existing = entries.find((entry) => entry.assetId === reclaim.assetId)
  if (existing) {
    if (!sameHostMediaReclaim(existing, reclaim)) {
      throw new Error('Conflicting game-video media reclaim journal entry')
    }
    return manifest
  }
  return withHostMediaReclaims(manifest, [...entries, reclaim])
}

function publicHostAsset(
  value: unknown,
  trustedMedia: ReadonlyMap<string, HostMediaAsset>,
): MediaAsset | null {
  const normalized = normalizeMediaAsset(value)
  if (!normalized) return null
  const { label, prompt, error, meta } = normalized
  const hostAssetId = trustedHostMediaId(normalized, trustedMedia)
  const authoritativeMedia = hostAssetId ? trustedMedia.get(hostAssetId) : undefined
  const trustedLocator = (
    authoritativeMedia
    && (normalized.url === undefined || authoritativeMedia.url === normalized.url)
  )
    ? safeHostMediaUrl(authoritativeMedia.url)
    : undefined
  const kinoProvider = normalized.provider?.kind === 'kino'
    && typeof normalized.provider.ref === 'string'
    && normalized.provider.ref.trim()
    ? {
        kind: 'kino' as const,
        ref: normalized.provider.ref.trim(),
        ...(typeof normalized.provider.upstreamResourceId === 'string'
          && normalized.provider.upstreamResourceId.trim()
          ? { upstreamResourceId: normalized.provider.upstreamResourceId.trim() }
          : {}),
      }
    : undefined
  const kinoLocator = kinoProvider ? safeRemoteMediaUrl(normalized.url) : undefined
  const publicLocator = trustedLocator ?? kinoLocator
  const sanitizedMetaBase = deepSanitizeMeta(
    meta,
    publicLocator,
    trustedLocator ? hostAssetId : undefined,
  )
  const sanitizedMeta = trustedLocator && hostAssetId
    ? {
        ...(sanitizedMetaBase ?? {}),
        hostMedia: {
          provenance: 'extension-media-capability',
          assetId: hostAssetId,
          locator: trustedLocator,
        },
      }
    : sanitizedMetaBase
  const provenance = sanitizePublicProvenance(normalized.provenance)
  return {
    id: normalized.id,
    kind: normalized.kind,
    productionType: normalized.productionType,
    status: normalized.status,
    ...(label ? { label: sanitizePublicText(label) } : {}),
    ...(prompt ? { prompt: sanitizePublicText(prompt) } : {}),
    ...(normalized.sceneNodeId ? {
      sceneNodeId: sanitizePublicText(normalized.sceneNodeId),
    } : {}),
    ...(normalized.sourceModule ? {
      sourceModule: sanitizePublicText(normalized.sourceModule),
    } : {}),
    ...(normalized.mime ? { mime: normalized.mime } : {}),
    ...(normalized.bytes !== undefined ? { bytes: normalized.bytes } : {}),
    ...(normalized.durationMs !== undefined
      ? { durationMs: normalized.durationMs }
      : {}),
    ...(error ? { error: sanitizePublicText(error) } : {}),
    ...(publicLocator ? { url: publicLocator } : {}),
    ...(kinoProvider ? { provider: kinoProvider } : {}),
    ...(sanitizedMeta ? { meta: sanitizedMeta } : {}),
    ...(provenance ? { provenance } : {}),
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
  }
}

export function sanitizePublicText(value: string): string {
  return value
    .replace(/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+/g, '[redacted]')
    .replace(/\b(?:file|javascript|data|vbscript|blob):\S+/gi, '[redacted]')
    .replace(/\\\\[^\s]+/g, '[redacted]')
    .replace(/[A-Za-z]:[\\/][^\s]+/g, '[redacted]')
    .replace(
      /(^|[^A-Za-z0-9._-])\/[^\s,;)\]}"']+/g,
      (_match, prefix: string) => `${prefix}[redacted]`,
    )
    .slice(0, 4_000)
}

function containsSensitivePublicText(value: string): boolean {
  return sanitizePublicText(value) !== value
}

function deepSanitizeMeta(
  value: unknown,
  trustedLocator?: string,
  trustedAssetId?: string,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, unknown> = {}
  for (const [childKey, child] of Object.entries(value)) {
    if (/^(?:externalPath|sourceUrl|path|file|providerUrl)$/i.test(childKey)) continue
    if (/(?:api[_-]?key|authorization|password|secret|token)/i.test(childKey)) continue
    if (childKey === 'hostMedia' && isRecord(child)) {
      if (
        child.provenance === 'extension-media-capability'
        && child.assetId === trustedAssetId
        && typeof trustedLocator === 'string'
      ) {
        out.hostMedia = {
          provenance: child.provenance,
          assetId: trustedAssetId,
          locator: trustedLocator,
        }
      }
      continue
    }
    if (typeof child === 'string') {
      if (
        containsSensitivePublicText(child)
        || /(?:path|url)$/i.test(childKey)
      ) continue
      out[childKey] = child
    } else if (Array.isArray(child)) {
      const items: unknown[] = []
      for (const item of child) {
        if (typeof item === 'string') {
          if (containsSensitivePublicText(item)) continue
          items.push(item)
        } else if (Array.isArray(item)) {
          const nested = deepSanitizeMeta(
            { items: item },
            trustedLocator,
            trustedAssetId,
          )
          if (nested?.items) items.push(nested.items)
        } else if (isRecord(item)) {
          const nested = deepSanitizeMeta(
            item,
            trustedLocator,
            trustedAssetId,
          )
          if (nested && Object.keys(nested).length) items.push(nested)
        } else {
          items.push(item)
        }
      }
      out[childKey] = items
    } else if (isRecord(child)) {
      const nested = deepSanitizeMeta(child, trustedLocator, trustedAssetId)
      if (nested && Object.keys(nested).length) out[childKey] = nested
    } else {
      out[childKey] = child
    }
  }
  return Object.keys(out).length ? out : undefined
}

function sanitizePublicProvenance(value: AssetProvenance | undefined): AssetProvenance | undefined {
  if (!value) return undefined
  const parameters = value.recipe
    ? deepSanitizeMeta(value.recipe.parameters) as AssetRecipe['parameters'] | undefined
    : undefined
  return {
    origin: value.origin,
    ...(value.source ? {
      source: {
        ...(value.source.module ? { module: sanitizePublicText(value.source.module) } : {}),
        ...(value.source.assetId ? { assetId: sanitizePublicText(value.source.assetId) } : {}),
      },
    } : {}),
    ...(value.recipe && parameters ? {
      recipe: {
        version: 1,
        ...(value.recipe.inputs ? {
          inputs: value.recipe.inputs.map((input) => ({
            assetId: sanitizePublicText(input.assetId),
            role: sanitizePublicText(input.role),
          })),
        } : {}),
        parameters,
      },
    } : {}),
  }
}

function safeHostMediaUrl(value: string): string | undefined {
  if (value.startsWith('/') && !value.startsWith('//') && !/[\\\r\n\0]/u.test(value)) {
    return value
  }
  try {
    const url = new URL(value)
    return ['file:', 'javascript:', 'data:'].includes(url.protocol)
      ? undefined
      : value
  } catch {
    return undefined
  }
}

function safeRemoteMediaUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function filterAssets(
  manifest: AssetManifest,
  trustedMedia: ReadonlyMap<string, HostMediaAsset>,
  filter?: AssetFilter,
): MediaAsset[] {
  let assets = manifest.assets
    .map((asset) => publicHostAsset(asset, trustedMedia))
    .filter((asset): asset is MediaAsset => asset !== null)
  if (filter?.kind) assets = assets.filter((asset) => asset.kind === filter.kind)
  if (filter?.productionType) {
    assets = assets.filter((asset) => asset.productionType === filter.productionType)
  }
  if (filter?.sceneNodeId) {
    assets = assets.filter((asset) => asset.sceneNodeId === filter.sceneNodeId)
  }
  return assets
}

function mediaFilename(prefix: string, id: string, mime: string): string {
  const safeId = id.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'asset'
  const extension = extForContentType(mime)
  return `${prefix}-${safeId}.${extension}`
}

function mediaIdempotencyKey(
  operation: string,
  parts: readonly (string | Uint8Array)[],
): string {
  const hash = createHash('sha256')
  for (const part of parts) {
    const bytes = typeof part === 'string' ? Buffer.from(part) : part
    hash.update(String(bytes.byteLength))
    hash.update(':')
    hash.update(bytes)
  }
  return `game-video:${operation}:${hash.digest('hex')}`
}

function generatedSourceFingerprint(
  asset: HostMediaAsset,
  body: MediaBody,
): string {
  const hash = createHash('sha256')
  for (const part of [
    asset.id,
    asset.type,
    asset.contentType,
    body.contentType,
    body.bytes,
  ]) {
    const bytes = typeof part === 'string' ? Buffer.from(part) : part
    hash.update(String(bytes.byteLength))
    hash.update(':')
    hash.update(bytes)
  }
  return `sha256:${hash.digest('hex')}`
}

function extForContentType(contentType: string): string {
  switch (contentType.toLowerCase().split(';', 1)[0]) {
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
    case 'video/mp4': return 'mp4'
    case 'video/webm': return 'webm'
    case 'video/quicktime': return 'mov'
    default: return 'png'
  }
}

export interface HostAssetRegistry {
  list(filter?: AssetFilter): Promise<MediaAsset[]>
  get(id: string): Promise<MediaAsset | null>
  upsert(asset: MediaAsset): Promise<MediaAsset>
  update(id: string, patch: Partial<MediaAsset>): Promise<MediaAsset | null>
  remove(id: string): Promise<RegistryAssetRemoval>
  getStyleAxes(): Promise<StyleAxes | undefined>
  setStyleAxes(axes: StyleAxes): Promise<StyleAxes>
  importGameFile(input: {
    registryId: string
    relativePath: string
    filename: string
    contentType: string
    productionType: 'character_ref' | 'scene_ref'
    label: string
    sourceModule: string
    meta?: Record<string, unknown>
  }): Promise<MediaAsset>
  mediaReference(id: string): Promise<MediaReference>
  registerGenerated(
    generated: HostMediaAsset,
    input: GeneratedAssetRegistrationInput,
  ): Promise<MediaAsset>
  persistGenerated(
    generated: HostMediaAsset,
    input: GeneratedAssetRegistrationInput & {
      filenamePrefix: string
    },
  ): Promise<MediaAsset>
}

/**
 * Creates the registry used by host-neutral service and router calls. Game data
 * is accessed only through bounded file helpers; binary ingress/egress goes
 * through the host media capability.
 */
export function createHostAssetRegistry(
  context: ExtensionContext,
): HostAssetRegistry {
  const withManifestLock = <T>(operation: () => Promise<T>): Promise<T> => (
    context.files.withLocks([HOST_MANIFEST_LOCK], operation)
  )
  const trustedMedia = async (): Promise<Map<string, HostMediaAsset>> => (
    new Map(
      (await context.media.list(context.gameId))
        .map((asset) => [asset.id, asset]),
    )
  )
  const prepareHostMediaOperation = async (
    initialManifest: AssetManifest,
    requested: HostMediaIntent,
  ): Promise<{
    manifest: AssetManifest
    hosted?: HostMediaAsset
  }> => {
    let manifest = initialManifest
    const intents = hostMediaIntents(manifest)
    const hostedAssets = await context.media.list(context.gameId)
    const liveAssetIds = new Set(
      manifest.assets
        .map((asset) => normalizeMediaAsset(asset))
        .filter((asset): asset is MediaAsset => asset !== null)
        .map((asset) => declaredHostMediaId(asset))
        .filter((assetId): assetId is string => assetId !== undefined),
    )
    const remaining: HostMediaIntent[] = []
    let recovered: HostMediaAsset | undefined
    let changed = false

    for (const intent of intents) {
      if (intent.registryId !== requested.registryId) {
        remaining.push(intent)
        continue
      }
      const candidates = hostedAssets.filter((asset) => (
        matchesHostMediaIntent(intent, asset)
      ))
      if (candidates.length > 1) {
        throw new Error(
          `Multiple host media objects match one durable intent: ${intent.registryId}`,
        )
      }
      const candidate = candidates[0]
      if (candidate && liveAssetIds.has(candidate.id)) {
        // The manifest reference is authoritative; a stale intent must never
        // make a committed object eligible for deletion.
        changed = true
        continue
      }
      if (sameHostMediaIntent(intent, requested)) {
        remaining.push(intent)
        recovered = candidate
        continue
      }
      if (candidate) {
        await context.media.delete(context.gameId, candidate.id)
      }
      changed = true
    }

    if (changed) {
      manifest = withHostMediaIntents(manifest, remaining)
      await writeHostManifest(context.files, manifest)
    }
    if (!remaining.some((intent) => sameHostMediaIntent(intent, requested))) {
      manifest = withHostMediaIntents(manifest, [...remaining, requested])
      await writeHostManifest(context.files, manifest)
    }
    return { manifest, ...(recovered ? { hosted: recovered } : {}) }
  }
  const completeHostMediaOperation = (
    manifest: AssetManifest,
    intent: HostMediaIntent,
    hosted: HostMediaAsset,
  ): AssetManifest => {
    if (!matchesHostMediaIntent(intent, hosted)) {
      throw new Error('Host media result does not match its durable operation intent')
    }
    const intents = hostMediaIntents(manifest)
    if (!intents.some((entry) => sameHostMediaIntent(entry, intent))) {
      throw new Error('Host media operation intent disappeared before commit')
    }
    return withHostMediaIntents(
      manifest,
      intents.filter((entry) => !sameHostMediaIntent(entry, intent)),
    )
  }
  const drainHostMediaReclaims = async (
    initialManifest: AssetManifest,
    registryId?: string,
    knownGeneratedSources: ReadonlyMap<string, KnownGeneratedSource> = new Map(),
  ): Promise<AssetManifest> => {
    let manifest = initialManifest
    for (const reclaim of hostMediaReclaims(manifest)) {
      if (registryId !== undefined && reclaim.registryId !== registryId) continue
      const liveAssetIds = new Set(
        manifest.assets
          .map((asset) => normalizeMediaAsset(asset))
          .filter((asset): asset is MediaAsset => asset !== null)
          .map((asset) => declaredHostMediaId(asset))
          .filter((assetId): assetId is string => assetId !== undefined),
      )
      const candidates = (await context.media.list(context.gameId))
        .filter((asset) => asset.id === reclaim.assetId)

      if (reclaim.source === 'game-video-model-output') {
        if (candidates.length > 1) {
          throw new Error(
            `Ambiguous generated source media identity: ${reclaim.assetId}`,
          )
        }
        const known = knownGeneratedSources.get(reclaim.assetId)
        const candidate = candidates[0] ?? known?.asset
        const body = candidates[0]
          ? await context.media.read(context.gameId, reclaim.assetId)
          : known?.body

        if (candidate) {
          if (liveAssetIds.has(reclaim.assetId)) {
            throw new Error(
              `Refusing to reclaim current host media reference: ${reclaim.assetId}`,
            )
          }
          if (
            !body
            || generatedSourceFingerprint(candidate, body) !== reclaim.fingerprint
          ) {
            throw new Error(
              `Refusing to reclaim mismatched generated source provenance: ${reclaim.assetId}`,
            )
          }
          await context.media.delete(context.gameId, reclaim.assetId)
        }
        manifest = withHostMediaReclaims(
          manifest,
          hostMediaReclaims(manifest)
            .filter((entry) => entry.assetId !== reclaim.assetId),
        )
        await writeHostManifest(context.files, manifest)
        continue
      }

      if (candidates.length > 1) {
        throw new Error(
          `Multiple host media objects match one reclaim: ${reclaim.assetId}`,
        )
      }
      const candidate = candidates[0]
      const observed = reclaimForHostMedia(reclaim.registryId, candidate)

      if (
        candidate
        && (!observed || !sameHostMediaReclaim(reclaim, observed))
      ) {
        throw new Error(
          `Refusing to reclaim host media with mismatched provenance: ${reclaim.assetId}`,
        )
      }
      if (
        candidate
        && observed
        && liveAssetIds.has(reclaim.assetId)
      ) {
        throw new Error(
          `Refusing to reclaim current host media reference: ${reclaim.assetId}`,
        )
      }
      if (candidate && observed) {
        await context.media.delete(context.gameId, reclaim.assetId)
      }
      manifest = withHostMediaReclaims(
        manifest,
        hostMediaReclaims(manifest)
          .filter((entry) => entry.assetId !== reclaim.assetId),
      )
      await writeHostManifest(context.files, manifest)
    }
    return manifest
  }
  const persistHostAsset = async (
    manifest: AssetManifest,
    index: number,
    current: MediaAsset | null,
    next: MediaAsset,
    knownGeneratedSources: ReadonlyMap<string, KnownGeneratedSource> = new Map(),
  ): Promise<MediaAsset> => {
    const hostedAssets = await trustedMedia()
    const previousHostId = current
      ? trustedHostMediaId(current, hostedAssets)
      : undefined
    const nextHostId = trustedHostMediaId(next, hostedAssets)

    if (index >= 0) manifest.assets[index] = next
    else manifest.assets.push(next)

    let persistedManifest = manifest
    if (
      previousHostId
      && nextHostId
      && previousHostId !== nextHostId
    ) {
      const reclaim = reclaimForHostMedia(
        next.id,
        hostedAssets.get(previousHostId),
      )
      if (reclaim) {
        persistedManifest = enqueueHostMediaReclaim(
          persistedManifest,
          reclaim,
        )
      }
    }
    await writeHostManifest(context.files, persistedManifest)
    await drainHostMediaReclaims(
      persistedManifest,
      next.id,
      knownGeneratedSources,
    )
    return publicHostAsset(next, await trustedMedia())!
  }
  const upsertInManifest = async (
    manifest: AssetManifest,
    asset: MediaAsset,
    knownGeneratedSources?: ReadonlyMap<string, KnownGeneratedSource>,
  ): Promise<MediaAsset> => {
    const index = manifest.assets.findIndex((entry) => (
      isRecord(entry) && entry.id === asset.id
    ))
    const now = Date.now()
    const next: MediaAsset = {
      ...asset,
      createdAt: asset.createdAt || now,
      updatedAt: now,
    }
    if (index >= 0) {
      const currentRecord = manifest.assets[index]
      if (
        !isMediaAsset(currentRecord)
        || (
          isProviderBacked(currentRecord)
          && currentRecord.sourceModule !== next.sourceModule
        )
      ) {
        throw new Error(`Asset id is owned by another asset domain: ${asset.id}`)
      }
      return persistHostAsset(
        manifest,
        index,
        normalizeMediaAsset(currentRecord),
        next,
        knownGeneratedSources,
      )
    }
    return persistHostAsset(
      manifest,
      index,
      null,
      next,
      knownGeneratedSources,
    )
  }
  const upsert = async (asset: MediaAsset): Promise<MediaAsset> => (
    withManifestLock(async () => {
      const manifest = await drainHostMediaReclaims(
        await readHostManifest(context.files),
        asset.id,
      )
      return upsertInManifest(manifest, asset)
    })
  )

  const getRaw = async (id: string): Promise<MediaAsset | null> => {
    const manifest = await readHostManifest(context.files)
    return normalizeMediaAsset(
      manifest.assets.find((entry) => isRecord(entry) && entry.id === id),
    )
  }
  const get = async (id: string): Promise<MediaAsset | null> => (
    publicHostAsset(await getRaw(id), await trustedMedia())
  )

  const updateInManifest = async (
    manifest: AssetManifest,
    id: string,
    patch: Partial<MediaAsset>,
    knownGeneratedSources?: ReadonlyMap<string, KnownGeneratedSource>,
  ): Promise<MediaAsset | null> => {
    const index = manifest.assets.findIndex((entry) => (
      isRecord(entry) && entry.id === id
    ))
    if (index < 0) return null
    const current = normalizeMediaAsset(manifest.assets[index])
    if (!current) return null
    const next: MediaAsset = {
      ...current,
      ...patch,
      id,
      createdAt: current.createdAt,
      updatedAt: Date.now(),
    }
    if (
      isProviderBacked(manifest.assets[index])
      && current.sourceModule !== next.sourceModule
    ) {
      throw new Error(`Asset id is owned by another asset domain: ${id}`)
    }
    return persistHostAsset(
      manifest,
      index,
      current,
      next,
      knownGeneratedSources,
    )
  }
  const update = async (
    id: string,
    patch: Partial<MediaAsset>,
  ): Promise<MediaAsset | null> => (
    withManifestLock(async () => {
      const manifest = await drainHostMediaReclaims(
        await readHostManifest(context.files),
        id,
      )
      return updateInManifest(manifest, id, patch)
    })
  )
  const remove = async (id: string): Promise<RegistryAssetRemoval> => (
    withManifestLock(async () => {
      const manifest = await drainHostMediaReclaims(
        await readHostManifest(context.files),
        id,
      )
      const index = manifest.assets.findIndex((entry) => (
        isRecord(entry) && entry.id === id
      ))
      if (index < 0) return { asset: null, clearedReferences: [] }
      const current = normalizeMediaAsset(manifest.assets[index])
      if (!current) return { asset: null, clearedReferences: [] }
      if (current.status === 'generating') {
        throw new Error('正在生成的资产不能删除')
      }
      const hostedAssets = await trustedMedia()
      const hostAssetId = trustedHostMediaId(current, hostedAssets)
      let next: AssetManifest = {
        ...manifest,
        assets: manifest.assets.filter((_entry, entryIndex) => entryIndex !== index),
      }
      const cleared = clearManifestAssetReferences(next, id)
      next = cleared.manifest
      if (hostAssetId) {
        const reclaim = reclaimForHostMedia(id, hostedAssets.get(hostAssetId))
        if (reclaim) next = enqueueHostMediaReclaim(next, reclaim)
      }
      await writeHostManifest(context.files, next)
      await drainHostMediaReclaims(next, id)
      return {
        asset: publicHostAsset(current, hostedAssets),
        clearedReferences: cleared.clearedReferences,
      }
    })
  )

  return {
    async list(filter) {
      return filterAssets(
        await readHostManifest(context.files),
        await trustedMedia(),
        filter,
      )
    },
    get,
    upsert,
    update,
    remove,
    async getStyleAxes() {
      return (await readHostManifest(context.files)).styleAxes
    },
    async setStyleAxes(axes) {
      return withManifestLock(async () => {
        const manifest = await readHostManifest(context.files)
        const styleAxes = { ...(manifest.styleAxes ?? {}), ...axes }
        await writeHostManifest(context.files, { ...manifest, styleAxes })
        return styleAxes
      })
    },
    async importGameFile(input) {
      const relativePath = assertBoundedRelativePath(input.relativePath)
      const bytes = await context.files.read(relativePath)
      if (!bytes) throw new Error(`Reference media was not found: ${relativePath}`)
      const operationId = mediaIdempotencyKey('asset-import', [
        input.registryId,
        relativePath,
        input.contentType,
        bytes,
      ])
      const intent: HostMediaIntent = {
        registryId: input.registryId,
        source: 'game-video-reference',
        operationId,
      }
      return withManifestLock(async () => {
        const manifest = await drainHostMediaReclaims(
          await readHostManifest(context.files),
          input.registryId,
        )
        const prepared = await prepareHostMediaOperation(
          manifest,
          intent,
        )
        const hosted = prepared.hosted ?? await context.media.put(context.gameId, {
          filename: input.filename,
          contentType: input.contentType,
          bytes,
          idempotencyKey: operationId,
          metadata: {
            source: intent.source,
            registryId: intent.registryId,
            operationId: intent.operationId,
          },
        })
        return upsertInManifest(
          completeHostMediaOperation(prepared.manifest, intent, hosted),
          {
            id: input.registryId,
            kind: 'image',
            productionType: input.productionType,
            status: 'ready',
            label: input.label,
            sourceModule: input.sourceModule,
            mime: hosted.contentType,
            bytes: hosted.sizeBytes ?? bytes.byteLength,
            url: safeHostMediaUrl(hosted.url),
            provider: { kind: 'local', ref: hosted.id },
            createdAt: Date.now(),
            updatedAt: Date.now(),
            meta: {
              ...(input.meta ?? {}),
              hostMedia: {
                provenance: 'extension-media-capability',
                assetId: hosted.id,
                locator: safeHostMediaUrl(hosted.url),
              },
            },
            provenance: {
              origin: 'import',
              source: { module: input.sourceModule, assetId: relativePath },
            },
          },
        )
      })
    },
    async mediaReference(id) {
      const asset = await getRaw(id)
      if (!asset) throw new Error(`参考图不存在：${id}`)
      if (asset.provider?.ref) {
        const hosted = (await context.media.list(context.gameId))
          .find((candidate) => candidate.id === asset.provider!.ref)
        if (!hosted) {
          throw new Error(`参考图 ${id} 的宿主媒体引用不存在`)
        }
        return { assetId: hosted.id }
      }
      if (!asset.file) throw new Error(`参考图 ${id} 没有可读取的宿主媒体`)
      const relativePath = assertBoundedRelativePath(`assets/${asset.file}`)
      const bytes = await context.files.read(relativePath)
      if (!bytes) throw new Error(`参考图 ${id} 内容不存在`)
      const hosted = await context.media.put(context.gameId, {
        filename: mediaFilename('reference', id, asset.mime ?? 'image/png'),
        contentType: asset.mime ?? 'image/png',
        bytes,
        idempotencyKey: mediaIdempotencyKey('asset-reference', [
          id,
          asset.mime ?? 'image/png',
          bytes,
        ]),
        metadata: { source: 'game-video-registry', registryId: id },
      })
      return { assetId: hosted.id }
    },
    async registerGenerated(generated, input) {
      const kino = kinoGeneratedResource(generated)
      return withManifestLock(async () => {
        const manifest = await drainHostMediaReclaims(
          await readHostManifest(context.files),
          input.registryId,
        )
        const registered = await updateInManifest(
          manifest,
          input.registryId,
          {
            kind: input.productionType === 'video_clip' ? 'video' : 'image',
            productionType: input.productionType,
            status: 'ready',
            label: input.label,
            prompt: input.prompt,
            sceneNodeId: input.sceneNodeId,
            sourceModule: 'game-video',
            mime: generated.contentType,
            url: kino.url,
            provider: {
              kind: 'kino',
              ref: kino.url,
              upstreamResourceId: kino.resourceId,
            },
            durationMs: input.durationMs,
            updatedAt: Date.now(),
            meta: {
              ...(input.meta ?? {}),
              ...generatedKinoMetadata(generated),
            },
            provenance: input.provenance ?? {
              origin: 'generation',
              recipe: { version: 1, parameters: {} },
            },
          },
        )
        if (!registered) {
          throw new Error(`Generating asset disappeared: ${input.registryId}`)
        }
        return registered
      })
    },
    async persistGenerated(generated, input) {
      return withManifestLock(async () => {
        const manifest = await drainHostMediaReclaims(
          await readHostManifest(context.files),
          input.registryId,
        )
        const current = normalizeMediaAsset(
          manifest.assets.find((entry) => (
            isRecord(entry) && entry.id === input.registryId
          )),
        )
        const currentHostId = current
          ? trustedHostMediaId(current, await trustedMedia())
          : undefined
        const body = await context.media.read(context.gameId, generated.id)
        if (!body || body.bytes.byteLength === 0) {
          const hostedAssets = await trustedMedia()
          const hostId = current
            ? trustedHostMediaId(current, hostedAssets)
            : undefined
          const hosted = hostId ? hostedAssets.get(hostId) : undefined
          if (
            current?.status === 'ready'
            && current.productionType === input.productionType
            && current.sceneNodeId === input.sceneNodeId
            && current.label === input.label
            && current.prompt === input.prompt
            && current.durationMs === input.durationMs
            && hosted
            && isRecord(hosted.metadata)
            && hosted.metadata.source === 'game-video-generation'
            && hosted.metadata.registryId === input.registryId
            && hosted.metadata.generatedAssetId === generated.id
          ) {
            return publicHostAsset(current, hostedAssets)!
          }
          throw new Error('Generated media is not readable through the host media capability')
        }
        const operationId = mediaIdempotencyKey('asset-generation', [
          generated.id,
          input.registryId,
          body.contentType,
          body.bytes,
        ])
        const intent: HostMediaIntent = {
          registryId: input.registryId,
          source: 'game-video-generation',
          operationId,
        }
        const prepared = await prepareHostMediaOperation(
          manifest,
          intent,
        )
        const hosted = prepared.hosted ?? await context.media.put(context.gameId, {
          filename: mediaFilename(input.filenamePrefix, input.registryId, body.contentType),
          contentType: body.contentType,
          bytes: body.bytes,
          idempotencyKey: operationId,
          metadata: {
            source: intent.source,
            generatedAssetId: generated.id,
            registryId: intent.registryId,
            operationId: intent.operationId,
          },
        })
        let committedManifest = completeHostMediaOperation(
          prepared.manifest,
          intent,
          hosted,
        )
        const knownGeneratedSources = new Map<string, KnownGeneratedSource>()
        if (
          hosted.id !== generated.id
          && currentHostId !== generated.id
        ) {
          committedManifest = enqueueHostMediaReclaim(
            committedManifest,
            {
              registryId: input.registryId,
              assetId: generated.id,
              source: 'game-video-model-output',
              operationId,
              fingerprint: generatedSourceFingerprint(generated, body),
            },
          )
          knownGeneratedSources.set(generated.id, { asset: generated, body })
        }
        const kinoMetadata = generatedKinoMetadata(generated)
        const persisted = await updateInManifest(
          committedManifest,
          input.registryId,
          {
            kind: input.productionType === 'video_clip' ? 'video' : 'image',
            productionType: input.productionType,
            status: 'ready',
            label: input.label,
            prompt: input.prompt,
            sceneNodeId: input.sceneNodeId,
            sourceModule: 'game-video',
            mime: hosted.contentType,
            bytes: hosted.sizeBytes ?? body.bytes.byteLength,
            url: safeHostMediaUrl(hosted.url),
            provider: { kind: 'local', ref: hosted.id },
            durationMs: input.durationMs,
            updatedAt: Date.now(),
            meta: {
              ...(input.meta ?? {}),
              ...kinoMetadata,
              hostMedia: {
                provenance: 'extension-media-capability',
                assetId: hosted.id,
                locator: safeHostMediaUrl(hosted.url),
              },
            },
            provenance: input.provenance ?? {
              origin: 'generation',
              recipe: { version: 1, parameters: {} },
            },
          },
          knownGeneratedSources,
        )
        if (!persisted) {
          throw new Error(`Generating asset disappeared: ${input.registryId}`)
        }
        return persisted
      })
    },
  }
}

export async function getHostStyleAxes(
  context: ExtensionContext,
): Promise<StyleAxes | undefined> {
  return createHostAssetRegistry(context).getStyleAxes()
}
