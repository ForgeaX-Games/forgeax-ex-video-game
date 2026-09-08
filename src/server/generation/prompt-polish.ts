import type { ExtensionContext } from '@forgeax/extension-host/node'

export const VIDEO_PROMPT_MAX_LENGTH = 4000

export const VIDEO_PROMPT_POLISH_SYSTEM_PROMPT = `You are a professional video-generation prompt editor.

Output requirements:
- Output only the final polished prompt. Do not output explanations, Markdown, JSON, analysis, headings, or surrounding quotation marks.
- Keep the original language. Do not translate the prompt.
- Preserve the original subjects, scene, actions, dialogue, story outcome, and style intent.
- Do not introduce characters, plot facts, props, locations, or source materials that are absent from the input.
- Preserve every existing @ material reference exactly as written. Do not rename, remove, duplicate, reorder, or invent references.
- Add concrete action detail, composition, lighting, and camera language that improves video generation.
- Use only one primary camera movement per shot.
- Avoid stacking conflicting camera movements or photography terms.
- Add only the necessary generation-stability constraints, including stable subjects and motion, no watermark, no Logo, and no UI.
- Keep dialogue meaning and quoted dialogue unchanged.
- The final output must not exceed 4000 characters.`

export type VideoPromptPolishErrorCode =
  | 'model_unavailable'
  | 'invalid_model_output'

export class VideoPromptPolishError extends Error {
  constructor(
    readonly code: VideoPromptPolishErrorCode,
    readonly status: 502 | 503,
    message: string,
  ) {
    super(message)
    this.name = 'VideoPromptPolishError'
  }
}

export async function polishVideoPromptWithModel(
  context: ExtensionContext,
  prompt: string,
): Promise<string> {
  let result: Awaited<ReturnType<ExtensionContext['models']['generateText']>>
  try {
    result = await context.models.generateText({
      prompt,
      system: VIDEO_PROMPT_POLISH_SYSTEM_PROMPT,
      temperature: 0.3,
      maxTokens: 1600,
      metadata: {
        usage: 'video-prompt-polish',
      },
    })
  } catch {
    throw new VideoPromptPolishError(
      'model_unavailable',
      503,
      'Extension text model is unavailable',
    )
  }

  const polished = result.text.trim()
  if (!polished) {
    throw new VideoPromptPolishError(
      'invalid_model_output',
      502,
      'Text model returned an empty video prompt',
    )
  }
  if (polished.length > VIDEO_PROMPT_MAX_LENGTH) {
    throw new VideoPromptPolishError(
      'invalid_model_output',
      502,
      `Text model returned a video prompt longer than ${VIDEO_PROMPT_MAX_LENGTH} characters`,
    )
  }
  return polished
}

/** 整块界面模板的摆放提示很简短，一条提示即可；输入/输出共用同一上限。 */
export const OVERLAY_PROMPT_MAX_LENGTH = 1000

export const OVERLAY_PROMPT_POLISH_SYSTEM_PROMPT = `You are a UI layout copy editor for an interactive-video game authoring tool.

You receive an interface template — a group of on-screen controls that will be dropped onto a video canvas as one unit (for example a status HUD, a subtitle bar, or a QTE prompt). The author gives you:
- template: the template title.
- draft hint: the author's current placement hint (may be empty).

Your task: produce the placement hint that tells an AI or a human where this template should be placed on the video canvas as a whole.

Output requirements:
- Output only the final hint. No explanations, Markdown, JSON, headings, or surrounding quotation marks.
- Keep the original language. Do not translate.
- Use canvas-anchored positional language: top/bottom/left/right/center, corners, edges.
- State where the template as a whole goes, not how its controls are arranged internally.
- Do not invent controls, gameplay, or content that the title/draft do not imply.
- If the draft hint is empty, infer a sensible default from the title.
- Keep it concise: one sentence, at most 200 characters.`

/**
 * 与视频提示词润色共用 Extension 文本模型，但契约不同：输入是「模板标题 + 当前
 * 摆放提示草稿（可为空）」，输出是一句整块模板在视频画布上的摆放提示。
 */
export async function polishOverlayPromptWithModel(
  context: ExtensionContext,
  prompt: string,
  title: string,
): Promise<string> {
  const modelPrompt = [
    title.trim() ? `template: ${title.trim()}` : '',
    prompt.trim() ? `draft hint: ${prompt.trim()}` : '',
  ].filter(Boolean).join('\n') || 'an interface template'

  let result: Awaited<ReturnType<ExtensionContext['models']['generateText']>>
  try {
    result = await context.models.generateText({
      prompt: modelPrompt,
      system: OVERLAY_PROMPT_POLISH_SYSTEM_PROMPT,
      temperature: 0.3,
      maxTokens: 400,
      metadata: {
        usage: 'overlay-prompt-polish',
      },
    })
  } catch {
    throw new VideoPromptPolishError(
      'model_unavailable',
      503,
      'Extension text model is unavailable',
    )
  }

  const polished = result.text.trim()
  if (!polished) {
    throw new VideoPromptPolishError(
      'invalid_model_output',
      502,
      'Text model returned an empty interface template placement hint',
    )
  }
  if (polished.length > OVERLAY_PROMPT_MAX_LENGTH) {
    throw new VideoPromptPolishError(
      'invalid_model_output',
      502,
      `Text model returned a placement hint longer than ${OVERLAY_PROMPT_MAX_LENGTH} characters`,
    )
  }
  return polished
}
