/**
 * 读取节点视频生成预设的兼容适配层。
 *
 * 旧蓝图节点只有 `media.kind = "video"` 和 `media.prompt`，没有 `media.generation`。
 * 读取时用 Kino 默认生成选项拼一份兼容 draft，**不改写原文件**：迁移只在作者显式
 * 写入时发生，新工作流的完成门再要求 `source === 'authored'`。
 *
 * 这里只处理 provider-resource-neutral 的作者选项。Kino resource id 的解析发生在
 * 用户点击生成的提交边界，不在本模块。
 */
import type { NodeMedia, NodeVideoGenerationPreset, NodeVideoMedia } from './graph-schema'
import {
  KINO_DEFAULT_GENERATION,
  KINO_VIDEO_MAX_DURATION_SECONDS,
  KINO_VIDEO_GENERATION_MODES,
  KINO_VIDEO_MIN_DURATION_SECONDS,
  KINO_VIDEO_RESOLUTIONS,
  KINO_VIDEO_SIZES,
} from './kino-schema'

export type NodeVideoPresetSource = 'authored' | 'legacy-default'

export interface ResolvedNodeVideoPreset {
  preset: NodeVideoGenerationPreset
  /**
   * `authored` = 节点上存在 generation 块（可能仍有缺项，由 validator 判定是否合格）。
   * `legacy-default` = 完全没有 generation，本次结果是读取期 draft。
   */
  source: NodeVideoPresetSource
}

/** 已具备基础 prompt 的视频演出节点。空白 prompt 不算已授权的视频节点。 */
export function isNodeVideoMedia(media: NodeMedia | undefined): media is NodeVideoMedia {
  return media?.kind === 'video'
    && typeof media.prompt === 'string'
    && media.prompt.trim().length > 0
}

function defaultPreset(): NodeVideoGenerationPreset {
  // 默认生成配置也带 prompt；这里刻意不取，prompt 的唯一真相源
  // 是 `media.prompt`。
  const { durationSeconds, generateAudio, mode, size, resolution } =
    KINO_DEFAULT_GENERATION
  return { schemaVersion: 1, durationSeconds, generateAudio, mode, size, resolution }
}

function authoredBlock(media: NodeVideoMedia): Partial<NodeVideoGenerationPreset> | null {
  const generation: unknown = media.generation
  if (typeof generation !== 'object' || generation === null || Array.isArray(generation)) {
    return null
  }
  return generation as Partial<NodeVideoGenerationPreset>
}

/**
 * 解析出一份完整预设，并说明它是作者写的还是读取期补的。
 *
 * 返回 `null` 表示该节点不是已授权的视频演出节点（无 media / 非 video / 无 prompt），
 * 调用方不应把它当作待生成节点。
 */
export function resolveNodeVideoPreset(
  media: NodeMedia | undefined,
): ResolvedNodeVideoPreset | null {
  if (!isNodeVideoMedia(media)) return null
  const authored = authoredBlock(media)
  if (!authored) return { preset: defaultPreset(), source: 'legacy-default' }
  // 缺项用默认值补齐，但仍算 authored：部分写入是作者数据不完整，
  // 不是旧数据，应由完成门报错而不是被静默当成 legacy。
  return {
    preset: { ...defaultPreset(), ...authored, schemaVersion: 1 },
    source: 'authored',
  }
}

const PRESET_KEYS = new Set([
  'schemaVersion',
  'durationSeconds',
  'generateAudio',
  'mode',
  'size',
  'resolution',
  'model',
  'visualStyleKey',
  'references',
])
const REFERENCE_KEYS = new Set([
  'sceneAssetIds',
  'firstFrameAssetId',
  'lastFrameAssetId',
  'extraImageAssetIds',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function validAssetIds(value: unknown): boolean {
  return Array.isArray(value) && value.every(nonEmptyString)
}

/** Deterministic persisted-shape validation; provider combination checks stay at submission. */
export function validateNodeVideoGenerationPreset(value: unknown): string[] {
  if (!isRecord(value)) return ['generation 必须是对象']
  const errors: string[] = []
  for (const key of Object.keys(value)) {
    if (!PRESET_KEYS.has(key)) errors.push(`generation 包含不支持字段 '${key}'`)
  }
  if (value.schemaVersion !== 1) errors.push('generation.schemaVersion 必须为 1')
  if (
    typeof value.durationSeconds !== 'number'
    || !Number.isFinite(value.durationSeconds)
    || !Number.isInteger(value.durationSeconds)
    || value.durationSeconds < KINO_VIDEO_MIN_DURATION_SECONDS
    || value.durationSeconds > KINO_VIDEO_MAX_DURATION_SECONDS
  ) {
    errors.push(
      `generation.durationSeconds 必须在 ${KINO_VIDEO_MIN_DURATION_SECONDS} 到 ${KINO_VIDEO_MAX_DURATION_SECONDS} 之间`,
    )
  }
  if (typeof value.generateAudio !== 'boolean') {
    errors.push('generation.generateAudio 必须是 boolean')
  }
  if (!KINO_VIDEO_GENERATION_MODES.includes(value.mode as never)) {
    errors.push('generation.mode 不受支持')
  }
  if (value.size !== undefined && !KINO_VIDEO_SIZES.includes(value.size as never)) {
    errors.push('generation.size 不受支持')
  }
  if (
    value.resolution !== undefined
    && !KINO_VIDEO_RESOLUTIONS.includes(value.resolution as never)
  ) {
    errors.push('generation.resolution 不受支持')
  }
  for (const field of ['model', 'visualStyleKey'] as const) {
    if (value[field] !== undefined && !nonEmptyString(value[field])) {
      errors.push(`generation.${field} 必须是非空字符串`)
    }
  }
  if (value.references !== undefined) {
    if (!isRecord(value.references)) {
      errors.push('generation.references 必须是对象')
    } else {
      for (const key of Object.keys(value.references)) {
        if (!REFERENCE_KEYS.has(key)) {
          errors.push(`generation.references 包含不支持字段 '${key}'`)
        }
      }
      for (const field of ['sceneAssetIds', 'extraImageAssetIds'] as const) {
        const candidate = value.references[field]
        if (candidate !== undefined && !validAssetIds(candidate)) {
          errors.push(`generation.references.${field} 必须是非空 asset id 数组`)
        }
      }
      for (const field of ['firstFrameAssetId', 'lastFrameAssetId'] as const) {
        const candidate = value.references[field]
        if (candidate !== undefined && !nonEmptyString(candidate)) {
          errors.push(`generation.references.${field} 必须是非空 asset id`)
        }
      }
    }
  }
  return errors
}
