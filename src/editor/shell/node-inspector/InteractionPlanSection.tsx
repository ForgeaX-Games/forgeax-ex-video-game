/**
 * 玩法分区（只读）—— 把本节拍的玩法契约给作者看。
 *
 * 契约是三条线唯一的共享设计（见 `NodeInteractionPlan`），闸门能验「接线通不通」，
 * 但**判断好不好玩只有作者能做**。这一块把 `interaction` 翻成人话摆在面板上，
 * 让作者在成片生成之前就能看出「这一段观众只能干等」。
 *
 * 只读是刻意的：契约的作者是总脉络、修改者是汇总整装，作者要改玩法应当改支柱或直接说话，
 * 否则会出现「作者改了契约但蓝图没跟着改」的两边不一致。
 */
import type { NodeInteractionPlan } from '@/runtime/core/schema/graph-schema'
import { getComponentManifest } from '@/runtime/core/registry/component-registry'
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import { tf, useT } from '../../../i18n'
import { NiSection } from '../ni-ui'

const BEAT_LABEL_KEY: Record<NodeInteractionPlan['beat'], string> = {
  narrative: 'interactionPlan.beat.narrative',
  choice: 'interactionPlan.beat.choice',
  combat: 'interactionPlan.beat.combat',
  check: 'interactionPlan.beat.check',
  timed: 'interactionPlan.beat.timed',
}

const OP_LABEL_KEY: Record<'add' | 'sub' | 'set', string> = {
  add: 'interactionPlan.operation.add',
  sub: 'interactionPlan.operation.sub',
  set: 'interactionPlan.operation.set',
}

const CSS = `
.ni-root .ni-plan-beat { color: rgba(255,255,255,.75); font-size: 12px; }
.ni-root .ni-plan-list { display: flex; flex-direction: column; gap: 8px; margin: 8px 0 0; padding: 0; list-style: none; }
.ni-root .ni-plan-item { border-radius: 6px; padding: 8px 10px; background: rgba(255,255,255,.05); font-size: 12px; line-height: 18px; }
.ni-root .ni-plan-intent { color: #fff; }
.ni-root .ni-plan-detail { margin-top: 4px; color: rgba(255,255,255,.55); }
.ni-root .ni-plan-empty { color: rgba(255,255,255,.4); font-size: 12px; }
`

/** 把 `entity.tiger.attr.hp` 说成「猛虎 的 hp」这类人话；解析不出就原样显示。 */
function targetLabel(target: string, entityNames: Record<string, string>): string {
  const entity = /^entity\.([^.]+)\.attr\.(.+)$/u.exec(target)
  if (entity) return tf('interactionPlan.target.entity', { entity: entityNames[entity[1]!] ?? entity[1]!, attribute: entity[2]! })
  const variable = /^var\.(.+)$/u.exec(target)
  return variable ? tf('interactionPlan.target.variable', { name: variable[1]! }) : target
}

export function InteractionPlanSection({
  plan,
  entityNames = {},
}: {
  plan: NodeInteractionPlan | undefined
  /** 实体 id → 展示名，用于把结算目标说成人话。 */
  entityNames?: Record<string, string>
}): JSX.Element | null {
  const t = useT()
  injectStyleOnce('ni-interaction-plan', CSS)
  // 没有契约时不占面板：旧节点与非影游文档都会走到这里。
  if (!plan) return null

  const actions = plan.actions ?? []
  return (
    <NiSection title={t('interactionPlan.title')}>
      <div className="ni-plan-beat">{tf('interactionPlan.beat', { beat: t(BEAT_LABEL_KEY[plan.beat]) })}</div>
      {actions.length === 0
        ? (
          <div className="ni-plan-empty">
            {t(plan.beat === 'narrative' ? 'interactionPlan.empty.narrative' : 'interactionPlan.empty.actions')}
          </div>
        )
        : (
          <ul className="ni-plan-list">
            {actions.map((action, index) => {
              const label = getComponentManifest(action.component)?.label ?? action.component
              const effect = action.effect
              const exit = action.exit ?? action.event
              const effectLabel = effect
                ? tf('interactionPlan.effect', {
                    target: targetLabel(effect.target, entityNames),
                    operation: t(OP_LABEL_KEY[effect.op]),
                    value: effect.formulaId ? ` ${effect.formulaId}` : effect.value !== undefined ? ` ${effect.value}` : '',
                  })
                : ''
              const exitLabel = exit === 'none'
                ? t('interactionPlan.exit.none')
                : tf('interactionPlan.exit.target', { exit })
              return (
                <li className="ni-plan-item" key={`${action.component}:${action.event}:${index}`}>
                  <div className="ni-plan-intent">{action.intent}</div>
                  <div className="ni-plan-detail">
                    {tf('interactionPlan.action', { label, effect: effectLabel, exit: exitLabel })}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      {(plan.terminals ?? []).length > 0 && (
        <ul className="ni-plan-list">
          {plan.terminals!.map((terminal, index) => (
            <li className="ni-plan-item" key={`terminal:${index}`}>
              <div className="ni-plan-intent">{terminal.note ?? t('interactionPlan.terminal.fallback')}</div>
              <div className="ni-plan-detail">{tf('interactionPlan.terminal.when', { condition: terminal.when })}</div>
            </li>
          ))}
        </ul>
      )}
    </NiSection>
  )
}
