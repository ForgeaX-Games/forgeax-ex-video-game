/**
 * forgeKineticVideo —— 图生视频提示词生成管线（v3.8 新增）
 *
 * 定位：在 storyboard 产出的 shot 基础上，为**单个镜头**生成
 * 一段可直接喂 Seedance / Sora / Kling 等视频模型的中文提示词。
 *
 * 与 `forgeStoryboard` / `batchVideoGen` 的分工：
 *
 *   forgeStoryboard   → 产出 shots[]（画面/台词/音效/A-B 帧）
 *   forgeKineticVideo → 为每个 shot 产出 shot.kineticVideoPrompt（本文件）
 *   batchVideoGen     → 把 kineticVideoPrompt + keyframe 图片喂给视频模型
 *
 * 核心职责 = **翻译**，不是生成视频。
 *
 * 设计：
 *   - system prompt = directorPersona + kinetic-video-prompt.skill.md
 *   - 输出是 150-350 字中文单段纯文本（不是 JSON），直接落 shot.kineticVideoPrompt
 *   - 纯函数 `buildKineticVideoUserPrompt` 可单测
 *   - 不调 ImageClient / VideoClient，只调 TextClient
 */

import type { Scene, Shot, Character, DialogueLine, DirectorStyleId, VisualStyle } from '../../scenario/types'
import { SKILLS } from '../skills'
import type { TextClient } from '../config/types'
import { streamOrFallback } from '../config/types'
import { resolveDirectorPersona, serializePersonaToPrompt } from '../config/directorPersonas'

export interface ForgeKineticVideoArgs {
  /** 目标镜头 —— 所有分镜脚本字段将直接读取 */
  shot: Shot
  /** 所在 scene（供上下文 fallback：视觉风格、场所氛围等） */
  scene: Scene
  /** 导演流派 —— 决定运镜节奏/色彩/手持偏好 */
  directorStyle?: DirectorStyleId
  /** custom persona 自由文本（directorStyle='custom' 时） */
  directorCustomPersona?: string
  /** 全局视觉风格（photoreal / anime / ...）—— 不在输出里复读，只作为背景信息 */
  visualStyle?: VisualStyle
  /** 全局 UI 风格提示词（若有） */
  uiStylePrompt?: string
}

export interface ForgeKineticVideoResult {
  /** 最终落入 shot.kineticVideoPrompt 的纯文本（150-350 字中文单段） */
  prompt: string
  /** LLM 原始输出 —— 调试 */
  raw: string
  /** 告警（长度超限、缺失关键字段等，不阻塞） */
  warnings: string[]
}

export interface ForgeKineticVideoStreamOpts {
  onProgress?: (ev:
    | { kind: 'stage'; label: string; detail?: string }
    | { kind: 'delta'; delta: string; cumulative: string }
  ) => void
  signal?: AbortSignal
}

/**
 * 入口 —— 为单个 shot 生成图生视频提示词。
 *
 * 典型调用：
 *   - Editor 里作者对某个 shot 点"生成视频提示词"按钮
 *   - 批量：对 scene.shots 并发跑（调用方负责 concurrency，建议 3-4）
 */
