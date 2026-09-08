/**
 * 字幕/对白（component id: `Dialogue`）。
 * 文案由 RuntimeComponentHost 解析后以扁平 props 传入；此处只展示。
 */
import type { ReactNode } from 'react'
import { injectCss, resolveTextAppearance, type TextAppearanceInputs } from './skinRuntime'

export { DialogueManifest } from '@/runtime/core/component-catalog/Dialogue.manifest'

export interface DialogueProps {
  speaker?: string
  text?: string
  color?: string
  fontSize?: number
}

export function Dialogue({
  speaker = '',
  text = '……',
  color,
  fontSize,
}: DialogueProps): ReactNode {
  injectCss('dialogue', DIALOGUE_CSS)
  const textStyle = resolveTextAppearance({ color, fontSize } as TextAppearanceInputs, { color: '#f0f0f0', fontSize: 2 })

  return (
    <div className="gv-dialogue">
      <div className="gv-dialogue-box" data-overlay-fit-target>
        {speaker && <div className="gv-dialogue-speaker">{speaker}</div>}
        <div className="gv-dialogue-text" style={textStyle}>{text}</div>
      </div>
    </div>
  )
}

const DIALOGUE_CSS = `
.gv-dialogue{position:relative;inline-size:100%;block-size:100%;display:flex;align-items:flex-end;justify-content:center;pointer-events:none}
.gv-dialogue-box{inline-size:100%;box-sizing:border-box;padding:12px 16px;background:transparent}
.gv-dialogue-speaker{margin-block-end:4px;color:#ffd54a;font-size:13px;font-weight:700;text-align:center}
.gv-dialogue-text{font-size:var(--gv-text-font-size,2cqh);line-height:1.5;text-align:center}
`
