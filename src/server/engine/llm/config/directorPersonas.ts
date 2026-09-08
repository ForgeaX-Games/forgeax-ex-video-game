/**
 * 导演 agent · 流派 persona 库。
 *
 * v4（2026-07）重构：persona 的**内容源**已迁到规范 skill 目录
 * `skills/directors/<id>/SKILL.md`，由 `directorSkillLoader` 解析成 DirectorPersona。
 * 本文件只保留**对外 API**（resolve / serialize / list / 默认值），内容不再内联，
 * 从而对齐 Agent Skill 目录规范、便于深度调研与扩充。下游 6 个 forge 调用点
 *（分镜 / 三件套 / 逐镜出片 / kinetic / seedance / videoPlan）零改动。
 *
 * 扩展新流派：
 *   ① scenario/types.ts 的 DirectorStyleId union 加字符串
 *   ② 建 skills/directors/<id>/SKILL.md（六段：身份/剪辑语法/镜头语言/节奏/下游绑定/海报样张）
 *   ③ directorSkillLoader.ts 的 REGISTRY 登记一行（UI 选择器/海报自动读取）
 */

import type { DirectorStyleId } from '../../scenario/types'
import {
  DIRECTOR_PERSONAS,
  DIRECTOR_ORDER,
  DIRECTING_PRINCIPLE,
  type DirectorPersona,
} from './directorSkillLoader'

export type { DirectorPersona } from './directorSkillLoader'
export { DIRECTING_PRINCIPLE } from './directorSkillLoader'

/**
 * 默认流派 —— 未指定 directorStyle 或指向 unknown id 时回退。
 * minimal-epic（极简史诗）：对新手最稳、画面最不容易崩、剪辑最规矩。
 */
export const DEFAULT_DIRECTOR_STYLE: DirectorStyleId = 'minimal-epic'

/**
 * 全部预设 persona（不含 custom）—— 内容来自 directorSkillLoader 解析 SKILL.md。
 * 保留此导出名以兼容既有 import（tests / 其他消费者）。
 */
export const PERSONAS: Record<Exclude<DirectorStyleId, 'custom'>, DirectorPersona> =
  DIRECTOR_PERSONAS

/**
 * 查出一个导演 persona。
 * custom 不在 PERSONAS 里——外部需自己把 customText 传进来。
 * 未知 id 一律回退 default。
 *
 * @param id       Scenario.directorStyle
 * @param custom   Scenario.directorCustomPersona（仅 id='custom' 时使用）
 */
export function resolveDirectorPersona(
  id: DirectorStyleId | undefined,
  custom?: string,
): DirectorPersona {
  if (id === 'custom' && custom && custom.trim()) {
    return {
      id: 'custom',
      displayName: '自定义',
      tagline: '作者自填 persona',
      identity: custom.trim(),
      editingGrammar:
        '（作者自定义——以 identity 段描述为准；如未指定，默认节拍中速、剪辑不过度风格化）',
      cameraLanguage:
        '（作者自定义——以 identity 段描述为准；如未指定，默认 medium+close 混合、自然光、中性色彩）',
      pacing:
        '（作者自定义——以 identity 段描述为准；如未指定，默认根据场景情绪自调）',
      downstreamBinding:
        '（作者自定义——按 identity 描述的风格，遵循"镜头调度通则"：景别随戏走、签名点睛不逐镜套用、紧张处快切、连贯桥段尽量 15 秒内一镜到底、短拍约 4 秒留裁剪）',
      posterPrompt:
        'Cinematic film poster, balanced dramatic composition, natural cinematic lighting, neutral filmic color grade, evocative mood, no text, vertical 2:3',
    }
  }
  const chosen = (id && id !== 'custom' ? id : DEFAULT_DIRECTOR_STYLE) as Exclude<
    DirectorStyleId,
    'custom'
  >
  return PERSONAS[chosen] ?? PERSONAS[DEFAULT_DIRECTOR_STYLE as Exclude<DirectorStyleId, 'custom'>]
}

/**
 * 把 persona 序列化成一段可直接嵌入 LLM system prompt 的 Markdown 文本。
 *
 * 输出稳定 —— 不含日期、随机数、对象地址；便于测试比对。
 *
 * 结构固定 6 段，方便下游 skill 层按段覆盖/替换：
 *   # 导演流派：<displayName>  <tagline>
 *   **身份**：...
 *   **剪辑语法**：...
 *   **镜头语言**：...
 *   **镜头调度通则**：...（所有流派通用，强制"情境化调度、非逐镜套用"）
 *   **节奏偏好**：...
 *   **下游绑定**：...（情境化调度矩阵 + 时长窗口，把风格更硬地传到逐镜出片）
 */
export function serializePersonaToPrompt(p: DirectorPersona): string {
  return [
    `# 导演流派：${p.displayName} —— ${p.tagline}`,
    '',
    `**身份**：${p.identity}`,
    '',
    `**剪辑语法**：${p.editingGrammar}`,
    '',
    `**镜头语言**：${p.cameraLanguage}`,
    '',
    `**镜头调度通则（凌驾于上面的风格之上，所有导演通用）**：${DIRECTING_PRINCIPLE}`,
    '',
    `**节奏偏好**：${p.pacing}`,
    '',
    `**下游绑定（落到逐镜出片 / 剪辑；情境化调度，非逐镜套用）**：\n${p.downstreamBinding}`,
  ].join('\n')
}

/**
 * 把 LLM/外部传来的任意字符串收敛成**合法的预设导演 id**。
 * 命中预设库 → 返回该 id；否则返回 undefined（调用方决定回退默认还是忽略）。
 * 'custom' 不算"预设库 id"，这里一律视为未命中——接线只用预设库，custom 走 UI 手填。
 */
export function coerceDirectorStyleId(v: unknown): Exclude<DirectorStyleId, 'custom'> | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return (DIRECTOR_ORDER as string[]).includes(t)
    ? (t as Exclude<DirectorStyleId, 'custom'>)
    : undefined
}

/**
 * 列出 UI 选择器要展示的全部流派（含 custom 占位）。
 * 顺序来自 loader 的 DIRECTOR_ORDER（villeneuve 默认置首），custom 追加末尾。
 */
export function listDirectorStyleOptions(): Array<{
  id: DirectorStyleId
  displayName: string
  tagline: string
}> {
  const list = DIRECTOR_ORDER.map((id) => {
    const p = PERSONAS[id]
    return { id: id as DirectorStyleId, displayName: p.displayName, tagline: p.tagline }
  })
  list.push({
    id: 'custom',
    displayName: '自定义',
    tagline: '作者自填 persona（自由文本，凌驾预设）',
  })
  return list
}
