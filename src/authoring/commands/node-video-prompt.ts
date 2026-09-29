import type {
  PillarEndingContract,
  PillarInteractionBeatContract,
  PillarInteractionContract,
  PillarNamedEntry,
} from '@/authoring/documents/pillar-interaction-contract'

/** 几个字的章节名不够拍；镜头提示词至少要能交代场面、动作和光影。 */
export const MIN_NODE_VIDEO_PROMPT_LENGTH = 20

function joinNamed(
  entries: readonly PillarNamedEntry[] | undefined,
): string {
  return (entries ?? [])
    .map((entry) => (entry.summary?.trim() ? `${entry.name}（${entry.summary.trim()}）` : entry.name))
    .filter(Boolean)
    .join('、')
}

export function composePillarNodeStoryText(input: {
  beat: PillarInteractionBeatContract
  chapterName?: string
  actionIntent?: string
  ending?: Pick<PillarEndingContract, 'title' | 'summary'>
}): string {
  if (input.ending) {
    return [input.ending.title, input.ending.summary]
      .map((part) => part.trim())
      .filter(Boolean)
      .join('\n')
  }
  const lines = [
    input.beat.staging?.trim()
      || input.chapterName?.trim()
      || input.beat.narrativeIntent,
    input.beat.playerInformation.length > 0
      ? `玩家可见：${input.beat.playerInformation.join('、')}`
      : '',
    input.actionIntent?.trim()
      ? `这一拍：${input.actionIntent.trim()}`
      : (input.beat.actions.length > 0
        ? `玩家可做：${input.beat.actions.map((action) => action.intent).join('；')}`
        : ''),
  ].filter(Boolean)
  return lines.join('\n')
}

export function composePillarNodeVideoPrompt(input: {
  beat: PillarInteractionBeatContract
  pillar: PillarInteractionContract
  chapterName?: string
  actionIntent?: string
  ending?: Pick<PillarEndingContract, 'title' | 'summary'>
}): string {
  const setting = joinNamed(input.pillar.settings)
  const cast = joinNamed(input.pillar.cast)
  const actionLine = input.actionIntent?.trim()
    || input.beat.actions.map((action) => action.intent).filter(Boolean).join('；')
  const beatLine = input.ending
    ? `${input.ending.title}。${input.ending.summary}`
    : (input.beat.staging?.trim() || input.chapterName?.trim() || input.beat.narrativeIntent)
  return [
    `电影感互动影游单镜头：${beatLine}。连续表演，不要字幕，不要UI，不要分屏。`,
    setting ? `场景在${setting}，空间层次清楚，镜头稳定跟焦。` : '',
    cast ? `出场${cast}，面孔与服饰前后一致。` : '',
    actionLine ? `核心动作：${actionLine}。镜头跟随动作，运动流畅。` : '以角色呼吸与环境细节撑满时长。',
    input.beat.playerInformation.length > 0
      ? `画面要让玩家读到：${input.beat.playerInformation.join('、')}。`
      : '',
    '光影明确：夜戏用月光、火把与尘雾，日戏用硬光与空气透视。',
  ].filter(Boolean).join('')
}

export function isInsufficientVideoPrompt(
  prompt: string | undefined,
  node?: { name?: string; chapterSummary?: string },
): boolean {
  const trimmed = prompt?.trim() ?? ''
  if (trimmed.length < MIN_NODE_VIDEO_PROMPT_LENGTH) return true
  if (node?.name?.trim() && trimmed === node.name.trim()) return true
  if (node?.chapterSummary?.trim() && trimmed === node.chapterSummary.trim()) return true
  return false
}

export function composeNodeVideoPromptFromGraph(input: {
  name?: string
  chapterSummary?: string
  storyText?: string
  narrativeIntent?: string
  playerInformation?: readonly string[]
  actionIntents?: readonly string[]
  characterLines?: readonly string[]
  sceneLines?: readonly string[]
}): string {
  const beatLine = (
    input.storyText?.trim()
    || input.chapterSummary?.trim()
    || input.narrativeIntent?.trim()
    || input.name?.trim()
    || '这一拍'
  ).replace(/\n/g, '。')
  return [
    `电影感互动影游单镜头：${beatLine}。连续表演，不要字幕，不要UI，不要分屏。`,
    input.sceneLines?.length
      ? `场景在${input.sceneLines.join('、')}，空间层次清楚，镜头稳定跟焦。`
      : '',
    input.characterLines?.length
      ? `出场${input.characterLines.join('、')}，面孔与服饰前后一致。`
      : '',
    input.actionIntents?.length
      ? `核心动作：${input.actionIntents.join('；')}。镜头跟随动作，运动流畅。`
      : '',
    input.playerInformation?.length
      ? `画面要让玩家读到：${input.playerInformation.join('、')}。`
      : '',
    '光影明确：夜戏用月光、火把与尘雾，日戏用硬光与空气透视。',
  ].filter(Boolean).join('')
}
