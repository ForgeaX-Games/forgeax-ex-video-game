import { t as translateUi } from '../../i18n'
/**
 * 统一的符号化运算符按钮组（+ − × ÷ =…）。Effect 层的「运算」字段与 ValueExprEditor
 * 选取公式模式下每一项的「运算」字段共用同一份视觉/交互实现，各自传入自己的 option 列表。
 */
import type { CSSProperties } from 'react'
import type { EffectDisplayOp } from './valueExprPick'

const row: CSSProperties = { display: 'flex', gap: 2 }
const btn: CSSProperties = { minWidth: 26, padding: '2px 6px', fontFamily: 'monospace', fontSize: 13 }

export interface OpSymbolOption {
  key: string
  symbol: string
  title?: string
  /** 是否是当前持久化状态（勾选态）；缺省 = 一次性动作按钮，不高亮。 */
  active?: boolean
  disabled?: boolean
}

export function OpSymbolButtons({
  options,
  onPick,
  ariaLabel,
}: {
  options: OpSymbolOption[]
  onPick: (key: string) => void
  ariaLabel?: string
}): JSX.Element {
  // 类名只是给外部作用域的换肤钩子（节点配置面板把这一组画成 27×27 方格），
  // 本文件不为它写任何规则：视觉默认值仍全在上面的行内 style 里。
  return (
    <div className="gc-op-symbols" style={row} role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          title={o.title ?? o.symbol}
          disabled={o.disabled}
          className={o.active ? 'gc-mini-action is-on' : 'gc-mini-action'}
          style={btn}
          onClick={() => onPick(o.key)}
        >
          {o.symbol}
        </button>
      ))}
    </div>
  )
}

/**
 * Effect 层"运算"符号按钮。这里处理稳定的编辑器运算态；落盘到 add/mul/set 的编码由
 * EffectRow 统一完成，不让按钮点击直接篡改操作数。
 * 嵌进「值」编辑器内部（`ValueInput`/`ValueExprEditor` 的 `effectOp` 入口）与 Effect 编辑器
 * 复用同一份实现——不放在 editors.tsx／ValueExprEditor.tsx 任一方，避免两者互相 import 成环。
 */
const EFFECT_OP_SYMBOLS: { key: string; symbol: string; title: string }[] = [
  { key: 'add', symbol: '+', title: '增加' },
  { key: 'sub', symbol: '−', title: '减少' },
  { key: 'mul', symbol: '×', title: '乘以' },
  { key: 'div', symbol: '÷', title: '除以' },
  { key: 'set', symbol: '=', title: '设为' },
]

export function EffectOpButtons({
  op,
  onChange,
  variant = 'symbol',
}: {
  op: EffectDisplayOp
  onChange: (next: EffectDisplayOp) => void
  variant?: 'symbol' | 'pill'
}): JSX.Element {
  if (variant === 'pill') {
    return (
      <div
        className="gc-effect-op-segmented"
        style={{
          display: 'flex',
          width: '100%',
          minWidth: 0,
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,.16)',
          borderRadius: 8,
          background: '#191919',
        }}
        role="radiogroup"
        aria-label={translateUi('ui.copy.ec7885eb376d')}
      >
        {EFFECT_OP_SYMBOLS.map((option) => {
          const active = option.key === op
          const pillSymbol = option.key === 'sub' ? '-' : option.symbol
          return (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={active}
              title={option.title}
              className={active ? 'gc-effect-op-pill is-on' : 'gc-effect-op-pill'}
              style={{
                flex: '1 1 0',
                minHeight: 28,
                minWidth: 0,
                padding: '3px 4px',
                border: 0,
                borderRight: option === EFFECT_OP_SYMBOLS.at(-1) ? 0 : '1px solid rgba(255,255,255,.16)',
                borderRadius: 0,
                background: active ? '#ff9c2a' : 'transparent',
                color: active ? '#171717' : 'rgba(255,255,255,.72)',
                fontSize: 14,
                cursor: 'pointer',
              }}
              onClick={() => onChange(option.key as EffectDisplayOp)}
            >
              {pillSymbol}
            </button>
          )
        })}
      </div>
    )
  }
  return (
    <OpSymbolButtons
      ariaLabel="运算"
      options={EFFECT_OP_SYMBOLS.map((o) => ({
        key: o.key,
        symbol: o.symbol,
        title: o.title,
        active: o.key === op,
      }))}
      onPick={(key) => onChange(key as EffectDisplayOp)}
    />
  )
}
