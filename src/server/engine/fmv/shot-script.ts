/**
 * prompts/production/shot-script (V3 · Seedance V2 镜头序列直出)
 * ===========================================================
 *
 * Phase 3 节点级视频 prompt 生成：合并模板层 + 字段解析层 + 装配主入口。
 *
 * V3 重设计：保留 JSON shot 外壳，但让 LLM 输出
 * Seedance 2 官方推荐的简洁镜头序列 prompt。
 *
 * 输出 schema：SeedancePromptEntry[]
 *   { shotNumber, durationSeconds, seedancePrompt, dialogueLine?, voiceover? }
 *
 * seedancePrompt 结构：
 *   镜头N：单一运镜 / 景别或角度，主体动作与表情，空间变化，可选声音
 */

/**
 * [vendored · reel-fmv-merge-plan.md §0.5 / P2 · Option B]
 * 本文件的规则常量与纯 builder（PHASE3_* / buildSeedance* / buildPhase3*）逐字搬自 FMV
 * `lib/server/prompts/production/shot-script.ts`，**一字未改**。唯一改动：把原文件底部
 * 读 FMV `ProjectRecord`/`SceneNode` 领域模型的 resolver + 装配主入口，改写成消费
 * GameGraph 薄输入 `ShotScriptInput`；FMV 领域独有段（上游变量 / 对白圣经 / 前后帧锚点 /
 * 剧本原文）改为「薄输入给了就注入、没给走 fallback 或跳过」。FMV 领域层
 * （narrative-context / screenplay-source / story-engine / prompt-utils）不搬。
 * buildPerspectiveLockBlock 也已 verbatim 搬到同目录 ./templates。
 */
import { buildPerspectiveLockBlock } from "./templates";

/**
 * 章节上下文（可选）。原从已删除的 node-production 导入；重建时内联为本地类型。
 * 当前 Phase 3 runner 不传入此参数，保留形参以便后续接章节链路。
 */
type Phase2ChapterContext = {
  chapterNumber: number;
  totalChapters: number;
  dramaticFunction: string;
  chapterBrief: string;
  priorChaptersDigest?: string;
};

// ── 全局常量（唯一修改点）──────────────────────────────────────────────
/** 单镜头最短时长（秒），与 Seedance 2 单段 4-15s 能力对齐。 */
const MIN_SHOT_DURATION = 4;
/** 单镜头最长时长（秒），与 Seedance 2 单段 4-15s 能力对齐。 */
const MAX_SHOT_DURATION = 15;
/** 推荐镜头时长（Seedance 2 最佳生成区间）。 */
const OPTIMAL_SHOT_DURATION = 8;
/** 总时长允许误差（秒）。 */
const DURATION_TOLERANCE_SECONDS = 5;
/** seedancePrompt 最少字数：简洁镜头序列也要具备可拍摄动作。 */
const MIN_PROMPT_LENGTH = 80;
/** seedancePrompt 最多字数：避免回退成五段式长文。 */
const MAX_PROMPT_LENGTH = 700;

// ─── 类型 ─────────────────────────────────────────────────────────────

type Phase3OutputSchemaInput = {
  shotCountRange: string;
  durationSeconds: number;
};

type Phase3ChapterContextInput = {
  chapterNumber: number;
  totalChapters: number;
  dramaticFunction: string;
  chapterBrief: string;
  priorChaptersDigest?: string;
};

type Phase3NodeInfoInput = {
  tempId: string;
  title: string;
  storyText: string;
  durationSeconds: number;
  narrativeRole: string;
  videoIntent: string;
  choiceSetup: string;
  visualAnchors: string;
  soundCues: string;
};

type Phase3InteractiveConstraintsInput = {
  applyChoiceRevealRule: boolean;
  choicesLength: number;
};

// ─── L1 · 任务总纲 ──────────────────────────────────────────────────────

