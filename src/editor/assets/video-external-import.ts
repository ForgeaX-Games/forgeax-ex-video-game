import {
  MAX_KINO_RESOURCE_PAGE_SIZE,
  requestKinoEnvelope,
  type CreateKinoResourceInput,
  type KinoRequestOptions,
  type KinoResourceDTO,
  type KinoVideoClient,
} from './kino-api'

export interface KinoImportProjectDTO {
  game_id: string
  game_name?: string
  name?: string
  cover_url?: string
  resource_count?: number
  asset_count?: number
  updated_at?: number
}

export interface KinoImportProjectPage {
  items: KinoImportProjectDTO[]
  total: number
}

export class ExternalVideoImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExternalVideoImportError'
  }
}

export function validateExternalVideoUrl(rawUrl: string): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new ExternalVideoImportError('External video URL must be a valid HTTPS URL')
  }
  if (url.protocol !== 'https:' || !url.host) {
    throw new ExternalVideoImportError('External video URL must be a valid HTTPS URL')
  }
  return url.toString()
}

export async function listExternalVideoImportProjects(
  targetGameId: string,
  options: KinoRequestOptions = {},
): Promise<KinoImportProjectDTO[]> {
  if (!targetGameId.trim()) {
    throw new ExternalVideoImportError('Target game ID is required')
  }
  const result = await requestKinoEnvelope<KinoImportProjectPage | KinoImportProjectDTO[]>('/media/import-projects', {
    query: { exclude_game_id: targetGameId },
    signal: options.signal,
  })
  return Array.isArray(result) ? result : result.items
}

export async function listExternalProjectVideos(
  client: KinoVideoClient,
  sourceGameId: string,
  options: KinoRequestOptions = {},
): Promise<KinoResourceDTO[]> {
  if (!sourceGameId.trim()) {
    throw new ExternalVideoImportError('Source game ID is required')
  }
  const page = await client.list({
    game_id: sourceGameId,
    media_type: 'video',
    page: 1,
    page_size: MAX_KINO_RESOURCE_PAGE_SIZE,
  }, options)
  return page.items
}

export function createExternalVideoImportInput(
  targetGameId: string,
  source: KinoResourceDTO,
  name: string,
): CreateKinoResourceInput {
  const nextName = name.trim()
  if (!targetGameId.trim()) {
    throw new ExternalVideoImportError('Target game ID is required')
  }
  if (source.media_type !== 'video') {
    throw new ExternalVideoImportError('Only video resources can be imported')
  }
  if (!nextName) {
    throw new ExternalVideoImportError('Video name is required')
  }
  return {
    game_id: targetGameId,
    media_type: 'video',
    url: validateExternalVideoUrl(source.url),
    name: nextName,
    type: 'OTHER',
    source: 'external-import',
    source_meta: source.source_meta,
  }
}
