import { pluginFetch } from '../../../lib/plugin-http'

export const VIDEO_PROMPT_POLISH_ROUTE = 'generation/prompt-polish'
export const VIDEO_PROMPT_MAX_LENGTH = 4000

export class PromptPolishUnavailableError extends Error {
  constructor() {
    super('Extension text model is unavailable')
    this.name = 'PromptPolishUnavailableError'
  }
}

export async function polishVideoPrompt(prompt: string): Promise<string> {
  const response = await pluginFetch(VIDEO_PROMPT_POLISH_ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    if (errorCode(payload) === 'model_unavailable') {
      throw new PromptPolishUnavailableError()
    }
    throw new Error(errorMessage(payload) ?? `Prompt polish failed with HTTP ${response.status}`)
  }
  if (!isRecord(payload) || typeof payload.prompt !== 'string') {
    throw new Error('Prompt polish returned an invalid response')
  }
  const result = payload.prompt.trim()
  if (!result || result.length > VIDEO_PROMPT_MAX_LENGTH) {
    throw new Error('Prompt polish returned an invalid prompt')
  }
  return result
}

export const OVERLAY_PROMPT_POLISH_ROUTE = 'generation/overlay-prompt-polish'
export const OVERLAY_PROMPT_MAX_LENGTH = 1000

/** 界面模板「AI 润色」：把模板标题 + 当前摆放提示草稿交给模型，返回一句摆放提示。 */
export async function polishOverlayPrompt(prompt: string, title: string): Promise<string> {
  const response = await pluginFetch(OVERLAY_PROMPT_POLISH_ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, title }),
  })
  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    if (errorCode(payload) === 'model_unavailable') {
      throw new PromptPolishUnavailableError()
    }
    throw new Error(errorMessage(payload) ?? `Overlay prompt polish failed with HTTP ${response.status}`)
  }
  if (!isRecord(payload) || typeof payload.prompt !== 'string') {
    throw new Error('Overlay prompt polish returned an invalid response')
  }
  const result = payload.prompt.trim()
  if (!result || result.length > OVERLAY_PROMPT_MAX_LENGTH) {
    throw new Error('Overlay prompt polish returned an invalid prompt')
  }
  return result
}

export function isPromptPolishUnavailableError(error: unknown): boolean {
  return error instanceof PromptPolishUnavailableError
}

function errorCode(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.error)) return undefined
  return typeof value.error.code === 'string' ? value.error.code : undefined
}

function errorMessage(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.error)) return undefined
  return typeof value.error.message === 'string' && value.error.message.trim()
    ? value.error.message
    : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
