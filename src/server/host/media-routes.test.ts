import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { bundledMediaResponse, type BundledMediaResolver } from './media-routes'

let resolveAsset: BundledMediaResolver
let directory = ''

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'game-video-media-'))
  const file = join(directory, 'dazhao.mp4')
  await writeFile(file, new Uint8Array([0, 1, 2, 3, 4, 5]))
  resolveAsset = async (id) => id === 'dazhao' ? pathToFileURL(file) : null
})

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('bundled media response', () => {
  test('serves an exact inclusive byte range with 206 semantics', async () => {
    const response = await bundledMediaResponse('dazhao', 'bytes=0-3', { resolveAsset })

    expect(response.status).toBe(206)
    expect(response.body).toHaveLength(4)
    expect(response.headers).toMatchObject({
      'accept-ranges': 'bytes',
      'content-length': '4',
      'content-range': expect.stringMatching(/^bytes 0-3\/\d+$/),
      'content-type': 'video/mp4',
    })
  })

  test.each(['../dazhao', '%2e%2e', 'unknown-id'])(
    'normalizes traversal or unknown id %s to the same 404',
    async (id) => {
      const response = await bundledMediaResponse(id)
      expect(response).toEqual({
        status: 404,
        headers: {
          'cache-control': 'no-store',
          'content-length': '0',
        },
        body: new Uint8Array(),
      })
    },
  )
})
