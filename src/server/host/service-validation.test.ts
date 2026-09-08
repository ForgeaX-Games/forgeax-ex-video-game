import { describe, expect, test } from 'vitest'
import generateVideoClipSchema from '../../../schemas/generate-video-clip.args.json'
import generateCharacterPreviewsSchema from '../../../schemas/generate-character-previews.args.json'
import generateScenePreviewsSchema from '../../../schemas/generate-scene-previews.args.json'
import patchGraphSchema from '../../../schemas/patch-graph.args.json'
import patchNodeMediaSchema from '../../../schemas/patch-node-media.args.json'
import {
  KINO_DEFAULT_GENERATION,
  KINO_VIDEO_GENERATION_MODES,
  KINO_VIDEO_RESOLUTIONS,
  KINO_VIDEO_SIZES,
} from '@/runtime/core/schema/kino-schema'
import {
  CHARACTER_PREVIEW_DEFAULT_MODE,
  CHARACTER_PREVIEW_MODES,
  CHARACTER_PREVIEW_PRESETS,
} from '@/runtime/core/schema/character-preview'
import {
  SCENE_PREVIEW_DEFAULT_ANGLE_COUNT,
  SCENE_PREVIEW_DEFAULT_MODE,
  SCENE_PREVIEW_MAX_ANGLE_COUNT,
  SCENE_PREVIEW_MIN_ANGLE_COUNT,
  SCENE_PREVIEW_MODES,
  SCENE_PREVIEW_PRESETS,
} from '@/runtime/core/schema/scene-preview'
import {
  validateServiceInput,
  type ServiceSchemaName,
} from './service-validation'

