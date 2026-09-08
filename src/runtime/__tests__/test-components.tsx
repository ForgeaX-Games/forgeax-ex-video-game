/**
 * 外部单测用的组件夹具 —— 不 import `component-host/components`。
 * 契约形状够编辑器/runtime 管线跑通即可；表现层用最小 stub。
 */
import type { ComponentType, CSSProperties, ReactNode } from 'react'
import {
  registerComponent,
  type ComponentDef,
  ComponentRegistry,
} from '../core/registry/component-registry'
import {
  registerOverlayRenderer,
  SkinRegistry,
} from '../react/component-host/rendererRegistry'
import type { ComponentManifest } from '../core/schema/node-config-schema'

export const TEST_FLOAT = 'test.float'
export const TEST_CHOICE = 'test.choice'
export const TEST_QTE = 'test.qte'
export const TEST_SKILL = 'test.skill'
export const TEST_TEXT = 'test.text'
export const TEST_HUD = 'test.hud'
export const TEST_NOTICE = 'test.notice'
export const TEST_DIALOGUE = 'test.dialogue'

export const TestFloatManifest: ComponentManifest = {
  id: TEST_FLOAT,
  label: '测试飘字',
  events: [],
  inputs: [
    { key: 'fixedText', label: '固定文本', valueType: 'string', default: '' },
    { key: 'parameter', label: '参数', valueType: 'string', component: 'numberExpr' },
    { key: 'color', label: '字色', valueType: 'string', component: 'color', default: '#f0f0f0' },
    { key: 'fontSize', label: '字号', valueType: 'number', default: 3.5 },
    { key: 'durationMs', label: '总时长ms', valueType: 'number', default: 1100 },
  ],
}

export const TestChoiceManifest: ComponentManifest = {
  id: TEST_CHOICE,
  label: '测试选项',
  events: [
    { id: 'ying', label: '應' },
    { id: 'mo', label: '默' },
  ],
  inputs: [
    { key: 'events', label: '选项', valueType: 'string', component: 'events' },
  ],
}

export const TestQteManifest: ComponentManifest = {
  id: TEST_QTE,
  label: '测试 QTE',
  events: [
    { id: 'greatSuccess', label: '大成功' },
    { id: 'success', label: '成功' },
    { id: 'fail', label: '失败' },
  ],
  inputs: [
    { key: 'cues', label: '拍点', valueType: 'string', component: 'qteCues' },
    { key: 'firstKey', label: '第一按键', valueType: 'string', default: 'A' },
    { key: 'secondKey', label: '第二按键', valueType: 'string', default: 'B' },
    { key: 'triggerKey', label: '触发按键', valueType: 'string', default: 'F' },
  ],
}

export const TestSkillManifest: ComponentManifest = {
  id: TEST_SKILL,
  label: '测试技能条',
  events: [
    { id: 'light', label: '轻攻击' },
    { id: 'heavy', label: '重攻击' },
    { id: 'medit', label: '冥想' },
    { id: 'ult', label: '灭世' },
  ],
  inputs: [
    { key: 'lightResource', label: '轻攻击资源', valueType: 'number', component: 'numberExpr' },
    { key: 'lightCost', label: '轻攻击资源消耗', valueType: 'number', component: 'numberExpr', default: 0 },
    { key: 'heavyResource', label: '重攻击资源', valueType: 'number', component: 'numberExpr' },
    { key: 'heavyCost', label: '重攻击资源消耗', valueType: 'number', component: 'numberExpr', default: 2 },
    { key: 'meditResource', label: '冥想资源', valueType: 'number', component: 'numberExpr' },
    { key: 'meditCost', label: '冥想资源消耗', valueType: 'number', component: 'numberExpr', default: 0 },
    { key: 'ultResource', label: '灭世资源', valueType: 'number', component: 'numberExpr' },
    { key: 'ultCost', label: '灭世资源消耗', valueType: 'number', component: 'numberExpr', default: 5 },
    { key: 'lightKey', label: '轻攻击按键', valueType: 'string', default: 'X' },
    { key: 'heavyKey', label: '重攻击按键', valueType: 'string', default: 'A' },
    { key: 'meditKey', label: '冥想按键', valueType: 'string', default: 'S' },
    { key: 'ultKey', label: '灭世按键', valueType: 'string', default: 'B' },
  ],
}

