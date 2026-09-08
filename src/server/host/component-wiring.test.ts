import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { inspectProject, validateProjectForActivity } from './project-inspection'
import { componentContracts } from './component-catalog'

const encoder = new TextEncoder()

/**
 * 界面元件接线（真跑回归）。
 *
 * 武松打虎那局把 `BattlePlayerHpBar` / `BattleEnemyHpBar` / `BattleSkill` / `BattleParry`
 * 都挂到了打斗节点上，但：输入键写成了不存在的 `actions` / `entityId`，
 * 真实输入（`lightResource` 等）全空，也没有任何 reaction 监听 `light` / `heavy`。
 * 结果是血条和技能条挂着但点了没反应，43 个公式只有 3 个被引用——玩法等于没配。
 */

function project(options: {
  inputs?: Record<string, unknown>
  reactions?: unknown[]
  /** 挂载级 reactions（overlayNodes[].reactions）——提示词与运行时的正式写法。 */
  mountReactions?: unknown[]
  /** Overlay 目录级 reactions（可复用模板的事件反馈）。 */
  catalogReactions?: unknown[]
  component?: string
  trigger?: { when: 'enter' | 'at', ms?: number }
  window?: { startMs?: number, endMs?: number }
  nodeChildren?: Array<Record<string, unknown>>
  attrMax?: number | null
  useAttrRatio?: boolean
  layout?: { left?: number; top?: number; width?: number; height?: number }
  /** 额外出边：验证出口 handle 必须由挂载元件提供。 */
  exits?: Array<{ handle: string, target?: string }>
}) {
  const graph = {
    nodes: [
      {
        id: 'clash',
        type: 'scene',
        position: { x: 0, y: 0 },
        data: {
          name: '首次交手',
          chapterSummary: '武松与虎首次交手',
          storyText: '虎扑而来',
          overlayNodes: [{
            overlay: 'node:clash',
            ...(options.nodeChildren ? { children: options.nodeChildren } : {}),
            ...(options.mountReactions ? { reactions: options.mountReactions } : {}),
          }],
          ...(options.reactions ? { reactions: options.reactions } : {}),
        },
      },
      { id: 'win', type: 'scene', position: { x: 200, y: 0 }, data: { name: '胜', chapterSummary: '胜', storyText: '胜' } },
    ],
    edges: [
      {
        id: 'e-win',
        source: 'clash',
        target: 'win',
        sourceHandle: 'default',
        targetHandle: 'in',
        data: options.useAttrRatio
          ? { condition: { all: [{ type: 'attrRatio', entityId: 'tiger', attr: 'hp', op: 'lte', value: 0 }] } }
          : {},
      },
      ...(options.exits ?? []).map((exit, index) => ({
        id: `e-exit-${index}`,
        source: 'clash',
        target: exit.target ?? 'win',
        sourceHandle: exit.handle,
        targetHandle: 'in',
        data: {},
      })),
    ],
  }
  return {
    revision: 1,
    version: 'game-video.graph.v1',
    graph,
    manifest: { mainPackId: 'bp-main', packs: { 'bp-main': { id: 'bp-main', title: '主蓝图', entry: 'clash', graph } } },
    variables: {},
    entities: {
      tiger: {
        id: 'tiger',
        attrs: { hp: 30 },
        attrMeta: { hp: options.attrMax === null ? {} : { max: options.attrMax ?? 30 } },
      },
    },
    formulas: {},
    ui: {
      overlays: {
        'node:clash': {
          id: 'node:clash',
          kind: 'group',
          ...(options.catalogReactions ? { reactions: options.catalogReactions } : {}),
          children: [{
            id: 'clash-skill',
            component: options.component ?? 'BattleSkill',
            layout: options.layout ?? { left: 0.1, top: 0.75, width: 0.8, height: 0.2 },
            trigger: options.trigger ?? { when: 'enter' },
            ...(options.window ? { window: options.window } : {}),
            inputs: options.inputs ?? {},
          }],
        },
      },
    },
  }
}