const PHASE3_TASK_HEADLINE = `你是专业的 Seedance 2 分镜导演 AI。本次唯一任务：为单个剧情节点生成 Seedance 2 可直接执行的简洁镜头序列 Prompt。

✅ 核心原则：
- 像写 Seedance 工程指令一样写 Prompt，不是写文学描述
- 使用「镜头1 / 镜头2 / …」表达事件顺序，不写绝对秒数
- 所有描述必须是可拍摄的物理动作和视觉元素
- 不输出 JSON 结构化字段（如 shotSize / cameraMovement 等枚举），全部转化为自然语言描述

❌ 绝对禁止：
- seedancePrompt 中出现任何台词字面（无论是否带引号）
- 使用「说：」「问道：」「喊：」等言说动词
- 出现「主角的表情很紧张」这类抽象情绪描述（必须转化为物理动作）
- 输出任何 JSON 结构化字段（如 shotSize: "特写"）
- 出现「0-3s」「3-5秒」等绝对时间切片
- 把「A/B/C 选择项」「选择浮现」这类游戏逻辑文本写进 seedancePrompt

【台词表演四要素公式 · 含台词镜头的画面内容段必须遵循】
场景氛围（光线/空间如何影响角色情绪空气）
→ 人物内心状态（疲惫/紧张/犹豫/愤怒/释然）
→ 发声方式（声音大小 + 语速快慢 + 停顿位置 + 尾音变化）
→ 口型物理动作（不写台词文字本身，只写嘴型/喉结/下颌的物理表演）

标点符号 → 嘴型语气锚定：
  · 问号（？）→ 尾音上扬，嘴型收窄后微张，眉毛轻提
  · 感叹号（！）→ 加重咬字，嘴型张开幅度大，下颌用力
  · 破折号（——）→ 拖长音/转折，嘴型保持或突然变化，气息拉长
  · 省略号（……）→ 迟疑留白，嘴唇缓慢闭合，气息减弱，目光游移
  · 逗号停顿 → 轻咽一次，唇轻闭 0.3s`;

// ─── Seedance V2 镜头序列协议 ────────────────────────────────────────────

function buildSeedanceShotSequenceProtocol(artStylePreset?: string): string {
  const isStylized = [
    "anime",
    "anime-cel",
    "anime-painterly",
    "anime-dark",
    "chibi-kawaii",
    "illustration",
    "watercolor",
    "concept-art",
    "comic-strip",
    "storybook",
    "ukiyo-e"
  ].includes(String(artStylePreset ?? ""));
  const styleHint = isStylized
    ? "如为动漫/插画/非写实项目，必须在末句明确目标风格，例如「2D 日漫风格」「国风漫画质感」，避免漂移成真人写实。"
    : "如为写实项目，使用「电影质感、色彩自然、光影柔和」这类轻量风格词，不堆摄影机型号或镜头品牌。";

  return `【Seedance 2 V2 镜头序列协议（每个 shot 的 seedancePrompt 必须遵循）】

输出形态：
- 每个 seedancePrompt 只写 1-4 行「镜头N：...」。
- 使用「镜头1 / 镜头2 / …」表达事件顺序；禁止写「0-3s」「3-5秒」等绝对时间切片。
- 不写「第 1 段 / 氛围与画质 / 真实质感 / 声音环境」等五段式标题。

每行公式：
\`镜头N：单一运镜或切换方式，景别/角度，主体具体动作与表情，位置/空间变化，可选声音或环境反馈。\`

写作要求：
1. 主体清晰：使用角色名或稳定称谓，不用「他/她/这个人」等模糊指代。
2. 动作具体：写手、腿、头、肩背、眼神、嘴型、呼吸等身体细节，补充幅度/速度/力度。
3. 情绪外化：禁止只写「紧张、悲伤、愤怒、张力上扬」；必须改成「指节收紧、喉结轻滚、肩膀微颤、目光回避」。
4. 一镜一运镜：单个「镜头N」只能指定一种主运镜；固定机位 / 推镜 / 拉镜 / 横移 / 摇镜 / 跟拍 / 环绕 / 升降只能择一。
5. 低缓优先：无明确参考视频时，优先低缓、连续、小幅动作；避免狂奔、大跳、翻滚等高爆发动态。
6. 互动隔离：选择项、按钮、分支文案、A/B/C 方案只属于游戏逻辑，禁止写入 seedancePrompt；只表现“选择压力”对应的可见身体反应或道具焦点。
7. 台词隔离：台词原文放 dialogueLine / voiceover 字段；seedancePrompt 只写口型、停顿、呼吸、下颌、喉结等可视化表演。
8. 收束约束：末尾可用一句轻量约束，包含高清、细节丰富、电影质感、无字幕、无水印、无 Logo、人物稳定不变形。${styleHint}

正例：
镜头1：固定机位，中景，林晚左手压住方向盘边缘，指节慢慢泛白，雨刷反光划过她紧绷的下颌。
镜头2：缓慢推镜，近景，阿珍双唇微张又闭合，喉结轻滚一次，右手反复摩挲安全带扣。
镜头3：轻微横移，全景，车内两人保持原有方位，远处港口雾灯在雨幕中闪烁，刹车声短促响起。

反例：
- 绝对秒级切片：林晚很紧张，镜头推拉摇移，气氛张力上扬。
- 选择浮现：A救人反堵 / B夺备份盘 / C逼住户作证。
- 视觉基调：堆叠摄影机型号、镜头品牌和旧协议标题。`;
}

