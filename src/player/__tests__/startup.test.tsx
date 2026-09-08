// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { setLocale } from '@/i18n'
import { createStandaloneRuntimeHost } from '../host'
import { RuntimeGameApp } from '../RuntimeGameApp'

const VIDEO_ID = '99e3beb1-dd55-4a30-82c4-8ed481af2cd0'
const mediaLocator = 'https://www.zaohuacdn.cn/kino/generated/clip.mp4'
const project = {
  id: 'published-game',
  title: 'Published game',
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

vi.mock('@/runtime/react/play', () => ({
  GamePlayer: ({ game, resolveAsset }: { game: string; resolveAsset: (id: string) => string | undefined }) => (
    <img data-testid="published-media" alt={game} src={resolveAsset(VIDEO_ID)} />
  ),
}))

vi.mock('@/runtime/react/component-host', () => ({
  refreshGameComponentsFromUrl: vi.fn(async () => true),
}))

beforeEach(() => {
  setLocale('zh')
})

afterEach(() => {
  vi.restoreAllMocks()
})

test('the published page loads game data locally and resolves only media through Kino', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/game/project.json')) return jsonResponse(project)
    if (url.endsWith('/game/blueprint.json')) return jsonResponse(blueprint)
    if (url.endsWith('/game/assets/manifest.json')) {
      return jsonResponse({ version: 2, assets: [] })
    }
    if (url.includes('/api/v1/kino/resources?')) {
      const mediaType = new URL(url).searchParams.get('media_type')
      return jsonResponse({
        code: 0,
        data: {
          items: mediaType === 'video'
            ? [{ resource_id: VIDEO_ID, media_type: 'video', url: mediaLocator }]
            : [],
          total: mediaType === 'video' ? 1 : 0,
        },
        message: 'ok',
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  })

  const host = createStandaloneRuntimeHost({
    fetch: fetchMock as unknown as typeof fetch,
  })

  render(<RuntimeGameApp host={host} />)

  fireEvent.click(await screen.findByRole('button', { name: '开始游戏' }))

  expect((await screen.findByTestId('published-media')).getAttribute('src')).toBe(mediaLocator)
  const requested = fetchMock.mock.calls.map(([input]) => String(input))
  expect(requested.some((url) => url.includes('/package'))).toBe(false)
  expect(requested.some((url) => /\/api\/game-host|\/__gva__/u.test(url))).toBe(false)
})
