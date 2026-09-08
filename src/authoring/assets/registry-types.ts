/**
 * registry-types —— 游戏级共享素材层的**类型 SSOT**（浏览器安全，零依赖 · 无 node:fs）。
 *
 * 素材层数据落在 `.forgeax/games/<slug>/assets/`：
 *   - `manifest.json` = { version:2, assets: AssetRecord[] }（游戏级共享资产清单）
 *   - `media/<id>.<ext>` = game-video **自产**的图/视频二进制
 *
 * 前端（media.ts）与后端（src/server/asset-registry.ts + generation）都
 * 从本文件取类型：前端负责渲染/轮询，后端负责 fs CRUD。跨模块产物（人设图/场景图）
 * **只读引用**，文件仍在对方目录、不复制进本 registry（externalPath 指回原路径）。
 */

/**
 * 资产的存储类别（对齐 NodeMedia.kind 的大类）。
 * `audio` = 床轨/音效（BGM SPEC 决策 A：音频并进本 manifest，与 video/image 同 resolve；
 * **不**以 bgm 的 `audio/manifest.json` 为 play 路径 SSOT）。
 */
export type MediaKind = 'image' | 'video' | 'audio'

/**
 * 资产用途（决定它在生成管线里的角色）——判断"这条资产是什么"永远看 productionType：
 *   - character_ref / scene_ref：**跨模块只读输入**（人设图 / 场景图），当视频参考图。
 *   - shot_image：game-video 自产的分镜图 / 关键帧。
 *   - grid_storyboard：game-video 自产的 6 面板黑白 previs 故事板（关键帧的可选替代分支）。
 *   - video_clip：game-video 自产的成片视频（node.data.media.ref 指它）。
 *   - audio_track：音频成品或生成的音轨。
 */
export type MediaProductionType =
  | 'character_ref'
  | 'scene_ref'
  | 'shot_image'
  | 'grid_storyboard'
  | 'video_clip'
  | 'audio_track'

/** 生成生命周期。placeholder = 已占位未生成；generating = 生成中；ready = 就绪；failed = 失败。 */
export type MediaStatus = 'placeholder' | 'generating' | 'ready' | 'failed'

/** 可安全写入 manifest 的 JSON 值；生成器私有参数不得逃逸为函数、Date 或 URL 对象。 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/**
 * 生成配方引用的输入资产。只登记本项目的稳定 asset id，避免持久化临时 URL 或磁盘路径。
 */
export interface AssetRecipeInput {
  assetId: string
  role: string
}

/**
 * 任意媒体/文档的可复用生成配方。
 *
 * 提示词继续住在记录既有的顶层 `prompt`；parameters 只记录其余已经脱敏的最终请求参数。
 */
export interface AssetRecipe {
  version: 1
  inputs?: AssetRecipeInput[]
  parameters: { [key: string]: JsonValue }
}

/**
 * 记录资产如何进入项目。storage provider 与来源动作不同：前者负责读取二进制，
 * 后者用于决定是否能重放生成配方、删除源副本等业务语义。
 */
export interface AssetProvenance {
  origin: 'upload' | 'generation' | 'import' | 'derived'
  source?: {
    module?: string
    assetId?: string
  }
  recipe?: AssetRecipe
}

export interface MediaProviderMapping {
  kind: 'local' | 's3' | 'cos' | 'kino'
  ref: string
  upstreamResourceId?: string
}

export interface MediaAsset {
  id: string
  kind: MediaKind
  productionType: MediaProductionType
  status: MediaStatus
  /** 展示名（缺省由 productionType + id 兜底）。 */
  label?: string
  /** Provider-backed manifests use this display-name alias. */
  name?: string
  /** 生成用/记录用 prompt。 */
  prompt?: string
  /**
   * 自产资产：相对 `assets/` 根的磁盘路径（如 `media/a-xxx.mp4`）。就绪后必有。
   * 播放 URL 由前端 resolveMediaSrc 通过宿主绑定的 media capability 派生，不直接暴露磁盘路径。
   */
  file?: string
  /**
   * 稳定可播放访问地址（D8 目标态）：一旦上传能力就绪，成片以稳定 `url` 登记，
   * 播放优先用它（`resolveMediaSrc` 见 media.ts 优先序）；在此之前为空，回落 D9 兜底
   * （zhandou basename / 宿主绑定的 media content 流）。graph/blueprint 只挂 id，URL 只住 manifest。
   */
  url?: string
  /** 跨模块只读产物：对方文件的绝对磁盘路径（**不复制**进本 registry 的 media/）。 */
  externalPath?: string
  /** 共享上传服务管理的存储映射；读取内容必须走服务端 content API。 */
  provider?: MediaProviderMapping
  /** 归属的演出节点 id（GameGraph node.id）；跨模块 ref 可空。 */
  sceneNodeId?: string
  /** 产出来源：'game-video' | 'character' | '<scene-module>' 等。 */
  sourceModule?: string
  mime?: string
  /** Provider-backed manifests use this MIME alias. */
  mimeType?: string
  bytes?: number
  /** 视频时长（ms）。 */
  durationMs?: number
  /** status=failed 时的可读原因。 */
  error?: string
  createdAt: number
  updatedAt: number
  /** 其它元信息（如 refIds / seed / model / keyframeRole 等）。 */
  meta?: Record<string, unknown>
  /**
   * 可选的、版本化的来源和生成配方。缺省代表旧 manifest 记录，必须保持可读。
   */
  provenance?: AssetProvenance
}