export async function forgeKineticVideoPrompt(
  llm: TextClient,
  args: ForgeKineticVideoArgs,
  opts: ForgeKineticVideoStreamOpts = {},
): Promise<ForgeKineticVideoResult> {
  const persona = resolveDirectorPersona(
    args.directorStyle,
    args.directorCustomPersona,
  )
  const systemPrompt = [
    serializePersonaToPrompt(persona),
    '',
    '---',
    '',
    SKILLS.kineticVideoPrompt,
  ].join('\n')

  const user = buildKineticVideoUserPrompt(args)

  opts.onProgress?.({
    kind: 'stage',
    label: '调用视频动能导演',
    detail: `${llm.getProviderName()} · ${llm.getModel()} · ${persona.displayName} · ${args.shot.durationSec ?? '?'}s · ${args.shot.keyframeStrategy ?? 'single'}`,
  })

  const raw = await streamOrFallback(
    llm,
    {
      systemPrompt,
      userPrompt: user,
      temperature: 0.85,
      maxTokens: 1200,
      jsonMode: false,
    },
    (ev) => {
      if (ev.type === 'text') {
        opts.onProgress?.({
          kind: 'delta',
          delta: ev.delta,
          cumulative: ev.cumulative,
        })
      } else if (ev.type === 'done') {
        opts.onProgress?.({
          kind: 'stage',
          label: '视频提示词完成',
          detail: `${ev.full.length} 字 · ${ev.latencyMs}ms`,
        })
      }
    },
    opts.signal,
  )

  const warnings: string[] = []
  const prompt = sanitizeKineticVideoPrompt(raw, warnings)

  return { prompt, raw, warnings }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers · 可单测
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 把 shot + scene 上下文拼成 kinetic-video-prompt skill 的 user prompt。
 * 结构对应 skill 里声明的"输入格式"章节。
 */
export function buildKineticVideoUserPrompt(args: ForgeKineticVideoArgs): string {
  const { shot, scene } = args
  const persona = resolveDirectorPersona(
    args.directorStyle,
    args.directorCustomPersona,
  )

  const lines: string[] = []
  lines.push(
    `【导演流派】${persona.displayName} —— ${persona.tagline}（身份/剪辑语法/镜头语言见 system prompt）`,
  )
  lines.push(`【时长】${shot.durationSec ?? 5}`)
  lines.push(`【关键帧策略】${shot.keyframeStrategy ?? 'single'}`)
  lines.push(`【景别 framing】${shot.framing}`)

  const bokehState = shot.bokehState
  if (bokehState) lines.push(`【背景状态 bokehState】${bokehState}`)

  const midPrompt = shot.prompt?.trim()
  if (midPrompt) lines.push(`【中间帧 prompt】${midPrompt}`)

  if (shot.keyframeStrategy === 'ab') {
    const a = shot.startFramePrompt?.trim()
    const b = shot.endFramePrompt?.trim()
    if (a) lines.push(`【A 帧 prompt】${a}`)
    if (b) lines.push(`【B 帧 prompt】${b}`)
  }

  if (shot.cameraHint?.trim()) lines.push(`【运镜提示 cameraHint】${shot.cameraHint.trim()}`)
  if (shot.dialogueText?.trim()) lines.push(`【本镜台词 dialogueText】${shot.dialogueText.trim()}`)
  if (shot.subtext?.trim()) lines.push(`【潜台词 subtext】${shot.subtext.trim()}`)
  if (shot.performance?.trim()) lines.push(`【表演指导 performance】${shot.performance.trim()}`)
  if (shot.audioHint?.trim()) lines.push(`【环境音 audioHint】${shot.audioHint.trim()}`)
  if (shot.transitionHint?.trim()) lines.push(`【转场提示 transitionHint】${shot.transitionHint.trim()}`)

  if (args.visualStyle) lines.push(`【全局视觉风格】${args.visualStyle}`)

  // 场景上下文（兜底信息；skill 会选择性利用）
  const sceneBg = scene.background?.trim()
  if (sceneBg) lines.push(`【场景舞美 / 氛围（上下文）】${sceneBg}`)

  if (args.uiStylePrompt?.trim()) {
    lines.push(`【UI 风格（上下文）】${args.uiStylePrompt.trim()}`)
  }

  lines.push('')
  lines.push(
    '请输出 150-350 字中文单段纯文本，无 markdown / 代码块 / JSON / 编号 / 标题；符合 persona 的运镜节奏与色彩强度。',
  )

  return lines.join('\n\n')
}

/**
 * 规整 LLM 返回的视频提示词：
 *   - 去 ```xxx``` / json 标记
 *   - 去开头的常见元话语（"好的"/"以下是"）
 *   - 长度超 450 字 → 截断并告警；不足 80 字 → 保留但告警
 *   - 把多行压成单段（合并换行），保留一个段落
 */
export function sanitizeKineticVideoPrompt(
  raw: string,
  warnings: string[],
): string {
  let text = raw.trim()

  // 剥离 markdown code fence
  const fenceMatch = text.match(/^```[a-zA-Z0-9]*\n([\s\S]*?)\n```$/)
  if (fenceMatch && fenceMatch[1]) {
    text = fenceMatch[1].trim()
  }

  // 常见引导语前缀
  const leadingPatterns: RegExp[] = [
    /^好的[，,]?\s*/,
    /^以下是[^\n]{0,20}[:：]\s*/,
    /^这是[^\n]{0,20}[:：]\s*/,
    /^[【(（][^】\n)）]{0,20}[】)）]\s*/,
  ]
  for (const re of leadingPatterns) {
    text = text.replace(re, '')
  }

  // 多段 → 单段：把 \n+ 替换为一个中文句号+空格（避免粘成一坨）
  text = text.replace(/\n{2,}/g, '。').replace(/\n/g, ' ').trim()

  if (text.length > 450) {
    warnings.push(`kinetic video prompt 超 450 字（${text.length}），已截断`)
    text = text.slice(0, 450)
  }
  if (text.length < 80) {
    warnings.push(`kinetic video prompt 过短（${text.length}），可能被截断或质量不足`)
  }

  return text
}

