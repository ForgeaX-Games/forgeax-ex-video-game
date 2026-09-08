/**
 * [vendored · reel-fmv-merge-plan.md §0.5 / P1] 逐字搬自 reel
 * `src/llm/forge/forgeImagePipeline.ts`。所有 prompt 构建函数（buildShotKeyframePrompt /
 * buildCharacterTurnaroundPrompt / buildSceneKeyframePrompt / ...）**一字未改**。
 * 唯一改动：删掉原文件底部依赖浏览器/编排层的 async 调度器 `runForgeImagePipeline`
 * 及其 Opts/Summary 类型（原本 import `../util/concurrency`=zustand settingsStore、
 * `../pipeline/batchImageGen`），因为 studio 侧调度归服务端 headless 的 orchestrate.ts。
 * 相应地删除 `composeVisualPrompt` / `ImageClient` 两个仅调度器用到的 import。
 *
 * forgeImagePipeline —— 角色三视图 / 场所基准图 / 关键帧的并发生图调度。
 *
 * 三类任务：
 *   1) character-turnaround  每角色 1 次；prompt 模板强调"正面/侧面/背面一图"
 *   2) location-keyframe      每场所 1 次；prompt 模板强调"空场无人，可叠角色"
 *   3) scene-keyframe         每场景 1 次；优先用 location.refImageId 当参考
 *
 * 当前 ImageClient 的参考图 API 是 `referenceImageDataUrl: string`（单张），
 * 所以关键帧生图时我们按优先级选一张（location base > character turnaround）
 * 喂进去。将来底层支持 multi-image 时再扩到三张。
 *
 * 所有任务通过 runWithConcurrency 调度（默认并发 3，比 batchImageGen 的 4
 * 略保守，因为 character/location 生成的 prompt 比 scene 更长，总 token 更重）。
 *
 * **保留纯函数层**（buildCharacterTurnaroundPrompt / buildLocationPrompt /
 * buildSceneKeyframePrompt）便于单测 —— LLM 的 prompt 漂移可以通过改这几个函数
 * 定向修复，不用碰 UI / 调度器。
 */

import type {
  Scenario,
  Character,
  Location,
  Prop,
  Scene,
  Shot,
  ShotFraming,
  VisualStyle,
} from '../../scenario/types'
import {
  faceMaskClause,
  shotFaceMaskClause,
} from '../refsets/faceMaskPrompt'
// 保留 re-export：老的测试 / 外部 import 走 forgeImagePipeline 的不用动
export { faceMaskClause, shotFaceMaskClause }

// ─── Prompt 模板（纯函数） ─────────────────────────────────────────────

/**
 * 角色三视图生成的选项 —— 允许作者控制风格分流和面部马赛克强度。
 *
 * `visualStyle` 留空时走"通用写实"模板（与 photoreal 等价），保证
 * 老调用方（没带 opts 的）继续拿到合理输出。
 */
export interface BuildCharacterTurnaroundOpts {
  visualStyle?: VisualStyle
  /**
   * @deprecated v7 起生成期不再打码（展示干净写实图），此字段被忽略。
   *   人脸打码迁移到上传期的 faceMaskTool。保留字段仅为兼容旧调用点。
   */
  faceMaskIntensity?: 'none' | 'subtle' | 'full'
}

/**
 * 角色设计参考稿（turnaround）的「多分格拼版」骨架 —— 所有风格共用。
 *
 * 布局（作者指定 · 截图同款 multi-panel character sheet，纯白无缝背景）：
 *   · 左上：大尺寸正面半身特写（large front-facing close-up bust / head-and-shoulders）
 *   · 左下：两个较小头部视图并排 —— 左=正左侧脸（left profile）、右=四分之三侧（three-quarter）
 *   · 右侧：两张完整全身并排 —— 左=正面站姿、右=背面站姿（front / back full-body standing）
 *   · 左上角标注角色英文大写名牌（small uppercase role label）
 *   全程同一角色，面部/发型/服装/比例严格一致。
 *
 * 风格层：`styleBlock` 会被各风格模板填入（写实/二次元/卡通等）。
 * 打码（仅写实真人风格 · 作者定稿）：生成期对**每一张可见人脸的左半边五官**
 *   做马赛克/像素化（写实风格的合规护栏）。非写实（anime/cartoon/…）不打码。
 *   注意：这与「上传给 Seedance 前」faceMaskTool 的像素级半脸打码是两道独立保险。
 */
