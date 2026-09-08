import type {
  MediaAsset,
  MediaUpdateInput,
  ResumableMediaCapability,
} from '@forgeax/extension-host/contracts'
import type {
  ExtensionContext,
  ExtensionRouter,
  ExtensionRouterRequest,
  ExtensionRouterResponse,
} from '@forgeax/extension-host/node'
import {
  createHostAssetRegistry,
  semanticallyRegisteredResourceIds,
  getHostStyleAxes,
  healMissingDocuments,
  readHostDocument,
} from '../asset-registry'
import { bundledMediaResponse, type BundledMediaResolver } from './media-routes'
import { VideoPromptPolishError } from '../generation/prompt-polish'
import {
  createGameVideoService,
  getAssetIdFromArgs,
  ExtensionServiceInputError,
} from './extension-service'
import { GAME_VIDEO_POST_SERVICE_ROUTES } from './http-routes'
import { WorkflowStateError } from './workflow-state'
import {
  ComponentAuthoringConflictError,
  ComponentAuthoringInputError,
  deleteAuthoredComponent,
} from './component-authoring'
import { bindNodeKinoReferences } from './node-production-context'
import { KINO_DEFAULT_IMAGE_MODEL, KINO_IMAGE_SIZES } from '@/runtime/core/schema/kino-image-schema'

export { GAME_VIDEO_HTTP_ROUTES, GAME_VIDEO_POST_SERVICE_ROUTES } from './http-routes'
export type { GameVideoHttpRoute, GameVideoServiceMethod } from './http-routes'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const ASSET_CATALOG_CAPABILITY_ID = 'game-video.asset-catalog'
const ASSET_CATALOG_CAPABILITY_VERSION = 2
const KINO_AUDIO_WAVEFORM_HOSTS = new Set(['www.zaohuacdn.cn'])
const MAX_AUDIO_WAVEFORM_BYTES = 25 * 1024 * 1024

class AssetCatalogCapabilityError extends Error {
  constructor(readonly code: string, message: string, readonly status = 503) {
    super(message)
  }
}

function jsonResponse(
  status: number,
  value: unknown,
): ExtensionRouterResponse {
  const body = encoder.encode(JSON.stringify(value))
  return {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-length': String(body.byteLength),
      'content-type': 'application/json; charset=utf-8',
    },
    body,
  }
}

function mediaResponse(value: unknown): ExtensionRouterResponse {
  return jsonResponse(200, { code: 0, message: 'ok', data: value })
}

function binaryResponse(
  status: number,
  contentType: string,
  body: Uint8Array,
): ExtensionRouterResponse {
  return {
    status,
    headers: {
      'cache-control': 'private, no-store',
      'content-length': String(body.byteLength),
      'content-type': contentType,
    },
    body,
  }
}

function kinoAudioWaveformUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ExtensionServiceInputError('audio URL is invalid')
  }
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.port
    || !KINO_AUDIO_WAVEFORM_HOSTS.has(url.hostname)
    || !url.pathname.startsWith('/kino/assets/')
    || !/\.(?:mp3|wav)$/i.test(url.pathname)
  ) {
    throw new ExtensionServiceInputError('audio URL is not an allowed Kino CDN asset')
  }
  return url
}