// ─────────────────────────────────────────────────────────────────────────────
// Cinema 出片提示词（v4 新增）—— 分秒时间码 + 逐字台词(点名角色) + 参考图锚定
//
// 与上面的 kinetic 版分工：
//   - kinetic: 图生视频 / 单段 / 物理交互主导 / 压成单段 ≤450 字 / 不带时间码
//   - cinema:  R2V 出片 / 单镜 ≤15s 内时间码分拍 / 逐字台词点名角色 / 角色↔参考图锚定 /
//              保留换行与时间码 / 上限更高（~1500 字）
//
// 出片链路 orchestrateVideos.resolveSeedanceShotPrompt 优先调用本生成器。
// ─────────────────────────────────────────────────────────────────────────────

export interface ForgeCinematicVideoArgs {
  /** 目标镜头 —— 读取 dialogueText / performance / framing / durationSec 等 */
  shot: Shot
  /** 所在 scene（提供舞美/氛围上下文，以及 fallback 台词） */
  scene: Scene
  /**
   * 本镜出场角色（用于角色花名册 + 外观锚点）。
   * 调用方应只传**本镜相关**角色（按 shot.characterIds / scene.characterIds 过滤），
   * 让提示词里的角色名与「参考素材说明」用同一套名字。
   */
  characters?: Character[]
  /** 导演流派 —— 决定运镜节奏/色彩/手持偏好 */
  directorStyle?: DirectorStyleId
  /** custom persona 自由文本（directorStyle='custom' 时） */
  directorCustomPersona?: string
  /** 全局视觉风格（photoreal / anime / ...） */
  visualStyle?: VisualStyle
  /** 全局 UI 风格提示词（若有） */
  uiStylePrompt?: string
}

export interface ForgeCinematicVideoResult {
  /** 最终落入 shot.cinemaVideoPrompt 的纯文本（保留时间码换行的多段） */
  prompt: string
  /** LLM 原始输出 —— 调试 */
  raw: string
  /** 告警 */
  warnings: string[]
}

/**
 * 入口 —— 为单个 shot 生成电影级出片提示词（cinema 范式）。
 */
export async function forgeCinematicVideoPrompt(
  llm: TextClient,
  args: ForgeCinematicVideoArgs,
  opts: ForgeKineticVideoStreamOpts = {},
): Promise<ForgeCinematicVideoResult> {
  const persona = resolveDirectorPersona(
    args.directorStyle,
    args.directorCustomPersona,
  )
  const systemPrompt = [
    serializePersonaToPrompt(persona),
    '',
    '---',
    '',
    SKILLS.cinemaVideoPrompt,
  ].join('\n')

  const user = buildCinemaVideoUserPrompt(args)

  opts.onProgress?.({
    kind: 'stage',
    label: '调用电影出片导演',
    detail: `${llm.getProviderName()} · ${llm.getModel()} · ${persona.displayName} · ${args.shot.durationSec ?? '?'}s`,
  })

  const raw = await streamOrFallback(
    llm,
    {
      systemPrompt,
      userPrompt: user,
      temperature: 0.8,
      maxTokens: 2200,
      jsonMode: false,
    },
    (ev) => {
      if (ev.type === 'text') {
        opts.onProgress?.({ kind: 'delta', delta: ev.delta, cumulative: ev.cumulative })
      } else if (ev.type === 'done') {
        opts.onProgress?.({
          kind: 'stage',
          label: '出片提示词完成',
          detail: `${ev.full.length} 字 · ${ev.latencyMs}ms`,
        })
      }
    },
    opts.signal,
  )

  const warnings: string[] = []
  const prompt = sanitizeCinemaVideoPrompt(raw, warnings)

  return { prompt, raw, warnings }
}

