import type {
  KinoRequestOptions,
  KinoResourceDTO,
  KinoVideoClient,
} from './kino-api'

export async function renameKinoResource(
  client: Pick<KinoVideoClient, 'get' | 'update'>,
  resourceId: string,
  gameId: string,
  name: string,
  options?: KinoRequestOptions,
  mediaType?: KinoResourceDTO['media_type'],
): Promise<KinoResourceDTO> {
  const current = await client.get(resourceId, gameId, options)
  return client.update(resourceId, {
    resource_id: resourceId,
    game_id: gameId,
    media_type: mediaType ?? current.media_type,
    url: current.url,
    name,
    type: current.type,
    remark: current.remark,
    source: current.source,
    source_meta: current.source_meta,
  }, options)
}
