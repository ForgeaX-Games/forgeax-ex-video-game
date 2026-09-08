import type { ExtensionContext } from '@forgeax/extension-host/node'
import { describe, expect, it, vi } from 'vitest'
import { createGameVideoRouter } from './router'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function request(body: unknown) {
  return {
    gameId: 'request-must-not-select-game',
    runtimeId: 'runtime-1',
    method: 'POST',
    path: 'generation/prompt-polish',
    headers: { 'content-type': ['application/json'] },
    query: {},
    body: encoder.encode(JSON.stringify(body)),
  } as const
}

function contextWithModel(generateText: (...args: unknown[]) => Promise<unknown>): ExtensionContext {
  return {
    gameId: 'context-game',
    models: { generateText },
  } as unknown as ExtensionContext
}

describe('generation/prompt-polish route', () => {
  it('routes a bounded prompt to the active context model', async () => {
    const generateText = vi.fn(async () => ({ text: '润色结果', model: 'test-model' }))
    const response = await createGameVideoRouter(contextWithModel(generateText)).handle(
      request({ prompt: '原始提示词' }),
    )

    expect(response.status).toBe(200)
    expect(JSON.parse(decoder.decode(response.body))).toEqual({ prompt: '润色结果' })
    expect(generateText).toHaveBeenCalledOnce()
  })

  it.each([
    [{ prompt: '' }, 400, 'invalid_input'],
    [{ prompt: 'x'.repeat(4001) }, 400, 'invalid_input'],
    [{ prompt: '原文', gameId: 'attacker-selected-game' }, 400, 'invalid_input'],
  ])('rejects invalid request input %#', async (body, status, code) => {
    const generateText = vi.fn(async () => ({ text: 'unused', model: 'test-model' }))
    const response = await createGameVideoRouter(contextWithModel(generateText)).handle(request(body))

    expect(response.status).toBe(status)
    expect(JSON.parse(decoder.decode(response.body)).error.code).toBe(code)
    expect(generateText).not.toHaveBeenCalled()
  })

  it('returns explicit model-unavailable and invalid-output failures', async () => {
    const unavailable = await createGameVideoRouter(contextWithModel(async () => {
      throw new Error('standalone has no model gateway')
    })).handle(request({ prompt: '原文' }))
    expect(unavailable.status).toBe(503)
    expect(JSON.parse(decoder.decode(unavailable.body)).error.code).toBe('model_unavailable')

    const invalidOutput = await createGameVideoRouter(contextWithModel(async () => ({
      text: '   ',
      model: 'test-model',
    }))).handle(request({ prompt: '原文' }))
    expect(invalidOutput.status).toBe(502)
    expect(JSON.parse(decoder.decode(invalidOutput.body)).error.code).toBe('invalid_model_output')
  })
})