/** 其它资产域拥有的记录。registry 必须原样保留，但不会把它们暴露为 MediaAsset。 */
export interface ForeignAssetRecord {
  id: string
  kind: string
  [key: string]: unknown
}

/** 项目叙事文档类别；正文落在游戏根 `docs/`，由 manifest 登记。 */
export type DocumentType = 'intake' | 'design-options' | 'core' | 'inquiry' | 'pillar'

/**
 * 只读项目文档登记项。正文由 provider.ref 指向相对游戏根的 Markdown 文件；
 * 它与 MediaAsset 共享 manifest，但不能被媒体列表、生成或播放链路消费。
 */
export interface DocumentRecord {
  id: string
  kind: 'document'
  name: string
  status: 'ready'
  mimeType: 'text/markdown'
  provider: {
    kind: 'local'
    ref: string
  }
  createdAt: number
  updatedAt: number
  meta: {
    documentType: DocumentType
  }
  /** 文档生成、导入或上传来源；不影响现有 docs/ 文件定位。 */
  provenance?: AssetProvenance
}

/**
 * 风格三轴（reel）—— 游戏级默认，node 可覆盖。
 * 字段是各轴的 id 字符串（保持 registry-types 零依赖，不引 engine 的 VisualStyle/FilmLook/DirectorStyleId union）；
 * orchestrate 侧的 engine/axes.ts 负责把这些 id 收敛成合法 union 并组合成 prompt。
 *   - artMedia：渲染媒介（photoreal/anime/ink/...，reel art-media 轴）
 *   - director：导演流派（minimal-epic/precision-noir/...，reel directors 轴）
 *   - filmLook：电影调色（teal-orange/noir-lowkey/...，reel film-looks 轴）
 */
export interface StyleAxes {
  artMedia?: string
  director?: string
  filmLook?: string
}

/**
 * 资产浏览器的项目级目录元数据。
 *
 * 云端对象仍由 Kino/COS 持有；这里仅记录文件夹与资源在浏览器中的归位。
 * 一级类型根目录由前端固定规则派生，永远不作为 folder 记录写入。
 */
export type AssetLibraryRootKind =
  | 'image'
  | 'video'
  | 'control'
  | 'sound'
  | 'audio'
  | 'character'
  | 'scene'
  | 'font'

export interface AssetLibraryFolder {
  id: string
  parentId?: string
  name: string
  rootKind: AssetLibraryRootKind
  createdAt: number
  updatedAt: number
}

export interface AssetLibraryState {
  version: 1
  folders: AssetLibraryFolder[]
  placements: Record<string, string>
}

/** Manifest-backed business asset identities. Generated media remains in `assets`. */
export type CatalogEntityKind =
  | 'character'
  | 'scene'
  | 'video'
  | 'icon'
  | 'control'
  | 'audio'
  | 'font'

export interface CatalogAssetRef {
  assetId: string
}

export interface CatalogHistoryItem extends CatalogAssetRef {
  appliedAt: number
  source?: 'generate' | 'upload' | 'select' | 'copy'
  note?: string
}

/**
 * Where a catalog entity entered the project.
 * - `outline`: declared by blueprint outline / modeling (counts toward work-scale).
 * - `catalog`: ad-hoc asset-library only (post-delivery or assets.scene); not bound to nodes.
 */
export type CatalogEntitySource = 'outline' | 'catalog'

/**
 * Stable business entity stored in `assetCatalog.entities`.
 *
 * `current` is intentionally optional: modeling creates the entity before an
 * image exists. `description` and `prompt` are the current production inputs;
 * the immutable prompt actually used for an output still lives on that asset.
 */
