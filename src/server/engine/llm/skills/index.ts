/**
 * Skill Loader —— 把 `<skill-name>/SKILL.md` 作为字符串编译进 bundle。
 *
 * 规范目录（对齐 Anthropic/Cursor Agent Skill 结构）：
 *   src/llm/skills/<skill-name>/
 *     ├── SKILL.md          # 核心指令（必需；带 name/description frontmatter）
 *     ├── references/       # 参考资料 / few-shot（可选）
 *     └── assets/           # 模板 / 静态资源（可选）
 *
 * 运行时用 Vite 的 `?raw` 把 SKILL.md 读成文本，`body()` **剥掉 frontmatter**
 * 后作为纯净 system prompt 喂给模型 —— frontmatter 只服务于目录规范与人读，
 * 不进提示词。这样 promptForge.ts 拿到的仍是"完整 system prompt"。
 *
 * 谁要新增 skill：
 *   1. 建目录 `<skill-name>/SKILL.md`（顶部带 `--- name/description ---` frontmatter）
 *   2. 在这里 import（`./<skill-name>/SKILL.md?raw`）并用 `body()` 包一层后导出
 *   3. 让 promptForge 里对应的 forgeXxx() 把它当 systemPrompt 喂给模型
 */

import { readRaw } from '../_raw'
const imageSkill = readRaw(import.meta.url, './cinema-image-prompt/SKILL.md')
const videoSkill = readRaw(import.meta.url, './cinema-video-prompt/SKILL.md')
const kineticVideoSkill = readRaw(import.meta.url, './kinetic-video-prompt/SKILL.md')
const dialogueSkill = readRaw(import.meta.url, './dialogue-craft/SKILL.md')
const scenarioSkill = readRaw(import.meta.url, './scenario-architect/SKILL.md')
const scriptStructurerSkill = readRaw(import.meta.url, './script-structurer/SKILL.md')
const scriptCuratorSkill = readRaw(import.meta.url, './script-curator/SKILL.md')
const storyboardDirectorSkill = readRaw(import.meta.url, './storyboard-director/SKILL.md')
const outlineArchitectSkill = readRaw(import.meta.url, './outline-architect/SKILL.md')
const scriptExpanderSkill = readRaw(import.meta.url, './script-expander/SKILL.md')
const proseToBeatsSkill = readRaw(import.meta.url, './prose-to-beats/SKILL.md')
const imageToStorySeedSkill = readRaw(import.meta.url, './image-to-storyseed/SKILL.md')
const scriptIndexScannerSkill = readRaw(import.meta.url, './script-index-scanner/SKILL.md')
const proseToBeatsChunkedSkill = readRaw(import.meta.url, './prose-to-beats-chunked/SKILL.md')
const batchPromptTrioSkill = readRaw(import.meta.url, './batch-prompt-trio/SKILL.md')
const styleCuratorSkill = readRaw(import.meta.url, './style-curator/SKILL.md')
const loglineWriterSkill = readRaw(import.meta.url, './logline-writer/SKILL.md')
const synopsisWriterSkill = readRaw(import.meta.url, './synopsis-writer/SKILL.md')
const forgeChatAlignerSkill = readRaw(import.meta.url, './forge-chat-aligner/SKILL.md')
const characterVoiceCasterSkill = readRaw(import.meta.url, './character-voice-caster/SKILL.md')
const sceneBgmComposerSkill = readRaw(import.meta.url, './scene-bgm-composer/SKILL.md')
const seedance2PromptOptimizerSkill = readRaw(import.meta.url, './seedance2-prompt-optimizer/SKILL.md')
const uiCuratorSkill = readRaw(import.meta.url, './ui-curator/SKILL.md')

/**
 * 剥掉 SKILL.md 顶部的 YAML frontmatter（`--- ... ---`）。
 * frontmatter 仅用于目录规范/人读；喂给模型的 system prompt 必须是纯净正文，
 * 否则 `name:`/`description:` 会混进提示词造成噪声。无 frontmatter 时原样返回。
 */
function body(raw: string): string {
  const m = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(raw)
  return (m ? raw.slice(m[0].length) : raw).replace(/^\s*\n/, '')
}

