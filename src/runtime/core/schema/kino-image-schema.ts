import type { KinoPromptContentItem } from './kino-schema'

/** Kino image-generation parameters shared by browser submission and Agent-facing presets. */
export const KINO_IMAGE_SIZES = [
  '2560x1440',
  '1440x2560',
  '2496x1664',
  '1664x2496',
] as const

export type KinoImageSize = (typeof KINO_IMAGE_SIZES)[number]

// Arrival's deployed Kino endpoint currently requires an explicit image model.
export const KINO_DEFAULT_IMAGE_MODEL = 'lite'

export interface KinoImageGenerationParams {
  prompt: string
  /** Prompt and inline @assets in author order. */
  promptContent?: KinoPromptContentItem[]
  /** Kino resource ids, never Extension registry asset ids or URLs. */
  referenceImageResourceIds?: string[]
  size?: KinoImageSize
  model?: string
  visualStyleKey?: string
}

export interface KinoDefaultImage {
  generation: KinoImageGenerationParams
}

export const KINO_DEFAULT_IMAGE = {
  generation: {
    prompt: '',
    model: KINO_DEFAULT_IMAGE_MODEL,
    size: '2560x1440',
  },
} satisfies KinoDefaultImage
