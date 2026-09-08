import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pluginFetch } from '../../../../lib/plugin-http'
import {
  isPromptPolishUnavailableError,
  polishVideoPrompt,
  VIDEO_PROMPT_POLISH_ROUTE,
} from '../prompt-polish-api'

vi.mock('../../../../lib/plugin-http', () => ({
  pluginFetch: vi.fn(),
}))

const mockedPluginFetch = vi.mocked(pluginFetch)

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('polishVideoPrompt', () => {
  beforeEach(() => mockedPluginFetch.mockReset())

  it('posts only the prompt through the extension-owned plugin transport', async () => {
    mockedPluginFetch.mockResolvedValue(jsonResponse({ prompt: '润色结果' }))

    await expect(polishVideoPrompt('原始提示词')).resolves.toBe('润色结果')
    expect(mockedPluginFetch).toHaveBeenCalledWith(VIDEO_PROMPT_POLISH_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '原始提示词' }),
    })
  })

  it('rejects malformed successful responses', async () => {
    mockedPluginFetch.mockResolvedValue(jsonResponse({ prompt: '   ' }))
    await expect(polishVideoPrompt('原始提示词')).rejects.toThrow('invalid prompt')

    mockedPluginFetch.mockResolvedValue(jsonResponse({ value: 'missing prompt' }))
    await expect(polishVideoPrompt('原始提示词')).rejects.toThrow('invalid response')
  })

  it('preserves the host-unavailable error category for localized UI', async () => {
    mockedPluginFetch.mockResolvedValue(jsonResponse({
      ok: false,
      error: { code: 'model_unavailable', message: 'Extension text model is unavailable' },
    }, 503))

    await expect(polishVideoPrompt('原始提示词')).rejects.toSatisfy(isPromptPolishUnavailableError)
  })
})
