/**
 * Browser-safe client for the product's same-origin Kino API.
 * Standalone DTOs — must not import server/private packages.
 */

import { productFetch, productUrl } from '../../lib/plugin-http'

export interface KinoEnvelope<T> {
  code: number
  message: string
  data: T
  error_code?: string
}

export type KinoMediaType = 'image' | 'video' | 'audio' | 'font'
export type KinoProviderKind = 'local' | 's3' | 'cos' | 'kino'
export type KinoUploadMime =
  | 'video/mp4'
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/gif'
  | 'audio/mpeg'
  | 'audio/wav'
  | 'audio/ogg'
  | 'audio/mp4'
  | 'audio/aac'
  | 'font/woff2'
  | 'font/woff'
  | 'font/ttf'
  | 'font/otf'

export interface KinoProviderCapabilities {
  provider: KinoProviderKind
  media_types: KinoMediaType[]
  upload_mimes: KinoUploadMime[]
}

export type KinoResourceType =
  | 'KEYFRAME'
  | 'SHOT_VIDEO'
  | 'CHARACTER_IMAGE'
  | 'CHARACTER_TURNAROUND'
  | 'LOCATION_IMAGE'
  | 'PROJECT_COVER_IMAGE'
  | 'UPLOAD'
  | 'OTHER'
  | 'GENERATION'

export interface KinoResourceSourceMeta {
  task_id?: string
  prompt?: string
  model?: string
  seed?: number
  width?: number
  height?: number
  duration_ms?: number
  mime_type?: string
  extra?: Record<string, unknown>
}

export interface KinoResourceDTO {
  resource_id: string
  game_id: string
  media_type: KinoMediaType
  name?: string
  type?: KinoResourceType
  url: string
  remark?: string
  source?: string
  source_meta?: KinoResourceSourceMeta
  created_at: number
  updated_at: number
}

export interface KinoResourcePage {
  items: KinoResourceDTO[]
  total: number
  page: number
  page_size: number
}

/**
 * Short-lived credentials for exactly one COS object.  The browser must hand
 * these to the COS SDK; `bucket_url` is the eventual object URL, not a
 * pre-signed upload endpoint.
 */
export interface KinoCosStsUploadResponse {
  tmp_secret_id: string
  tmp_secret_key: string
  session_token: string
  expiration: string
  bucket: string
  bucket_url: string
  region: string
  prefix: string
  object_key: string
  allowed_extensions: string[]
  allowed_content_types: string[]
  max_file_size_bytes: number
  required_headers: Record<string, string>
}

export interface PrepareUploadInput {
  game_id: string
  file_name?: string
  mime_type: KinoUploadMime
  bytes: number
  extension?: string
  client_resource_id?: string
  replace_existing?: boolean
}

export interface CreateKinoResourceInput {
  game_id: string
  media_type: KinoMediaType
  url: string
  name?: string
  type?: KinoResourceType
  remark?: string
  source?: string
  source_meta?: KinoResourceSourceMeta
}

export interface UpdateKinoResourceInput {
  resource_id: string
  game_id: string
  media_type: KinoMediaType
  url: string
  name?: string
  type?: KinoResourceType
  remark?: string
  source?: string
  source_meta?: KinoResourceSourceMeta
}

export interface BatchCreateKinoResourcesInput {
  game_id: string
  resources: Array<Omit<CreateKinoResourceInput, 'game_id'>>
}

export interface BatchCreateKinoResourcesResult {
  created_count: number
  skipped_count: number
  items: KinoResourceDTO[]
}

export interface ListKinoResourcesQuery {
  game_id: string
  media_type?: KinoMediaType
  page?: number
  page_size?: number
  type?: KinoResourceType
  /**
   * 排除已被 registry 语义登记的资源（角色图 / 场景图）。
   * 由 Host 判定，前端不需要自己实现去重规则（设计 §10.9.4 B）。
   */
  exclude_registered?: boolean
}

export class KinoClientError extends Error {
  readonly status: number
  readonly errorCode?: string

  constructor(message: string, status: number, errorCode?: string) {
    super(message)
    this.name = 'KinoClientError'
    this.status = status
    this.errorCode = errorCode
  }
}

export interface KinoRequestOptions {
  signal?: AbortSignal
}

export interface KinoEnvelopeRequestOptions extends KinoRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  query?: Record<string, string | number | boolean | undefined>
  json?: unknown
  /** Test seam; production callers use the same-origin global fetch. */
  fetch?: KinoFetch
}