const accepted: Array<[ServiceSchemaName, unknown]> = [
  ['getGraph', {}],
  ['getGraph', {
    blueprintId: 'main',
    nodeIds: ['entry'],
    fields: ['summary', 'interaction', 'edges'],
  }],
  ['saveGraph', { project: {} }],
  ['listAssets', {
    kind: 'image',
    productionType: 'shot_image',
    sceneNodeId: 'node-1',
  }],
  ['listVideos', {}],
  ['getAsset', { id: 'asset-1' }],
  ['importCharacterRefs', {}],
  ['importSceneRefs', {}],
  ['registerKinoReference', {
    registryId: 'asset-manual-1', hostMediaAssetId: 'media-1',
    kinoResourceId: 'kino-resource-1', kinoGenerationId: 'kino-generation-1',
    productionType: 'character_ref', characterId: 'hero',
    prompt: '角色立绘', model: 'lite', size: '1664x2496',
  }],
  ['generateShotScript', {
    nodeName: 'Opening',
    storyText: 'Hero enters',
    durationSeconds: 1.5,
    interactive: false,
    characters: [{ name: 'Hero', desc: 'Coat' }],
  }],
  ['generateKeyframe', {
    sceneNodeId: 'node-1',
    nodeName: 'Opening',
    beat: 'Hero enters',
    grid: { panelLabels: true, nodeRole: 'regular' },
  }],
  ['generateVideo', {
    sceneNodeId: 'node-1',
    nodeName: 'Opening',
    durationSeconds: 8.5,
    characterRefIds: ['character'],
    sceneRefIds: ['scene'],
    generateAudio: false,
  }],
  ['generateVideoClip', {
    prompt: 'A slow dolly-in toward the warrior under cold moonlight',
    size: '2560x1440',
    resolution: '720p',
    model: 'seedance2',
  }],
  ['patchGraph', {
    ops: [{
      op: 'set-node-data',
      nodeId: 'entry',
      patch: {
        media: {
          kind: 'video',
          prompt: 'A slow dolly-in toward the warrior under cold moonlight',
        },
      },
    }],
  }],
  ['patchNodeMedia', {
    activityRevision: 3,
    expectedGraphRevision: 7,
    graphSnapshotToken: 'game:7',
    expectedAssetRevision: 11,
    idempotencyKey: 'video-presets:main:entry:v1',
    bindings: [{
      nodeRef: { blueprintId: 'main', nodeId: 'entry' },
      media: {
        kind: 'video',
        prompt: 'A slow dolly-in toward the warrior under cold moonlight',
        generation: {
          schemaVersion: 1,
          durationSeconds: 8,
          generateAudio: false,
          mode: 'ref',
          references: {
            sceneAssetIds: ['scene-ref'],
            extraImageAssetIds: ['character-ref'],
          },
        },
      },
    }],
  }],
  ['patchGraph', {
    ops: [{
      op: 'set-node-data',
      nodeId: 'entry',
      patch: {
        overlayNodes: [{
          overlay: 'node:entry',
          overrides: {},
          reactions: [],
        }],
      },
    }],
  }],
  ['patchGraph', {
    snapshotToken: 'game:1',
    expectedRevision: 1,
    idempotencyKey: 'finalization-step-1',
    ops: [{
      op: 'set-node-data',
      nodeId: 'entry',
      patch: { storyText: 'bounded step' },
    }],
  }],
  ['patchGraph', {
    ops: [{
      op: 'set-node-data',
      nodeId: 'entry',
      patch: {
        overlayNodes: [{
          overlay: 'base:InkYingMo',
          layout: { left: 0, top: 0, width: 1, height: 1 },
          overrides: { 'InkYingMo-0': { inputs: {} } },
          reactions: [],
        }],
      },
    }],
  }],
  ['patchGraph', {
    ops: [
      { op: 'make-empty-sub-flow-pack', id: 'pack-tiandao', title: '天道', version: '1.0.0' },
      { op: 'set-sub-flow-pack', nodeId: 'tiandao_enter', packId: 'pack-tiandao', version: '1.0.0' },
    ],
  }],
  ['generateNodeVideo', {
    sceneNodeId: 'node-1',
    nodeName: 'Opening',
    durationSeconds: 120,
    characterRefIds: ['character'],
    sceneRefIds: ['scene'],
  }],
  // 每种合法触发器都必须继续放行，否则收紧 reaction 形状会把正常写入一起拦掉。
  ['patchGraph', {
    ops: [{
      op: 'set-node-data',
      nodeId: 'entry',
      patch: {
        reactions: [
          { when: { type: 'enter' }, do: [{ kind: 'effect', effects: [{ kind: 'flag', varId: 'seen', value: true }] }] },
          { when: { type: 'at', ms: 1200 }, do: [{ kind: 'spawn', from: 'hud/rage', ttlMs: 800 }] },
          { when: { type: 'exit' }, do: [] },
          { when: { type: 'complete' }, do: [{ kind: 'advance', edgeId: 'e-1' }] },
          {
            when: { type: 'complete', if: { all: [{ type: 'visited', nodeId: 'open' }] } },
            do: [{ kind: 'advance', edgeId: 'e-2' }],
          },
          { when: { type: 'event', id: 'qte:hit' }, do: [{ kind: 'hideOverlay', mountId: 'hud' }] },
          {
            when: { type: 'state', condition: { all: [{ type: 'attrRatio', entityId: 'ent-boss', attr: 'hp', op: 'lte', value: 0 }] } },
            do: [{ kind: 'advance', edgeId: 'settlement-advance:win' }],
          },
          {
            when: { type: 'watch', of: 'entity.ent-player.attr.hp', on: 'dec' },
            do: [{ kind: 'spawn', from: 'hud/float', inputs: { text: { expr: 'delta' } }, layout: { left: 0, top: 0 } }],
          },
          { when: { type: 'shown', of: 'hud/rage' }, do: [] },
          { when: { type: 'hidden', of: 'hud/rage' }, do: [] },
        ],
      },
    }],
  }],
  // 效果原语的完整取值域：表达式值、once/id、文本变量、道具。
  ['patchGraph', {
    ops: [{
      op: 'set-node-data',
      nodeId: 'entry',
      patch: {
        reactions: [{
          when: { type: 'enter' },
          do: [{
            kind: 'effect',
            effects: [
              { kind: 'attr', entityId: 'ent-player', attr: 'hp', op: 'add', value: -10, once: true, id: 'fx-1' },
              { kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'set', value: { expr: 'entity.ent-boss.attr.hp * 0.5' } },
              { kind: 'var', varId: 'qi', op: 'mul', value: 2 },
              { kind: 'var', varId: 'chapter', valueType: 'text', op: 'set', value: { ref: 'var.nextChapter' } },
              { kind: 'item', itemId: 'elixir', op: 'give', count: 1 },
            ],
          }],
        }],
      },
    }],
  }],
  ['patchGraph', {
    ops: [{
      op: 'set-node-data',
      nodeId: 'entry',
      patch: {
        overlayNodes: [{
          overlay: 'base:InkYingMo',
          reactions: [{ when: { type: 'event', id: 'InkYingMo-0:done' }, do: [{ kind: 'advance', edgeId: 'e-1' }] }],
        }],
      },
    }],
  }],
]

