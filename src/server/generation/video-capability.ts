import type {
  MediaAsset,
  MediaReference,
} from '@forgeax/extension-host/contracts'
import type { ExtensionContext } from '@forgeax/extension-host/node'

const VIDEO_GENERATION_CAPABILITY_ID = 'media.video.generate'
const VIDEO_GENERATION_CAPABILITY_VERSION = 1

interface GenerateHostVideoInput {
  prompt: string
  durationSeconds: number
  generateAudio: boolean
  aspectRatio?: string
  resolution?: string
  model?: string
  visualStyleKey?: string
  references: MediaReference[]
  metadata: {
    sceneNodeId: string
    nodeName: string
  }
  requestId?: string
}

interface CapabilityVideo {
  bytes: Uint8Array
  mime: string
  sourceUrl: string
  provider: {
    kind: string
    ref: string
    upstreamResourceId: string
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseCapabilityVideo(value: unknown): CapabilityVideo {
  if (!isRecord(value) || !isRecord(value.video) || !isRecord(value.video.provider)) {
    throw new Error('Host media.video.generate returned an invalid result')
  }
  const { video } = value
  const provider = video.provider as Record<string, unknown>
  if (
    !(video.bytes instanceof Uint8Array)
    || video.bytes.byteLength === 0
    || typeof video.mime !== 'string'
    || video.mime.length === 0
    || typeof video.sourceUrl !== 'string'
    || video.sourceUrl.length === 0
    || typeof provider.kind !== 'string'
    || typeof provider.ref !== 'string'
    || typeof provider.upstreamResourceId !== 'string'
    || provider.upstreamResourceId.length === 0
  ) {
    throw new Error('Host media.video.generate returned an invalid video')
  }
  return video as unknown as CapabilityVideo
}

async function materializeReferences(
  context: ExtensionContext,
  references: readonly MediaReference[],
): Promise<Array<{
  role: MediaReference['role']
  mediaKind?: MediaReference['mediaKind']
  assetId: string
  mime: string
  bytes: Uint8Array
}>> {
  return Promise.all(references.map(async (reference) => {
    if (!reference.assetId) {
      throw new Error('Host media.video.generate references require assetId')
    }
    const body = await context.media.read(context.gameId, reference.assetId)
    if (!body || body.bytes.byteLength === 0) {
      throw new Error(`Host media reference is not readable: ${reference.assetId}`)
    }
    return {
      role: reference.role ?? 'reference_image',
      ...(reference.mediaKind ? { mediaKind: reference.mediaKind } : {}),
      assetId: reference.assetId,
      mime: body.contentType,
      bytes: body.bytes,
    }
  }))
}

/** Invoke the product-owned video capability and project its Kino resource as Host media. */
export async function generateVideoThroughHostCapability(
  context: ExtensionContext,
  input: GenerateHostVideoInput,
): Promise<MediaAsset> {
  const references = await materializeReferences(context, input.references)
  const result = await context.capabilities.invoke(
    VIDEO_GENERATION_CAPABILITY_ID,
    VIDEO_GENERATION_CAPABILITY_VERSION,
    {
      prompt: input.prompt,
      durationSeconds: input.durationSeconds,
      generateAudio: input.generateAudio,
      ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
      ...(input.resolution ? { resolution: input.resolution } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.visualStyleKey ? { visualStyleKey: input.visualStyleKey } : {}),
      references,
      metadata: input.metadata,
    },
    input.requestId === undefined ? undefined : { requestId: input.requestId },
  )
  const video = parseCapabilityVideo(result)
  return {
    id: video.provider.upstreamResourceId,
    type: 'video',
    url: video.sourceUrl,
    contentType: video.mime,
    sizeBytes: video.bytes.byteLength,
    metadata: {
      source: 'media.video.generate',
      providerKind: video.provider.kind,
      providerRef: video.provider.ref,
    },
  }
}