function context(doc: unknown): ExtensionContext {
  const files = new Map<string, Uint8Array>([
    ['blueprint.json', encoder.encode(JSON.stringify(doc))],
    ['assets/manifest.json', encoder.encode(JSON.stringify({ version: 2, assets: [] }))],
  ])
  return {
    gameId: 'wiring',
    files: {
      async read(path: string) { return files.get(path) ?? null },
      async write(path: string, bytes: Uint8Array) { files.set(path, bytes) },
      async list() { return [...files.keys()] },
      async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>) { return operation() },
    },
    media: { async list() { return [] }, async read() { return null } },
  } as unknown as ExtensionContext
}

async function codes(doc: unknown): Promise<string[]> {
  const result = await validateProjectForActivity(context(doc), 'ui.authoring', 1, ['ui.interactions.reachable'])
  return (result.evidence[0]!.issues ?? []).map((entry) => entry.code)
}

describe('元件契约清单', () => {
  it('列出内置元件的事件与输入键', () => {
    const skill = componentContracts().find((entry) => entry.id === 'BattleSkill')

    expect(skill?.events.map((event) => event.id)).toEqual(['light', 'heavy', 'medit', 'ult'])
    expect(skill?.inputs.map((input) => input.key)).toContain('lightResource')
    // numberExpr 的输入可以绑表达式（实体属性 / 公式），这是把血条接到数据上的关键。
    expect(skill?.inputs.find((input) => input.key === 'lightResource')?.component).toBe('numberExpr')
    expect(skill?.layout).toMatchObject({
      anchor: 'bottom-center',
      preferredRegion: { x: [0.2, 0.8], y: [0.68, 0.96] },
      safeMargin: 0.04,
      overflow: 'forbidden',
    })
    expect(skill?.timing).toEqual({
      kind: 'persistent-hud',
      mount: 'trigger-enter',
    })
    expect(componentContracts().find((entry) => entry.id === 'BattleParry')?.timing).toEqual({
      kind: 'windowed-qte',
      mount: 'window',
      selfSettleMs: 1500,
      emitsOnUnmount: true,
    })
    expect(componentContracts().find((entry) => entry.id === 'InkKou')?.timing).toEqual({
      kind: 'windowed-qte',
      mount: 'window',
      emitsOnUnmount: false,
    })
  })

  it('exposes blueprint quality metrics for agent self-review', async () => {
    const inspected = await inspectProject(context(project({})))

    expect(inspected.qualityMetrics).toMatchObject({
      interactionDensity: 0,
      decisionConsequenceRate: 0,
      stateActivityRate: 0,
      formulaConsumptionRate: 0,
      feedbackCoverageRate: 0,
      differentiatedEndingCount: 1,
    })
  })
})

describe('元件 prompt 契约', () => {
  it('spawn-only 控件必须教动态 spawn，也必须教时间轴 at 触发', () => {
    for (const contract of componentContracts()) {
      if (contract.timing?.kind !== 'spawn-only') continue
      // 这三个只能由 reaction 的 spawn 产生，但 spawn 可以由 enter、event 或
      // at(ms) reaction 触发；3000ms 飘字是合法需求，不能被 prompt 禁掉。
      expect(contract.prompt ?? '', contract.id).toContain('spawn')
      expect(contract.prompt ?? '', contract.id).toContain('静态挂载')
      expect(contract.prompt ?? '', contract.id).toContain('at')
      expect(contract.prompt ?? '', contract.id).toContain('ms')
    }
  })

  it('多事件控件必须逐个点名事件，并说明后果要互异', () => {
    for (const contract of componentContracts()) {
      if (contract.events.length < 2) continue
      for (const event of contract.events) {
        expect(contract.prompt ?? '', `${contract.id}/${event.id}`).toContain(event.id)
      }
      // 伪分支的成因就是 prompt 只教「接上 reaction」不教「通向不同后果」。
      expect(contract.prompt ?? '', contract.id).toContain('不同')
    }
  })

  it('技能条必须讲清置灰语义与缺省陷阱', () => {
    const skill = componentContracts().find((entry) => entry.id === 'BattleSkill')

    expect(skill?.prompt ?? '').toContain('资源 < 消耗')
    expect(skill?.prompt ?? '').toContain('不配不等于关闭')
  })

  it('两个 QTE 各自写清窗口规则与兜底', () => {
    const parry = componentContracts().find((entry) => entry.id === 'BattleParry')
    const kou = componentContracts().find((entry) => entry.id === 'InkKou')

    // BattleParry 自带 1500ms 内部判定，外层窗口不得短于 1600ms。
    expect(parry?.prompt ?? '').toContain('1600')
    // InkKou 无内部超时且卸载时不 emit，必须配 endMs + 兜底走向。
    expect(kou?.prompt ?? '').toContain('endMs')
  })

  it('没有一个控件退回到只讲机械接法的一句话', () => {
    // 粗糙但有效的回归闸：旧版三段式 prompt 都在 200 字以内，补了剧情角色与
    // 事件语义之后不可能这么短。
    for (const contract of componentContracts()) {
      expect((contract.prompt ?? '').length, contract.id).toBeGreaterThan(200)
    }
  })
})