export interface KinoVideoClient {
  capabilities(options?: KinoRequestOptions): Promise<KinoProviderCapabilities>
  prepareUpload(input: PrepareUploadInput, options?: KinoRequestOptions): Promise<KinoCosStsUploadResponse>
  list(query: ListKinoResourcesQuery, options?: KinoRequestOptions): Promise<KinoResourcePage>
  get(resourceId: string, gameId: string, options?: KinoRequestOptions): Promise<KinoResourceDTO>
  create(input: CreateKinoResourceInput, options?: KinoRequestOptions): Promise<KinoResourceDTO>
  batch(input: BatchCreateKinoResourcesInput, options?: KinoRequestOptions): Promise<BatchCreateKinoResourcesResult>
  update(resourceId: string, input: UpdateKinoResourceInput, options?: KinoRequestOptions): Promise<KinoResourceDTO>
  delete(resourceId: string, gameId: string, options?: KinoRequestOptions): Promise<void>
  playbackUrl(resourceId: string, gameId: string): string
}

export interface CreateKinoVideoClientOptions {
  fetch?: KinoFetch
  baseUrl?: string
}

export type KinoFetch = (input: string, init?: RequestInit) => Promise<Response>

const DEFAULT_BASE_URL = '/api/v1/kino'
const MAX_ERROR_MESSAGE_LENGTH = 512
const KINO_BROWSER_CAPABILITIES: KinoProviderCapabilities = {
  provider: 'kino',
  media_types: ['video', 'image', 'audio'],
  upload_mimes: [
    'video/mp4',
    'image/png',
    'image/jpeg',
    'image/webp',
    'audio/mpeg',
    'audio/wav',
  ],
}

/** Shared sentinel text so downstream callers can detect a plain (non-business) 404 by message. */
export const KINO_PLAIN_HTTP_404_MESSAGE = 'Request failed with HTTP 404'
/** Shared sentinel text so downstream callers can detect a browser-level connection failure by message. */
export const KINO_NETWORK_FAILURE_MESSAGE = 'Network request failed'

/** Kino `/resources` 服务端分页协议的单页上限。 */
export const MAX_KINO_RESOURCE_PAGE_SIZE = 100

function normalizeBaseUrl(raw: string | undefined): string {
  const trimmed = (raw ?? DEFAULT_BASE_URL).trim()
  if (trimmed.length === 0) {
    return DEFAULT_BASE_URL
  }
  return trimmed.replace(/\/+$/, '')
}

function truncateMessage(message: string): string {
  if (message.length <= MAX_ERROR_MESSAGE_LENGTH) {
    return message
  }
  return message.slice(0, MAX_ERROR_MESSAGE_LENGTH)
}

function appendQuery(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue
    }
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  }
  const query = parts.join('&')
  return query.length > 0 ? `${path}?${query}` : path
}

async function readJsonPayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) {
    if (!response.ok) {
      throw new KinoClientError(
        response.status === 404 ? KINO_PLAIN_HTTP_404_MESSAGE : `Request failed with HTTP ${response.status}`,
        response.status,
        response.status === 404 ? 'not_found' : 'http_error',
      )
    }
    throw new KinoClientError('Upstream returned an empty response', 502, 'upstream_unavailable')
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    if (!response.ok) {
      throw new KinoClientError(
        response.status === 404 ? KINO_PLAIN_HTTP_404_MESSAGE : `Request failed with HTTP ${response.status}`,
        response.status,
        response.status === 404 ? 'not_found' : 'http_error',
      )
    }
    throw new KinoClientError('Upstream returned malformed JSON', 502, 'upstream_unavailable')
  }
}

function resolveBusinessStatus(envelope: Partial<KinoEnvelope<unknown>>): number {
  if (typeof envelope.code === 'number' && envelope.code >= 400 && envelope.code < 600) {
    return envelope.code
  }
  return 502
}

function parseEnvelope<T>(response: Response, payload: unknown): T {
  if (response.status === 401) {
    const envelope = payload as Partial<KinoEnvelope<T>>
    throw new KinoClientError(
      truncateMessage(
        typeof envelope.message === 'string' && envelope.message.length > 0
          ? envelope.message
          : 'Unauthorized',
      ),
      401,
      typeof envelope.error_code === 'string' ? envelope.error_code : 'unauthorized',
    )
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new KinoClientError('Upstream returned malformed JSON', 502, 'upstream_unavailable')
  }

  const envelope = payload as KinoEnvelope<T>
  if (typeof envelope.code !== 'number') {
    throw new KinoClientError('Upstream returned malformed JSON', 502, 'upstream_unavailable')
  }

  if (!response.ok || envelope.code !== 0) {
    throw new KinoClientError(
      truncateMessage(
        typeof envelope.message === 'string' && envelope.message.length > 0
          ? envelope.message
          : response.ok
            ? 'Upstream business error'
            : `Upstream HTTP ${response.status}`,
      ),
      response.ok ? resolveBusinessStatus(envelope) : response.status >= 400 && response.status < 600
        ? response.status
        : resolveBusinessStatus(envelope),
      typeof envelope.error_code === 'string' ? envelope.error_code : 'upstream_unavailable',
    )
  }

  return envelope.data
}