function composeTurnaroundBody(args: {
  character: Character
  visualStyle: VisualStyle | undefined
  /** 风格层（质感表现、服装材质细节等），放在布局之后 */
  styleBlock: string
}): string {
  const { character, visualStyle, styleBlock } = args
  const core = character.prompt?.trim() || '普通现代人物（default generic contemporary character）'

  const parts: string[] = [
    `角色设计参考稿（Character design reference sheet），角色：${character.name}。`,
    `外观设定：${core}。`,
    '布局设定（严格遵循，单张图多分格拼版 multi-panel character sheet）：',
    '· 左上：大尺寸正面半身特写（large front-facing close-up bust / head-and-shoulders portrait），五官清晰；',
    '· 左下：两个较小的头部视图并排 —— 左为正左侧脸（left profile view），右为四分之三侧脸（three-quarter view）；',
    '· 右侧：两张完整全身像并排 —— 左为正面站姿（front view, full body standing），右为背面站姿（back view, full body standing），双臂自然下垂、中性站姿、完整服化道（complete wardrobe and accessories）；',
    '· 画面左上角标注角色英文/拉丁大写名牌（small uppercase role label）。',
    '一致性要求：所有分格必须是同一个人 —— 面部、发型、服装、配饰、身材比例严格一致。',
  ]

  parts.push(styleBlock)

  // 写实真人风格的合规护栏：对画面里每一张可见脸的左半边五官打码（作者定稿）。
  // 非写实风格（anime/cartoon/pixelart/watercolor/ink）跳过。
  if (isRealisticVisualStyle(visualStyle)) {
    parts.push(
      '合规打码（仅写实真人风格，严格执行）：将画面中该角色每一张可见人脸的左半边五官（the left half of every visible face）做马赛克 / 像素化处理（mosaic / pixelate the left half of the facial features），马赛克程度 100%（fully opaque mosaic, 100% strength，完全遮盖该侧五官、不残留可辨细节），右半边保持清晰可辨；皮肤其余部位、发型、服装、配饰不受影响。',
    )
  }

  parts.push(
    '纯白无缝背景（clean seamless white background），均匀柔和的影棚布光，构图工整，各分格清晰分隔、互不重叠，整图横向 3:2 比例（landscape 3:2）。',
  )
  return parts.join('\n')
}

/**
 * 各 visualStyle 的"质感表现"片段 —— 只写风格层，不碰布局。
 *
 * v6.4（2026-05-11）· 去掉商业 IP 名：
 *   Makoto Shinkai / Kyoto Animation / Pixar / Disney 这类知名 IP 名字在
 *   Azure safety filter 上会被额外收紧（防 IP 侵权）。改成纯风格描述即可。
 */
function styleBlockFor(vs: VisualStyle | undefined): string {
  // 各风格末尾共用的「差异化护栏」：要求同风格大类内按角色气质选定子风格，
  // 而不是所有图都套同一个默认模子（P2.6 防千篇一律）。
  const antiCliche = (subStyles: string) =>
    `差异化：在本风格大类内按角色气质/场景情绪选定一档子风格（${subStyles}），避免千篇一律的默认套路。`

  switch (vs) {
    case 'anime':
      return [
        '质感表现：日系二次元动画风（Japanese cel-shaded animation），干净的赛璐珞上色（clean cel shading），',
        '富有张力的线稿（expressive linework），大眼/精致五官，浅色高光，高质量 2D 插画。',
        antiCliche('精致电影级 2D（film-grade）/ 大众扁平 TV 动画（flat TV anime）/ 厚涂插画感'),
      ].join(' ')
    case 'cartoon':
      return [
        '质感表现：西式卡通插画（Western cartoon），粗黑描边（bold black outlines），',
        '平涂鲜艳色彩，夸张表情，家庭友好型风格化角色设计。',
        antiCliche('精致电影级 3D CG / 大众扁平绘本 / 手绘漫画感'),
      ].join(' ')
    case 'pixelart':
      return [
        '质感表现：复古 16-bit 像素画（retro 16-bit pixel art），有限色板，锐利像素边缘，',
        '抖动阴影（dithered shading），经典主机时代游戏立绘审美。',
        antiCliche('8-bit 极简 / 16-bit 精细 dithering / 现代高分像素插画'),
      ].join(' ')
    case 'watercolor':
      return [
        '质感表现：水彩晕染（watercolor wash），柔和笔触，半透明颜料叠加，',
        '纸张纹理（paper texture），手绘暖感，边缘轻微虚化。',
        antiCliche('湿画法大面积晕染 / 干笔厚涂层次 / 淡彩速写'),
      ].join(' ')
    case 'ink':
      return [
        '质感表现：中式水墨白描（Chinese ink wash），黑白灰三调，',
        '干湿笔对比，留白呼吸感，宣纸质地。',
        antiCliche('工笔细描 / 写意泼墨 / 白描线稿'),
      ].join(' ')
    case 'photoreal':
    default:
      // 默认 = 写实（与用户给的写实模板严格对齐）
      return [
        '质感表现：极致写实人像（cinematic photoreal portrait），8k 超高细节，',
        '强调物理渲染（PBR）的丝绸折射与皮肤次表面散射（subsurface scattering），',
        '自然光 / 电影级布光，锐利的纺织品纹理，高保真渲染。',
        antiCliche('纪实硬光（high-contrast documentary）/ 柔光人像（soft-light beauty）/ 电影胶片（filmic Kodak/Fuji）'),
      ].join(' ')
  }
}