describe('元件接线校验', () => {
  it('写了不存在的输入键会被拦住，并列出可用输入', async () => {
    const found = await codes(project({
      inputs: { actions: 'pounce,bite', entityId: 'tiger' },
      mountReactions: [{ when: { type: 'event', id: 'light' }, do: [{ kind: 'advance', edgeId: 'e-win' }] }],
    }))

    expect(found.filter((code) => code === 'ui.component.unknown-input')).toHaveLength(2)
  })

  it('挂了交互元件却没人听它的事件会被报告', async () => {
    const found = await codes(project({ inputs: { lightResource: 3 } }))

    expect(found).toContain('ui.component.event-unbound')
  })

  it('事件未接线只给 warning，不阻塞当前活动完成', async () => {
    const result = await validateProjectForActivity(
      context(project({ inputs: { lightResource: 3 } })),
      'ui.authoring',
      1,
      ['ui.interactions.reachable', 'finalization.interactions-reachable'],
    )

    expect(result.evidence.map((entry) => entry.status)).toEqual(['warn', 'warn'])
    expect(result.evidence[0]!.issues?.map((entry) => entry.code)).toContain('ui.component.event-unbound')
    expect(result.ok).toBe(true)
  })

  it('输入键正确且事件有 reaction 监听时通过', async () => {
    const found = await codes(project({
      inputs: { lightResource: 3, lightCost: 0, meditCost: 1 },
      mountReactions: [{
        when: { type: 'event', id: 'light' },
        do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'tiger', attr: 'hp', op: 'add', value: -3 }] }],
      }],
    }))

    expect(found).not.toContain('ui.component.unknown-input')
    expect(found).not.toContain('ui.component.event-unbound')
  })

  it('节点级 event reaction 不能冒充挂载级事件接线', async () => {
    const found = await codes(project({
      inputs: { lightResource: 3, lightCost: 0, meditCost: 1, ultCost: 1 },
      reactions: [{
        when: { type: 'event', id: 'light' },
        do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'tiger', attr: 'hp', op: 'add', value: -3 }] }],
      }],
    }))

    expect(found).toContain('ui.component.event-unbound')
  })

  it('挂载级 reactions 也算把事件接上了', async () => {
    const found = await codes(project({
      inputs: { lightResource: 3, lightCost: 0, meditCost: 1, ultCost: 1 },
      mountReactions: [{
        when: { type: 'event', id: 'light' },
        do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'tiger', attr: 'hp', op: 'add', value: -3 }] }],
      }],
    }))

    expect(found).not.toContain('ui.component.event-unbound')
  })

  it('Overlay 目录级 reaction 也算把事件接上了', async () => {
    const found = await codes(project({
      inputs: { lightResource: 3, lightCost: 0, meditCost: 1, ultCost: 1 },
      catalogReactions: [{
        when: { type: 'event', id: 'clash-skill:light' },
        do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'tiger', attr: 'hp', op: 'add', value: -3 }] }],
      }],
    }))

    expect(found).not.toContain('ui.component.event-unbound')
  })

  it('四个技能只接了一个、其余既没接也没置灰时点名未接事件', async () => {
    // 真跑形状：武松打虎那局只写了 light / heavy 的输入，medit 与 ult 一个字没写。
    // 运行时取默认值 meditResource=0 / meditCost=0 ⇒ 冥想按钮是亮的、点了没反应。
    const found = await codes(project({
      inputs: { lightResource: 3, lightCost: 0 },
      mountReactions: [{
        when: { type: 'event', id: 'light' },
        do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'tiger', attr: 'hp', op: 'add', value: -3 }] }],
      }],
    }))

    expect(found).toContain('ui.component.event-unbound')
  })

  it('把用不上的招式配成资源不足即可豁免', async () => {
    // heavy 默认 cost 2 > resource 0 已经置灰；medit / ult 显式配到资源之上。
    const found = await codes(project({
      inputs: { lightResource: 3, lightCost: 0, meditResource: 0, meditCost: 1 },
      mountReactions: [{
        when: { type: 'event', id: 'light' },
        do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'tiger', attr: 'hp', op: 'add', value: -3 }] }],
      }],
    }))

    expect(found).not.toContain('ui.component.event-unbound')
  })

  it('用表达式绑资源时按声明的上界判断是否置灰', async () => {
    // ultResource 绑 tiger.hp（attrMeta.max = 30），ultCost 99 ⇒ 永远开不出，算置灰。
    const found = await codes(project({
      inputs: {
        lightResource: 3,
        lightCost: 0,
        meditCost: 1,
        ultResource: { expr: 'entity.tiger.attr.hp' },
        ultCost: 99,
      },
      mountReactions: [{
        when: { type: 'event', id: 'light' },
        do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'tiger', attr: 'hp', op: 'add', value: -3 }] }],
      }],
    }))

    expect(found).not.toContain('ui.component.event-unbound')
  })

  it('QTE 的三档必须全部接线，不接受置灰豁免', async () => {
    const found = await codes(project({
      component: 'BattleParry',
      window: { startMs: 1_800, endMs: 3_600 },
      mountReactions: [{
        when: { type: 'event', id: 'success' },
        do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'tiger', attr: 'hp', op: 'add', value: -3 }] }],
      }],
    }))

    expect(found).toContain('ui.component.event-unbound')
  })

  it('uses effective node children when deriving emitted output events', async () => {
    const found = await codes(project({
      component: 'BattleSkill',
      nodeChildren: [{
        id: 'clash-skill',
        component: 'InkKou',
        trigger: { when: 'enter' },
        inputs: {},
      }],
      exits: [{ handle: 'kou' }],
    }))

    expect(found).not.toContain('ui.exit.no-source')
  })

  it('控件布局越出舞台边界会被拦住', async () => {
    const found = await codes(project({
      inputs: { lightResource: 3, lightCost: 0 },
      layout: { left: 0.82, top: 0.75, width: 0.3, height: 0.2 },
      reactions: [{
        when: { type: 'event', id: 'light' },
        do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'tiger', attr: 'hp', op: 'add', value: -3 }] }],
      }],
    }))

    expect(found).toContain('ui.component.layout-out-of-bounds')
  })
})

