/** Binds the published Host browser media client to the nonce-bound handshake. */
import {
  createExtensionBrowserClient,
  type ExtensionBrowserMediaClient,
} from '@forgeax/extension-host/browser'
import type {
  MediaAsset as HostMediaAsset,
  MediaType as HostMediaType,
  MediaUpload as HostMediaUpload,
} from '@forgeax/extension-host/contracts'

export type { HostMediaAsset, HostMediaType, HostMediaUpload }

export interface HostMediaClient {
  list(type?: HostMediaType, signal?: AbortSignal): Promise<HostMediaAsset[]>
  contentUrl(assetId: string): Promise<string>
  /** Retained only for the existing XHR transfer UI; the Host owns the session. */
  uploadUrl(uploadId: string): Promise<string>
  update(assetId: string, input: { filename?: string, metadata?: Record<string, unknown> }, signal?: AbortSignal): Promise<HostMediaAsset>
  delete(assetId: string, signal?: AbortSignal): Promise<boolean>
  createUpload(input: { filename: string, contentType: string, sizeBytes: number, metadata?: Record<string, unknown>, idempotencyKey?: string }, signal?: AbortSignal): Promise<HostMediaUpload>
  getUpload(uploadId: string, signal?: AbortSignal): Promise<HostMediaUpload | null>
  writeUploadChunk(uploadId: string, offset: number, bytes: Uint8Array, signal?: AbortSignal): Promise<HostMediaUpload>
  completeUpload(uploadId: string, signal?: AbortSignal): Promise<HostMediaAsset>
}

export interface HandshakeMediaContext {
  readonly gameId: string
  readonly endpoints: { readonly gamePackage: string }
}

export interface CreateHostMediaClientOptions {
  readonly ready: () => Promise<HandshakeMediaContext>
  readonly fetch?: typeof globalThis.fetch
}

const syntheticOrigin = 'https://extension.invalid'

function browserBase(packageEndpoint: string): string {
  const relative = !/^[a-z][a-z\d+.-]*:/iu.test(packageEndpoint)
  const url = new URL(packageEndpoint, syntheticOrigin)
  if (!/\/games\/[^/]+\/package$/.test(url.pathname)) {
    throw new TypeError('Handshake game package endpoint has an invalid Host API shape')
  }
  url.pathname = url.pathname.replace(/\/games\/[^/]+\/package$/, '')
  url.search = ''
  url.hash = ''
  return relative ? url.pathname : url.toString()
}

/** Delegates media operations to `createExtensionBrowserClient().media`. */
export function createHostMediaClient(options: CreateHostMediaClientOptions): HostMediaClient {
  const fetch = options.fetch
  const resolved = async (): Promise<{ media: ExtensionBrowserMediaClient, mediaBase: string }> => {
    const context = await options.ready()
    if (!context.gameId) throw new TypeError('Handshake gameId is required')
    const baseUrl = browserBase(context.endpoints.gamePackage)
    return {
      media: createExtensionBrowserClient({ baseUrl, gameId: context.gameId, ...(fetch ? { fetch } : {}) }).media,
      mediaBase: `${baseUrl}/games/${encodeURIComponent(context.gameId)}/media`,
    }
  }

  return Object.freeze({
    async list(type: HostMediaType | undefined, signal?: AbortSignal) {
      return (await resolved()).media.list(type ? { type } : {}, signal)
    },
    async contentUrl(assetId: string) {
      return `${(await resolved()).mediaBase}/${encodeURIComponent(assetId)}`
    },
    async uploadUrl(uploadId: string) {
      return `${(await resolved()).mediaBase}/uploads/${encodeURIComponent(uploadId)}`
    },
    async update(assetId: string, input: { filename?: string, metadata?: Record<string, unknown> }, signal?: AbortSignal) {
      return (await resolved()).media.update(assetId, input, signal)
    },
    async delete(assetId: string, signal?: AbortSignal) {
      return (await resolved()).media.delete(assetId, signal)
    },
    async createUpload(input: { filename: string, contentType: string, sizeBytes: number, metadata?: Record<string, unknown>, idempotencyKey?: string }, signal?: AbortSignal) {
      return (await resolved()).media.createUpload(input, signal)
    },
    async getUpload(uploadId: string, signal?: AbortSignal) {
      return (await resolved()).media.getUpload(uploadId, signal)
    },
    async writeUploadChunk(uploadId: string, offset: number, bytes: Uint8Array, signal?: AbortSignal) {
      return (await resolved()).media.writeUploadChunk(uploadId, offset, bytes, signal)
    },
    async completeUpload(uploadId: string, signal?: AbortSignal) {
      return (await resolved()).media.completeUpload(uploadId, signal)
    },
  })
}
