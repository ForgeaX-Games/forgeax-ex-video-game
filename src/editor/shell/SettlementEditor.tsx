import { t as translateUi } from '../../i18n'
/**
 * 结算编辑器 —— 选项分支 / QTE 档位 / 通用组件事件三处共用（跳转 + 改数值 + 生成组件）。
 * 数据源统一是 `OutcomeView[]`（graphMaterialOps.ts `listOptionBranches`/`listQteOutcomeViews`/
 * `listComponentEventViews` 的返回投影），三处原先几乎逐字重复的 JSX 收成这一个组件。
 */
import type { CSSProperties, JSX, ReactNode } from 'react'
import type { Entity, GameNode, GraphEffect, Overlay, Variable } from '@/runtime/core/schema/graph-schema'
import type { Formula } from '@/authoring/blueprint/formula-authoring'
import type { OutcomeView, SettlementSpawn } from '../video/graphMaterialOps'
import { flowHandleDisplay } from '@/authoring/graph/flow-handle-labels'
import { EffectsEditor } from './editors'
import { SettlementSpawnEditor, type SpawnTemplateOption } from './SettlementSpawnEditor'

const branchBox: CSSProperties = { border: '1px solid var(--gc-accent-line, #2a2a2a)', borderRadius: 6, padding: 6, marginBottom: 8 }
const branchRow: CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }

export interface SettlementEditorProps {
  branches: OutcomeView[]
  nodeOptions: GameNode[]
  spawnTemplates: SpawnTemplateOption[]
  overlays?: Record<string, Overlay>
  nodeDurMs: number
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  formulas?: Record<string, Formula>
  onSetTarget: (key: string, targetId: string) => void
  onSetEffects: (key: string, effects: GraphEffect[]) => void
  onSetSpawn: (key: string, spawn: SettlementSpawn | undefined) => void
  /** 选项分支：文案可编辑（未样式锁定时）。缺省不可编辑（展示 flowHandleDisplay(key,label)）。 */
  labelEditable?: boolean
  onSetLabel?: (key: string, label: string) => void
  /** 该档是否可删（例如「至少保留一项」）；缺省不可删。 */
  removable?: (key: string) => boolean
  onRemove?: (key: string) => void
  /** 还可添加的候选档（QTE 用；选项走 onAddBranch 的整选项新增，不走这里）。 */
  addable?: { candidates: Array<{ key: string; label: string }>; onAdd: (key: string) => void }
  /** 结算区小标题右侧的说明文案。 */
  hint?: ReactNode
  /** 单个档「标识/文案」列宽（样式锁定的固定档位用窄列展示 handle 而非可编辑输入）。 */
  labelColumnWidth?: number
  /** `fallsBackToPass` 档的提示文案（QTE 专用；缺省用通用措辞）。 */
  fallsBackToPassHint?: ReactNode
}

export function SettlementEditor({
  branches,
  nodeOptions,
  spawnTemplates,
  overlays,
  nodeDurMs,
  entities,
  variables,
  formulas,
  onSetTarget,
  onSetEffects,
  onSetSpawn,
  labelEditable = false,
  onSetLabel,
  removable,
  onRemove,
  addable,
  hint,
  labelColumnWidth = 40,
  fallsBackToPassHint,
}: SettlementEditorProps): JSX.Element {
  return (
    <>
      <div className="gc-inspector-subhead">
        <span>{translateUi('ui.copy.4c506e4ef106')}</span>
        {hint ? <span className="gc-inspector-subhint">{hint}</span> : null}
      </div>
      {branches.map((b) => {
        const canRemove = removable?.(b.key) ?? false
        return (
          <div key={b.key} className="gc-branch-block" style={branchBox}>
            <div className="gc-branch-row" style={branchRow}>
              {labelEditable && onSetLabel ? (
                <input
                  style={{ flex: 1, minWidth: 100 }}
                  value={b.label}
                  onChange={(e) => onSetLabel(b.key, e.target.value)}
                  placeholder={translateUi('ui.copy.9d55c17a7967')}
                  title={b.key}
                />
              ) : (
                <span style={{ width: labelColumnWidth, flexShrink: 0, fontWeight: 600 }} title={b.key}>
                  {flowHandleDisplay(b.key, b.label)}
                </span>
              )}
              <select style={{ flex: 1 }} value={b.targetId ?? ''} onChange={(e) => onSetTarget(b.key, e.target.value)}>
                <option value="">{translateUi('ui.copy.0126b306ae8e')}</option>
                {nodeOptions.map((n) => <option key={n.id} value={n.id}>{n.data.name || n.id}</option>)}
              </select>
              {onRemove ? (
                <button
                  type="button"
                  className="gc-mini-danger"
                  disabled={!canRemove}
                  title={canRemove ? `${translateUi('ui.template.9fad3beb4471')}${b.label}${translateUi('ui.template.33fabfa62a6b')}` : translateUi('ui.copy.63663655b260')}
                  onClick={() => onRemove(b.key)}
                >
                  {translateUi('ui.copy.3755f56f2f83')}</button>
              ) : null}
            </div>
            {b.fallsBackToPass ? (
              <p className="gc-inspector-hint" style={{ margin: '0 0 6px' }}>
                {fallsBackToPassHint ?? '未单独配置该档时，也会按「完美」结算。'}
              </p>
            ) : null}
            <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 2 }}>{translateUi('ui.copy.0d0ee1d62192')}</div>
            <EffectsEditor
              value={b.effects}
              entities={entities}
              variables={variables}
              formulas={formulas}
              onChange={(effects) => onSetEffects(b.key, effects)}
            />
            <SettlementSpawnEditor
              value={b.spawn}
              templates={spawnTemplates}
              overlays={overlays}
              entities={entities}
              variables={variables}
              formulas={formulas}
              maxTtlMs={nodeDurMs}
              hasJump={!!b.targetId}
              onChange={(spawn) => onSetSpawn(b.key, spawn)}
            />
          </div>
        )
      })}
      {addable && addable.candidates.length > 0 ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
          <select
            id="gvv-add-outcome"
            defaultValue=""
            onChange={(e) => {
              const h = e.target.value
              if (!h) return
              addable.onAdd(h)
              e.target.value = ''
            }}
            style={{ flex: 1 }}
          >
            <option value="" disabled>{translateUi('ui.copy.bc72d99a2af1')}</option>
            {addable.candidates.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
      ) : null}
    </>
  )
}