describe('元件时空契约校验', () => {
  it('rejects QTE that appears at the start of a node', async () => {
    const found = await codes(project({
      component: 'BattleParry',
      trigger: { when: 'enter' },
      window: { startMs: 0, endMs: 2_000 },
    }))

    expect(found).toContain('qte.timing.premature')
  })

  it('requires BattleParry to stay mounted for its internal settle window', async () => {
    const found = await codes(project({
      component: 'BattleParry',
      trigger: { when: 'at', ms: 1_000 },
      window: { startMs: 1_000, endMs: 2_000 },
    }))

    expect(found).toContain('qte.parry.window-too-short')
  })

  it('requires InkKou to have a bounded window', async () => {
    const found = await codes(project({
      component: 'InkKou',
      trigger: { when: 'at', ms: 800 },
    }))

    expect(found).toContain('qte.inkkou.no-timeout')
  })

  it('uses a node inline QTE timing override instead of the prototype default', async () => {
    const found = await codes(project({
      component: 'BattleParry',
      trigger: { when: 'enter' },
      window: { startMs: 0, endMs: 2_000 },
      nodeChildren: [{
        id: 'clash-skill',
        component: 'BattleParry',
        trigger: { when: 'at', atMs: 2_000 },
        window: { startMs: 2_000, endMs: 4_000 },
        inputs: {},
      }],
    }))

    expect(found).not.toContain('qte.timing.premature')
    expect(found).not.toContain('qte.parry.window-too-short')
  })

  it('rejects transient feedback mounted as a static child', async () => {
    const found = await codes(project({ component: 'DamageFloatText' }))

    expect(found).toContain('ui.floattext.static-mount')
  })
})

