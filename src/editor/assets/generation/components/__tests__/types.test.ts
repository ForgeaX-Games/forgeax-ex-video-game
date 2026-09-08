import { describe, expect, it } from 'vitest'
import {
  canPerformGenerationAction,
  GENERATION_ASSET_KINDS,
  interactionStateForPhase,
  isGeneratedImageAsset,
  isGeneratedVideoAsset,
  isImageGenerationResult,
  isVideoGenerationResult,
  supportsGenerationKind,
  type GenerationCapabilities,
  type GenerationResult,
  type GenerationInteractionState,
} from '..'

const capabilities: GenerationCapabilities = {
  supportedKinds: GENERATION_ASSET_KINDS,
  canGenerate: true,
  canCancel: true,
  canRetry: false,
}

describe('generation component contracts', () => {
  it('narrows generated assets by their discriminant', () => {
    const image = { assetKind: 'character' as const, media: 'image' as const, id: 'image-1', width: 1280 }
    const video = { assetKind: 'video' as const, media: 'video' as const, id: 'video-1', durationSeconds: 4 }

    expect(isGeneratedImageAsset(image)).toBe(true)
    expect(isGeneratedVideoAsset(image)).toBe(false)
    expect(isGeneratedVideoAsset(video)).toBe(true)
    expect(isGeneratedImageAsset(video)).toBe(false)
  })

  it('supports all six business asset kinds independently from media kind', () => {
    expect(GENERATION_ASSET_KINDS).toEqual(['image', 'icon', 'scene', 'character', 'video', 'control'])
    for (const kind of GENERATION_ASSET_KINDS) {
      expect(supportsGenerationKind(capabilities, kind)).toBe(true)
    }
  })

  it('keeps result media and business asset kind aligned', () => {
    const character: GenerationResult = {
      assetKind: 'character',
      media: 'image',
      generationId: 'image-generation-1',
      asset: { id: 'character-1', assetKind: 'character', media: 'image' },
    }
    const video: GenerationResult = {
      assetKind: 'video',
      media: 'video',
      generationId: 'video-generation-1',
      asset: { id: 'video-1', assetKind: 'video', media: 'video' },
    }

    expect(isImageGenerationResult(character)).toBe(true)
    expect(isVideoGenerationResult(character)).toBe(false)
    expect(isVideoGenerationResult(video)).toBe(true)
    expect(isImageGenerationResult(video)).toBe(false)
  })

  it('derives busy from submitting and generating phases', () => {
    expect(interactionStateForPhase('idle')).toEqual({
      disabled: false,
      readOnly: false,
      busy: false,
    })
    expect(interactionStateForPhase('generating', { readOnly: true })).toEqual({
      disabled: false,
      readOnly: true,
      busy: true,
    })
  })

  it.each([
    ['disabled', { disabled: true, readOnly: false, busy: false }],
    ['read-only', { disabled: false, readOnly: true, busy: false }],
    ['busy', { disabled: false, readOnly: false, busy: true }],
  ] as const)('blocks generate while %s', (_label, state: GenerationInteractionState) => {
    expect(canPerformGenerationAction(state, 'generate')).toBe(false)
  })

  it('allows cancelling a busy task unless the surface is disabled', () => {
    expect(canPerformGenerationAction({ disabled: false, readOnly: true, busy: true }, 'cancel')).toBe(true)
    expect(canPerformGenerationAction({ disabled: true, readOnly: false, busy: true }, 'cancel')).toBe(false)
  })
})