const rejected: Array<[ServiceSchemaName, unknown]> = [
  ['patchNodeMedia', {
    activityRevision: 3,
    expectedGraphRevision: 7,
    graphSnapshotToken: 'game:7',
    expectedAssetRevision: 11,
    idempotencyKey: 'video-presets:main:entry:v1',
    bindings: [{
      nodeRef: { blueprintId: 'main', nodeId: 'entry' },
      media: {
        kind: 'video',
        prompt: 'A slow dolly-in',
        generation: {
          schemaVersion: 1,
          durationSeconds: 8,
          generateAudio: false,
          mode: 'ref',
          references: { firstFrameResourceId: 'kino-provider-id' },
        },
      },
    }],
  }],
  ['patchNodeMedia', {
    activityRevision: 3,
    expectedGraphRevision: 7,
    graphSnapshotToken: 'game:7',
    expectedAssetRevision: 11,
    idempotencyKey: 'video-presets:main:entry:v1',
    bindings: [{
      nodeRef: { blueprintId: 'main', nodeId: 'entry' },
      media: {
        kind: 'video',
        prompt: 'A slow dolly-in',
        generation: {
          schemaVersion: 1,
          durationSeconds: 8,
          generateAudio: false,
          mode: 't2v',
          references: {},
        },
      },
      storyText: 'must not be writable through this operation',
    }],
  }],
  ['getGraph', { cwd: '/private/secret' }],
  ['listAssets', { gameSlug: '游戏一' }],
  ['importSceneRefs', { gameSlug: '游戏一' }],
  ['saveGraph', { project: {}, cwd: '/private/secret' }],
  ['saveGraph', {}],
  ['listAssets', { kind: 'audio' }],
  ['listAssets', { productionType: 'legacy_asset' }],
  ['listVideos', { extensionDir: '/private/secret' }],
  ['getAsset', { id: 'asset-1', extra: true }],
  ['getAsset', { id: 1 }],
  ['importCharacterRefs', { characterIds: ['hero'] }],
  ['importSceneRefs', { files: ['scene.png'] }],
  ['registerKinoReference', { productionType: 'character_ref' }],
  ['generateShotScript', {
    nodeName: 'Opening',
    storyText: 'Hero enters',
    interactive: 'false',
  }],
  ['generateShotScript', {
    nodeName: 'Opening',
    storyText: 'Hero enters',
    characters: [{ name: 'Hero', sourceUrl: 'https://secret.invalid' }],
  }],
  ['generateKeyframe', {
    sceneNodeId: 'node-1',
    nodeName: 'Opening',
    beat: 'Hero enters',
    grid: { panelLabels: 'true' },
  }],
  ['generateKeyframe', {
    sceneNodeId: 'node-1',
    nodeName: 'Opening',
    beat: 'Hero enters',
    styleAxes: { artMedia: 'ink', extra: true },
  }],
  ['generateVideo', {
    sceneNodeId: 'node-1',
    nodeName: 'Opening',
    durationSeconds: 61,
    characterRefIds: ['character'],
    sceneRefIds: ['scene'],
  }],
  ['generateVideoClip', { prompt: '' }],
  ['patchGraph', {
    ops: [{
      op: 'set-node-data',
      nodeId: 'entry',
      patch: { media: { kind: 'video' } },
    }],
  }],
  ['patchGraph', {
    ops: [{
      op: 'set-node-data',
      nodeId: 'entry',
      patch: {
        overlayNodes: [{
          overlay: 'base:InkYingMo',
          children: [{ id: 'InkYingMo-0', component: 'InkYingMo' }],
        }],
      },
    }],
  }],
  // attach-sub-process is inline-only; a packId here means the caller wanted set-sub-flow-pack.
  ['patchGraph', {
    ops: [{ op: 'attach-sub-process', nodeId: 'tiandao_enter', packId: 'pack-tiandao' }],
  }],
  ['patchGraph', {
    ops: [{ op: 'set-sub-flow-pack', nodeId: 'tiandao_enter' }],
  }],
  ['generateVideo', {
    sceneNodeId: 'node-1',
    nodeName: 'Opening',
    characterRefIds: [],
    sceneRefIds: ['scene'],
  }],
  ['generateNodeVideo', {
    sceneNodeId: 'node-1',
    nodeName: 'Opening',
    durationSeconds: 121,
    characterRefIds: ['character'],
    sceneRefIds: ['scene'],
  }],
  ['generateNodeVideo', {
    sceneNodeId: 'node-1',
    nodeName: 'Opening',
    characterRefIds: ['character'],
    sceneRefIds: ['scene'],
    extend: true,
  }],
  // 真实事故形状：AI 把出边的 edge.data.condition 写法套到 reaction 顶层，
  // 编辑器读 reaction.when.condition.all 直接 TypeError 崩整页。写入口必须当场打回。
  ['patchGraph', {
    ops: [{
      op: 'set-node-data',
      nodeId: 'entry',
      patch: {
        reactions: [{
          when: { type: 'state' },
          condition: { all: [{ type: 'attrRatio', entityId: 'ent-boss', attr: 'hp', op: 'lte', value: 0 }] },
          do: [{ kind: 'advance', edgeId: 'e-1' }],
        }],
      },
    }],
  }],
  ['patchGraph', {
    ops: [{
      op: 'set-node-data',
      nodeId: 'entry',
      patch: { reactions: [{ when: { type: 'state' }, do: [] }] },
    }],
  }],
  ['patchGraph', {
    ops: [{
      op: 'set-node-data',
      nodeId: 'entry',
      patch: { reactions: [{ when: { type: 'state', condition: 'boss.hp <= 0' }, do: [] }] },
    }],
  }],
  ['patchGraph', {
    ops: [{
      op: 'set-node-data',
      nodeId: 'entry',
      patch: { reactions: [{ when: { type: 'state', condition: { any: [] } }, do: [] }] },
    }],
  }],
  ['patchGraph', {
    ops: [{
      op: 'set-node-data',
      nodeId: 'entry',
      patch: { reactions: [{ when: { type: 'enter' } }] },
    }],
  }],
  ['patchGraph', {
    ops: [{
      op: 'set-node-data',
      nodeId: 'entry',
      patch: { reactions: [{ when: { type: 'onBattleStart' }, do: [] }] },
    }],
  }],
  ['patchGraph', {
    ops: [{
      op: 'set-node-data',
      nodeId: 'entry',
      patch: {
        overlayNodes: [{
          overlay: 'base:InkYingMo',
          reactions: [{ when: { type: 'state' }, condition: { all: [] }, do: [] }],
        }],
      },
    }],
  }],
]

