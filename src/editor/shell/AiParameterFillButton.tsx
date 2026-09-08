import { t as translateUi } from '../../i18n'
import type { CSSProperties, JSX } from 'react'
import aiParameterFillIcon from './assets/ai-parameter-fill.png'

export function AiParameterFillButton({
  className,
  ariaLabel = 'AI 补全参数',
  title = 'AI 补全暂不可用',
  onClick,
}: {
  className?: string
  ariaLabel?: string
  title?: string
  /** 接通后传 onClick：按钮启用并把引用推进 Agent 对话框。缺省保持 disabled 占位。 */
  onClick?: () => void
}): JSX.Element {
  const enabled = typeof onClick === 'function'
  const style: CSSProperties = {
    flex: 'none',
    display: 'block',
    width: 18,
    height: 18,
    padding: 0,
    border: 0,
    borderRadius: 0,
    background: 'transparent',
    cursor: enabled ? 'pointer' : 'not-allowed',
    opacity: 1,
  }
  return (
    <button
      type="button"
      className={className}
      disabled={!enabled}
      aria-label={ariaLabel}
      title={enabled ? translateUi('ui.copy.e496a192de45') : title}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
      style={style}
    >
      <img
        src={aiParameterFillIcon}
        alt=""
        aria-hidden="true"
        width={18}
        height={18}
        style={{ display: 'block' }}
      />
    </button>
  )
}