export const TestTextManifest: ComponentManifest = {
  id: TEST_TEXT,
  label: '测试文字交互',
  events: [{ id: 'activate', label: '交互' }],
  inputs: [
    { key: 'text', label: '文字', valueType: 'string', component: 'numberExpr', default: '摁F交互' },
    { key: 'color', label: '字色', valueType: 'string', component: 'color', default: '#f0f0f0' },
    { key: 'fontSize', label: '字号', valueType: 'number', default: 2.4 },
    { key: 'triggerKey', label: '触发按键', valueType: 'string', default: 'F' },
  ],
}

export const TestHudManifest: ComponentManifest = {
  id: TEST_HUD,
  label: '测试血条',
  events: [],
  inputs: [
    { key: 'current', label: '当前', valueType: 'number', component: 'numberExpr', required: true },
    { key: 'max', label: '上限', valueType: 'number', component: 'numberExpr', required: true },
    { key: 'label', label: '标签', valueType: 'string', default: 'HP' },
  ],
}

export const TestNoticeManifest: ComponentManifest = {
  id: TEST_NOTICE,
  label: '状态提示',
  events: [],
  inputs: [
    { key: 'fixedText', label: '固定文本', valueType: 'string', default: '获得道具' },
    { key: 'parameter', label: '参数', valueType: 'string', component: 'numberExpr', default: '〈xxx〉' },
    { key: 'color', label: '字色', valueType: 'string', component: 'color', default: '#f0f0f0' },
    { key: 'fontSize', label: '字号', valueType: 'number', default: 2.6 },
    { key: 'durationMs', label: '总时长ms', valueType: 'number', default: 1600 },
  ],
}

export const TestDialogueManifest: ComponentManifest = {
  id: TEST_DIALOGUE,
  label: '字幕/对白',
  events: [],
  inputs: [
    { key: 'speaker', label: '说话人', valueType: 'string', component: 'numberExpr' },
    { key: 'text', label: '台词', valueType: 'string', component: 'numberExpr', default: '……' },
  ],
}

const TEST_CATALOG: Array<{ manifest: ComponentManifest }> = [
  { manifest: TestFloatManifest },
  { manifest: TestChoiceManifest },
  { manifest: TestQteManifest },
  { manifest: TestSkillManifest },
  { manifest: TestTextManifest },
  { manifest: TestHudManifest },
  { manifest: TestNoticeManifest },
  { manifest: TestDialogueManifest },
]

/** 最小预览 stub：支持 fit-target / preview 冻结，不依赖真实皮肤 DOM。 */
function TestStub(props: {
  preview?: boolean
  previewPlaying?: boolean
  previewTimeMs?: number
  label?: string
}): ReactNode {
  const frozen = props.preview && !props.previewPlaying
  const style: CSSProperties | undefined = frozen
    ? { ['--preview-t' as string]: `${props.previewTimeMs ?? 0}ms` }
    : undefined
  return (
    <div
      className={`test-stub${frozen ? ' is-preview-frozen is-frozen' : ''}`}
      data-overlay-fit-target="true"
      style={style}
    >
      {props.label ?? 'stub'}
    </div>
  )
}

function stubFor(manifest: ComponentManifest): ComponentType<Record<string, unknown>> {
  function Bound(props: Record<string, unknown>): ReactNode {
    return (
      <TestStub
        preview={props.preview as boolean | undefined}
        previewPlaying={props.previewPlaying as boolean | undefined}
        previewTimeMs={props.previewTimeMs as number | undefined}
        label={manifest.label}
      />
    )
  }
  Bound.displayName = `TestStub(${manifest.id})`
  return Bound
}

let testRegistered = false

/** 幂等：把测试夹具装进默认契约表 + 渲染表。 */
export function registerTestComponents(): void {
  if (testRegistered) return
  testRegistered = true
  for (const { manifest } of TEST_CATALOG) {
    registerComponent(manifest.id, manifest as ComponentDef)
    registerOverlayRenderer(manifest.id, stubFor(manifest), manifest)
  }
}

/** 隔离表：仅含测试夹具（不碰 catalog）。 */
export function createTestComponentRegistry(): ComponentRegistry {
  const registry = new ComponentRegistry()
  for (const { manifest } of TEST_CATALOG) {
    registry.registerComponent(manifest.id, manifest as ComponentDef)
  }
  return registry
}

export function createTestSkinRegistry(): SkinRegistry {
  const registry = new SkinRegistry()
  for (const { manifest } of TEST_CATALOG) {
    registry.registerOverlayRenderer(manifest.id, stubFor(manifest), manifest)
  }
  return registry
}