/**
 * 角色三视图生成 prompt —— "双栏布局 + 风格分流 + 面部马赛克" 三合一模板。
 *
 * 布局（所有风格共用）：
 *   - 左栏：大尺寸半身像（close-up bust），面部按 `faceMaskIntensity` 规则处理
 *   - 右栏：全身三视图（正 / 侧 / 背），比例一致
 *   - 横向 3:2（配合 1536×1024 尺寸）
 *
 * 风格：
 *   - `photoreal`（默认）：写实摄影 · PBR · 次表面散射 · 8k
 *   - `anime`：日系动画 · 赛璐珞上色
 *   - 其他风格共用通用骨架，质感层走对应 styleBlock
 *
 * 面部马赛克：
 *   - `'subtle'`（默认）：~40% 像素覆盖一侧脸
 *   - `'full'`：整脸马赛克
 *   - `'none'`：不覆盖
 *
 * 参考：用户给的"浅绿纱衣女子 / 粉红纱衣女子"安全版模板。
 */
export function buildCharacterTurnaroundPrompt(
  character: Character,
  opts: BuildCharacterTurnaroundOpts = {},
): string {
  const visualStyle = opts.visualStyle
  return composeTurnaroundBody({
    character,
    visualStyle,
    styleBlock: styleBlockFor(visualStyle),
  })
}

/**
 * 该 visualStyle 是否「写实真人」—— 决定角色锚点上传 Seedance 前是否走半脸打码（P1-C）。
 *
 * 约定（对齐 plan §0.3 / P1-B）：只有 `photoreal` 视为写实；其余 anime / cartoon /
 * pixelart / watercolor / ink 都是 stylized，跳过打码。`undefined` 按默认风格
 * （DEFAULT_VISUAL_STYLE = 'photoreal'）也视为写实，保证老剧本（未显式设风格）
 * 仍按保守策略打码。
 */
export function isRealisticVisualStyle(vs: VisualStyle | undefined): boolean {
  return vs === undefined || vs === 'photoreal'
}

/**
 * 角色锚点 prompt（P1-B）—— **大头照 headshot**（替代三视图喂 Seedance 的人脸锚点）。
 *
 * sd2-pe 人脸参考最佳实践：仅头肩、正脸或微侧、表情自然、干净背景、五官清晰，
 * 便于 Seedance 2.0 把人脸特征稳定迁移到每一镜。**单人单格**，不做拼版三视图。
 */
export function buildCharacterHeadshotPrompt(
  character: Character,
  opts: BuildCharacterTurnaroundOpts = {},
): string {
  const visualStyle = opts.visualStyle
  const core = character.prompt?.trim() || '普通现代人物（default generic contemporary character）'
  return [
    `角色大头照（character headshot / portrait），角色：${character.name}。`,
    `外观设定：${core}。`,
    '构图（严格遵循）：单人单格，仅头部与肩部（head and shoulders only），正脸或轻微侧脸（frontal or slight three-quarter），',
    '视线看向镜头，表情自然平和（无夸张表情），五官清晰锐利，发型/配饰完整可辨。',
    styleBlockFor(visualStyle),
    '纯净干净背景（clean plain background），均匀柔和影棚布光，无文字无水印，竖向 3:4 构图（portrait 3:4）。',
  ].join('\n')
}

/**
 * 角色锚点 prompt（P1-B）—— **全身照 fullbody**（替代三视图喂 Seedance 的体型/服化锚点）。
 *
 * 完整全身站姿、完整服化道（妆造参考），中性姿势便于迁移到不同镜头动作。
 * **单人单格、单一正面视角**（不是正/侧/背三连拼版）。
 */