// ─── 防字幕铁律 ─────────────────────────────────────────────────────────

const PHASE3_ANTI_SUBTITLE_RULES = `【防字幕三铁律 · 最高优先级 · 违反即失败】
Seedance 2 会把 Prompt 中的任何文字烧录为屏幕字幕，必须严格遵守：

1. ❌ seedancePrompt 中严禁出现任何台词字面（不论是否带引号）
   ✅ 正确：「林晚口型急促开合（约 8 字语流），下颌肌微抖，手指扣紧方向盘上沿」
   ❌ 错误：「林晚说"再晚十分钟就来不及了"，握紧方向盘」

2. ❌ 禁止「说：」「问道：」「喊：」等"言说动词+冒号"句式
   ✅ 正确：「双唇紧抿后缓缓张开，发出声音」
   ❌ 错误：「林晚问道：'你是谁？'」

3. ❌ 禁止「<角色名>："…"」格式
   ✅ 正确：「对面的女人嘴唇微动，目光锁定镜头」
   ❌ 错误：「林晚：'我知道真相了'」

【表达"在说话"的合规写法】
- 口型节奏：「口型急促开合（约 X 字语流）」「双唇紧抿后缓缓张开」
- 倾听反应：「眉梢上挑半度」「指节在桌面无意识收紧」
- 非言语回应：「以一次缓慢吞咽作答」「下颌肌轻微紧绷三次」`;

// ─── 跨镜头一致性 ────────────────────────────────────────────────────────

const PHASE3_CROSS_SHOT_CONSISTENCY = `【跨镜头一致性硬约束 · 输出前必须自检】
同节点内所有镜头必须保持以下 5 项 100% 一致，任何不一致即为穿帮：

1. 【光线指纹】光源方向 + 色温 + 强度完全一致
   ✅ 正确：所有镜头都是「头顶冷白日光灯，正上方照射，6500K」
   ❌ 错误：前镜是暖光，后镜变成冷光

2. 【空间方位】主体位置 + 面朝方向 + 左右关系不变
   ✅ 正确：主角始终在画面左 1/3，面朝右方
   ❌ 错误：前镜主角在左边，后镜突然跑到右边

3. 【服装道具】服装款式颜色、道具位置状态不变
   ✅ 正确：主角一直穿着蓝色外套，左手拿着手机
   ❌ 错误：前镜外套是蓝色，后镜变成黑色

4. 【时间天气】时间、天气、季节不变（除非明确闪回）
   ✅ 正确：所有镜头都是「夜晚，下着小雨」
   ❌ 错误：前镜在下雨，后镜雨停了

5. 【标志物回声】首镜建立的核心标志物至少在后续镜头复现 1 次`;

// ─── 第一人称 POV 镜头序列专属写作规则 ───────────────────────────────────

const PHASE3_POV_WRITING_RULES = `【第一人称 POV 镜头序列写法硬约束 · 所有镜头必须遵循】

本项目采用第一人称 POV 视角（摄影机 = 主角眼睛）。生成每个 seedancePrompt 时必须遵循以下规则：

运镜（POV 专用）：
- 景别**禁止写**「特写」「近景」——POV 视角没有"拍自己"的概念
- 景别改写为对**所看事物**的描述：「眼前中景」「视线范围内远景」「低头近距离」
- 运镜**只允许**：自然头部转动 / 视线转移 / 前进/后退步伐带动 / 轻微手持呼吸浮动
- 运镜**禁止**：环绕 / 弧形 / 升降 / 俯瞰 / 任何暴露主角全貌的机位
- 每镜头**必须写**：「手持拍摄，全程轻微自然呼吸浮动与头部微摆」

画面内容（POV 专用）：
- **主角不作为画面中被观察的对象**（禁止写「主角站在...」「主角的表情...」）
- 改为写**主角看到的世界**：「眼前出现...」「视线下移看到自己的手...」「对面的人开口说...」
- 主角手部动作用「手从画面下方伸出」「右手抬起触碰」等入画式描写
- 其他角色**面朝镜头方向**说话/互动（制造对着观众的沉浸感）
- 情绪通过**生理反应**传递而非面部描写（心跳加速→画面轻微抖动 / 紧张→手指颤抖 / 眩晕→画面倾斜）

声音（POV 专用）：
- **必须含主角生理音效**：呼吸声 / 心跳 / 吞咽 / 衣料摩擦
- 对话类节点：其他角色的声音从「正前方/侧方」传来（给空间定位感）

━━━ POV 禁止事项（最高优先级） ━━━
- 禁止写「主角转身」「主角回头看」等会暴露主角全貌的描写
- 禁止写主角的面部表情（摄影机是眼睛，看不到自己的脸）
- 禁止出现主角正面/侧面/背影的任何描写
- 唯一允许的主角身体描写：手/手臂/低头可见的躯干前部/影子`;

