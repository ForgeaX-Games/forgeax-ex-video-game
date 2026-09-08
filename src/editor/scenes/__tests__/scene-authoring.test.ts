import { describe, expect, it } from 'vitest'
import type { SceneDefinition } from '@/authoring/assets/registry-types'
import {
  applySceneOps,
  scenesMissingPreview,
  unresolvedSceneReferences,
  type SceneOp,
} from '@/authoring/scenes/scene-authoring'

function scene(id: string, name: string): SceneDefinition {
  return {
    id,
    name,
    visual: { description: `${name}的画面`, previewPrompt: `${name}，电影质感` },
  }
}

function errorCode(result: ReturnType<typeof applySceneOps>): string | undefined {
  return result.ok ? undefined : result.errors[0]?.code
}

describe('场景目录写入', () => {
  it('把总脉络声明的场景补成完整定义', () => {
    const result = applySceneOps({}, [{
      op: 'upsert-scene',
      sceneId: 'scene_tiger_hill',
      name: '景阳冈',
      description: '暮色下的荒山，枯草与巨石',
      previewPrompt: '暮色荒山，枯草巨石，电影质感，无人物',
    }], { declaredSceneIds: ['scene_tiger_hill'] })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.scenes.scene_tiger_hill).toEqual({
        id: 'scene_tiger_hill',
        name: '景阳冈',
        visual: {
          description: '暮色下的荒山，枯草与巨石',
          previewPrompt: '暮色荒山，枯草巨石，电影质感，无人物',
        },
      })
    }
  })

  it('拒绝新增总脉络未声明的场景', () => {
    const result = applySceneOps({}, [{
      op: 'upsert-scene',
      sceneId: 'scene_extra',
      name: '临时加的',
      description: 'x',
      previewPrompt: 'y',
    }], { declaredSceneIds: ['scene_tiger_hill'] })

    expect(errorCode(result)).toBe('scenes.scene.not-declared')
  })

  it('assets.scene / 交付后允许新建仅资产库场景，并标记 source=catalog', () => {
    const result = applySceneOps({
      scene_tiger_hill: scene('scene_tiger_hill', '景阳冈'),
    }, [{
      op: 'upsert-scene',
      sceneId: 'scene_extra',
      name: '独立夜市',
      description: '灯笼与雨巷',
      previewPrompt: '雨夜灯笼街巷，电影质感，无人物',
    }], {
      declaredSceneIds: ['scene_tiger_hill'],
      allowCatalogAdHoc: true,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.scenes.scene_extra).toMatchObject({
        id: 'scene_extra',
        name: '独立夜市',
        source: 'catalog',
        visual: {
          description: '灯笼与雨巷',
          previewPrompt: '雨夜灯笼街巷，电影质感，无人物',
        },
      })
      expect(result.scenes.scene_tiger_hill?.source).toBeUndefined()
    }
  })

  it('更新已有场景时保留原 source，不因 allowCatalogAdHoc 改写', () => {
    const existing: SceneDefinition = {
      ...scene('scene_extra', '独立夜市'),
      source: 'catalog',
    }
    const result = applySceneOps({ scene_extra: existing }, [{
      op: 'upsert-scene',
      sceneId: 'scene_extra',
      description: '改了描述',
    }], { declaredSceneIds: ['scene_tiger_hill'], allowCatalogAdHoc: true })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.scenes.scene_extra?.source).toBe('catalog')
      expect(result.scenes.scene_extra?.visual.description).toBe('改了描述')
    }
  })

  it('新建场景 ID 遵守与变量一致的字符集约束', () => {
    for (const sceneId of ['场景一', 'scene-hill', '2hill']) {
      const result = applySceneOps({}, [{
        op: 'upsert-scene', sceneId, name: 'n', description: 'd', previewPrompt: 'p',
      }])
      expect(errorCode(result), sceneId).toBe('scenes.scene.invalid-id')
    }
  })

  it('旧项目的历史 ID 仍可更新', () => {
    const legacy = { 'scene-hill': scene('scene-hill', '旧山') }
    const result = applySceneOps(legacy, [{
      op: 'upsert-scene', sceneId: 'scene-hill', description: '改了描述',
    }])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.scenes['scene-hill']?.visual.description).toBe('改了描述')
  })

  it('声明期允许只给 id 与名字，画面与 Prompt 留空', () => {
    // 总脉络先声明、场景线再补内容。把「内容非空」放在写入层会让声明这一步
    // 根本写不进去，那正是真跑里撞出来的死锁；现在由完成门
    // `scenes.catalog.valid` 负责拦空壳。
    const declared = applySceneOps({}, [{ op: 'upsert-scene', sceneId: 'scene_a', name: 'A' }])

    expect(declared.ok).toBe(true)
    if (declared.ok) {
      expect(declared.scenes.scene_a?.visual).toEqual({ description: '', previewPrompt: '' })
    }
  })

  it('没有名字的新场景仍然无法写入', () => {
    expect(errorCode(applySceneOps({}, [{ op: 'upsert-scene', sceneId: 'scene_a' }])))
      .toBe('scenes.scene.name-required')
  })

  it('删除不存在的场景报错，删除存在的场景成功', () => {
    expect(errorCode(applySceneOps({}, [{ op: 'remove-scene', sceneId: 'ghost' }])))
      .toBe('scenes.scene.not-found')
    const result = applySceneOps({ scene_a: scene('scene_a', 'A') }, [
      { op: 'remove-scene', sceneId: 'scene_a' },
    ])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.scenes).toEqual({})
  })

  it('批处理失败时不产生部分写入', () => {
    const result = applySceneOps({}, [
      { op: 'upsert-scene', sceneId: 'scene_ok', name: 'OK', description: 'd', previewPrompt: 'p' },
      { op: 'remove-scene', sceneId: 'ghost' },
    ] as SceneOp[])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failedOpIndex).toBe(1)
  })
})

describe('场景引用完整性', () => {
  it('找出节点引用了但还没定义的场景', () => {
    expect(unresolvedSceneReferences({ scene_a: scene('scene_a', 'A') }, ['scene_a', 'scene_b']))
      .toEqual(['scene_b'])
  })

  it('找出已定义但缺主预览图的场景，且只看节点引用到的', () => {
    const scenes = {
      scene_a: scene('scene_a', 'A'),
      scene_b: { ...scene('scene_b', 'B'), currentAssetId: 'a-sceneref-b' },
      scene_unused: scene('scene_unused', '没人用'),
    }
    expect(scenesMissingPreview(scenes, ['scene_a', 'scene_b'])).toEqual(['scene_a'])
  })
})