/**
 * 把 shot + scene + 角色花名册拼成 cinema-video-prompt skill 的 user prompt。
 *
 * 关键点：
 *   - 角色花名册（id / 名字 / 外观锚点）前置，让模型用**统一角色名**写台词和外观一致性。
 *   - dialogueText **保留换行**（多句来回对白每行「角色名：台词」），并明确要求逐字念、点名角色。
 *   - 强调这是「单个 shot ≤15s」，内部用时间码分拍，不再拆多场。
 */
export function buildCinemaVideoUserPrompt(args: ForgeCinematicVideoArgs): string {
  const { shot, scene } = args
  const persona = resolveDirectorPersona(
    args.directorStyle,
    args.directorCustomPersona,
  )

  const lines: string[] = []
  lines.push(
    `【导演流派】${persona.displayName} —— ${persona.tagline}（身份/剪辑语法/镜头语言见 system prompt，请以这个导演的眼睛调度本镜）`,
  )
  lines.push(`【本镜时长（秒）】${shot.durationSec ?? 5}（单个 shot，请在此时长内用时间码分拍，NEVER 超过 15s 或塞进跨场多场戏）`)
  lines.push(`【景别 framing】${shot.framing}`)
  if (shot.bokehState) lines.push(`【背景状态 bokehState】${shot.bokehState}`)

  // 角色花名册 —— 名字 + 外观锚点，供"角色↔参考图锚定"统一用名
  const roster = (args.characters ?? []).filter((c) => c && c.name)
  if (roster.length > 0) {
    const block = roster
      .map((c) => {
        const appearance = c.prompt?.trim()
        return `- ${c.name}${appearance ? `：${appearance}` : ''}`
      })
      .join('\n')
    lines.push(
      `【本镜角色花名册（写台词/外观一致性时，必须用这里的角色名；这些名字与参考图一一对应）】\n${block}`,
    )
  }

  const midPrompt = shot.prompt?.trim()
  if (midPrompt) lines.push(`【画面意图 prompt】${midPrompt}`)

  if (shot.cameraHint?.trim()) lines.push(`【运镜提示 cameraHint】${shot.cameraHint.trim()}`)

  // 台词 —— 保留换行；明确逐字念 + 点名角色
  const dialogue = buildShotDialogue(shot, scene)
  if (dialogue) {
    lines.push(
      `【本镜台词（必须逐字保留，由点名的角色开口说出，不可漏念/改写/错配到别人）】\n${dialogue}`,
    )
  } else {
    lines.push('【本镜台词】无台词 —— 专注动作/环境/情绪，不要硬塞对白。')
  }

  if (shot.subtext?.trim()) lines.push(`【潜台词 subtext】${shot.subtext.trim()}`)
  if (shot.performance?.trim()) lines.push(`【表演指导 performance】${shot.performance.trim()}`)
  if (shot.audioHint?.trim()) lines.push(`【环境音 audioHint】${shot.audioHint.trim()}`)
  if (shot.transitionHint?.trim()) lines.push(`【转场提示 transitionHint】${shot.transitionHint.trim()}`)

  if (args.visualStyle) lines.push(`【全局视觉风格】${args.visualStyle}`)

  const sceneBg = scene.background?.trim()
  if (sceneBg) lines.push(`【场景舞美 / 氛围（上下文）】${sceneBg}`)
  if (args.uiStylePrompt?.trim()) lines.push(`【UI 风格（上下文）】${args.uiStylePrompt.trim()}`)

  lines.push('')
  lines.push(
    '请输出**单个 shot** 的电影级出片提示词：以 `[0-X 秒]` 时间码分段（各段换行分隔），含镜头语言 + 声音注释 + 物理修饰语 + 画质规格；台词逐字、点名角色、贴在该角色动作里；角色名/外观一致性锚点逐段复述。纯文本，无 markdown / 代码块 / 元话语。',
  )

  return lines.join('\n\n')
}

