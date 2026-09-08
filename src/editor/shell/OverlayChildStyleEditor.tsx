import { t as translateUi } from '../../i18n'
/**
 * Overlay 子组件样式编辑 —— 界面 tab 用；按 component 类型展示皮肤 / 文字预设选择。
 * 尺寸（Layout.width/height）不按类型分支，统一挂在末尾——所有组件都能配置，新组件不用回来改这个文件。
 */
import type { CSSProperties, JSX } from 'react'
import type { GraphTextStyle, Layout, OverlayChild } from '@/runtime/core/schema/graph-schema'
import { GraphTextStylePicker } from './GraphTextStylePicker'
import { isSizable, SizeEditor } from './editors'

const row: CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, fontSize: 12 }
const lbl: CSSProperties = { width: 72, opacity: 0.7, flexShrink: 0, fontSize: 11 }

const COMPONENT_LABEL: Record<string, string> = {
  Dialogue: '字幕',
  floatText: '飘字',
  qte: 'QTE',
  choice: '选项',
  battleHpBar: 'HUD 血条',
}

function sizeField(child: OverlayChild, onPatchLayout: (patch: Partial<Layout>) => void): JSX.Element {
  return (
    <div style={{ ...row, alignItems: 'flex-start', marginTop: 6 }}>
      <span style={lbl}>{translateUi('ui.copy.94a6711f2408')}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <SizeEditor
          width={typeof child.layout?.width === 'number' ? child.layout.width : undefined}
          height={typeof child.layout?.height === 'number' ? child.layout.height : undefined}
          onChange={onPatchLayout}
          disabled={!isSizable(child.component)}
        />
      </div>
    </div>
  )
}

export function OverlayChildStyleEditor({
  child,
  onPatchParams,
  onPatchLayout,
}: {
  child: OverlayChild
  onPatchParams: (patch: Record<string, unknown>) => void
  onPatchComponent: (component: string) => void
  onPatchLayout: (patch: Partial<Layout>) => void
}): JSX.Element {
  const inputs = child.inputs ?? {}
  const kind = child.component
  const title = COMPONENT_LABEL[kind] ?? kind

  if (kind === 'Dialogue') {
    return (
      <div style={{ marginTop: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>{child.id} · {title}</div>
        <div style={{ ...row, alignItems: 'flex-start' }}>
          <span style={lbl}>{translateUi('ui.copy.41085f11ee73')}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <GraphTextStylePicker
              group="subtitle"
              value={inputs.style as GraphTextStyle | undefined}
              onChange={(style) => onPatchParams({ style })}
            />
          </div>
        </div>
        {sizeField(child, onPatchLayout)}
      </div>
    )
  }

  if (kind === 'floatText') {
    return (
      <div style={{ marginTop: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>{child.id} · {title}</div>
        <div style={{ ...row, alignItems: 'flex-start' }}>
          <span style={lbl}>{translateUi('ui.copy.a2b9bc9cf710')}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <GraphTextStylePicker
              group="overlay"
              value={inputs.style as GraphTextStyle | undefined}
              onChange={(style) => onPatchParams({ style })}
            />
          </div>
        </div>
        {sizeField(child, onPatchLayout)}
      </div>
    )
  }

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 11, opacity: 0.55 }}>{child.id} · {title}{translateUi('ui.copy.474f7a3a950a')}</div>
      {sizeField(child, onPatchLayout)}
    </div>
  )
}