export function buildCharacterFullbodyPrompt(
  character: Character,
  opts: BuildCharacterTurnaroundOpts = {},
): string {
  const visualStyle = opts.visualStyle
  const core = character.prompt?.trim() || '普通现代人物（default generic contemporary character）'
  return [
    `角色全身照（character full-body reference），角色：${character.name}。`,
    `外观设定：${core}。`,
    '构图（严格遵循）：单人单格，完整全身从头到脚（full body, head-to-toe），正面站姿（front view standing pose），',
    '双臂自然下垂、中性站姿，完整呈现服装/鞋履/配饰等全套服化道（complete wardrobe and accessories）。',
    styleBlockFor(visualStyle),
    '纯净干净背景（clean plain background），均匀柔和影棚布光，无文字无水印，竖向 2:3 构图（portrait 2:3）。',
  ].join('\n')
}

/**
 * 场所基准图 prompt —— 主图，信息密度尽可能高。
 *
 * 设计意图（v6.5）：
 *   主图是后续所有视角的"图像锚"，所以它要把空间最关键、最具识别度的信息
 *   一次性铺好：
 *     - 透视：establishing wide；地平线 / 灭点稳定，一眼能感知空间布局
 *     - 主体：场所最关键的视觉特征要进入画面（比如"水泥仓库"得能看到水泥
 *       柱、吊灯、铁卷帘门 —— 这些后面"局部特写"角度会从主图里找)
 *     - 光影：把主光源（日光 / 顶灯 / 月光 / 火光）画清楚 —— 这是后面所有
 *       视角必须遵循的方向
 *     - 不放角色：空场，让光影 / 道具 / 材质成为视觉主语，避免后续 shot
 *       关键帧把主图里的"路人"误读成主角
 *
 *   副作用：buildLocationDerivedAnglePrompts 依赖主图作为 reference image，
 *   所以**主图必须先生成完成**才能生其它角度。pipeline 那边的调度做了这个串行。
 */
export function buildLocationPrompt(location: Location): string {
  const core = location.prompt?.trim() || '普通现代场景'
  return [
    `${location.name} —— ${core}.`,
    'Establishing wide shot, empty location with no people. Show the space\u2019s most distinctive features (architecture, materials, key props) and the dominant light source clearly — this image will serve as the visual anchor for all other camera angles of this place.',
    'Cinematic composition, consistent lighting that other angles will match.',
  ].join('\n')
}

/**
 * 基于主图的"视角转换"prompt —— 所有衍生角度共用这个生成器。
 *
 * 关键约束：
 *   - 这些 prompt 会和 referenceImageDataUrl=主图 一起喂给 image model，
 *     让它**保持同一空间 / 同一光源 / 同一材质**，仅切换镜头位置和取景。
 *   - 所以 prompt 故意**不重复 location.prompt**（避免模型基于文字"重新画一个房子"），
 *     只描述"相对于主图的相机变化"。
 *   - 角度数 angleCount 默认 2（搭配 1 张主图 = 3 张总图，与历史行为对齐）
 *
 * 这里返回的 fullPrompt 故意只包含 camera-direction 描述，不再拼 core。
 * core 信息已经全在 reference image 上，模型从图里读就够了。
 */
export function buildLocationDerivedAnglePrompts(
  location: Location,
  angleCount = 2,
): Array<{ id: string; label: string; anglePrompt: string; fullPrompt: string }> {
  /*
   * 视角库 —— 这些都是"相对主图的相机移动"，没有任何关于场所是什么的描述.
   * 所有"这是什么场所"的信息都由 reference image 提供.
   */
  const cameras: Array<{ label: string; hint: string }> = [
    {
      label: '室内主区域 · 中景',
      hint: 'Same location as the reference image, camera now pulled in to a medium-wide shot of the main interior area. Same lighting direction and color temperature as reference. Empty, no people.',
    },
    {
      label: '局部特写 · 氛围',
      hint: 'Same location as the reference image, camera now framing a tight close-up on one distinctive material or detail visible in the reference (texture / object / corner). Same lighting and mood as reference.',
    },
    {
      label: '反向视角',
      hint: 'Same location as the reference image, camera turned 180 degrees, looking back toward where the reference image\u2019s camera was standing. Same light source direction (now appears from behind / side of new framing). Empty, no people.',
    },
    {
      label: '入口 / 过渡区',
      hint: 'Same location as the reference image, camera now positioned at the entrance / threshold of the space, looking inward. Same lighting and time-of-day as reference. Empty, no people.',
    },
  ]

  return cameras.slice(0, Math.min(angleCount, cameras.length)).map((c, i) => ({
    id: `${location.id}-angle${i + 2}`, // 主图占 angle1，衍生从 angle2 起
    label: c.label,
    anglePrompt: c.hint,
    fullPrompt: c.hint,
  }))
}

