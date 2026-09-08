/**
 * 语言一致性检查（设计 §11.4）。
 *
 * Prompt 已经要求「写进项目的自然语言一律用作者语言」，但模型偶尔还是会
 * 把角色描述或出图 Prompt 写成英文——尤其是出图 Prompt，因为它「看起来像
 * 给模型看的参数」。这是机器兜底：报出字段路径，但**不阻塞流程**。
 *
 * 为什么只做 warning：语言漂移是质量问题不是正确性问题，拦住 `complete_activity`
 * 会把一次润色变成一次撞墙；而且判定必然有误差，宁可漏报也不要卡住创作。
 */
import type { GameScenario } from '@/runtime/core/schema/graph-schema'
import type { CharacterDefinition, SceneDefinition, VideoDefinition } from '@/authoring/assets/registry-types'

export interface LanguageIssue {
  /** 字段路径，例如 `assetCatalog.entities.character.c1.prompt`。 */
  path: string
  message: string
  sample: string
}

/**
 * 专有名词与技术缩写照常保留：`Boss`、`QTE`、`HP` 出现在中文句子里是正常写法，
 * 不该被判成语言漂移。判定只看「整句是否为英文」。
 */
const CJK = /[\u4e00-\u9fff\u3040-\u30ff]/
const LATIN_WORD = /[A-Za-z]{2,}/g

/** 纯标识符字段不参与语言检查：ID、check ID、公式函数名本来就是英文。 */
function isIdentifierLike(value: string): boolean {
  return /^[A-Za-z0-9_.:\-/]+$/.test(value.trim())
}

/**
 * 一段自然语言是否偏离了作者语言。
 *
 * 判定用「拉丁词占比」而不是「是否含英文」：含 Boss、QTE 的中文句子必须放过，
 * 而通篇英文的句子必须报出来。
 */
export function driftsFromChinese(value: string): boolean {
  const text = value.trim()
  if (text.length < 8) return false
  if (isIdentifierLike(text)) return false
  if (CJK.test(text)) return false
  // 到这里既没有中日文字符、又不是标识符，且有一定长度。
  const words = text.match(LATIN_WORD) ?? []
  return words.length >= 3
}

function check(
  issues: LanguageIssue[],
  path: string,
  value: string | undefined,
  label: string,
): void {
  if (!value) return
  if (!driftsFromChinese(value)) return
  issues.push({
    path,
    message: `${label}使用了英文，请改为作者语言`,
    sample: value.trim().slice(0, 60),
  })
}

/**
 * 扫描内容平面里由 Agent 撰写的自然语言字段。
 *
 * 只覆盖「模型写、用户读或用户消费」的字段：角色与场景的描述和出图 Prompt、
 * 章节梗概与正文、界面文案。不碰 ID、不碰公式表达式。
 */
export function languageConsistencyIssues(
  project: GameScenario,
  assetEntities: {
    characters?: Readonly<Record<string, CharacterDefinition>>
    scenes?: Readonly<Record<string, SceneDefinition>>
    videos?: Readonly<Record<string, VideoDefinition>>
  } = {},
): LanguageIssue[] {
  const issues: LanguageIssue[] = []

  for (const [id, character] of Object.entries(assetEntities.characters ?? {})) {
    check(issues, `assetCatalog.entities.character.${id}.name`, character.name, '角色名')
    check(issues, `assetCatalog.entities.character.${id}.description`, character.appearance?.description, '角色外观描述')
    check(issues, `assetCatalog.entities.character.${id}.prompt`, character.appearance?.previewPrompt, '角色出图提示词')
  }

  for (const [id, scene] of Object.entries(assetEntities.scenes ?? {})) {
    check(issues, `assetCatalog.entities.scene.${id}.name`, scene.name, '场景名')
    check(issues, `assetCatalog.entities.scene.${id}.summary`, scene.summary, '场景梗概')
    check(issues, `assetCatalog.entities.scene.${id}.description`, scene.visual?.description, '场景画面描述')
    check(issues, `assetCatalog.entities.scene.${id}.prompt`, scene.visual?.previewPrompt, '场景出图提示词')
  }

  for (const [id, video] of Object.entries(assetEntities.videos ?? {})) {
    check(issues, `assetCatalog.entities.video.${id}.name`, video.name, '视频预设名')
    check(issues, `assetCatalog.entities.video.${id}.summary`, video.summary, '视频预设梗概')
    check(issues, `assetCatalog.entities.video.${id}.description`, video.description, '视频预设描述')
    check(issues, `assetCatalog.entities.video.${id}.prompt`, video.prompt, '视频预设出图提示词')
  }

  for (const [id, variable] of Object.entries(project.variables ?? {})) {
    check(issues, `variables.${id}.name`, variable.name, '变量显示名')
  }
  for (const [id, entity] of Object.entries(project.entities ?? {})) {
    check(issues, `entities.${id}.name`, entity.name, '实体显示名')
  }

  return issues
}

/** 蓝图节点里的自然语言。节点住在 manifest 里，所以单独一支。 */
export function nodeLanguageIssues(
  nodes: ReadonlyArray<{ id: string, data: { name?: string, chapterSummary?: string, storyText?: string, media?: { kind?: string, prompt?: string } } }>,
  blueprintId: string,
): LanguageIssue[] {
  const issues: LanguageIssue[] = []
  for (const node of nodes) {
    const base = `manifest.packs.${blueprintId}.nodes.${node.id}`
    check(issues, `${base}.name`, node.data.name, '节点名')
    check(issues, `${base}.chapterSummary`, node.data.chapterSummary, '章节梗概')
    check(issues, `${base}.storyText`, node.data.storyText, '章节正文')
    if (node.data.media?.kind === 'video') {
      check(issues, `${base}.media.prompt`, node.data.media.prompt, '节点画面提示词')
    }
  }
  return issues
}
