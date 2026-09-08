import { describe, expect, it, vi } from 'vitest'
import { createStandaloneRuntimeHost } from '../host'

const GAME_ID = 'ad0e4ae7-04a3-4ad1-81b1-e7b81253b623'
const VIDEO_ID = '99e3beb1-dd55-4a30-82c4-8ed481af2cd0'
const GAME_BASE_URL = 'https://cdn.example.com/games/demo/game/'

const project = {
  id: GAME_ID,
  title: 'Demo',
  platform: 'game-video',
  platformVersion: '1',
}
const blueprint = {
  graph: { nodes: [], edges: [] },
  manifest: { mainPackId: 'main', packs: { main: {} } },
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('standalone runtime host', () => {
  it('loads the published game payload beside the standalone shell', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === `${GAME_BASE_URL}project.json`) return jsonResponse(project)
      if (url === `${GAME_BASE_URL}blueprint.json`) return jsonResponse(blueprint)
      if (url === `${GAME_BASE_URL}assets/manifest.json`) {
        return jsonResponse({ version: 2, assets: [] })
      }
      if (url.includes('/api/v1/kino/resources?')) {
        return jsonResponse({ code: 0, data: { items: [], total: 0 }, message: 'ok' })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const session = await createStandaloneRuntimeHost({
      fetch: fetchMock as unknown as typeof fetch,
      gameBaseUrl: GAME_BASE_URL,
    }).ready()

    expect(session).toMatchObject({
      gameId: GAME_ID,
      gamePackage: {
        project: { id: GAME_ID },
        blueprint: {
          graph: { nodes: expect.any(Array), edges: expect.any(Array) },
          manifest: { mainPackId: expect.any(String), packs: expect.any(Object) },
        },
      },
    })
    expect(session.componentModuleUrl).toBe(`${GAME_BASE_URL}components/index.js`)
    expect(fetchMock).toHaveBeenCalledWith(`${GAME_BASE_URL}project.json`, expect.anything())
    expect(fetchMock).toHaveBeenCalledWith(`${GAME_BASE_URL}blueprint.json`, expect.anything())
    expect(fetchMock).toHaveBeenCalledWith(`${GAME_BASE_URL}assets/manifest.json`, expect.anything())
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/package'),
      expect.anything(),
    )
  })

  it('fills the raw empty manifest with playable Kino locators', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const rawUrl = String(input)
      if (rawUrl === `${GAME_BASE_URL}project.json`) return jsonResponse(project)
      if (rawUrl === `${GAME_BASE_URL}blueprint.json`) return jsonResponse(blueprint)
      if (rawUrl === `${GAME_BASE_URL}assets/manifest.json`) {
        return jsonResponse({ version: 2, assets: [] })
      }
      const url = new URL(rawUrl)
      const mediaType = url.searchParams.get('media_type')
      return jsonResponse({
        code: 0,
        data: {
          items: mediaType === 'video'
            ? [{
                resource_id: VIDEO_ID,
                media_type: 'video',
                url: 'https://www.zaohuacdn.cn/kino/generated/clip.mp4',
              }]
            : [],
          total: mediaType === 'video' ? 1 : 0,
        },
        message: 'ok',
      })
    })

    const session = await createStandaloneRuntimeHost({
      fetch: fetchMock as unknown as typeof fetch,
      gameBaseUrl: GAME_BASE_URL,
    }).ready()

    expect(session.gamePackage.assetsManifest.assets).toEqual([{
      id: VIDEO_ID,
      kind: 'video',
      url: 'https://www.zaohuacdn.cn/kino/generated/clip.mp4',
    }])
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })
})