// ─── 角色/场景段头 ──────────────────────────────────────────────────────

const PHASE3_CHARACTER_INFO_HEADER = "【角色信息】";
const PHASE3_LOCATION_INFO_HEADER = "【场景详细信息】";

// ─── 帧锚点 ─────────────────────────────────────────────────────────────

const PHASE3_PREV_VISUAL_ANCHORS_HEADER =
  "【前置收尾画面】前一节点末尾视觉锚点，本节点首镜开场构图应与之在空间/光影上连续：";
const PHASE3_PREV_VISUAL_ANCHORS_FALLBACK = "（此为开场节点，无前置）";
const PHASE3_NEXT_ANCHORS_HEADER =
  "【后续首帧锚点】本节点末镜头应为下游节点首帧留出视觉接口：";
const PHASE3_NEXT_ANCHORS_FALLBACK = "（本节点为结局或无后续）";

// ─── 对白圣经 ────────────────────────────────────────────────────────────

const PHASE3_DIALOGUE_BIBLE_HEADER =
  "【对白圣经】（台词分配到 dialogueLine 字段，seedancePrompt 中只写口型/表演动作）：";

// ─── 剧本原文锚定 ─────────────────────────────────────────────────────────

const PHASE3_SCREENPLAY_SOURCE_HEADER = "【原始剧本段落 · 分镜唯一权威来源】";

const PHASE3_SCREENPLAY_FIDELITY_RULES = `【剧本忠实度铁律 · 最高优先级】
本节点的分镜必须 100% 基于上方【原始剧本段落】的内容创作，不可自由发挥：

1. ❌ 禁止新增剧本中不存在的角色、动作、台词、道具或事件
2. ❌ 禁止篡改角色间的对话内容或先后顺序
3. ❌ 禁止遗漏剧本段落中的关键动作标记（△）、OS/VO、空镜和台词
4. ✅ 每个 shot 的画面内容段必须能在原始剧本段落中找到对应的文本锚点
5. ✅ dialogueLine 字段必须完全引用剧本中的台词原文（一字不改）
6. ✅ 可以补充镜头运动、光影细节、物理质感等"视觉导演层"描写，但叙事骨架必须忠于剧本
7. ✅ 剧本中的舞台动作（△开头）和【空镜】是画面内容段的直接素材来源

自检：逐 shot 检查，每个 shot 的核心事件是否都来自【原始剧本段落】。如有任何自由创作成分，删除并重写。`;

// ─── 输出前自检清单 ────────────────────────────────────────────────────────

const PHASE3_FINAL_CHECKLIST = `【输出前必须完成的自检清单】
✅ 所有 seedancePrompt 都严格遵循 Seedance V2 镜头序列结构
✅ seedancePrompt 中没有任何台词文字或言说动词
✅ 所有情绪都通过具体物理动作表达（无"很紧张""很开心"等抽象描述）
✅ 没有 0-3s / 3-5秒 等绝对时间切片
✅ 没有选择浮现、A/B/C 选项文案或按钮文本
✅ 每个镜头只包含一种主运镜
✅ 同节点内光线、服装、道具、方位完全一致（5 项一致性）
✅ 所有镜头时长之和等于总时长（±${DURATION_TOLERANCE_SECONDS}s）
✅ 单镜头时长在 ${MIN_SHOT_DURATION}-${MAX_SHOT_DURATION}s 之间
✅ POV 镜头没有出现主角的面部或全身
✅ 互动节点末镜头符合选择揭示规则（眼神/道具/环境三选一）

少一条都不要输出，回去修改直到全部满足。`;