describe('published service schemas', () => {
  test.each(accepted)('accepts %s contract input', (schema, input) => {
    expect(validateServiceInput(schema, input)).toEqual([])
  })

  test.each(rejected)('rejects %s contract drift', (schema, input) => {
    expect(validateServiceInput(schema, input).length).toBeGreaterThan(0)
  })

  test('projects Kino defaults and modes into the Agent-facing tool schemas', () => {
    const properties = generateVideoClipSchema.properties
    expect(properties.durationSeconds.default).toBe(
      KINO_DEFAULT_GENERATION.durationSeconds,
    )
    expect(properties.generateAudio.default).toBe(
      KINO_DEFAULT_GENERATION.generateAudio,
    )
    expect(properties.mode).toMatchObject({
      enum: [...KINO_VIDEO_GENERATION_MODES],
      default: KINO_DEFAULT_GENERATION.mode,
    })
    expect(properties.size).toMatchObject({
      enum: [...KINO_VIDEO_SIZES],
      default: KINO_DEFAULT_GENERATION.size,
    })
    expect(properties.resolution).toMatchObject({
      enum: [...KINO_VIDEO_RESOLUTIONS],
      default: KINO_DEFAULT_GENERATION.resolution,
    })
    expect(patchGraphSchema.$defs.nodeMedia.properties.prompt).toMatchObject({
      type: 'string',
      minLength: 1,
      maxLength: 4000,
    })
    expect(patchNodeMediaSchema.$defs.media).not.toHaveProperty('properties.ref')
    expect(patchNodeMediaSchema.$defs.media).not.toHaveProperty('properties.meta')
    expect(patchNodeMediaSchema.$defs.media.additionalProperties).toBe(false)
    expect(patchNodeMediaSchema.$defs.generation.required).toContain('references')
    expect(patchGraphSchema.$defs.layout.description).toContain(
      'width:1,height:1',
    )
    expect(generateCharacterPreviewsSchema.properties.mode).toMatchObject({
      enum: [...CHARACTER_PREVIEW_MODES],
      default: CHARACTER_PREVIEW_DEFAULT_MODE,
    })
    expect(generateCharacterPreviewsSchema.properties.mode.description).toContain(
      `${CHARACTER_PREVIEW_PRESETS.turnaround.size}`,
    )
    expect(generateCharacterPreviewsSchema.description).toContain('never substitute generate-keyframe')
    expect(generateScenePreviewsSchema.properties.mode).toMatchObject({
      enum: [...SCENE_PREVIEW_MODES],
      default: SCENE_PREVIEW_DEFAULT_MODE,
    })
    expect(generateScenePreviewsSchema.properties.angleCount).toMatchObject({
      minimum: SCENE_PREVIEW_MIN_ANGLE_COUNT,
      maximum: SCENE_PREVIEW_MAX_ANGLE_COUNT,
      default: SCENE_PREVIEW_DEFAULT_ANGLE_COUNT,
    })
    expect(generateScenePreviewsSchema.properties.mode.description).toContain(
      `${SCENE_PREVIEW_PRESETS.multiview.size}`,
    )
  })
})
