import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { createGameVideoService } from './extension-service'

const encoder = new TextEncoder()

/**
 * 软失败路径也必须符合自己的 returns schema。
 *
 * 真跑证据（第二局 02:52:50 起连续三次）：`upsert_document` 内容校验失败时返回
 * `{ document: null, error }`，而 returns schema 要求 `document` 是 object，
 * 于是 Host 用 `tool_result_invalid`「工具返回不符合 schema」顶掉了真实错误。
 * 模型看不到内容哪里不对，只能原样重试——这是最典型的「泛化错误导致重试」。
 */

function schema(name: string): object {
  return JSON.parse(readFileSync(resolve(import.meta.dirname, '..', '..', '..', 'schemas', name), 'utf8'))
}

function createContext(): ExtensionContext {
  const files = new Map<string, Uint8Array>([
    ['assets/manifest.json', encoder.encode(JSON.stringify({ version: 2, assets: [] }))],
  ])
  return {
    gameId: 'g',
    files: {
      async read(path: string) {
        const bytes = files.get(path)
        return bytes ? new Uint8Array(bytes) : null
      },
      async write(path: string, contents: Uint8Array) { files.set(path, new Uint8Array(contents)) },
      async list() { return [...files.keys()] },
      async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>) { return operation() },
    },
    media: { async list() { return [] }, async read() { return null } },
  } as unknown as ExtensionContext
}

describe('软失败返回值契约', () => {
  // 与 service-validation 用同一个 draft：2020-12（args schema 也是这个 draft）。
  const ajv = new Ajv2020({ allErrors: true, strict: false })

  it('design-options 内容非法时，返回值仍符合 schema 且带上真实原因', async () => {
    const service = createGameVideoService(createContext())
    const validate = ajv.compile(schema('upsert-document.returns.json'))

    const result = await service.upsertDocument({
      documentType: 'design-options',
      slug: 'wusong',
      // 只有一个方案：`parseDesignOptions` 要求 A/B/C 三个互斥方案。
      content: JSON.stringify([{ id: 'A', title: '只有一个方案' }]),
    }) as { document: unknown, error?: string }

    expect(validate(result), JSON.stringify(validate.errors)).toBe(true)
    expect(result.document).toBeNull()
    expect(result.error, '真实原因必须回传，否则模型只会原样重试').toBeTruthy()
  })

  it('成功路径同样符合 schema', async () => {
    const service = createGameVideoService(createContext())
    const validate = ajv.compile(schema('upsert-document.returns.json'))

    const result = await service.upsertDocument({
      documentType: 'core',
      slug: 'wusong',
      content: '# 核心\n\n主循环：回合对峙。',
    }) as { document: { id?: string } | null }

    expect(validate(result), JSON.stringify(validate.errors)).toBe(true)
    expect(result.document?.id).toBeTruthy()
  })
})

describe('幂等键推导', () => {
  it('缩小到单个目标重试时，键与整批不同', async () => {
    // 真跑证据：整批用 `scenes.previewing@0:previews`，重试只补 scene_cave 时
    // 沿用同一个键，被判成 idempotency.conflict，peer 只能自己编键绕过。
    const { derivedIdempotencyKeyForTest } = await import('./extension-service')
    const all = derivedIdempotencyKeyForTest(undefined, 'scenes.previewing', 2, undefined)
    const one = derivedIdempotencyKeyForTest(undefined, 'scenes.previewing', 2, ['scene_cave'])

    expect(all).not.toBe(one)
    expect(all).toContain('@2')
    expect(one).toContain('scene_cave')
  })

  it('目标顺序不影响键：同一批不该被判成两批', async () => {
    const { derivedIdempotencyKeyForTest } = await import('./extension-service')

    expect(derivedIdempotencyKeyForTest(undefined, 'characters.previewing', 1, ['b', 'a']))
      .toBe(derivedIdempotencyKeyForTest(undefined, 'characters.previewing', 1, ['a', 'b']))
  })

  it('调用方显式给了键就用它', async () => {
    const { derivedIdempotencyKeyForTest } = await import('./extension-service')

    expect(derivedIdempotencyKeyForTest(' my-key ', 'scenes.previewing', 1, ['x'])).toBe('my-key')
  })

  it('同一活动里换出图形态时键不同：否则会被判成 idempotency.conflict', async () => {
    const { derivedIdempotencyKeyForTest } = await import('./extension-service')

    expect(derivedIdempotencyKeyForTest(undefined, 'scenes.previewing', 1, undefined, 'establishing'))
      .not.toBe(derivedIdempotencyKeyForTest(undefined, 'scenes.previewing', 1, undefined, 'multiview4'))
    expect(derivedIdempotencyKeyForTest(undefined, 'characters.previewing', 1, undefined, 'turnaround'))
      .not.toBe(derivedIdempotencyKeyForTest(undefined, 'characters.previewing', 1, undefined, 'portrait'))
  })
})