export const SKILLS = {
  cinemaImagePrompt: body(imageSkill),
  cinemaVideoPrompt: body(videoSkill),
  /** 图生视频 · 动能派（黄金三角 + 屏幕交互）—— v3.8 新增；吃 directorPersona */
  kineticVideoPrompt: body(kineticVideoSkill),
  dialogueCraft: body(dialogueSkill),
  /** idea 模式 —— 从一句话**创作**整树（要发散、要审美） */
  scenarioArchitect: body(scenarioSkill),
  /** script 模式 —— **结构化解析**已写好的剧本（要忠于原文、禁二创） */
  scriptStructurer: body(scriptStructurerSkill),
  /** P2 整理 —— **保守整理**乱排剧本（修复段落/统一标题/表格转散文，禁改写、禁创作） */
  scriptCurator: body(scriptCuratorSkill),
  /** 分镜脚本 —— 把单个 scene 炸成 N 张电影分镜（含 A/B 双帧、时长控制、视觉锚点承接） */
  storyboardDirector: body(storyboardDirectorSkill),
  /** idea 多阶段 · Stage A —— 一句话 → 2-4 幕大纲（不写台词、不写画面，只立"故事骨架 + 主角 + tone"） */
  outlineArchitect: body(outlineArchitectSkill),
  /** idea 多阶段 · Stage B —— 单幕 beat → 成品剧本文本（场景+对白+画面描写，纯文本供下游 scriptStructurer 吃） */
  scriptExpander: body(scriptExpanderSkill),
  /** P3 抽 beats —— **从已有散文/小说原文里抽 beats 清单**（每 beat 带原文 quote 可审计，禁创作） */
  proseToBeats: body(proseToBeatsSkill),
  /** P4 一张图 → 故事种子 —— 看图后顺势创作 Outline（与 outlineArchitect 输出形状一致，下游可直接走 forgeScriptFromOutline） */
  imageToStorySeed: body(imageToStorySeedSkill),
  /** 长文 · Pass 1 —— 全局索引扫描器（角色名册 / 场景地图 / logline / tone）；输入全文，输出极简 JSON */
  scriptIndexScanner: body(scriptIndexScannerSkill),
  /** 长文 · Pass 2 —— 单 chunk beats 抽取器（强制使用 Pass 1 的全局索引 ID 做跨段对齐） */
  proseToBeatsChunked: body(proseToBeatsChunkedSkill),
  /** 长文 · Phase 4 —— 单 Act 一次出齐 image+storyboard+video 三件套（跨 scene 一致性 + 节省 LLM call 数 / token） */
  batchPromptTrio: body(batchPromptTrioSkill),
  /** Forge 模块化 · Stage 0 —— 风格策展（导演 / 编剧 / 视觉基调）, 是后续所有 skill 的上游锚点 */
  styleCurator: body(styleCuratorSkill),
  /** Forge 模块化 · Stage 1 —— 一句话 logline + 3 条差异化备选, 主角 / 欲望 / 阻力 三要素硬约束 */
  loglineWriter: body(loglineWriterSkill),
  /** Forge 模块化 · Stage 2 —— 200–380 字梗概 + 3-5 拍 beats + keyImage, logline → outline 桥梁 */
  synopsisWriter: body(synopsisWriterSkill),
  /** Forge 模块化 · Intent —— ForgeChatPanel 自然语言意图分类兜底（keyword router 之后的 LLM 兜底） */
  forgeChatAligner: body(forgeChatAlignerSkill),
  /**
   * Forge · 角色音色选角师 (v6.7) ——
   *   从 TTS 白名单里挑 3 个候选音色 + 自创角色专属基准话语,
   *   供作者试听并锚定为 character.voiceAnchor.
   */
  characterVoiceCaster: body(characterVoiceCasterSkill),
  /**
   * Forge · 场景 BGM 作曲指挥 (v6.7) ——
   *   单 / 多场景 → MiniMax Music 官方框架的 cinematic instrumental brief.
   *   产物直接喂给 minimax music_generation prompt 字段.
   */
  sceneBgmComposer: body(sceneBgmComposerSkill),
  /**
   * 官方 Seedance 2.0 提示词优化器 (sd2-pe) ——
   *   把"分镜 + 锚点素材"翻译成 Seedance 2.0 工程化提示词:
   *   @图片N/<主体N> 绑定语法、八大要素、路径 A(单镜一段式)/路径 B(多镜三段论)、
   *   一镜一运镜、镜头序号优先于绝对秒数、大头照+全身照(禁三视图)、音频/字幕特殊符号。
   *   定位: cinema-video-prompt / kinetic-video-prompt 的 Seedance 2.0 升级规范。
   */
  seedance2PromptOptimizer: body(seedance2PromptOptimizerSkill),
  /**
   * Forge · 影游 UI 素材策展师 (v9) ——
   *   按剧本 + 视觉风格产出一套叠加式 UI 素材规格(role/prompt/matte/lifecycle/anchor),
   *   去背靠图层混合(纯黑+滤色 / 纯白+相乘),版权安全。供 UIAssetLibrary「AI 生成整套」。
   */
  uiCurator: body(uiCuratorSkill),
} as const

export type SkillName = keyof typeof SKILLS

/**
 * 按需取用 skill 文本。
 * 调用方一般直接 `SKILLS.cinemaVideoPrompt`，但若要做"按名称选 skill"
 * 的 UI（如未来给作者一个"选风格"下拉框），用这个函数。
 */
export function getSkill(name: SkillName): string {
  return SKILLS[name]
}
