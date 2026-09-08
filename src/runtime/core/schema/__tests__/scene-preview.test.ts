import { describe, expect, it } from 'vitest'
import {
  buildScenePreviewPrompt,
  SCENE_PREVIEW_DEFAULT_ANGLE_COUNT,
  SCENE_PREVIEW_DEFAULT_MODE,
  SCENE_PREVIEW_MODES,
  SCENE_PREVIEW_PRESETS,
  SCENE_VIEW_ANGLES,
  normalizeSceneAngleCount,
  scenePreviewShapeKey,
  scenePreviewSize,
} from '../scene-preview'

const source = {
  name: '断桥客栈',
  description: '雨夜山道旁的木构客栈',
  sourcePrompt: 'rain-soaked timber inn',
}

describe('scene preview contract', () => {
  it('keeps the single-frame concept prompt available as an explicit mode', () => {
    const prompt = buildScenePreviewPrompt(source, { mode: 'establishing' })

    expect(prompt).toContain('生成一张场景概念参考图')
    expect(prompt).toContain('rain-soaked timber inn')
    expect(prompt).toContain('画面中不要出现任何人物或角色。')
    expect(SCENE_PREVIEW_MODES).toEqual(['establishing', 'multiview'])
    expect(scenePreviewSize('establishing')).toBe('2560x1440')
    expect(SCENE_PREVIEW_PRESETS.multiview).toEqual({
      aspectRatio: '16:9',
      size: '2560x1440',
    })
  })

  it('builds a five-panel multiview sheet with the full camera library by default', () => {
    const prompt = buildScenePreviewPrompt(source)

    expect(SCENE_PREVIEW_DEFAULT_MODE).toBe('multiview')
    expect(SCENE_PREVIEW_DEFAULT_ANGLE_COUNT).toBe(4)
    expect(prompt).toContain('生成一张场景多机位设定图')
    expect(prompt).toContain('顶部一格通栏，下方 2 行 2 列共 4 格，合计恰好 5 格')
    expect(prompt).toContain('不得出现多余画框、合并画框或缺格')
    for (const angle of SCENE_VIEW_ANGLES) expect(prompt).toContain(angle.label)
    expect(prompt).toContain('每格按宽幅取景构图')
    expect(prompt).toContain('空场，画面中不要出现任何人物或角色。')
    expect(prompt).toContain('不要文字、标签、边框、签名或水印。')
  })

  it('derives the layout from angleCount and takes angles in library order', () => {
    const prompt = buildScenePreviewPrompt(source, { mode: 'multiview', angleCount: 2 })

    expect(prompt).toContain('顶部一格通栏，下方 1 行 2 格，合计恰好 3 格')
    expect(prompt).toContain('主区域中景')
    expect(prompt).toContain('局部特写')
    expect(prompt).not.toContain('反向视角')
    expect(buildScenePreviewPrompt(source, { mode: 'multiview', angleCount: 1 }))
      .toContain('顶部一格通栏，下方 1 格通栏，合计恰好 2 格')
  })

  it('clamps angleCount into the camera library range', () => {
    expect(normalizeSceneAngleCount(undefined)).toBe(SCENE_PREVIEW_DEFAULT_ANGLE_COUNT)
    expect(normalizeSceneAngleCount(0)).toBe(1)
    expect(normalizeSceneAngleCount(99)).toBe(SCENE_VIEW_ANGLES.length)
  })

  it('keys the image shape so the two modes never share an identity', () => {
    expect(scenePreviewShapeKey()).toBe('multiview4')
    // 单幅模式没有衍生机位，angleCount 不该制造出无意义的形态差异。
    expect(scenePreviewShapeKey({ mode: 'establishing', angleCount: 2 })).toBe('establishing')
    expect(scenePreviewShapeKey({ mode: 'multiview' })).toBe('multiview4')
    expect(scenePreviewShapeKey({ mode: 'multiview', angleCount: 2 })).toBe('multiview2')
  })
})
