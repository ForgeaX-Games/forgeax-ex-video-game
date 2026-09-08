import type { KinoImageSize } from './kino-image-schema'

/**
 * 场景参考图预设与提示词组装，与 `character-preview.ts` 对称。
 *
 * 场景固定用 16:9 横构图：它的用途是给节点视频当画面参考，
 * 而节点视频本身是横向演出画面，比例对不上会让参考图失去意义。
 */
export const SCENE_PREVIEW_MODES = ['establishing', 'multiview'] as const
export type ScenePreviewMode = (typeof SCENE_PREVIEW_MODES)[number]
/** 默认出多机位图：工作流不显式传 mode 也要拿到多机位设定图。 */
export const SCENE_PREVIEW_DEFAULT_MODE = 'multiview' satisfies ScenePreviewMode
/**
 * 存量资产没有形态字段时的解释口径，恒为单幅。
 *
 * 不能拿 `SCENE_PREVIEW_DEFAULT_MODE` 兜底：默认值改成多机位后，那样会把历史上
 * 生成的单幅图误读成多机位图，新鲜度判定跟着失真。
 */
export const SCENE_PREVIEW_LEGACY_MODE = 'establishing' satisfies ScenePreviewMode

export const SCENE_PREVIEW_PRESETS = {
  establishing: { aspectRatio: '16:9', size: '2560x1440' },
  // 多机位图共用同一预设：KINO_IMAGE_SIZES 里 16:9 只有这一档。
  multiview: { aspectRatio: '16:9', size: '2560x1440' },
} as const satisfies Record<ScenePreviewMode, {
  aspectRatio: '16:9'
  size: KinoImageSize
}>

/**
 * 衍生机位库，语义照搬影游场所多视角流水线的 `cameras`
 * （`src/server/engine/llm/forge/forgeImagePipeline.ts`）。
 *
 * 每一格只描述**相对全景格的相机变化**，不重复场景描述：影游那边踩过的坑是
 * 重复描述会让模型基于文字重新画一个空间，而不是换个机位拍同一个空间。
 */
export const SCENE_VIEW_ANGLES = [
  {
    id: 'main-area',
    label: '主区域中景',
    instruction: '镜头推近到主要表演区，取景更紧，主光方向与色温与全景格一致。',
  },
  {
    id: 'detail',
    label: '局部特写',
    instruction: '紧凑取景在全景格中已出现过的一处标志性材质或陈设，光线与氛围与全景格一致。',
  },
  {
    id: 'reverse',
    label: '反向视角',
    instruction: '相机转 180 度，看回全景格相机所在的方向，光源方向据此相应改变。',
  },
  {
    id: 'threshold',
    label: '入口 / 过渡区',
    instruction: '相机位于空间的入口或门槛处向内看，时间与光照与全景格一致。',
  },
] as const

export type SceneViewAngleId = (typeof SCENE_VIEW_ANGLES)[number]['id']

export const SCENE_PREVIEW_MIN_ANGLE_COUNT = 1
export const SCENE_PREVIEW_MAX_ANGLE_COUNT = SCENE_VIEW_ANGLES.length
export const SCENE_PREVIEW_DEFAULT_ANGLE_COUNT = SCENE_VIEW_ANGLES.length

export interface ScenePreviewPromptSource {
  name: string
  description: string
  sourcePrompt: string
}

export interface ScenePreviewShape {
  mode?: ScenePreviewMode
  /** 全景格之外的衍生机位数量，按 `SCENE_VIEW_ANGLES` 顺序取前 N。 */
  angleCount?: number
}

export function normalizeSceneAngleCount(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value)) return SCENE_PREVIEW_DEFAULT_ANGLE_COUNT
  return Math.min(Math.max(value, SCENE_PREVIEW_MIN_ANGLE_COUNT), SCENE_PREVIEW_MAX_ANGLE_COUNT)
}

export function scenePreviewSize(mode: ScenePreviewMode): KinoImageSize {
  return SCENE_PREVIEW_PRESETS[mode].size
}

/**
 * 出图形态的稳定标识，进资产 id、新鲜度判定与幂等键。
 *
 * 不含形态就意味着两种 mode 的图落在同一个资产 id 上互相覆盖，且 `skipReady`
 * 会把「已有单幅图」误判成「多机位图也就绪」。单幅模式忽略 angleCount：
 * 那时根本没有衍生机位，把它写进标识只会让无意义的参数差异触发重出图。
 */
export function scenePreviewShapeKey(shape: ScenePreviewShape = {}): string {
  const mode = shape.mode ?? SCENE_PREVIEW_DEFAULT_MODE
  return mode === 'multiview'
    ? `multiview${normalizeSceneAngleCount(shape.angleCount)}`
    : 'establishing'
}

/**
 * 版式说明。全景格恒定占顶部通栏，衍生机位排在下方。
 *
 * 格数写死进提示词而不是让模型自己决定：六格故事板那边实测过模型会自作主张改成
 * 九宫格，`shot-grid-templates.ts` 至今留着一整套版式纠偏正则。
 */
function layoutInstruction(angleCount: number): string {
  const total = angleCount + 1
  const below = angleCount === 1
    ? '下方 1 格通栏'
    : angleCount === 4
      ? '下方 2 行 2 列共 4 格'
      : `下方 1 行 ${angleCount} 格`
  return `版式（严格遵循）：顶部一格通栏，${below}，合计恰好 ${total} 格；`
    + '细黑边框，格间均匀留白，不得出现多余画框、合并画框或缺格。'
}

/** Agent 工作流与场景图片生成页共用的唯一提示词组装入口。 */
export function buildScenePreviewPrompt(
  source: ScenePreviewPromptSource,
  shape: ScenePreviewShape = {},
): string {
  const mode = shape.mode ?? SCENE_PREVIEW_DEFAULT_MODE
  const subject = [
    `场景：${source.name}。`,
    `场景描述：${source.description}。`,
    `视觉要求：${source.sourcePrompt}。`,
  ]
  // 两种 mode 的否定项措辞保持一致：场景图是「舞台」，人物由角色参考图负责；
  // 混进人物会让两类参考图互相干扰。
  const negatives = [
    '画面中不要出现任何人物或角色。',
    '不要文字、标签、边框、签名或水印。',
  ]
  if (mode === 'multiview') {
    const angleCount = normalizeSceneAngleCount(shape.angleCount)
    const angles = SCENE_VIEW_ANGLES.slice(0, angleCount)
    return [
      '生成一张场景多机位设定图，单张 16:9 图内按固定版式排布多个机位。',
      ...subject,
      layoutInstruction(angleCount),
      '顶部通栏 · 建立镜头全景：交代完整空间关系与出入口，把最具识别度的建筑、材质、'
      + '关键陈设与主光源方向一次性呈现清楚，作为下方所有格的视觉锚点。',
      ...angles.map((angle, index) => (
        `下方第 ${index + 1} 格 · ${angle.label}：${angle.instruction}`
      )),
      '所有格是同一个空间、同一时刻、同一光源方向与色温、同一美术风格，'
      + '建筑结构与陈设布局不得改变；每格按宽幅取景构图。',
      '空场，' + negatives[0],
      negatives[1],
    ].join(' ')
  }
  return [
    '生成一张场景概念参考图，用作后续节点视频的画面参考。',
    ...subject,
    '横向构图，完整呈现空间关系、光线氛围与主要景物。',
    ...negatives,
  ].join(' ')
}