export interface CatalogEntity {
  id: string
  name: string
  summary?: string
  description?: string
  prompt?: string
  /** Optional link from a screen character to a runtime rule entity. */
  entityId?: string
  /** Absent / outline = production-scale entity; catalog = library-only. */
  source?: CatalogEntitySource
  current?: CatalogAssetRef
  history: CatalogHistoryItem[]
  createdAt: number
  updatedAt: number
}

/** Node ids are blueprint-local, so Catalog identity must include both scopes. */
export function nodeVideoEntityId(target: { blueprintId: string; nodeId: string; graphPath?: readonly string[] }): string {
  const scope = target.graphPath?.length ? `${target.graphPath.map((segment) => encodeURIComponent(segment)).join('/')}:` : ''
  return `node:${encodeURIComponent(target.blueprintId)}:${scope}${encodeURIComponent(target.nodeId)}`
}

/** Recover the node binding encoded by nodeVideoEntityId for asset-entry apply actions. */
export function nodeVideoTargetFromEntityId(
  entityId: string,
): { blueprintId: string; nodeId: string; graphPath?: string[] } | undefined {
  if (!entityId.startsWith('node:')) return undefined
  const encoded = entityId.slice('node:'.length)
  const separator = encoded.indexOf(':')
  if (separator <= 0 || separator === encoded.length - 1) return undefined
  const blueprintId = decodeEntityIdPart(encoded.slice(0, separator))
  const scopedNode = encoded.slice(separator + 1)
  const lastSeparator = scopedNode.lastIndexOf(':')
  const encodedPath = lastSeparator >= 0 ? scopedNode.slice(0, lastSeparator) : ''
  const encodedNodeId = lastSeparator >= 0 ? scopedNode.slice(lastSeparator + 1) : scopedNode
  const nodeId = decodeEntityIdPart(encodedNodeId)
  if (!blueprintId || !nodeId) return undefined
  const graphPath = encodedPath ? encodedPath.split('/').map(decodeEntityIdPart) : []
  if (graphPath.some((segment) => !segment)) return undefined
  return { blueprintId, nodeId, ...(graphPath.length ? { graphPath } : {}) }
}

function decodeEntityIdPart(value: string): string {
  try { return decodeURIComponent(value) } catch { return '' }
}

/** Character modeling input owned by the manifest asset domain. */
export interface CharacterDefinition {
  id: string
  name: string
  entityId?: string
  summary?: string
  appearance: { description: string; previewPrompt: string }
  currentAssetId?: string
}

/** Scene modeling input owned by the manifest asset domain. */
export interface SceneDefinition {
  id: string
  name: string
  summary?: string
  visual: { description: string; previewPrompt: string }
  currentAssetId?: string
  /** Absent / outline = work-scale; catalog = asset-library only. */
  source?: CatalogEntitySource
}

/** Video modeling / preset input owned by the manifest asset domain. */
export interface VideoDefinition {
  id: string
  name: string
  summary?: string
  description?: string
  prompt?: string
  currentAssetId?: string
  /** Absent / outline = work-scale; catalog = asset-library only. */
  source?: CatalogEntitySource
}

export interface AssetCatalogState {
  version: 1
  folders: unknown[]
  placements: Record<string, unknown>
  entities: Record<CatalogEntityKind, Record<string, CatalogEntity>>
  [key: string]: unknown
}

/** manifest.json 顶层容器。 */
export interface AssetManifest {
  version: 2
  assets: Array<MediaAsset | DocumentRecord | ForeignAssetRecord>
  /** 游戏级风格三轴默认（可选）；缺省=各轴不加。 */
  styleAxes?: StyleAxes
  /** 资产浏览器的文件夹和资源归位元数据。 */
  assetLibrary?: AssetLibraryState
  /** 业务资产实体、目录和当前资源绑定的唯一事实源。 */
  assetCatalog?: AssetCatalogState
  [key: string]: unknown
}

/** 前端渲染友好的轻量视图（列表/卡片用）。 */
export interface AssetListItem {
  id: string
  kind: MediaKind
  productionType: MediaProductionType
  status: MediaStatus
  label?: string
  sceneNodeId?: string
  durationMs?: number
  bytes?: number
  mime?: string
}

/** 生成不可变、与资产类别无关的 registry id；分类永远由 productionType 判定。 */
export function makeAssetId(): string {
  const t = Date.now().toString(36)
  const r = Math.random().toString(36).slice(2, 14)
  return `asset_${t}_${r}`
}

/** MediaAsset → 轻量视图。 */
export function toListItem(a: MediaAsset): AssetListItem {
  return {
    id: a.id,
    kind: a.kind,
    productionType: a.productionType,
    status: a.status,
    label: a.label,
    sceneNodeId: a.sceneNodeId,
    durationMs: a.durationMs,
    bytes: a.bytes,
    mime: a.mime,
  }
}
