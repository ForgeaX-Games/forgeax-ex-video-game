/**
 * 界面方案目录辅助：`base:<组件id>` 单组件方案 + 「+ 组件」预设模板。
 *
 * 方案清单一律从 live `ui.overlays` 派生；boot 只保证 `base:*` 存在。
 */
import type { Overlay, OverlayChild } from '@/runtime/core/schema/graph-schema'
import { localComponentManifests } from '@/runtime/core/component-catalog'
import { listComponentManifests } from '@/runtime/core/registry/component-registry'
import { STAGE_FILL_LAYOUT } from '@/runtime/core/schema/layout'

/** 基础覆盖物 方案 id 前缀：`base:<组件id>`，每份仅含该单组件、锁定不可增删。 */
export const BASE_HUD_PREFIX = 'base:'

function catalogManifests() {
  const manifests = new Map(localComponentManifests.map((manifest) => [manifest.id, manifest]))
  for (const manifest of listComponentManifests()) manifests.set(manifest.id, manifest)
  return [...manifests.values()]
}

/** 新规格组件均从外层 Layout 取得舞台盒，不再从 inputs 猜位置或尺寸。 */
function makeNewComponentPreset(component: string, id: string): OverlayChild {
  return {
    id,
    component,
    layout: { ...STAGE_FILL_LAYOUT },
    trigger: { when: 'enter' },
    // 显隐唯一 SSOT = window；不写 endMs 表示持续到节点结束。
    window: { startMs: 0 },
    // 组件默认值只由 manifest / renderer 解释；作者未填写时保持空 bag，让参数面板显示 placeholder。
    inputs: {},
  }
}

/**
 * 界面 tab「自定义覆盖物」组 = 用户自由方案：排除 `node:*`（时间轴内容容器）与
 * `base:*`（基础覆盖物单组件方案）。
 */
export function listCustomSchemeIds(overlays: Record<string, Overlay> | undefined): string[] {
  return Object.keys(overlays ?? {}).filter((id) => !id.startsWith('node:') && !id.startsWith(BASE_HUD_PREFIX))
}

/**
 * 界面 tab 的「自定义覆盖物」列表：让 overlays 中最先写入的自定义方案置顶。
 * 新建方案会 prepend 到 overlays，因此它在后续重渲染和重新载入后仍保持列表第一项。
 */
export function listInterfaceCustomSchemeIds(overlays: Record<string, Overlay> | undefined): string[] {
  const all = overlays ?? {}
  const ids = listCustomSchemeIds(all)
  const firstStoredId = Object.keys(all).find((id) => ids.includes(id))
  if (!firstStoredId) return ids
  return [firstStoredId, ...ids.filter((id) => id !== firstStoredId)]
}

/**
 * 界面 tab「基础覆盖物」组 = 组件库每组件一份 `base:<id>` 单组件方案；
 * 按组件库顺序排列，仅取目录里实际存在的。
 */
export function listBaseHudIds(overlays: Record<string, Overlay> | undefined): string[] {
  const all = overlays ?? {}
  return catalogManifests().map((manifest) => `${BASE_HUD_PREFIX}${manifest.id}`).filter((id) => all[id])
}

/**
 * 界面 tab 两个分组（自定义覆盖物 + 基础覆盖物）打平后的有序 overlay id 列表。
 * 蓝图侧所有「挑一张 overlay」的选择器（NodeInspector 的 ＋挂载 / 默认样式、
 * NodePreviewStage 的「添加控件」栏）共用此列表，保证与界面 tab 完全一致、不漂移。
 */
export function listSchemeAndBaseOverlayIds(overlays: Record<string, Overlay> | undefined): string[] {
  return [...listCustomSchemeIds(overlays), ...listBaseHudIds(overlays)]
}

/** 「+ 组件」菜单：每项 = 一个组件预设模板（顶栏 component = 该组件的顶层 id）。 */
export const NEW_COMPONENT_PRESETS: Array<{
  id: string
  label: string
  make: (childId: string) => OverlayChild
}> = [
  {
    id: 'Dialogue',
    label: '字幕',
    make: (id) => makeNewComponentPreset('Dialogue', id),
  },
  { id: 'InkKou', label: 'QTE · 叩击', make: (id) => makeNewComponentPreset('InkKou', id) },
  { id: 'BattleParry', label: 'QTE · 防反', make: (id) => makeNewComponentPreset('BattleParry', id) },
  { id: 'InkYingMo', label: '选项 · 應默', make: (id) => makeNewComponentPreset('InkYingMo', id) },
  { id: 'BattleSkill', label: '选项 · 技能条', make: (id) => makeNewComponentPreset('BattleSkill', id) },
  { id: 'TextOption', label: '交互 · 文字', make: (id) => makeNewComponentPreset('TextOption', id) },
  { id: 'StatusNotice', label: '提示 · 状态', make: (id) => makeNewComponentPreset('StatusNotice', id) },
  { id: 'DamageFloatText', label: '飘字 · 伤害', make: (id) => makeNewComponentPreset('DamageFloatText', id) },
  { id: 'GainFloatText', label: '飘字 · 增益', make: (id) => makeNewComponentPreset('GainFloatText', id) },
  { id: 'BattlePlayerHpBar', label: 'HUD · 我方血条', make: (id) => makeNewComponentPreset('BattlePlayerHpBar', id) },
  { id: 'BattleEnemyHpBar', label: 'HUD · 敌方血条', make: (id) => makeNewComponentPreset('BattleEnemyHpBar', id) },
]

/** 保证基础覆盖物存在于 overlays 目录（缺失才补）。 */
export function ensureBuiltinSchemes(
  overlays: Record<string, Overlay> | undefined,
): Record<string, Overlay> {
  return ensureBaseHudSchemes({ ...(overlays ?? {}) })
}

/** 基础覆盖物 单组件方案的 child：默认参数不落盘，由组件 manifest 作为 placeholder 展示。 */
function makeBaseHudChild(componentId: string): OverlayChild {
  const preset = NEW_COMPONENT_PRESETS.find((p) => p.id === componentId)
  if (preset) return preset.make(`${componentId}-0`)
  return {
    id: `${componentId}-0`,
    component: componentId,
    layout: { ...STAGE_FILL_LAYOUT },
    trigger: { when: 'enter' },
    window: { startMs: 0 },
    inputs: {},
  }
}

/**
 * 保证「基础覆盖物」方案存在：组件库每个可用组件各一份 `base:<id>` 单组件方案（缺失才补）。
 * 这些方案锁定为单组件（编辑器侧不允许增删组件），可编辑 inputs/layout。
 */
export function ensureBaseHudSchemes(
  overlays: Record<string, Overlay>,
): Record<string, Overlay> {
  const next = { ...overlays }
  for (const manifest of catalogManifests()) {
    const componentId = manifest.id
    const id = `${BASE_HUD_PREFIX}${componentId}`
    if (!next[id]) {
      next[id] = {
        id,
        title: manifest.label ?? componentId,
        children: [makeBaseHudChild(componentId)],
        // 基础单组件方案继承该组件的摆放/潜规则提示，让拿到整张界面的消费者
        // 能据此自动布局，而不是只看到一个孤立组件。
        ...(manifest.prompt ? { prompt: manifest.prompt } : {}),
      }
    }
  }
  return next
}
