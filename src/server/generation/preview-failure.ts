/**
 * 出图失败的对外文案：脱敏 + 按上游分类码附上「下一步该做什么」。
 *
 * 第二局问题 9：一个场景连续 4 次失败，Agent 只看到 `Arrival image generation failed`，
 * 无从判断该改写 Prompt 还是稍后重试，于是原样重试到耗尽再报 blocker。
 * 现在 mate 侧会给出 `IMAGE_MODEL_*` 分类码（见 `image-generation-client.ts`），
 * 这里把它翻成出图线能直接执行的动作。
 */

/** mate 的分类码 → 出图线的下一步动作。 */
const NEXT_ACTION_BY_CODE: Record<string, string> = {
  IMAGE_MODEL_CONTENT_BLOCKED: '内容被上游审核拦截：请改写这一项的 previewPrompt（去掉血腥、暴力、写实伤害等描述）后重试，不要原样重试。',
  IMAGE_MODEL_RATE_LIMITED: '上游限流：稍后原样重试即可，不要改 Prompt。',
  IMAGE_MODEL_TIMEOUT: '上游超时：稍后原样重试即可，不要改 Prompt。',
  IMAGE_MODEL_INSUFFICIENT_CREDITS: '账户额度不足：改 Prompt 也没用，直接 report_blocker 交回编排者。',
}

function providerCodeOf(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const details = (error as { details?: unknown }).details
  const candidate = details && typeof details === 'object'
    ? (details as { providerCode?: unknown }).providerCode
    : undefined
  const code = candidate ?? (error as { providerCode?: unknown }).providerCode
  return typeof code === 'string' && code ? code : undefined
}

/** 去掉本地路径与 URL，截断长度；两类预览图共用。 */
export function publicGenerationError(error: unknown, fallback: string): string {
  const message = (error instanceof Error ? error.message : fallback)
    .replace(/file:\/\/\S+/gi, '[redacted]')
    .replace(/https?:\/\/\S+/gi, '[redacted]')
    .slice(0, 400)
  const nextAction = NEXT_ACTION_BY_CODE[providerCodeOf(error) ?? '']
  return nextAction ? `${message}｜${nextAction}` : message
}
