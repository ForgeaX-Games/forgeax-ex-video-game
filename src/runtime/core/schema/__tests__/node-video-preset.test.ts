import { describe, expect, it } from 'vitest'
import { KINO_DEFAULT_GENERATION } from '../kino-schema'
import type { NodeMedia } from '../graph-schema'
import {
  isNodeVideoMedia,
  resolveNodeVideoPreset,
  validateNodeVideoGenerationPreset,
} from '../node-video-preset'

describe('isNodeVideoMedia', () => {
  it('accepts a video node that carries a base prompt', () => {
    expect(isNodeVideoMedia({ kind: 'video', prompt: '悟空闯入凌霄殿' })).toBe(true)
  })

  it('rejects media without a usable base prompt', () => {
    expect(isNodeVideoMedia(undefined)).toBe(false)
    expect(isNodeVideoMedia({ kind: 'video' })).toBe(false)
    expect(isNodeVideoMedia({ kind: 'video', prompt: '   ' })).toBe(false)
    expect(isNodeVideoMedia({ kind: 'image', prompt: 'x' })).toBe(false)
  })
})

describe('validateNodeVideoGenerationPreset', () => {
  it('accepts a complete provider-neutral preset', () => {
    expect(validateNodeVideoGenerationPreset({
      schemaVersion: 1,
      durationSeconds: 8,
      generateAudio: false,
      mode: 'ref',
      resolution: '720p',
      references: { sceneAssetIds: ['scene-1'] },
    })).toEqual([])
  })

  it('rejects provider fields and invalid stable author options', () => {
    const errors = validateNodeVideoGenerationPreset({
      schemaVersion: 1,
      durationSeconds: 20,
      generateAudio: 'yes',
      mode: 'unknown',
      firstFrameResourceId: 'kino-resource-1',
      references: { referenceImageResourceIds: ['kino-resource-2'] },
    })

    expect(errors.join('\n')).toContain("不支持字段 'firstFrameResourceId'")
    expect(errors.join('\n')).toContain("不支持字段 'referenceImageResourceIds'")
    expect(errors.join('\n')).toContain('durationSeconds')
    expect(errors.join('\n')).toContain('generateAudio')
    expect(errors.join('\n')).toContain('mode')
  })
})

describe('resolveNodeVideoPreset', () => {
  it('returns nothing for a node that is not an authored video beat', () => {
    expect(resolveNodeVideoPreset(undefined)).toBeNull()
    expect(resolveNodeVideoPreset({ kind: 'image', prompt: 'x' })).toBeNull()
    expect(resolveNodeVideoPreset({ kind: 'video' })).toBeNull()
  })

  it('builds a compatibility draft for a legacy node that only has a base prompt', () => {
    const resolved = resolveNodeVideoPreset({ kind: 'video', prompt: '悟空闯入凌霄殿' })

    expect(resolved).toEqual({
      source: 'legacy-default',
      preset: {
        schemaVersion: 1,
        durationSeconds: KINO_DEFAULT_GENERATION.durationSeconds,
        generateAudio: KINO_DEFAULT_GENERATION.generateAudio,
        mode: KINO_DEFAULT_GENERATION.mode,
        size: KINO_DEFAULT_GENERATION.size,
        resolution: KINO_DEFAULT_GENERATION.resolution,
      },
    })
  })

  it('never carries the Kino default empty prompt into the preset', () => {
    // `media.prompt` stays the single prompt SSOT; the preset holds everything else.
    const resolved = resolveNodeVideoPreset({ kind: 'video', prompt: '一段提示词' })

    expect(resolved?.preset).not.toHaveProperty('prompt')
  })

  it('reports an authored preset and preserves its explicit choices', () => {
    const resolved = resolveNodeVideoPreset({
      kind: 'video',
      prompt: '悟空腾云',
      generation: {
        schemaVersion: 1,
        durationSeconds: 5,
        generateAudio: true,
        mode: 'ref',
        resolution: '1080p',
        visualStyleKey: 'ink-wash',
        references: { sceneAssetIds: ['a-scene-1'] },
      },
    })

    expect(resolved?.source).toBe('authored')
    expect(resolved?.preset).toMatchObject({
      durationSeconds: 5,
      generateAudio: true,
      mode: 'ref',
      resolution: '1080p',
      visualStyleKey: 'ink-wash',
      references: { sceneAssetIds: ['a-scene-1'] },
    })
  })

  it('fills gaps in a partially authored preset without downgrading it to legacy', () => {
    const resolved = resolveNodeVideoPreset({
      kind: 'video',
      prompt: '悟空腾云',
      generation: { mode: 'firstref' } as never,
    })

    expect(resolved?.source).toBe('authored')
    expect(resolved?.preset.mode).toBe('firstref')
    expect(resolved?.preset.durationSeconds)
      .toBe(KINO_DEFAULT_GENERATION.durationSeconds)
    expect(resolved?.preset.schemaVersion).toBe(1)
  })

  it('treats a malformed generation block as absent rather than throwing', () => {
    for (const generation of ['nope', 42, null, []] as unknown[]) {
      const resolved = resolveNodeVideoPreset({
        kind: 'video',
        prompt: '悟空腾云',
        generation,
      } as NodeMedia)

      expect(resolved?.source).toBe('legacy-default')
    }
  })

  it('does not mutate or rewrite the node media it reads', () => {
    const media: NodeMedia = { kind: 'video', prompt: '悟空腾云' }
    const snapshot = JSON.stringify(media)

    resolveNodeVideoPreset(media)

    expect(JSON.stringify(media)).toBe(snapshot)
  })
})