/**
 * @deprecated v6.5 起 location 多视角改为"主图先行 + 衍生视角参考主图"流水线，
 * 这个老函数仍然保留只是为了向后兼容老调用 / 老测试，新代码请用
 * buildLocationDerivedAnglePrompts。
 *
 * 保留语义：返回 angleCount 条不带 reference 的独立 prompt，行为与改造前完全一致。
 */
export function buildLocationAnglePrompts(
  location: Location,
  angleCount = 3,
): Array<{ id: string; label: string; anglePrompt: string; fullPrompt: string }> {
  const core = location.prompt?.trim() || '普通现代场景'
  const templates: Array<{ label: string; hint: string }> = [
    { label: '全貌 · 建立镜', hint: 'wide establishing shot, full view of the space' },
    { label: '室内主区域', hint: 'interior main area, medium wide framing' },
    { label: '局部特写 · 氛围', hint: 'close detail shot of a distinctive feature, texture emphasis' },
    { label: '入口 / 过渡区', hint: 'entrance or transition zone, threshold framing, depth of field' },
    { label: '反向视角', hint: 'reverse angle, looking back toward the entrance or opposite wall' },
  ]
  return templates.slice(0, Math.min(angleCount, templates.length)).map((t, i) => {
    const fullPrompt = [
      `${location.name} —— ${core}.`,
      `Angle: ${t.label}. ${t.hint}.`,
      'Consistent lighting with other angles of this location.',
    ].join('\n')
    return {
      id: `${location.id}-angle${i + 1}`,
      label: t.label,
      anglePrompt: t.hint,
      fullPrompt,
    }
  })
}

/**
 * 关键道具基准图 prompt —— 单品陈列构图，正向描述。
 *
 * v6.4（2026-05-11）· prompt 瘦身：
 *   老版本 "no characters, no hands, no text watermark" 这种大量负面锚定被
 *   Azure safety classifier 误判。改成正向 product shot 描述，意图一致但
 *   classifier 友好度显著提升。
 */
export function buildPropRefPrompt(prop: Prop): string {
  const core = prop.prompt?.trim() || '关键剧情道具'
  return [
    `${prop.name} —— ${core}.`,
    'Close-up product shot, studio lighting, centered composition on a neutral background, clear material and identifying marks.',
  ].join('\n')
}

/**
 * 关键帧生图 prompt —— 在场景 prompt 基础上注入角色/场所引用。
 *
 * 如果 scene 绑定了 location，就在 prompt 开头声明"使用该 location 基准图的光影/构图"；
 * 角色 ids 会拼进末尾，模型知道有哪些角色出场。
 */
export function buildSceneKeyframePrompt(args: {
  scene: Scene
  location?: Location
  characters: Character[]
  uiStylePrompt?: string
}): string {
  const parts: string[] = []
  if (args.uiStylePrompt) {
    parts.push(`Visual style: ${args.uiStylePrompt}.`)
  }
  if (args.location) {
    parts.push(
      `Location: ${args.location.name} — ${args.location.prompt || ''}. Match the lighting and composition of the provided reference image of this location.`,
    )
  }
  if (args.characters.length > 0) {
    const names = args.characters.map((c) => c.name).join(', ')
    parts.push(
      `Characters present: ${names}. Keep each character consistent with their provided turnaround reference.`,
    )
  }
  const scenePrompt = args.scene.prompts?.scene?.trim() || args.scene.media.prompt || ''
  if (scenePrompt) {
    parts.push(`Scene action: ${scenePrompt}.`)
  }
  // v6.4 · 删除 "no text, no watermark" 的负面锚定，改成正向质量描述
  parts.push('Cinematic framing, high detail, clean composition.')
  return parts.join('\n')
}

// ─── v3: Shot 级 prompt 模板（纯函数） ───────────────────────────────────

/**
 * 人类可读的景别描述 —— 喂给 LLM 生图时比英文代号更稳定。
 *
 * 为什么不直接 `wide shot` / `close-up`：不同的 image model 对英文短语敏感度不一样，
 * 我们统一给一段完整英文描述，让模型照字面构图，避免歧义。
 */
const FRAMING_DESCRIPTIONS: Record<ShotFraming, string> = {
  wide: 'Wide establishing shot. The camera is far from the subject, showing the full environment and spatial relationships.',
  medium:
    'Medium shot. The camera frames the subject from roughly waist-up, keeping context visible but with the subject dominant.',
  close:
    'Close-up. The camera tightly frames the subject, with strong emphasis on facial expression or the single key object.',
  insert:
    'Insert shot. Extreme close-up on a small but significant detail (a prop, a hand, a fragment of text). Background is minimized.',
  ots: 'Over-the-shoulder shot. Framed from behind one character\u2019s shoulder, looking toward another subject, keeping both in the frame.',
  pov: "Point-of-view shot. The camera takes the subject\u2019s eyes as its position; what appears is what the subject would see.",
}

