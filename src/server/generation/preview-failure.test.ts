import { describe, expect, it } from 'vitest'
import { publicGenerationError } from './preview-failure'

/**
 * 出图失败要能指导下一步（第二局问题 9）。
 *
 * 当时 `scene_cave` 连续 4 次失败，Agent 拿到的只有 `Arrival image generation failed`：
 * 既不知道是审核拦截还是限流，也不知道该改 Prompt 还是等一会儿，只能原样重试到耗尽。
 */
describe('出图失败文案', () => {
  function providerError(message: string, providerCode?: string) {
    return Object.assign(new Error(message), providerCode ? { details: { providerCode } } : {})
  }

  it('审核拦截时要求改写 Prompt，并明确禁止原样重试', () => {
    const text = publicGenerationError(
      providerError('输入内容包含敏感信息', 'IMAGE_MODEL_CONTENT_BLOCKED'),
      'Scene preview generation failed',
    )

    expect(text).toContain('改写')
    expect(text).toContain('previewPrompt')
    expect(text).toContain('不要原样重试')
  })

  it('限流与超时只让稍后重试，不让改 Prompt', () => {
    for (const code of ['IMAGE_MODEL_RATE_LIMITED', 'IMAGE_MODEL_TIMEOUT']) {
      const text = publicGenerationError(providerError('upstream busy', code), 'failed')
      expect(text, code).toContain('稍后')
      expect(text, code).toContain('不要改 Prompt')
    }
  })

  it('额度不足直接交回编排者，避免白改 Prompt', () => {
    const text = publicGenerationError(
      providerError('余额不足', 'IMAGE_MODEL_INSUFFICIENT_CREDITS'),
      'failed',
    )

    expect(text).toContain('report_blocker')
  })

  it('没有分类码时保持原样，只做脱敏', () => {
    const text = publicGenerationError(
      providerError('failed at file:///sandbox/tmp/a.png from https://cdn.example.com/x'),
      'failed',
    )

    expect(text).not.toContain('file://')
    expect(text).not.toContain('https://')
    expect(text).toContain('[redacted]')
    // 无码时不要凭空编造动作建议。
    expect(text).not.toContain('｜')
  })
})