/** scene 级台词兜底：shot 没给 dialogueText 时，拼 scene.dialogue 的「说话人：台词」多行。*/
function fallbackSceneDialogue(scene: Scene): string {
  if (!scene.dialogue || scene.dialogue.length === 0) return ''
  return scene.dialogue
    .filter((d) => d && d.text?.trim() && d.role !== 'system')
    .map((d) => `${d.speaker || (d.role === 'narration' ? '旁白' : '角色')}：${d.text.trim()}`)
    .join('\n')
}

/** 一行台词的「说话人：内容」展示。 */
function dialogueDisplayLine(d: DialogueLine): string {
  return `${d.speaker || (d.role === 'narration' ? '旁白' : '角色')}：${d.text.trim()}`
}

/**
 * 本镜出片提示词用的台词 —— 在 shot.dialogueText 基础上，**补齐落在本镜时间窗内、
 * 却没被分配进 dialogueText 的 scene.dialogue 句**。
 *
 * 背景：拆分镜时 LLM 偶尔漏把某句台词写进任何镜的 dialogueText，导致这句台词在
 * 所有出片 prompt 里都看不到（用户反馈「漏台词」）。realign 后每句都有相对 scene
 * 的时间，这里按 shot 的 [startMs,endMs] 把漏掉的句补回对应镜，保证全覆盖、不漏读。
 */
function buildShotDialogue(shot: Shot, scene: Scene): string {
  const base = shot.dialogueText?.trim() || ''
  // 整镜无台词文本 → 退回 scene 级兜底（保持旧行为）。
  if (!base) return fallbackSceneDialogue(scene)
  if (shot.startMs == null || shot.endMs == null) return base
  const start = shot.startMs
  const end = shot.endMs
  const baseNorm = base.replace(/\s+/g, '')
  const extra = (scene.dialogue ?? [])
    .filter((d) => d && d.text?.trim() && d.role !== 'system')
    .filter((d) => {
      const mid = d.endMs != null ? (d.startMs + d.endMs) / 2 : d.startMs
      return mid >= start && mid < end
    })
    .filter((d) => !baseNorm.includes(d.text.trim().replace(/\s+/g, '')))
    .map(dialogueDisplayLine)
  return extra.length > 0 ? `${base}\n${extra.join('\n')}` : base
}

/**
 * 规整 cinema 出片提示词 —— 与 kinetic 版不同，**保留换行/时间码结构**：
 *   - 去 ```code fence``` 与开头元话语
 *   - 逐行 trim，丢弃空行造成的 3+ 连续换行（压成最多一个空行）
 *   - 上限放宽到 1800 字（时间码多段本就长）；超限截断并告警
 *   - 不足 60 字告警（可能被截断）
 */
export function sanitizeCinemaVideoPrompt(raw: string, warnings: string[]): string {
  let text = raw.trim()

  const fenceMatch = text.match(/^```[a-zA-Z0-9]*\n([\s\S]*?)\n```$/)
  if (fenceMatch && fenceMatch[1]) {
    text = fenceMatch[1].trim()
  }

  const leadingPatterns: RegExp[] = [
    /^好的[，,]?\s*/,
    /^以下是[^\n]{0,20}[:：]\s*/,
    /^这是[^\n]{0,20}[:：]\s*/,
  ]
  for (const re of leadingPatterns) {
    text = text.replace(re, '')
  }

  // 保留换行：逐行 trim，去掉首尾空行，把 3+ 连续换行压成一个空行
  text = text
    .split('\n')
    .map((l) => l.replace(/\s+$/g, '').replace(/^\s+/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (text.length > 1800) {
    warnings.push(`cinema video prompt 超 1800 字（${text.length}），已截断`)
    text = text.slice(0, 1800)
  }
  if (text.length < 60) {
    warnings.push(`cinema video prompt 过短（${text.length}），可能被截断或质量不足`)
  }

  return text
}