/**
 * 单镜关键帧生图 prompt —— 在 scene-level 提示的基础上叠"本镜"的摄影语言。
 *
 * 组装顺序（逐段落换行拼接，给模型明确的主次 —— 分层堆叠架构）：
 *   1) Visual style（uiStyle）—— 风格统一，来自全局
 *   2) Location 描述 + "match the reference lighting" 指令（若有）
 *   3) Characters present —— 角色一致性锚点（视觉锚点前置）
 *   4) Scene background（如果 scene.background 有）—— 舞美氛围
 *   5) Scene action —— scene-level 主 prompt（兜底；shot.prompt 为空时退化到这里）
 *   6) **Shot N: framing + cameraHint + this shot's prompt**（本轮核心）
 *   7) Audio as visual cues —— 把 shot.audioHint "视觉化"：
 *      环境音 / 非语言人声必须转化为画面可见的物理证据（尘土、白雾、溅水）
 *   8) Performance —— 若有 dialogueText/performance/subtext：
 *      外化为面部肌肉 / 身体语言 / 呼吸姿态（不直接画字幕，AI 画不出字）
 *   9) Background state —— 清晰 / 模糊（需描述光斑）/ 动态
 *  10) transitionHint（若有，让模型知道下一镜怎么接，影响本镜末态构图）
 *  11) 收尾：电影幅比锚点 (2.39:1 / letterbox / cinematic composition)
 *         + high detail / no text / no watermark
 *
 * 这个函数**纯**，不读 store 不调 client，便于单测。
 *
 * 设计约束：所有新加段落都是**条件拼接**（字段为空 → 不输出该段），
 * 老数据（没 audioHint/subtext/...）生成的 prompt 与重写前语义一致，
 * 不会破坏历史剧本的再生图结果。
 */