async function audioWaveformResponse(
  request: ExtensionRouterRequest,
): Promise<ExtensionRouterResponse> {
  const query = exactQuery(request.query, ['url'])
  const url = kinoAudioWaveformUrl(stringValue(query.url, 'url'))
  const response = await fetch(url, {
    headers: { accept: 'audio/mpeg,audio/wav;q=0.9' },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (!response.ok || !contentType?.startsWith('audio/') || (contentLength > MAX_AUDIO_WAVEFORM_BYTES)) {
    return jsonResponse(502, {
      ok: false,
      error: { code: 'audio_waveform_unavailable', message: 'Audio waveform source is unavailable' },
    })
  }
  const body = new Uint8Array(await response.arrayBuffer())
  if (body.byteLength > MAX_AUDIO_WAVEFORM_BYTES) {
    return jsonResponse(413, {
      ok: false,
      error: { code: 'audio_waveform_too_large', message: 'Audio waveform source is too large' },
    })
  }
  return binaryResponse(200, contentType, body)
}

function notFound(): ExtensionRouterResponse {
  return jsonResponse(404, {
    ok: false,
    error: {
      code: 'not_found',
      target: 'game-video',
      message: 'Not Found',
      retryable: false,
    },
  })
}

function documentSummary(document: {
  id: string
  name: string
  updatedAt: number
  meta: { documentType: string }
}) {
  return {
    id: document.id,
    name: document.name,
    documentType: document.meta.documentType,
    updatedAt: document.updatedAt,
  }
}

function header(
  request: ExtensionRouterRequest,
  name: string,
): string | undefined {
  const target = name.toLowerCase()
  for (const [key, values] of Object.entries(request.headers)) {
    if (key.toLowerCase() === target) return values[0]
  }
  return undefined
}

function pathParts(rawPath: string): string[] | null {
  const path = rawPath.replace(/^\/+|\/+$/g, '')
  if (!path) return []
  const parts: string[] = []
  for (const rawPart of path.split('/')) {
    let part: string
    try {
      part = decodeURIComponent(rawPart)
    } catch {
      return null
    }
    if (
      !part
      || part === '.'
      || part === '..'
      || part.includes('/')
      || part.includes('\\')
    ) {
      return null
    }
    parts.push(part)
  }
  return parts
}

function jsonBody(request: ExtensionRouterRequest): unknown {
  if (request.body.byteLength === 0) return {}
  const contentType = header(request, 'content-type')
  const mediaType = contentType?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    throw new ExtensionServiceInputError('Request body must be application/json')
  }
  try {
    return JSON.parse(decoder.decode(request.body)) as unknown
  } catch {
    throw new ExtensionServiceInputError('Request body is invalid JSON')
  }
}

function exactQuery(
  query: Readonly<Record<string, readonly string[]>>,
  allowed: readonly string[],
): Record<string, string> {
  const allowedKeys = new Set(allowed)
  const result: Record<string, string> = {}
  for (const [name, values] of Object.entries(query)) {
    if (!allowedKeys.has(name)) {
      throw new ExtensionServiceInputError(`Query contains unsupported key: ${name}`)
    }
    if (values.length !== 1 || values[0] === undefined) {
      throw new ExtensionServiceInputError(`Query key must have exactly one value: ${name}`)
    }
    result[name] = values[0]
  }
  return result
}

function parsePositiveInteger(value: string | undefined, label: string, allowZero = false): number {
  if (value === undefined || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new ExtensionServiceInputError(`${label} is invalid`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || (allowZero ? parsed < 0 : parsed < 1)) {
    throw new ExtensionServiceInputError(`${label} is invalid`)
  }
  return parsed
}

function record(value: unknown, label = 'Request body'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExtensionServiceInputError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ExtensionServiceInputError(`${label} is invalid`)
  }
  return value
}

async function invokeAssetCatalogCapability(
  context: ExtensionContext,
  operation: 'list' | 'history' | AssetCatalogOperation,
  input: Record<string, unknown>,
): Promise<unknown> {
  const invoke = context.capabilities?.invoke
  if (typeof invoke !== 'function') {
    throw new AssetCatalogCapabilityError('asset_catalog_capability_unavailable', 'The current host does not provide game-video asset catalog operations')
  }
  try {
    return await invoke.call(
      context.capabilities,
      `${ASSET_CATALOG_CAPABILITY_ID}.${operation}`,
      ASSET_CATALOG_CAPABILITY_VERSION,
      input,
      typeof input.operationId === 'string' ? { requestId: input.operationId } : undefined,
    )
  } catch (cause) {
    const known = cause as { code?: unknown, message?: unknown, retryable?: unknown }
    if (typeof known?.code === 'string') {
      throw new AssetCatalogCapabilityError(
        known.code,
        typeof known.message === 'string' ? known.message : 'Asset catalog operation failed',
        known.code === 'revision_conflict' ? 409 : 422,
      )
    }
    throw new AssetCatalogCapabilityError('asset_catalog_capability_failed', cause instanceof Error ? cause.message : 'Asset catalog operation failed')
  }
}

const ASSET_CATALOG_OPERATIONS = [
  'upsert-asset', 'apply', 'place', 'delete', 'register-generated',
  'create-folder', 'rename-folder', 'move-folder', 'delete-folder',
  'rename-asset', 'move-asset', 'delete-asset', 'delete-assets',
  'rename-entity', 'delete-entity',
] as const

type AssetCatalogOperation = typeof ASSET_CATALOG_OPERATIONS[number]

function assetCatalogOperation(value: unknown): AssetCatalogOperation {
  const operation = stringValue(value, 'operation')
  const match = ASSET_CATALOG_OPERATIONS.find((candidate) => candidate === operation)
  if (match) return match
  throw new ExtensionServiceInputError('assetCatalog operation is invalid')
}

const IMAGE_TARGET_ROOTS = ['image', 'icon', 'control', 'character', 'scene'] as const
type ImageTargetRoot = typeof IMAGE_TARGET_ROOTS[number]

function imageTargetRoot(value: unknown): ImageTargetRoot {
  if (IMAGE_TARGET_ROOTS.some((candidate) => candidate === value)) return value as ImageTargetRoot
  throw new ExtensionServiceInputError('targetRoot is invalid')
}

function kinoRegistryId(generationId: string): string {
  const canonical = generationId.trim()
  if (!canonical) throw new ExtensionServiceInputError('generationId cannot be mapped to an asset id')
  return `asset_kino_${encodeURIComponent(canonical)}`
}

function assertActiveGame(context: ExtensionContext, value: unknown): void {
  if (value !== undefined && value !== context.gameId) {
    throw new ExtensionServiceInputError('game_id must match the active Extension game')
  }
}

function resumableMedia(context: ExtensionContext): ResumableMediaCapability {
  const media = context.media as Partial<ResumableMediaCapability>
  for (const method of [
    'update',
    'createUpload',
    'getUpload',
    'writeUploadChunk',
    'completeUpload',
  ] as const) {
    if (typeof media[method] !== 'function') {
      throw new ExtensionServiceInputError('Extension media uploads are not supported')
    }
  }
  return context.media as ResumableMediaCapability
}

function mediaTimestamp(asset: MediaAsset, field: 'created_at' | 'updated_at'): number {
  const value = asset.metadata?.[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * 排除已被 registry 语义登记的受控媒体。
 *
 * 判定依据只能是「参考图指向哪个资源 id」，不能靠文件名或标签猜：
 * 猜错会把用户手动上传的普通图片藏起来，那比重复显示更糟。
 */
async function excludeSemanticallyRegistered(
  context: ExtensionContext,
  assets: readonly MediaAsset[],
): Promise<MediaAsset[]> {
  const claimed = await semanticallyRegisteredResourceIds(context.files).catch(() => new Set<string>())
  return assets.filter((asset) => !claimed.has(asset.id))
}

function kinoResource(context: ExtensionContext, asset: MediaAsset): Record<string, unknown> {
  const metadata = asset.metadata ?? {}
  const sourceMetaKeys = [
    'task_id', 'prompt', 'model', 'seed', 'width', 'height', 'duration_ms',
  ] as const
  const sourceMeta = Object.fromEntries(
    sourceMetaKeys.flatMap((key) => metadata[key] === undefined ? [] : [[key, metadata[key]]]),
  )
  const reserved = new Set([
    ...sourceMetaKeys, 'type', 'remark', 'source', 'created_at', 'updated_at',
  ])
  const extra = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !reserved.has(key)),
  )
  return {
    resource_id: asset.id,
    game_id: context.gameId,
    media_type: asset.type,
    name: asset.filename ?? asset.id,
    type: asset.metadata?.type ?? 'OTHER',
    remark: asset.metadata?.remark,
    url: asset.url,
    source: asset.metadata?.source ?? 'extension-host',
    source_meta: {
      mime_type: asset.contentType,
      ...sourceMeta,
      extra: {
        ...extra,
        ...(asset.sizeBytes === undefined ? {} : { bytes: asset.sizeBytes }),
      },
    },
    created_at: mediaTimestamp(asset, 'created_at'),
    updated_at: mediaTimestamp(asset, 'updated_at'),
  }
}

async function mediaAsset(
  context: ExtensionContext,
  assetId: string,
): Promise<MediaAsset | undefined> {
  return (await context.media.list(context.gameId)).find((asset) => asset.id === assetId)
}

function uploadIdFromObjectUrl(value: unknown): string {
  const objectUrl = stringValue(value, 'url')
  if (!objectUrl.startsWith('extension-upload:')) {
    throw new ExtensionServiceInputError('url must identify a Extension upload')
  }
  return stringValue(objectUrl.slice('extension-upload:'.length), 'upload id')
}

async function completeHostResource(
  context: ExtensionContext,
  rawInput: unknown,
): Promise<MediaAsset> {
  const input = record(rawInput)
  assertActiveGame(context, input.game_id)
  const uploadId = uploadIdFromObjectUrl(input.url)
  let asset = await resumableMedia(context).completeUpload(context.gameId, uploadId)
  const metadata: Record<string, unknown> = {
    ...(record(input.source_meta ?? {}, 'source_meta')),
    ...(input.type === undefined ? {} : { type: input.type }),
    ...(input.source === undefined ? {} : { source: input.source }),
  }
  const update: MediaUpdateInput = {
    ...(typeof input.name === 'string' ? { filename: input.name } : {}),
    metadata,
  }
  asset = await resumableMedia(context).update(context.gameId, asset.id, update) ?? asset
  return asset
}

async function handleHostMedia(
  context: ExtensionContext,
  request: ExtensionRouterRequest,
  parts: readonly string[],
): Promise<ExtensionRouterResponse | undefined> {
  if (parts[0] !== 'media') return undefined
  const method = request.method.toUpperCase()
  const path = parts.join('/')

  if (method === 'GET' && parts.length === 3 && parts[1] === 'assets') {
    const query = exactQuery(request.query, ['gameId'])
    assertActiveGame(context, query.gameId)
    const body = await context.media.read(context.gameId, parts[2]!)
    return body ? binaryResponse(200, body.contentType, body.bytes) : notFound()
  }

  if (method === 'GET' && path === 'media/capabilities') {
    exactQuery(request.query, [])
    return mediaResponse({
      provider: 'kino',
      media_types: ['image', 'video', 'audio'],
      upload_mimes: [
        'video/mp4', 'image/png', 'image/jpeg', 'image/webp',
        'audio/mpeg', 'audio/wav',
      ],
    })
  }

  if (method === 'GET' && path === 'media/resources') {
    const query = exactQuery(request.query, [
      'game_id', 'media_type', 'page', 'page_size', 'type', 'exclude_registered',
    ])
    assertActiveGame(context, query.game_id)
    const page = query.page === undefined ? 1 : parsePositiveInteger(query.page, 'page')
    const pageSize = query.page_size === undefined
      ? 20
      : parsePositiveInteger(query.page_size, 'page_size')
    if (pageSize > 100) throw new ExtensionServiceInputError('page_size is invalid')
    const assets = await context.media.list(context.gameId, {
      ...(query.media_type === undefined ? {} : {
        type: stringValue(query.media_type, 'media_type') as MediaAsset['type'],
      }),
    })
    const byType = query.type === undefined
      ? assets
      : assets.filter((asset) => asset.metadata?.type === query.type)
    // 语义化产物（角色图 / 场景图）已经由 registry 登记并归到「角色」「场景」根下。
    // 通用图片池若不排除它们，同一张图会出现两次，而且「图片」根还会提供一个
    // 绕过 registry 的删除入口——删掉底层资源会让角色卡变成空图（设计 §10.9.4 B）。
    const filtered = query.exclude_registered === 'true'
      ? await excludeSemanticallyRegistered(context, byType)
      : byType
    const start = (page - 1) * pageSize
    return mediaResponse({
      items: filtered.slice(start, start + pageSize).map((asset) => kinoResource(context, asset)),
      total: filtered.length,
      page,
      page_size: pageSize,
    })
  }

  if (method === 'POST' && path === 'media/image-assets/upload') {
    exactQuery(request.query, [])
    const input = record(jsonBody(request))
    assertActiveGame(context, input.game_id)
    const filename = stringValue(input.file_name, 'file_name')
    const contentType = stringValue(input.mime_type, 'mime_type')
    const sizeBytes = input.bytes
    if (!Number.isSafeInteger(sizeBytes) || (sizeBytes as number) <= 0) {
      throw new ExtensionServiceInputError('bytes is invalid')
    }
    const upload = await resumableMedia(context).createUpload(context.gameId, {
      filename,
      contentType,
      sizeBytes: sizeBytes as number,
      ...(typeof input.client_resource_id === 'string'
        ? { idempotencyKey: `replace:${input.client_resource_id}` }
        : {}),
    })
    // Extension Host bounds every extension HTTP request body to 1 MiB.
    // Keep resumable chunks within that transport contract; a larger chunk is
    // cancelled by the Hono adapter before it reaches writeUploadChunk.
    const chunkSize = Math.min(1024 * 1024, upload.sizeBytes)
    return mediaResponse({
      upload: {
        method: 'PUT',
        url: `/media/uploads/${encodeURIComponent(upload.id)}`,
        headers: {},
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        chunk_size: chunkSize,
        chunk_count: Math.ceil(upload.sizeBytes / chunkSize),
      },
      object_url: `extension-upload:${upload.id}`,
      upload_token: upload.id,
    })
  }

  if (method === 'PUT' && parts.length === 3 && parts[1] === 'uploads') {
    exactQuery(request.query, [])
    const offsetHeader = header(request, 'upload-offset')
    const offset = parsePositiveInteger(offsetHeader, 'upload-offset', true)
    const upload = await resumableMedia(context).writeUploadChunk(
      context.gameId,
      parts[2]!,
      { offset, bytes: request.body },
    )
    if (!upload) return notFound()
    return mediaResponse(upload)
  }

  if (method === 'POST' && path === 'media/resources') {
    exactQuery(request.query, [])
    const asset = await completeHostResource(context, jsonBody(request))
    return mediaResponse(kinoResource(context, asset))
  }

  if (method === 'POST' && path === 'media/resources/batch') {
    exactQuery(request.query, [])
    const input = record(jsonBody(request))
    assertActiveGame(context, input.game_id)
    if (!Array.isArray(input.resources)) {
      throw new ExtensionServiceInputError('resources must be an array')
    }
    const completed = await Promise.all(input.resources.map((resource) => (
      completeHostResource(context, {
        ...record(resource, 'resource'),
        game_id: context.gameId,
      })
    )))
    const unique = new Map(completed.map((asset) => [asset.id, asset]))
    return mediaResponse({
      created_count: unique.size,
      skipped_count: completed.length - unique.size,
      items: [...unique.values()].map((asset) => kinoResource(context, asset)),
    })
  }

  if (parts.length >= 3 && parts[1] === 'resources') {
    const assetId = parts[2]!
    if (parts.length === 4 && parts[3] === 'content' && method === 'GET') {
      const query = exactQuery(request.query, ['game_id', 'v'])
      assertActiveGame(context, query.game_id)
      const body = await context.media.read(context.gameId, assetId)
      return body ? binaryResponse(200, body.contentType, body.bytes) : notFound()
    }
    if (parts.length !== 3) return undefined
    const query = exactQuery(request.query, ['game_id'])
    assertActiveGame(context, query.game_id)
    if (method === 'GET') {
      const asset = await mediaAsset(context, assetId)
      return asset ? mediaResponse(kinoResource(context, asset)) : notFound()
    }
    if (method === 'PUT') {
      const input = record(jsonBody(request))
      assertActiveGame(context, input.game_id)
      const metadata = record(input.source_meta ?? {}, 'source_meta')
      const asset = await resumableMedia(context).update(context.gameId, assetId, {
        ...(typeof input.name === 'string' ? { filename: input.name } : {}),
        metadata: {
          ...metadata,
          ...(input.type === undefined ? {} : { type: input.type }),
          ...(input.source === undefined ? {} : { source: input.source }),
        },
      })
      return asset ? mediaResponse(kinoResource(context, asset)) : notFound()
    }
    if (method === 'DELETE') {
      await context.media.delete(context.gameId, assetId)
      return mediaResponse(null)
    }
  }
  return undefined
}

/**
 * Creates the transport-neutral extension router. Framework adapters remain
 * host responsibilities and receive these status/headers/body values verbatim.
 *
 * Route inventory SSOT: `./http-routes.ts`.
 */
export function createGameVideoRouter(
  context: ExtensionContext,
  options: { bundledMediaResolver?: BundledMediaResolver } = {},
): ExtensionRouter {
  const service = createGameVideoService(context)

  return {
    async handle(request) {
      try {
        const parts = pathParts(request.path)
        if (!parts) return notFound()
        const method = request.method.toUpperCase()
        const path = parts.join('/')

        if (method === 'GET' && path === 'media/audio-waveform') {
          return await audioWaveformResponse(request)
        }

        const hostMediaResponse = await handleHostMedia(context, request, parts)
        if (hostMediaResponse) return hostMediaResponse

        if (method === 'GET' && path === 'assets') {
          const query = exactQuery(request.query, [
            'kind', 'productionType', 'sceneNodeId',
          ])
          return jsonResponse(200, await service.listAssets(query))
        }
        if (method === 'GET' && path === 'documents') {
          exactQuery(request.query, [])
          return jsonResponse(200, {
            documents: (await healMissingDocuments(context)).map(documentSummary),
          })
        }
        if (method === 'GET' && path === 'workflow-state') {
          exactQuery(request.query, [])
          return jsonResponse(200, await service.getWorkflowState({}))
        }
        if (method === 'GET' && path === 'node-production-context') {
          const query = exactQuery(request.query, ['blueprintId', 'nodeId'])
          return jsonResponse(200, await service.getNodeProductionContext({
            blueprintId: stringValue(query.blueprintId, 'blueprintId'),
            nodeId: stringValue(query.nodeId, 'nodeId'),
          }))
        }
        if (method === 'POST' && path === 'node-production-context/kino-references') {
          exactQuery(request.query, [])
          const body = jsonBody(request) as {
            blueprintId?: unknown
            nodeId?: unknown
            assetMappings?: unknown
          }
          if (!Array.isArray(body.assetMappings)) {
            throw new ExtensionServiceInputError('assetMappings must be an array')
          }
          return jsonResponse(200, await bindNodeKinoReferences(context, {
            blueprintId: stringValue(body.blueprintId, 'blueprintId'),
            nodeId: stringValue(body.nodeId, 'nodeId'),
            assetMappings: body.assetMappings.map((value) => {
              const item = value as Record<string, unknown>
              if (typeof item?.assetId !== 'string' || typeof item.resourceId !== 'string') {
                throw new ExtensionServiceInputError('asset mapping is invalid')
              }
              return { assetId: item.assetId, resourceId: item.resourceId }
            }),
          }))
        }
        if (method === 'GET' && path === 'author-gates/pillar/proposal') {
          exactQuery(request.query, [])
          return jsonResponse(200, await service.getPillarAuthorGateProposal({}))
        }
        if (
          method === 'GET'
          && parts.length === 2
          && parts[0] === 'documents'
        ) {
          exactQuery(request.query, [])
          await healMissingDocuments(context)
          const document = await readHostDocument(context, parts[1]!)
          if (!document) return notFound()
          return jsonResponse(200, {
            document: documentSummary(document.document),
            content: document.content,
          })
        }
        if (
          method === 'DELETE'
          && parts.length === 2
          && parts[0] === 'components'
        ) {
          exactQuery(request.query, [])
          return jsonResponse(200, await deleteAuthoredComponent(context, parts[1]!))
        }
        if (method === 'GET' && path === 'asset-catalog') {
          exactQuery(request.query, [])
          return jsonResponse(200, await invokeAssetCatalogCapability(context, 'list', {}))
        }
        if (method === 'GET' && path === 'asset-catalog/history') {
          const query = exactQuery(request.query, ['tabKind', 'entityId'])
          return jsonResponse(200, await invokeAssetCatalogCapability(context, 'history', {
            tabKind: stringValue(query.tabKind, 'tabKind'),
            entityId: stringValue(query.entityId, 'entityId'),
          }))
        }
        if (method === 'POST' && path === 'asset-catalog') {
          exactQuery(request.query, [])
          const body = record(jsonBody(request))
          const operation = assetCatalogOperation(body.operation)
          const { operation: _operation, ...input } = body
          return jsonResponse(200, await invokeAssetCatalogCapability(context, operation, input))
        }
        if (method === 'POST' && path === 'generation/image/lifecycle') {
          exactQuery(request.query, [])
          const body = record(jsonBody(request))
          const generationId = stringValue(body.generationId, 'generationId')
          const targetRoot = imageTargetRoot(body.targetRoot)
          const status = body.status
          if (status !== 'generating' && status !== 'ready' && status !== 'failed') {
            throw new ExtensionServiceInputError('status is invalid')
          }
          const prompt = stringValue(body.prompt, 'prompt')
          const resourceId = typeof body.resourceId === 'string' && body.resourceId.trim()
            ? body.resourceId.trim()
            : undefined
          const resultUrl = typeof body.resultUrl === 'string' && body.resultUrl.trim()
            ? body.resultUrl.trim()
            : undefined
          const entityId = typeof body.entityId === 'string' && body.entityId.trim()
            ? body.entityId.trim()
            : undefined
          const characterId = typeof body.characterId === 'string' && body.characterId.trim()
            ? body.characterId.trim()
            : undefined
          const displayName = stringValue(body.displayName, 'displayName')
          const placementTarget = stringValue(body.placementTarget, 'placementTarget')
          const model = typeof body.model === 'string' && body.model.trim()
            ? body.model.trim()
            : KINO_DEFAULT_IMAGE_MODEL
          const size = typeof body.size === 'string' && (KINO_IMAGE_SIZES as readonly string[]).includes(body.size)
            ? body.size
            : undefined
          const visualStyleKey = typeof body.visualStyleKey === 'string' && body.visualStyleKey.trim()
            ? body.visualStyleKey.trim()
            : undefined
          const parameters = record(body.parameters)
          const assetId = kinoRegistryId(generationId)
          const semanticTarget = status === 'ready' && resourceId && (
            (targetRoot === 'character' && characterId)
            || (targetRoot === 'scene' && entityId)
          )
          if (semanticTarget) {
            return jsonResponse(200, await service.registerKinoReference({
              registryId: assetId,
              kinoResourceId: resourceId,
              kinoGenerationId: generationId,
              productionType: targetRoot === 'character' ? 'character_ref' : 'scene_ref',
              ...(targetRoot === 'character' ? { characterId } : { sceneId: entityId }),
              prompt,
              model,
              ...(size ? { size } : {}),
              ...(visualStyleKey ? { visualStyleKey } : {}),
            }))
          }
          if (status === 'ready' && (!resourceId || !resultUrl)) {
            throw new ExtensionServiceInputError('ready image generation requires resourceId and resultUrl')
          }
          const isBusinessImage = targetRoot !== 'image' && Boolean(entityId)
          const placementKey = isBusinessImage ? `${targetRoot}:${entityId}` : `image:${assetId}`
          const placement = {
            placementKey,
            folderId: placementTarget,
            sortKey: typeof body.createdAt === 'number' ? String(body.createdAt) : generationId,
          }
          const scope = {
            mediaType: 'image',
            targetRoot,
            ...(isBusinessImage ? { entityId } : {}),
          }
          return jsonResponse(200, await invokeAssetCatalogCapability(context, 'register-generated', {
            operationId: `${generationId}:server-${status}`,
            asset: {
              id: assetId,
              kind: 'image',
              status,
              label: displayName,
              prompt,
              ...(status === 'ready' ? {
                provider: { kind: 'kino', ref: resourceId, upstreamResourceId: resourceId },
                url: resultUrl,
              } : {}),
              ...(status === 'failed' ? { error: typeof body.error === 'string' ? body.error : 'Generation failed' } : {}),
              productionType: targetRoot === 'character' ? 'character_ref' : targetRoot === 'scene' ? 'scene_ref' : 'shot_image',
              sourceModule: 'game-video',
              provenance: { origin: 'generation', recipe: { version: 1, parameters } },
              meta: {
                kinoGenerationId: generationId,
                ...(resourceId ? { kinoResourceId: resourceId } : {}),
                kinoModel: model,
                catalogGeneration: {
                  version: 3,
                  scope,
                  generationId,
                  mediaType: 'image',
                  placement,
                  parameters,
                },
              },
            },
            ...(!isBusinessImage || status === 'ready' ? { placement } : {}),
            ...(status === 'ready' && isBusinessImage ? {
              apply: {
                mode: 'catalog',
                tabKind: targetRoot,
                entityId,
                createEntity: { name: displayName },
                source: 'generate',
              },
            } : {}),
          }))
        }
        if (
          method === 'GET'
          && parts.length === 2
          && parts[0] === 'assets'
        ) {
          exactQuery(request.query, [])
          const id = getAssetIdFromArgs({ id: parts[1]! })
          return jsonResponse(200, await service.getAsset(id))
        }
        if (
          method === 'GET'
          && parts.length === 3
          && parts[0] === 'media'
          && parts[1] === 'bundled'
        ) {
          exactQuery(request.query, [])
          const response = await bundledMediaResponse(
            parts[2]!,
            header(request, 'range'),
            { resolveAsset: options.bundledMediaResolver },
          )
          if (response.status === 404) return notFound()
          if (response.status === 416) {
            const normalized = jsonResponse(416, {
              ok: false,
              error: {
                code: 'range_not_satisfiable',
                target: 'game-video',
                message: 'Range Not Satisfiable',
                retryable: false,
              },
            })
            return {
              ...normalized,
              headers: {
                ...normalized.headers,
                'accept-ranges': response.headers?.['accept-ranges'] ?? 'bytes',
                'content-range': response.headers?.['content-range'] ?? 'bytes */0',
              },
            }
          }
          return response
        }
        if (method === 'GET' && path === 'style-axes') {
          exactQuery(request.query, [])
          return jsonResponse(200, {
            styleAxes: await getHostStyleAxes(context) ?? null,
          })
        }
        if (method === 'POST' && path === 'style-axes') {
          exactQuery(request.query, [])
          const axes = jsonBody(request)
          if (!axes || typeof axes !== 'object' || Array.isArray(axes)) {
            throw new ExtensionServiceInputError('styleAxes must be an object')
          }
          return jsonResponse(200, {
            styleAxes: await createHostAssetRegistry(context).setStyleAxes(
              axes as Parameters<ReturnType<typeof createHostAssetRegistry>['setStyleAxes']>[0],
            ),
          })
        }
        if (method === 'POST') {
          const serviceMethod = GAME_VIDEO_POST_SERVICE_ROUTES.get(path)
          if (serviceMethod) {
            exactQuery(request.query, [])
            return jsonResponse(
              200,
              await service[serviceMethod](jsonBody(request)),
            )
          }
        }
        return notFound()
      } catch (error) {
        if (error instanceof AssetCatalogCapabilityError) {
          return jsonResponse(error.status, {
            ok: false,
            error: {
              code: error.code,
              target: 'game-video.asset-catalog',
              message: error.message,
              retryable: error.status >= 500,
            },
          })
        }
        if (error instanceof ComponentAuthoringConflictError) {
          return jsonResponse(409, {
            ok: false,
            error: {
              code: error.code,
              target: error.componentId,
              message: error.message,
              references: error.references,
              retryable: true,
            },
          })
        }
        if (error instanceof ComponentAuthoringInputError) {
          return jsonResponse(400, {
            ok: false,
            error: {
              code: error.code,
              target: 'component',
              message: error.message,
              retryable: false,
            },
          })
        }
        if (error instanceof WorkflowStateError) {
          // 三态语义 + 可执行下一步：`stop` 类错误重试一万次也不会变，
          // 统一返回 retryable: true 等于在鼓励模型空转（设计 §9.7.5）。
          return jsonResponse(409, {
            ok: false,
            error: {
              code: error.code,
              target: 'game-video',
              message: error.message,
              retry: error.retry,
              retryable: error.retry !== 'stop',
              ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }),
              ...(error.guidance ? { guidance: error.guidance } : {}),
            },
          })
        }
        if (error instanceof ExtensionServiceInputError) {
          return jsonResponse(400, {
            ok: false,
            error: {
              code: error.code,
              target: 'game-video',
              message: error.message,
              retryable: false,
            },
          })
        }
        if (error instanceof VideoPromptPolishError) {
          return jsonResponse(error.status, {
            ok: false,
            error: {
              code: error.code,
              target: 'game-video',
              message: error.message,
              retryable: error.code === 'model_unavailable',
            },
          })
        }
        return jsonResponse(500, {
          ok: false,
          error: {
            code: 'internal_error',
            target: 'game-video',
            message: 'Internal Server Error',
            retryable: false,
          },
        })
      }
    },
  }
}
