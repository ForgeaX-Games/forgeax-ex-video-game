import type { ExtensionContext } from '@forgeax/extension-host/node'
import { describe, expect, it, vi } from 'vitest'
import {
  polishVideoPromptWithModel,
  polishOverlayPromptWithModel,
  VIDEO_PROMPT_MAX_LENGTH,
  VIDEO_PROMPT_POLISH_SYSTEM_PROMPT,
  OVERLAY_PROMPT_MAX_LENGTH,
  OVERLAY_PROMPT_POLISH_SYSTEM_PROMPT,
  VideoPromptPolishError,
} from './prompt-polish'

function contextWithText(text: string): {
  context: ExtensionContext
  generateText: ReturnType<typeof vi.fn>
} {
  const generateText = vi.fn(async () => ({ text, model: 'test-model' }))
  return {
    generateText,
    context: { models: { generateText } } as unknown as ExtensionContext,
  }
}

describe('polishVideoPromptWithModel', () => {
  it('uses the Extension text model with the dedicated video prompt contract', async () => {
    const { context, generateText } = contextWithText('润色后的镜头')

    await expect(polishVideoPromptWithModel(context, '原始镜头')).resolves.toBe('润色后的镜头')
    expect(generateText).toHaveBeenCalledWith({
      prompt: '原始镜头',
      system: VIDEO_PROMPT_POLISH_SYSTEM_PROMPT,
      temperature: 0.3,
      maxTokens: 1600,
      metadata: { usage: 'video-prompt-polish' },
    })
    expect(VIDEO_PROMPT_POLISH_SYSTEM_PROMPT).toContain('Keep the original language')
    expect(VIDEO_PROMPT_POLISH_SYSTEM_PROMPT).toContain('Preserve every existing @ material reference exactly')
    expect(VIDEO_PROMPT_POLISH_SYSTEM_PROMPT).toContain('no watermark, no Logo, and no UI')
  })

  it('rejects empty and over-limit model output instead of truncating or falling back', async () => {
    const empty = contextWithText('   ')
    const oversized = contextWithText('x'.repeat(VIDEO_PROMPT_MAX_LENGTH + 1))

    await expect(polishVideoPromptWithModel(empty.context, '原文')).rejects.toMatchObject({
      code: 'invalid_model_output',
      status: 502,
    })
    await expect(polishVideoPromptWithModel(oversized.context, '原文')).rejects.toMatchObject({
      code: 'invalid_model_output',
      status: 502,
    })
  })

  it('reports an unavailable Extension text model explicitly', async () => {
    const context = {
      models: { generateText: vi.fn(async () => { throw new Error('no gateway') }) },
    } as unknown as ExtensionContext

    await expect(polishVideoPromptWithModel(context, '原文')).rejects.toEqual(
      expect.objectContaining<Partial<VideoPromptPolishError>>({
        code: 'model_unavailable',
        status: 503,
      }),
    )
  })
})

describe('polishOverlayPromptWithModel', () => {
  it('packs the template title and draft hint into the text model call', async () => {
    const { context, generateText } = contextWithText('我方状态 HUD 一般放在右下角。')

    await expect(
      polishOverlayPromptWithModel(context, '右下角', '我方状态 HUD'),
    ).resolves.toBe('我方状态 HUD 一般放在右下角。')
    expect(generateText).toHaveBeenCalledWith({
      prompt: 'template: 我方状态 HUD\ndraft hint: 右下角',
      system: OVERLAY_PROMPT_POLISH_SYSTEM_PROMPT,
      temperature: 0.3,
      maxTokens: 400,
      metadata: { usage: 'overlay-prompt-polish' },
    })
    expect(OVERLAY_PROMPT_POLISH_SYSTEM_PROMPT).toContain('Keep the original language')
    expect(OVERLAY_PROMPT_POLISH_SYSTEM_PROMPT).toContain('top/bottom/left/right/center')
  })

  it('falls back to title only when the draft hint is empty', async () => {
    const { context, generateText } = contextWithText('字幕一般放在底部居中。')

    await expect(
      polishOverlayPromptWithModel(context, '   ', '字幕'),
    ).resolves.toBe('字幕一般放在底部居中。')
    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'template: 字幕',
    }))
  })

  it('rejects over-limit output instead of truncating', async () => {
    const { context } = contextWithText('x'.repeat(OVERLAY_PROMPT_MAX_LENGTH + 1))

    await expect(polishOverlayPromptWithModel(context, '', '标题')).rejects.toMatchObject({
      code: 'invalid_model_output',
      status: 502,
    })
  })
})