export function buildShotKeyframePrompt(args: {
  scene: Scene
  shot: Shot
  location?: Location
  characters: Character[]
  /**
   * v3.8 · 关键道具（prop）—— 拼进 "Key props present:" 段，让模型对具名
   * 道具（雨伞 / 匕首 / 信物等）的材质、颜色、标识与 Forge 阶段生成的参考图
   * 保持一致。调用方通常传 `Object.values(scenario.props ?? {})` 过滤出本场
   * 涉及的道具；如果传空数组，不渲染本段。
   */
  props?: Prop[]
  uiStylePrompt?: string
  /**
   * v3.9 · 全局视觉风格（`scenario.visualStyle`）。
   *
   * 当前仅用于：`photoreal` 风格下对画面里每个出场角色的脸部注入"局部像素
   * 马赛克"指令（shotFaceMaskClause），确保下游图生视频模型（Seedance 等）
   * 不会因为"完整真人脸"触发 safety_violations=[person] 拦截。
   *
   * 其它风格（anime/cartoon/pixelart/watercolor/ink）本身就不是真人画面，
   * 传进来不会产生任何副作用。
   *
   * 老调用方不传 visualStyle → 不注入打码指令，保持向后兼容。
   */
  visualStyle?: VisualStyle
  /** 本场景内 shot 的总数（用于 "Shot N/M" 提示）—— 可选 */
  shotIndex?: number
  shotTotal?: number
  /**
   * 渲染哪一帧 —— v3.8 新增。
   *
   *   'single' 或未传 → 代表帧（老行为）。当 shot.keyframeStrategy==='ab' 且
   *             未显式传 frame 时，会 fallback 到 'A'，保证"ab 镜调用方忘传参数
   *             也能拿到 A 帧而不是代表帧混乱的图"。
   *   'A' → 首帧；使用 shot.startFramePrompt 覆盖 shot.prompt，并追加 A/B 守恒说明
   *   'B' → 尾帧；使用 shot.endFramePrompt 覆盖 shot.prompt，并追加 A/B 守恒说明
   *
   * 任何情况下，老调用（不传 frame + keyframeStrategy='single'）都应得到与
   * 重写前语义一致的 prompt，避免破坏历史剧本再生图的稳定性。
   */
  frame?: 'single' | 'A' | 'B'
}): string {
  const { scene, shot, location, characters, uiStylePrompt } = args
  const props = args.props ?? []

  // —— 解析 frame 参数：显式 > shot.keyframeStrategy 推断 > 兜底 single
  const effectiveFrame: 'single' | 'A' | 'B' =
    args.frame ??
    (shot.keyframeStrategy === 'ab' ? 'A' : 'single')

  const parts: string[] = []

  if (uiStylePrompt) parts.push(`Visual style: ${uiStylePrompt}.`)

  if (location) {
    parts.push(
      `Location: ${location.name} \u2014 ${location.prompt || ''}. Match the lighting, spatial orientation, and mood of the provided reference image of this location.`,
    )
  }

  if (characters.length > 0) {
    const anchors = characters
      .map((c) => {
        const appearance = c.prompt?.trim()
        return appearance ? `${c.name} (${appearance})` : c.name
      })
      .join('; ')
    parts.push(
      `Characters present (visual anchors up-front): ${anchors}. Keep each character consistent with their provided turnaround reference — face, wardrobe, proportions, distinctive accessories.`,
    )
    // v3.9 · 写实风格下的人脸局部打码：与角色三视图的 faceMaskClause 对齐，
    // 让下游视频模型过真人人脸安全审核
    const maskClause = shotFaceMaskClause(args.visualStyle, characters.length)
    if (maskClause) parts.push(maskClause)
  }

  // —— 关键道具（prop）的文字锚点：让 gpt-image-2 把具名道具的材质、颜色、
  // 标识细节与 Forge 阶段生成的参考图对齐。不在本镜的道具不应出现（若调用方
  // 只传入本场使用的道具，则默认"应当可见"；若要更精准可未来加 visibility 字段）。
  if (props.length > 0) {
    const propAnchors = props
      .map((p) => {
        const appearance = p.prompt?.trim()
        return appearance ? `${p.name} (${appearance})` : p.name
      })
      .join('; ')
    parts.push(
      `Key props present: ${propAnchors}. Render each visible prop with matching material, silhouette, colors, and any labels/insignia as shown in the prop reference image — do NOT redesign them.`,
    )
  }

  const backgroundText = scene.background?.trim()
  if (backgroundText) {
    parts.push(`Scene mood and staging: ${backgroundText}.`)
  }

  const sceneAction =
    scene.prompts?.scene?.trim() || scene.media?.prompt?.trim() || ''
  if (sceneAction) {
    parts.push(`Scene action (scene level): ${sceneAction}.`)
  }

  const shotHeader =
    args.shotIndex !== undefined && args.shotTotal !== undefined
      ? `Shot ${args.shotIndex + 1} of ${args.shotTotal}.`
      : 'Current shot.'
  parts.push(shotHeader)

  parts.push(FRAMING_DESCRIPTIONS[shot.framing])

  if (shot.cameraHint?.trim()) {
    parts.push(`Camera direction: ${shot.cameraHint.trim()}.`)
  }

  // —— 核心：根据 frame 选用不同的画面描述
  //   single: 老路径，用 shot.prompt
  //   A:      优先 startFramePrompt，缺失 fallback 到 shot.prompt（并加告警语）
  //   B:      优先 endFramePrompt，缺失同上
  const abContext = (() => {
    if (effectiveFrame === 'A') {
      const p = shot.startFramePrompt?.trim() || shot.prompt?.trim() || ''
      return {
        label: 'START FRAME (A)',
        prompt: p,
        note: 'This image represents the FIRST frame of the shot\u2019s motion. Compose this image as the opening pose/position of the action; the END frame (B) will continue from here with the same light source direction, the same props still in place, and physical state only accumulating (wetness, dust, injuries never disappear).',
      }
    }
    if (effectiveFrame === 'B') {
      const p = shot.endFramePrompt?.trim() || shot.prompt?.trim() || ''
      return {
        label: 'END FRAME (B)',
        prompt: p,
        note: 'This image represents the LAST frame of the shot\u2019s motion. Compose this image as the closing pose/position; it must remain consistent with the START frame (A) — same light source direction, same props still present (possibly in new positions), physical accumulation preserved (wet hair stays wet, wounds stay wounded).',
      }
    }
    return null
  })()

  if (abContext) {
    parts.push(`${abContext.label} — this image shows: ${abContext.prompt}.`)
    parts.push(abContext.note)
  } else {
    const shotPrompt = shot.prompt?.trim()
    if (shotPrompt) {
      parts.push(`This shot shows: ${shotPrompt}.`)
    }
  }

  // —— 音效视觉化：AI 画不出声音，把音效翻译成画面证据的明确指令
  const audio = shot.audioHint?.trim()
  if (audio) {
    parts.push(
      `Audio cues to externalize visually (AI cannot render sound — translate to visible physical evidence): ${audio}. For each sonic element, render a matching physical cue — e.g. raindrops crown-splashing on metal, dust floating in a beam of light, breath condensing into white mist, ripples on a puddle.`,
    )
  }

  // —— 表演 / 台词 / 潜台词：外化为面部肌肉和身体语言
  const dialogueText = shot.dialogueText?.trim()
  const subtext = shot.subtext?.trim()
  const perf = shot.performance?.trim()
  if (dialogueText || subtext || perf) {
    const perfBits: string[] = []
    if (dialogueText) {
      perfBits.push(
        `Character speaks (do NOT render text/subtitles in the image — only show the body language of speaking): "${dialogueText}"`,
      )
    }
    if (perf) perfBits.push(`Performance direction: ${perf}`)
    if (subtext)
      perfBits.push(
        `Subtext to externalize through micro-expression and posture: ${subtext}`,
      )
    parts.push(
      `Performance & subtext: ${perfBits.join(' \u00b7 ')}. Translate emotion into tensed jaw, whitened knuckles, reddened eye rims, shoulder posture, not into written words.`,
    )
  }

  // —— 背景状态（焦外散景策略）
  if (shot.bokehState) {
    const bokehDesc =
      shot.bokehState === 'sharp'
        ? 'background kept sharp — full depth-of-field, establishing/documentary clarity'
        : shot.bokehState === 'blurred'
          ? 'background deeply blurred with shallow depth-of-field — describe bokeh highlights (hex shapes / creamy circles / neon colors)'
          : 'background in motion — flickering lights, moving traffic, lightning or particles change frame-to-frame'
    parts.push(`Background state: ${bokehDesc}.`)
  }

  if (shot.transitionHint?.trim()) {
    parts.push(
      `Transition to next shot: ${shot.transitionHint.trim()}. Compose the end of this frame so it flows naturally into that transition.`,
    )
  }

  // —— 电影幅比锚点：确保模型产出剧照感而非手机截图
  // v6.4 · 去掉 "no text, no watermark, no UI overlays" 的连续负面锚定，
  //   Azure safety classifier 对这类"多重禁止词"有误判倾向。正向描述一样能
  //   让模型产出干净剧照。
  parts.push(
    'Cinematic widescreen composition, 2.39:1 anamorphic letterbox aesthetic, film grain texture, high detail, clean frame.',
  )
  return parts.join('\n')
}