describe('战斗数值元数据校验', () => {
  it('requires attrRatio attributes to declare a positive max', async () => {
    const result = await validateProjectForActivity(
      context(project({ attrMax: null, useAttrRatio: true })),
      'rules.binding',
      1,
      ['rules.bindings.valid'],
    )

    expect(result.evidence[0]!.issues?.map((entry) => entry.code)).toContain('rules.attr-meta.max-missing')
  })
})

describe('没人引用的公式', () => {
  function withFormulas(referenced: boolean) {
    const doc = project({
      inputs: { lightResource: 3 },
      reactions: referenced
        ? [{
          when: { type: 'event', id: 'light' },
          do: [{
            kind: 'effect',
            effects: [{ kind: 'attr', entityId: 'tiger', attr: 'hp', op: 'add', value: { expr: 'formula.dmg_light' } }],
          }],
        }]
        : [],
    }) as { formulas: Record<string, unknown> }
    doc.formulas = { dmg_light: { id: 'dmg_light', ast: { t: 'num', id: 'n0', v: 3 } } }
    return doc
  }

  it('公式没被任何边、reaction 或界面输入引用时报 warn', async () => {
    const result = await validateProjectForActivity(
      context(withFormulas(false)),
      'game.finalizing',
      1,
      ['content.formula-usage'],
    )

    expect(result.evidence[0]!.status).toBe('warn')
    expect((result.evidence[0]!.issues ?? []).map((entry) => entry.code)).toContain('content.formula-unused')
    // warn 不能把整体判成失败：设计了没接上是质量问题，不是阻塞。
    expect(result.ok).toBe(true)
  })

  it('被 reaction 的 effect 引用后通过', async () => {
    const result = await validateProjectForActivity(
      context(withFormulas(true)),
      'game.finalizing',
      1,
      ['content.formula-usage'],
    )

    expect(result.evidence[0]!.status).toBe('pass')
  })
})

describe('出口 handle 的来源', () => {
  it('挂了叩门元件、出边走 kou：不需要 reaction 也算接上了', async () => {
    // 引擎里事件 id 命中出边 sourceHandle 就直接跳转（selectHandleEdgeInScope），
    // 所以「挂元件 + 一条同名出边」是完整的分支接法。
    const result = await validateProjectForActivity(
      context(project({
        component: 'InkKou',
        trigger: { when: 'at', ms: 800 },
        window: { startMs: 800, endMs: 2_800 },
        exits: [{ handle: 'kou' }],
      })),
      'game.finalizing',
      1,
      ['finalization.interactions-reachable'],
    )

    expect(result.evidence[0]!.status, JSON.stringify(result.evidence[0]!.issues)).toBe('pass')
  })

  it('出边写了没有元件提供的出口：判定为玩家走不到的死分支', async () => {
    const result = await validateProjectForActivity(
      context(project({ component: 'InkKou', exits: [{ handle: 'choice-A' }] })),
      'game.finalizing',
      1,
      ['finalization.interactions-reachable'],
    )

    const issues = result.evidence[0]!.issues ?? []
    expect(issues.map((entry) => entry.code)).toContain('ui.exit.no-source')
    // 报错要把可用出口列出来，否则 Agent 只能猜。
    expect(issues.find((entry) => entry.code === 'ui.exit.no-source')!.message).toContain('kou')
  })
})