// ─── 模板函数 ────────────────────────────────────────────────────────────

function buildPhase3OutputSchemaBlock(input: Phase3OutputSchemaInput): string {
  return `【输出格式 · JSON 数组】
为此节点生成 ${input.shotCountRange} 个镜头，返回严格 JSON 数组。每个元素结构：

{
  "shotNumber": 1,
  "durationSeconds": ${OPTIMAL_SHOT_DURATION},
  "seedancePrompt": "（Seedance V2 镜头序列自然语言 prompt，见上方协议）",
  "dialogueLine": "台词原文（可选，无台词时省略此字段）",
  "voiceover": "旁白文本（可选，无旁白时省略此字段）"
}

硬约束：
- 所有镜头 durationSeconds 之和必须等于节点的 ${input.durationSeconds}s（±${DURATION_TOLERANCE_SECONDS}s 误差）
- 单镜头时长 ${MIN_SHOT_DURATION}-${MAX_SHOT_DURATION}s，推荐 ${OPTIMAL_SHOT_DURATION}s（Seedance 2 单段能力区间）
- seedancePrompt 必须严格遵循 Seedance V2 镜头序列结构，纯中文
- seedancePrompt 字数 ${MIN_PROMPT_LENGTH}-${MAX_PROMPT_LENGTH} 字；宁可短而具体，不要五段式长文
- dialogueLine 只放角色台词原文，不含表演提示
- 若填写 dialogueLine 或 voiceover，该镜头 durationSeconds 必须足够覆盖完整发声、标点停顿和 0.5-1s 反应留白；不得让视频在话没说完前结束
- 仅返回 JSON 数组，不要追加自然语言说明或 markdown 代码块`;
}

function buildPhase3ToneLockBlock(tone: string | undefined): string {
  if (!tone) return "";
  return `【题材锁定】本项目题材基调是「${tone}」，所有镜头的视觉描述、氛围与画质段必须匹配「${tone}」题材方向。`;
}

function buildPhase3GlobalStyleBlock(globalStyle: string): string {
  return `【全局风格关键词】${globalStyle}
（LLM 须把这些关键词自然融入每个 seedancePrompt 的「氛围与画质」段，不要生硬堆叠。）`;
}

function buildPhase3ChapterBlock(ctx: Phase3ChapterContextInput | undefined): string {
  if (!ctx) return "";
  return `【章节背景】
- 当前章节：第 ${ctx.chapterNumber} / ${ctx.totalChapters} 幕
- 章节戏剧功能：${ctx.dramaticFunction}
- 本章节简报：${ctx.chapterBrief}
- 前情摘要：${ctx.priorChaptersDigest || "（此为开篇章节，无前情）"}`;
}

function buildPhase3NodeInfoBlock(input: Phase3NodeInfoInput): string {
  return `【当前节点信息】
- tempId：${input.tempId}
- 标题：${input.title}
- 剧情正文：${input.storyText}
- 时长：${input.durationSeconds}s
- 叙事角色：${input.narrativeRole || "常规"}
- 视频意图：${input.videoIntent}
- 选择铺垫：${input.choiceSetup}
- 视觉锚点：${input.visualAnchors}
- 声音线索：${input.soundCues}`;
}

function buildPhase3InteractiveConstraintsBlock(
  input: Phase3InteractiveConstraintsInput
): string {
  if (!input.applyChoiceRevealRule) {
    return "【互动约束】本节点不触发选择揭示镜头规则（结局或无分支）。";
  }
  return `【互动影游镜头硬约束】
本节点有 ${input.choicesLength} 个选择且非结局：
1. 末镜头必须满足：镜头推近主角眼睛(特写) / 画面定格在抉择物件 / 留 2-3s 呼吸空间
2. 末镜头的画面内容段必须含至少 1 条肌肉动作级描述（眉心/嘴角/指节/喉结）
3. 末镜头「声音环境」段心跳或深呼吸上扬，模拟玩家思考压力`;
}

// ─── 薄输入装配（studio · GameGraph）──────────────────────────────────────
//
// [vendored · §0.5/P2] 替代 FMV 读 ProjectRecord/SceneNode 的 resolver + 装配主入口。
// 上方规则常量与 build* 纯函数均逐字保留；这里只把「数据从哪来」换成 GameGraph 薄输入，
// section 顺序 / 每段规则文本 / fallback 措辞与 FMV buildNodeShotScriptPrompt 完全一致。

