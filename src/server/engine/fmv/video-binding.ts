/**
 * [vendored · reel-fmv-merge-plan.md §0.5 / P2] FMV 视频参考绑定内核。
 *
 * 规则常量与 section builder（policy 常量 / inferSeedanceTaskMode / buildTaskModeLine /
 * buildSubjectAnchorOpening / buildTopPriorityConstraints / SEEDANCE_POLISH_SYSTEM_PROMPT）
 * **逐字搬自 FMV**：
 *   · `lib/server/video-generation/prompts/seedance/policy.ts`
 *   · `lib/server/video-generation/prompts/seedance/reference-v2.ts`
 * 一字未改。
 *
 * 唯一改动（每处标注理由）：
 *   1. `buildSubjectAnchorOpening` 原读 `characterBible` 解析短名；studio 侧参考图来自
 *      registry（无 bible），改成直接用 binding.label 作显示名——数据源差异逼出。
 *   2. 顶层装配主入口 `assembleSeedanceReferencePromptV2` 原读 `ProjectRecord`/`SceneNode`
 *      并用 timeline-builder 实时派生镜头序列；studio 侧镜头序列已由 Step1 shot-script
 *      产出（SeedancePromptEntry.seedancePrompt），故装配改为消费薄输入 `VideoBindingInput`，
 *      镜头序列段直接注入 Step1 产物。段落顺序 / 每段规则文本与 FMV 一致。
 *   3. FMV 领域段（分层音效 collectDialogueSpeakers / voiceAnchor / base-setting resolver /
 *      quality preset）依赖 ProjectRecord，不搬；改由薄输入的 styleKeywords / soundCues 兜底。
 */

// ─── policy 常量（逐字搬自 seedance/policy.ts）──────────────────────────────

export type SeedanceTaskMode = "reference" | "extend" | "edit" | "first_last_frame";

export const ANTI_CLONE_COMPACT_CONSTRAINT =
  "角色唯一性：每个 @ 角色仅 1 个实例；禁止复制人、镜像、重影、双重曝光、面部融合或身份串扰。";

export const ANTI_SUBTITLE_COMPACT_CONSTRAINT =
  "保持无字幕，避免生成任何文字或字幕；无 caption、无对话气泡、无画面文字。";

export const STYLIZED_TEXTURE_COMPACT_CONSTRAINT =
  "质感：保留微表情、发丝、衣物褶皱、雨雾/尘埃、金属玻璃反射和阴影层次；避免塑料感与全画面统一锐度。";

export const CHINESE_DIALOGUE_CONSTRAINT =
  "所有角色对白与人声为简体中文普通话发音，口型与中文音节同步；严禁说英语 / 日语 / 其他语种。";

export const NO_WATERMARK_BGM_COMPACT_CONSTRAINT =
  "无音乐、无 BGM、无配乐、无水印、无 Logo、无 UI。";

/**
 * 剪辑台术语 → 镜头运动语言软化映射（逐字搬自 seedance/policy.ts）。
 * Seedance 2.0 对「硬切入 / 反打切至 / 甩镜跳切 / 留白收束」易理解为「剧烈剪辑」，统一软化。
 */
const SEEDANCE_CUT_TERM_SOFTEN_MAP: ReadonlyArray<readonly [RegExp, string]> = [
  [/硬切入/g, "直接起镜"],
  [/反打切至/g, "反打镜头"],
  [/甩镜跳切/g, "快速摇镜"],
  [/视线引导至/g, "沿视线方向"],
  [/仰角切入/g, "低角度切入"],
  [/留白收束/g, "镜头缓慢落幅"],
];