async function requestJson<T>(
  fetchImpl: KinoFetch,
  baseUrl: string,
  path: string,
  options?: Pick<RequestInit, 'method' | 'body' | 'signal'>,
): Promise<T> {
  let response: Response
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    })
  } catch {
    throw new KinoClientError(KINO_NETWORK_FAILURE_MESSAGE, 502, 'network_error')
  }

  const payload = await readJsonPayload(response)
  return parseEnvelope<T>(response, payload)
}

/**
 * Shared browser-side Kino envelope transport for endpoints outside the resource client.
 * It keeps credentials, query encoding, JSON serialization and error normalization in one place.
 */
export async function requestKinoEnvelope<T>(
  path: string,
  options: KinoEnvelopeRequestOptions = {},
): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('Kino request path must be same-origin and absolute')
  }
  const fetchImpl = options.fetch ?? productFetch
  const requestPath = options.query ? appendQuery(path, options.query) : path
  return requestJson<T>(fetchImpl, '', requestPath, {
    method: options.method,
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
    signal: options.signal,
  })
}

function resourcePath(resourceId: string, gameId: string, suffix = ''): string {
  return appendQuery(
    `/resources/${encodeURIComponent(resourceId)}${suffix}`,
    { game_id: gameId },
  )
}

export function createKinoVideoClient(
  options: CreateKinoVideoClientOptions = {},
): KinoVideoClient {
  const fetchImpl = options.fetch ?? productFetch
  const baseUrl = normalizeBaseUrl(options.baseUrl)

  return {
    async capabilities() {
      return {
        ...KINO_BROWSER_CAPABILITIES,
        media_types: [...KINO_BROWSER_CAPABILITIES.media_types],
        upload_mimes: [...KINO_BROWSER_CAPABILITIES.upload_mimes],
      }
    },

    async prepareUpload(input, options) {
      return requestJson<KinoCosStsUploadResponse>(fetchImpl, baseUrl, '/image-assets/upload', {
        method: 'POST',
        body: JSON.stringify(input),
        signal: options?.signal,
      })
    },

    async list(query, options) {
      return requestJson<KinoResourcePage>(
        fetchImpl,
        baseUrl,
        appendQuery('/resources', {
          game_id: query.game_id,
          media_type: query.media_type ?? 'video',
          page: query.page,
          page_size: query.page_size,
          type: query.type,
          ...(query.exclude_registered ? { exclude_registered: 'true' } : {}),
        }),
        { signal: options?.signal },
      )
    },

    async get(resourceId, gameId, options) {
      return requestJson<KinoResourceDTO>(
        fetchImpl,
        baseUrl,
        resourcePath(resourceId, gameId),
        { signal: options?.signal },
      )
    },

    async create(input, options) {
      return requestJson<KinoResourceDTO>(fetchImpl, baseUrl, '/resources', {
        method: 'POST',
        body: JSON.stringify(input),
        signal: options?.signal,
      })
    },

    async batch(input, options) {
      return requestJson<BatchCreateKinoResourcesResult>(fetchImpl, baseUrl, '/resources/batch', {
        method: 'POST',
        body: JSON.stringify(input),
        signal: options?.signal,
      })
    },

    async update(resourceId, input, options) {
      return requestJson<KinoResourceDTO>(
        fetchImpl,
        baseUrl,
        resourcePath(resourceId, input.game_id),
        {
          method: 'PUT',
          body: JSON.stringify(input),
          signal: options?.signal,
        },
      )
    },

    async delete(resourceId, gameId, options) {
      await requestJson<null>(fetchImpl, baseUrl, resourcePath(resourceId, gameId), {
        method: 'DELETE',
        signal: options?.signal,
      })
    },

    playbackUrl(resourceId, gameId) {
      const path = `${baseUrl}${resourcePath(resourceId, gameId, '/content')}`
      return options.fetch === undefined ? productUrl(path) : path
    },
  }
}