/** 单节点镜头脚本的薄输入 —— orchestrate 从 GameGraph node + 游戏级配置 + registry 参考图组装。 */
export interface ShotScriptInput {
  /** 节点展示名（原 tempId/title）。 */
  nodeName: string;
  /** 剧情正文（原 node.playerText ?? node.beat）。 */
  storyText: string;
  /** 本节点目标总时长（秒）。 */
  durationSeconds: number;
  /** art-media 风格 id（三轴之一）——喂 buildSeedanceShotSequenceProtocol 判写实/风格化。 */
  artStyle?: string;
  /** 全局风格关键词（原 productionPlan.globalSceneAnchoring.styleKeywords）。 */
  styleKeywords?: string[];
  /** 题材基调（原 project.tone）。 */
  tone?: string;
  /** 视角（'第一人称' | '第三人称' | ...；原 resolvePerspective）。 */
  perspective?: string;
  /** 本节点选择数（原 node.choices.length）。 */
  choicesLength?: number;
  /** 是否结局节点（原 node.ending）。 */
  isEnding?: boolean;
  /** 叙事角色（原 production.narrativeRole）。 */
  narrativeRole?: string;
  /** 视频意图（原 production.videoIntent）。 */
  videoIntent?: string;
  /** 选择铺垫（原 production.choiceSetup）。 */
  choiceSetup?: string;
  /** 视觉锚点（原 production.visualAnchors）。 */
  visualAnchors?: string[];
  /** 声音线索（原 production.soundCues）。 */
  soundCues?: string[];
  /** 本节点出场角色花名册（原 characterBible 投影）。 */
  characters?: { name: string; role?: string; appearance?: string }[];
  /** 场景详细信息（原 locationBible 投影，已渲染成多行或一句）。 */
  location?: string;
  /** 原始剧本段落（原 resolveNodeScreenplaySource）——给了才注入剧本忠实度铁律。 */
  screenplay?: string;
  /** 上游变量快照（原 buildUpstreamContext.variableSnapshot）。 */
  variableSnapshot?: Record<string, string | number | boolean>;
  /** 前置收尾画面锚点（原 resolvePhase3PrevVisualAnchorsBlock）。 */
  prevVisualAnchors?: string[];
  /** 后续首帧锚点行（原 resolvePhase3NextAnchorsBlock，已渲染成 "若进入「X」：hook"）。 */
  nextAnchors?: string[];
  /** 对白圣经块（原 resolvePhase3DialogueBibleBlock，已渲染成文本）。 */
  dialogueBible?: string;
  /** 章节背景（原 chapterContext）。 */
  chapterContext?: Phase3ChapterContextInput;
  /** 镜头数区间（如 "4-6"）；不传则按 durationSeconds 推导。 */
  shotCountRange?: string;
}

/** Seedance 2 单段能力上限（秒）；> 上限须拆多镜。搬自 FMV derive-multi-shot-plan.ts。 */
export const SEEDANCE_MAX_SHOT_DURATION = MAX_SHOT_DURATION;

/**
 * 拆镜数 —— 逐字搬自 FMV `derive-multi-shot-plan.ts:getShotCount`。
 * P5 超长检测用：> 15s 的节点须拆成 ceil(duration/15) 段。
 */
export function getShotCount(durationSeconds: number): number {
  if (durationSeconds <= 0) return 1;
  return Math.max(1, Math.ceil(durationSeconds / MAX_SHOT_DURATION));
}

/** 按 durationSeconds 推导镜头数区间 —— 逐字搬自 FMV resolvePhase3ShotCountInput 的兜底分支。 */
function deriveShotCountRange(durationSeconds: number): string {
  const estimatedShots = Math.max(4, Math.min(6, Math.round(durationSeconds / OPTIMAL_SHOT_DURATION)));
  return `${Math.max(4, estimatedShots - 1)}-${Math.min(8, estimatedShots + 1)}`;
}

/**
 * Phase 3 镜头脚本 user prompt 装配 —— 薄输入版。
 * section 顺序、每段规则文本、fallback 措辞与 FMV buildNodeShotScriptPrompt 一致；
 * 差异仅在于各段内容来自 ShotScriptInput（可选），而非 resolve ProjectRecord/SceneNode。
 */