export function softenSeedanceCutTerms(text: string): string {
  if (!text) return text;
  let result = text;
  for (const [pattern, replacement] of SEEDANCE_CUT_TERM_SOFTEN_MAP) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ─── 参考图角色模型（逐字搬自 reference-v2.ts 的 ReferenceImageRole）─────────

export type ReferenceImageRole = {
  atSlot: string;
  assetId?: string;
  entityId?: string;
  productionType:
    | "character_ref"
    | "scene_ref"
    | "prop_ref"
    | "shot_image"
    | "style_anchor_frame"
    | "video_clip";
  role:
    | "protagonist"
    | "supporting"
    | "background"
    | "prop"
    | "storyboard"
    | "style_anchor"
    | "palette_anchor"
    | "extend_video"
    | "effect_reference"
    | "keyframe_first"
    | "keyframe_last";
  referenceFocus?: "face" | "full_body" | "general";
  bibleName: string;
  summary: string;
};

// ─── 任务模式判定（逐字搬自 reference-v2.ts）────────────────────────────────

export function inferSeedanceTaskMode(roles: ReferenceImageRole[]): SeedanceTaskMode {
  if (roles.some((role) => role.role === "extend_video")) return "extend";
  if (
    roles.some((role) => role.role === "keyframe_first") &&
    roles.some((role) => role.role === "keyframe_last")
  ) {
    return "first_last_frame";
  }
  return "reference";
}

function buildTaskModeLine(taskMode: SeedanceTaskMode, roles: ReferenceImageRole[]): string {
  if (taskMode === "extend") {
    const extendVideo = roles.find((role) => role.role === "extend_video");
    const tailFrame = roles.find((role) => role.role === "keyframe_first");
    if (extendVideo) {
      return `向后延长 ${extendVideo.atSlot}，时序延续以其尾帧为唯一基准，首帧紧接其人物姿态、表情、光影和镜头位置；禁止跳切、跳帧或重置场景。`;
    }
    if (tailFrame) {
      return `续写上一段视频，时序延续以 ${tailFrame.atSlot}（上一段视频的真实尾帧）为唯一基准；禁止跳切、跳帧或重置场景。`;
    }
    throw new Error("extend 视频 prompt 缺少上一段视频或真实尾帧锚点");
  }
  if (taskMode === "edit") {
    return "严格编辑 @视频1，仅修改被明确点名的元素；未提及的人物身份、动作、运镜和场景保持不变。";
  }
  if (taskMode === "first_last_frame") {
    return "视频从首帧关键帧自然起势，并在结尾平滑收束到尾帧关键帧。";
  }
  return "";
}

/**
 * Seedance 2.0 主体设定句（逐字搬自 reference-v2.ts:buildSubjectAnchorOpening）。
 * 改动：原用 characterBible 解析短名，studio 侧无 bible，改用 role.bibleName（= binding.label）。
 */
function buildSubjectAnchorOpening(roles: ReferenceImageRole[]): string {
  if (!roles.length) return "";
  const lines: string[] = ["【参考图职责】"];

  for (const r of roles.filter((x) => x.productionType === "character_ref")) {
    const displayName = r.bibleName.trim() || "角色";
    lines.push(`${r.atSlot}「${displayName}」人物设定图，仅锁定脸型、发型、服装、体态。`);
  }
  for (const r of roles.filter((x) => x.productionType === "scene_ref")) {
    lines.push(`${r.atSlot}「${r.bibleName.trim() || "场景"}」场景设定图，仅锁定空间结构、陈设、光影方向。`);
  }
  for (const r of roles.filter((x) => x.productionType === "prop_ref")) {
    lines.push(`${r.atSlot}「${r.bibleName.trim() || "道具"}」道具设定图，仅锁定材质、形状。`);
  }

  for (const r of roles.filter((x) => x.role === "palette_anchor")) {
    lines.push(`${r.atSlot} 色卡锚定：仅锁定整体色彩范围、明暗关系和情绪色调，不改变角色身份与场景结构。`);
  }

  const first = roles.find((r) => r.role === "keyframe_first");
  const last = roles.find((r) => r.role === "keyframe_last");
  if (first) lines.push(`${first.atSlot} 作为首帧（首帧遵从度 ≥ 85%）。`);
  if (last) lines.push(`${last.atSlot} 作为尾帧目标。`);

  const styleAnchor = roles.find((r) => r.productionType === "style_anchor_frame");
  if (styleAnchor && styleAnchor.role !== "palette_anchor") {
    lines.push(`${styleAnchor.atSlot} 风格锚帧，仅继承美术风格、构图、色调与情绪氛围。`);
  }

  const extendVideo = roles.find((r) => r.role === "extend_video");
  if (extendVideo) {
    lines.push(`延长 ${extendVideo.atSlot}「${extendVideo.bibleName.trim() || "上一段"}」，首帧紧接其末帧。`);
  }
  const effectVideo = roles.find((r) => r.role === "effect_reference");
  if (effectVideo) {
    lines.push(`${effectVideo.atSlot} 特效运动参考，仅学习特效形态与运动逻辑。`);
  }
  const storyboard = roles.find((r) => r.role === "storyboard");
  if (storyboard) {
    lines.push(`${storyboard.atSlot} 分镜节奏参考，按面板顺序执行。`);
  }

  return lines.length > 1 ? lines.join("\n") : "";
}

/**
 * 【最高优先级约束】前置块（逐字搬自 reference-v2.ts:buildTopPriorityConstraints）。
 */
function buildTopPriorityConstraints(roles: ReferenceImageRole[]): string {
  const rules: string[] = ["【最高优先级约束】", ANTI_CLONE_COMPACT_CONSTRAINT];
  const sceneRole = roles.find((r) => r.productionType === "scene_ref");
  if (sceneRole) {
    rules.push(`场景建筑结构、陈设与光影方向以 ${sceneRole.atSlot} 为准，不得改变。`);
  }
  rules.push("保持无字幕，避免生成任何文字或字幕；无 caption、无对话气泡、无画面文字、Logo、UI。");
  return rules.join("\n");
}

/** 风格 + 生成参数段（改自 reference-v2.ts:buildStyleAndParamsBlock）。
 *  改动：原 buildGlobalStyleFirstLine(project) 依赖 ProjectRecord，改用薄输入 styleKeywords。 */
function buildStyleAndParamsBlock(
  styleKeywords: string[] | undefined,
  clipSeconds: number,
  aspectRatio: "16:9" | "9:16" | "1:1",
): string {
  const tier = clipSeconds <= 5 ? "S档" : clipSeconds <= 10 ? "M档" : "L档";
  const contentWindow =
    clipSeconds >= 15 ? "有效内容13-14s，末尾留1s自然定格" : `有效内容约${clipSeconds}s`;
  const styleLine = (styleKeywords ?? []).filter(Boolean).join("，") || "统一影视级写实质感";
  return [
    "【STYLE LOCK + 生成参数】",
    `${styleLine}；Seedance 2.0，画幅${aspectRatio}，时长${clipSeconds}s·${tier}，${contentWindow}。`,
  ].join("\n");
}

// ─── 薄输入装配（studio · GameGraph）───────────────────────────────────────

/** orchestrate.resolveVideoRoleImages 产出的运行时绑定（1 条 = 1 张 @图片N/@视频N）。 */
export interface VideoRefBinding {
  /** @图片N / @视频N 的序号 N（1-based，与上传槽顺序一致）。 */
  index: number;
  /** 语义槽：'角色' | '场景' | '续接首帧' | '延长视频' | '道具' | '色卡' | '风格锚帧'。 */
  role: string;
  /** 展示名（registry asset.label），进 @图片N「名」。 */
  label?: string;
  /** 是否 @视频N（默认 @图片N）。 */
  isVideo?: boolean;
}

/** Step1 镜头脚本条目（parseShotScript 产物）。 */
export interface SeedancePromptEntry {
  shotNumber: number;
  durationSeconds: number;
  seedancePrompt: string;
  dialogueLine?: string;
  voiceover?: string;
}

/** buildSeedanceVideoPrompt 薄输入。 */
export interface VideoBindingInput {
  /** Step1 已审镜头脚本正文（优先作镜头序列段）。 */
  seedancePrompt?: string;
  /** 无镜头脚本时的兜底剧情正文。 */
  storyText?: string;
  nodeName: string;
  durationSeconds: number;
  /** art-media 风格 id（三轴之一，P3 由 GameGraph 供给）。 */
  artStyle?: string;
  /** 全局风格关键词。 */
  styleKeywords?: string[];
  /** 画幅（默认 16:9）。 */
  aspectRatio?: "16:9" | "9:16" | "1:1";
  /** 运行时参考图绑定（orchestrate 供给）。 */
  refs: VideoRefBinding[];
  /** 显式指定任务模式；不传则由 refs 推导。 */
  taskMode?: SeedanceTaskMode;
  /** 是否 extend 段（P5 超长续接）；true 时前置 VIDEO_EXTEND_HEADER_BLOCK。 */
  extend?: boolean;
  /** extend 段的衔接锚点（拼到 extend 头块第 7 条）。 */
  transitionHint?: string;
}

/** 语义槽 → ReferenceImageRole 映射（studio VideoRefBinding → FMV role 模型）。 */
function bindingToRole(b: VideoRefBinding): ReferenceImageRole {
  const atSlot = `${b.isVideo ? "@视频" : "@图片"}${b.index}`;
  const label = b.label ?? "";
  const base = { atSlot, bibleName: label, summary: label };
  switch (b.role) {
    case "场景":
      return { ...base, productionType: "scene_ref", role: "background" };
    case "续接首帧":
      return { ...base, productionType: "shot_image", role: "keyframe_first" };
    case "延长视频":
      return { ...base, productionType: "video_clip", role: "extend_video" };
    case "道具":
      return { ...base, productionType: "prop_ref", role: "prop" };
    case "色卡":
      return { ...base, productionType: "style_anchor_frame", role: "palette_anchor" };
    case "风格锚帧":
      return { ...base, productionType: "style_anchor_frame", role: "style_anchor" };
    case "分镜节奏":
      return { ...base, productionType: "shot_image", role: "storyboard" };
    default:
      return { ...base, productionType: "character_ref", role: "protagonist" };
  }
}

/**
 * V-PROMPT-15 从同目录 ./templates 引入；锚点按实际绑定的视频或真实尾帧动态渲染。
 */
import { buildVideoExtendHeaderBlock } from "./templates";

/**
 * 视频 prompt 装配（薄输入版，对齐 reference-v2.ts:assembleSeedanceReferencePromptV2 段序）。
 *
 * 段序：STYLE LOCK → 参考图职责 → 最高优先级约束 → 任务模式句 → 镜头序列（Step1 产物）
 *   → 中文对白约束 → 质感约束 → 无水印/BGM 约束。
 * extend 段前置 VIDEO_EXTEND_HEADER_BLOCK（V-PROMPT-15，七条）。
 */
export function buildSeedanceVideoPrompt(input: VideoBindingInput): string {
  const clipSeconds = input.durationSeconds;
  const aspectRatio = input.aspectRatio ?? "16:9";
  const roles = input.refs.map(bindingToRole);
  const taskMode = input.taskMode ?? (input.extend ? "extend" : inferSeedanceTaskMode(roles));

  const styleAndParams = buildStyleAndParamsBlock(input.styleKeywords, clipSeconds, aspectRatio);
  const subjectAnchor = buildSubjectAnchorOpening(roles);
  const constraintBlock = buildTopPriorityConstraints(roles);
  const taskModeLine = buildTaskModeLine(taskMode, roles);

  const rawSequence = (input.seedancePrompt?.trim() || input.storyText?.trim() || "").trim();
  const shotSequence = rawSequence
    ? `【${clipSeconds}秒运镜】\n${softenSeedanceCutTerms(rawSequence)}`
    : `【${clipSeconds}秒运镜】\n镜头1：按节点剧情推进表演和镜头。`;

  const body = [
    styleAndParams,
    subjectAnchor,
    constraintBlock,
    taskModeLine,
    shotSequence,
    CHINESE_DIALOGUE_CONSTRAINT,
    STYLIZED_TEXTURE_COMPACT_CONSTRAINT,
    NO_WATERMARK_BGM_COMPACT_CONSTRAINT,
  ]
    .filter((s) => s.trim().length > 0)
    .join("\n");

  if (input.extend) {
    const extendVideo = roles.find((role) => role.role === "extend_video");
    const tailFrame = roles.find((role) => role.role === "keyframe_first");
    const continuityAnchor = extendVideo
      ? { atSlot: extendVideo.atSlot, source: "video" as const }
      : tailFrame
        ? { atSlot: tailFrame.atSlot, source: "tail_frame" as const }
        : null;
    if (!continuityAnchor) {
      throw new Error("extend 视频 prompt 缺少上一段视频或真实尾帧锚点");
    }
    const header = buildVideoExtendHeaderBlock(
      continuityAnchor.atSlot,
      continuityAnchor.source,
    );
    const extendHeader = input.transitionHint
      ? `${header}\n衔接锚点：${input.transitionHint}`
      : header;
    return [extendHeader, body].join("\n");
  }
  return body;
}

/**
 * Seedance 2.0 Prompt Optimizer system prompt（逐字搬自 policy.ts:SEEDANCE_POLISH_SYSTEM_PROMPT）。
 */
export const SEEDANCE_POLISH_SYSTEM_PROMPT = `你是 Seedance 2.0 Prompt Optimizer（sd2-pe），服务于 FMV 互动影视视频生成。
你的任务：以「结构母版 Seedance Prompt」为格式外壳，以「用户润色意图」为新的剧情演绎方向，输出一个仍符合 Seedance V2 结构的完整视频 prompt。

【最高优先级输出协议】
- 只输出润色后的最终 prompt 正文，不要解释、不要 Markdown、不要 JSON、不要"优化问题"段落。
- 全部使用简体中文，可保留 @图片N / @视频N / @音频N / FMV / POV / 16:9。
- 禁止输出内部 XML 或实体标签，例如 <character>、</character>、<location>、</location>。
- 必须使用「镜头1：」「镜头2：」这样的镜头序列；简单视频也至少输出「镜头1：」。

【结构保持 · 不可破坏】
- 必须保持结构母版的段落顺序和段落标题，不得改写成散文。
- 保留并原样输出结构母版中的「【基础设定】」「【氛围与画质】」等方括号段落标题。
- 保留结构母版中的任务模式句，例如「续写上一段视频」「向后延长 @视频1」「严格编辑 @视频1」「视频从首帧关键帧自然起势」。
- 保留结构母版中的所有「镜头N：」编号；不得增删镜头，不得改变镜头编号顺序。
- 保留结构母版中的素材绑定句与 @ 引用用途说明；不得把 @ 引用藏进泛泛描述里。
- 用户润色意图可以是大白话，你需要把它扩写进镜头序列，而不是用它替换整个结构母版。

【sd2-pe 任务判定】
- 多模态参考：使用 @图片N / @视频N / @音频N 绑定主体、场景、动作、音色。
- 视频延长：若母版绑定 @视频N，写「向后延长 @视频N」；若母版绑定上一段真实尾帧 @图片N，写「从 @图片N 无缝接续」。不得发明母版中不存在的 @视频N。
- 视频编辑：必须写「严格编辑 @视频N，将其中的…修改/替换/删除为…」。
- 组合任务：先说明参考维度，再说明严格编辑或延长的目标视频。

【引用与主体绑定】
- 保留输入中已有的 @图片N / @视频N / @音频N 引用，不要改编号，不要发明不存在的编号。
- 严禁裸写 asset id。若出现 asset id，改为已有 @图片N / @视频N / @音频N 或删除该裸 id。
- 多主体时用「@图片N 中的角色/人物/场景」这类自然名词隔断，避免 "@图片1跑向…" 的数字粘连歧义。

【镜头序列公式】
每个镜头按以下顺序写成一行：
镜头N：可选时间段【镜头功能】景别，人物/空间构图，摄影机角度，焦段/景深/对焦，单一运镜或设备，布光/色温，主体动作与表情，位置/空间变化，声音或同期声。

【镜头示例】
镜头1：0-3s【定场缓慢推镜】轻微 15° 仰视角，广角超远景，滑动变焦，展现了坠毁的巨型星舰引擎的震撼视角，热浪笼罩着大地。

【专业颗粒度菜单】
- 景别：大远景 / 建立镜头 / 全景 / 中全景 / 中景 / 中近景 / 特写 / 极特写。
- 人物与构图：单人镜头 / 双人镜头 / 过肩镜头 / 插入镜头 / POV / 前景遮挡 / 对角引导线 / 负空间 / 前中后景深度。
- 摄影机角度：视平线 / 肩高 / 膝盖高度 / 地面高度 / 低角度仰拍 / 高角度俯拍 / 俯拍上帝视角 / 荷兰角。
- 焦段与对焦：24mm 广角 / 35mm 广角 / 50mm 标准焦段 / 85mm 长焦 / 100mm 微距 / 深焦 / 浅景深 / 变焦或移焦 / 双焦度并置。
- 运镜与设备：固定镜头 / 推镜 / 拉镜 / 横移 / 水平摇摄 / 甩镜 / 跟拍 / 环绕 / 升降 / 手持 / 滑轨 / 斯坦尼康 / 摇臂。
- 布光：硬光 / 柔光 / 主光 / 辅光 / 轮廓光 / 低调布光 / 高调布光 / 伦勃朗光 / 分割光 / 负补光 / 冷蓝色温 / 暖黄钨丝灯。
- 剪辑与速度：硬切 / 动作切入 / 视线匹配 / 甩镜剪辑 / 匹配剪辑 / 闪切 / 慢动作升格 / 速度渐变 / 抽帧拖影。
- 每个镜头选择最能服务剧情的 5-6 项即可，禁止把菜单全部堆进同一镜头。

【一镜一运镜】
- 单个「镜头N」只能指定一种主运镜：固定机位 / 推镜 / 拉镜 / 横移 / 摇镜 / 跟拍 / 环绕 / 升降 只能选一个。
- 如果输入同时出现推、拉、摇、移等冲突运镜，保留最符合动作意图的一种，其他转为构图或动作描述。

【动作与表演】
- 以用户润色意图为准重写镜头内容，保留用户核心动作、胜负关系与情绪方向。
- 用可见物理细节替代抽象情绪：眼神、下颌、肩背、手指、呼吸、步伐、衣料和道具物理反馈。
- 优先低缓连续小动作，避免狂奔、大跳、剧烈翻滚等高爆发动态，除非用户明确要求。
- 允许优化空泛动作词，但不得删除角色身份、场景空间、道具证据和台词含义。

【风格与硬约束】
- 末尾必须包含画质与稳定约束：高清，细节丰富，电影质感，色彩自然，光影柔和。
- 必须逐字包含：保持无字幕，避免生成任何文字或字幕。
- 必须包含无水印、无 Logo、无 UI。
- 多人物或角色参考场景必须包含：同一角色仅 1 个实例，禁止复制人、镜像、重影、分身、双胞胎效果。
- 输出长度控制在 800 字以内。

【失败模式】
- 如果你准备删除 @图片N / @视频N、删除「镜头N：」、删除「【基础设定】」或「【氛围与画质】」，这是错误输出，必须重写。`;