/**
 * Shot 级参考图选择 —— 比 scene 级细一点：优先 location base，
 * 其次在 shot.characterIds（若有）里选第一个，最后回退到 scene.characterIds[0]。
 */
export function pickPrimaryRefForShot(args: {
  scene: Scene
  shot: Shot
  scenario: Scenario
  mediaLookup: (id: string) => string | undefined
}): string | undefined {
  const { scene, shot, scenario, mediaLookup } = args
  if (scene.locationId) {
    const loc = scenario.locations?.[scene.locationId]
    if (loc?.refImageId) {
      const url = mediaLookup(loc.refImageId)
      if (url) return url
    }
  }
  const shotChars = shot.characterIds && shot.characterIds.length > 0
    ? shot.characterIds
    : scene.characterIds ?? []
  const firstCharId = shotChars[0]
  if (firstCharId) {
    const char = scenario.characters?.[firstCharId]
    if (char) {
      const id = char.turnaroundRefImageId ?? char.refImageId
      if (id) {
        const url = mediaLookup(id)
        if (url) return url
      }
    }
  }
  return undefined
}

/**
 * 挑选"最重要"的单张参考图给关键帧生图。
 *
 * 当前 ImageClient 只接一张 reference，所以我们按优先级选：
 *   1) location 基准图（给构图/光影）—— 最稳定
 *   2) 主角（角色列表第一个）的三视图 —— 给角色一致性
 *   3) 主角的 refImageId（v1 兼容）
 *   4) null —— 直接文本生成
 *
 * 未来底层支持 multi-image 时改这里返回数组即可。
 */
export function pickPrimaryRef(args: {
  scene: Scene
  scenario: Scenario
  mediaLookup: (id: string) => string | undefined
}): string | undefined {
  const { scene, scenario, mediaLookup } = args
  if (scene.locationId) {
    const loc = scenario.locations?.[scene.locationId]
    if (loc?.refImageId) {
      const url = mediaLookup(loc.refImageId)
      if (url) return url
    }
  }
  const firstCharId = scene.characterIds?.[0]
  if (firstCharId) {
    const char = scenario.characters?.[firstCharId]
    if (char) {
      const id = char.turnaroundRefImageId ?? char.refImageId
      if (id) {
        const url = mediaLookup(id)
        if (url) return url
      }
    }
  }
  return undefined
}