export function buildNodeShotScriptPrompt(input: ShotScriptInput): string {
  const applyChoiceRevealRule = (input.choicesLength ?? 0) >= 2 && !input.isEnding;
  const isPov = input.perspective === "第一人称";

  const toneLockBlock = buildPhase3ToneLockBlock(input.tone);
  const perspectiveBlock = buildPerspectiveLockBlock(input.perspective, "phase3");
  const globalStyle = (input.styleKeywords ?? []).join("，");
  const globalStyleBlock = globalStyle ? buildPhase3GlobalStyleBlock(globalStyle) : "";
  const chapterBlock = buildPhase3ChapterBlock(input.chapterContext);

  const involvedChars =
    (input.characters ?? []).length > 0
      ? (input.characters ?? [])
          .map((c) => {
            const head = c.role ? `${c.name}（${c.role}）` : c.name;
            return c.appearance ? `${head}：${c.appearance}` : head;
          })
          .join("\n")
      : "无角色信息";
  const locationBlock = input.location?.trim() || "未指定场景";

  const nodeInfoBlock = buildPhase3NodeInfoBlock({
    tempId: input.nodeName,
    title: input.nodeName,
    storyText: input.storyText,
    durationSeconds: input.durationSeconds,
    narrativeRole: input.narrativeRole ?? "",
    videoIntent: input.videoIntent ?? "无",
    choiceSetup: input.choiceSetup ?? "无",
    visualAnchors: input.visualAnchors?.join("、") ?? "无",
    soundCues: input.soundCues?.join("、") ?? "无"
  });

  const screenplaySource = input.screenplay?.trim() ?? "";

  const variableSnapshotBlock =
    input.variableSnapshot && Object.keys(input.variableSnapshot).length > 0
      ? `【变量状态 → 表演基调】\n当前变量：${Object.entries(input.variableSnapshot)
          .map(([k, v]) => `${k}=${v}`)
          .join("，")}\n（镜头语言须体现变量值对角色状态的影响：高信任→肢体开放/眼神直视；低信任→拘谨/回避；高勇气→动作果决；低勇气→犹豫/手指绞动。）`
      : "";

  const prevVisualAnchors = (input.prevVisualAnchors ?? []).map((a) => `- ${a}`).join("\n");
  const nextAnchors = (input.nextAnchors ?? []).join("\n");
  const dialogueBibleBlock = input.dialogueBible?.trim() || "(本节点在 dialogueBible 中无对应条目)";

  const outputSchemaBlock = buildPhase3OutputSchemaBlock({
    shotCountRange: input.shotCountRange ?? deriveShotCountRange(input.durationSeconds),
    durationSeconds: input.durationSeconds
  });

  const interactiveBlock = buildPhase3InteractiveConstraintsBlock({
    applyChoiceRevealRule,
    choicesLength: input.choicesLength ?? 0
  });

  const sections = [
    PHASE3_TASK_HEADLINE,
    buildSeedanceShotSequenceProtocol(input.artStyle),
    perspectiveBlock,
    isPov ? PHASE3_POV_WRITING_RULES : "",
    toneLockBlock,
    globalStyleBlock,
    chapterBlock,
    `${PHASE3_CHARACTER_INFO_HEADER}\n${involvedChars}`,
    `${PHASE3_LOCATION_INFO_HEADER}\n${locationBlock}`,
    nodeInfoBlock,
    variableSnapshotBlock,
    screenplaySource ? `${PHASE3_SCREENPLAY_SOURCE_HEADER}\n${screenplaySource}` : "",
    screenplaySource ? PHASE3_SCREENPLAY_FIDELITY_RULES : "",
    `${PHASE3_PREV_VISUAL_ANCHORS_HEADER}\n${prevVisualAnchors || PHASE3_PREV_VISUAL_ANCHORS_FALLBACK}`,
    `${PHASE3_NEXT_ANCHORS_HEADER}\n${nextAnchors || PHASE3_NEXT_ANCHORS_FALLBACK}`,
    `${PHASE3_DIALOGUE_BIBLE_HEADER}\n${dialogueBibleBlock}`,
    PHASE3_ANTI_SUBTITLE_RULES,
    PHASE3_CROSS_SHOT_CONSISTENCY,
    interactiveBlock,
    outputSchemaBlock,
    PHASE3_FINAL_CHECKLIST
  ];

  return sections.filter(Boolean).join("\n\n");
}
