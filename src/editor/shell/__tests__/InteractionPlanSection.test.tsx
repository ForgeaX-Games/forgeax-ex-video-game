import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InteractionPlanSection } from '../node-inspector/InteractionPlanSection'
import type { NodeInteractionPlan } from '@/runtime/core/schema/graph-schema'

/**
 * 玩法契约要让**作者**看懂。
 *
 * 闸门只能验「接线通不通」，判断好不好玩只有作者能做——所以面板上不能摆
 * `entity.tiger.attr.hp` 这种机器写法，要说成「猛虎 的 hp 减少」。
 */
describe('玩法分区', () => {
  const plan: NodeInteractionPlan = {
    beat: 'combat',
    actions: [{
      component: 'BattleSkill',
      event: 'light',
      intent: '观众点轻击，趁老虎扑空时打它',
      effect: { target: 'entity.tiger.attr.hp', op: 'sub', formulaId: 'dmg_light' },
      exit: 'none',
    }],
    terminals: [{ when: 'entity.tiger.attr.hp <= 0', note: '武松取胜' }],
  }

  it('把契约说成人话：意图、结算目标用展示名、留在本段', () => {
    render(<InteractionPlanSection plan={plan} entityNames={{ tiger: '猛虎' }} />)

    expect(screen.getByText('观众点轻击，趁老虎扑空时打它')).toBeTruthy()
    const detail = screen.getByText(/猛虎 的 hp 减少/)
    expect(detail.textContent).toContain('dmg_light')
    expect(detail.textContent).toContain('留在本段')
    expect(screen.getByText('武松取胜')).toBeTruthy()
  })

  it('纯叙事节拍明确说「观众只看」，不显示成漏配', () => {
    render(<InteractionPlanSection plan={{ beat: 'narrative' }} />)

    expect(screen.getByText('这一段观众只看，不需要操作。')).toBeTruthy()
  })

  it('声明了交互节拍却没有动作时，如实告诉作者还没配', () => {
    render(<InteractionPlanSection plan={{ beat: 'combat' }} />)

    expect(screen.getByText('这一段还没有配置观众可以做的事。')).toBeTruthy()
  })

  it('没有契约的节点不占面板（旧数据与非影游文档）', () => {
    const { container } = render(<InteractionPlanSection plan={undefined} />)

    expect(container.textContent).toBe('')
  })
})
