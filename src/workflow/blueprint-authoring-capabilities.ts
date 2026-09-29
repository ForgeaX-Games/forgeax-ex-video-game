import type { BlueprintAuthoringCapabilityContract } from './contracts'
import {
  AUTHORING_CAPABILITY_REGISTRY_VERSION,
  publicAuthoringCapabilities,
} from './authoring-capability-registry'
import {
  INTERACTION_GAMEPLAY_PATTERNS,
  SETTLEMENT_GAMEPLAY_PATTERNS,
} from './gameplay-semantics'

/**
 * 蓝图策划与执行阶段共享的能力边界。
 *
 * 它描述的是产品可表达的玩法，不是 authoring 内部函数清单。活动契约会把它直接返回给 AI，
 * 支柱和总脉络据此设计，整装再把同一份意图落实为节点事务。
 */
export const BLUEPRINT_AUTHORING_CAPABILITIES = {
  schemaVersion: 1,
  registryVersion: AUTHORING_CAPABILITY_REGISTRY_VERSION,
  registryPolicy: '能力注册表是唯一事实源；前端持久化能力必须同时声明 Agent 路由、领域原语与 parity suite，或显式登记有理由的豁免。',
  purpose: '约束上游只设计平台能够落地的互动，并指导下游选择正确的蓝图事务。',
  topology: {
    tool: 'patch_graph',
    supports: [
      '新增、删除、移动节点',
      '在已有节点前后插入节点并自动重接原路径',
      '复制一个或多个节点及其内部连线并重写引用',
      '新增、删除连线或在保留 edgeId 的前提下修改连线端点',
      '主干边、分支边、子流程与可复用子蓝图',
      '节点故事与互动计划',
    ],
    boundary: '只负责图拓扑和节点事务未覆盖的字段；复用画布领域方法，但不用于直接写完整 overlayNodes 或 reactions。',
  },
  outlineCompiler: {
    skeletonTool: 'create_blueprint_outline_skeleton',
    nodeTool: 'configure_blueprint_outline_node',
    legacyTool: 'compile_blueprint_outline',
    unit: '先一次创建完整节点骨架，再按画布节点逐个提交玩法契约与出边。Agent 不生成完整 GameNode/GameEdge',
    composesCapabilityIds: [
      'blueprint.node.create',
      'blueprint.edge.connect',
      'blueprint.edge.update-routing',
    ],
    commitPolicy: '骨架事务先落全部节点并立即在画布可见；随后每个节点事务只替换该节点的玩法契约和出边，失败只重试当前节点。最后由 complete_activity 对完整图统一验收。旧 compile_blueprint_outline 仅保留兼容，不用于新总脉络。',
  },
  nodeTransaction: {
    tool: 'configure_blueprint_node',
    unit: '一个已完整规划的节点一次调用',
    interfaces: [
      '挂载一个或多个已有界面',
      '配置挂载布局与组件属性',
      '把组件事件绑定到目标节点，以及选中锁定/隐藏等瞬时界面动作',
      '配置 immediate 或 onSettlement 跳转时机',
    ],
    settlementTriggers: [
      'at：时间轴时刻',
      'watch：变量或实体属性 change/inc/dec',
      'state：条件表达式成立',
    ],
    settlementActions: ['修改变量或实体属性', '用 edgeId 精确绑定总脉络既有目标边', '显示界面', '隐藏界面'],
    updates: ['修改已有界面挂载与组件属性', '替换已有事件响应', '按 settlementIndex 完整更新已有结算'],
    removals: [
      '卸载界面并级联删除其事件响应和事件出口边',
      '删除整个事件响应、单个事件动作或事件连线',
      '删除整条结算并清理不再引用的结算专用边',
      '删除结算中的效果、连线、界面绑定或隐藏界面动作',
      '删除当前节点拥有的指定出边并同步清理 advance 引用',
    ],
    preconditions: [
      '当前节点和所有目标节点已存在',
      '生产 workflow 内所有目标边已由 blueprint.outline 创建；结算分支优先携带精确 edgeId',
      '效果引用的实体、变量和公式 ID 已存在',
      '界面、子组件、组件 input 和 event 已由目录确认',
    ],
    commitPolicy: '同一节点的界面、事件响应和结算合并提交；多节点可并行规划，但按最新 revision 串行写入。',
    settlementPatterns: SETTLEMENT_GAMEPLAY_PATTERNS,
  },
  operations: publicAuthoringCapabilities(),
  interactionPatterns: INTERACTION_GAMEPLAY_PATTERNS,
  planningRequirements: [
    '每个非纯叙事节拍都说明玩家动作以及承载该动作的 component/event。',
    'v2 支柱动作必须用 stateMutationOwner=settlement|none 明确状态归属；总脉络逐项原样物化，禁止把状态动作伪装成纯分支。',
    '每个玩家动作至少产生状态变化或可达出口，不能只有点击而没有后果。',
    '生命、怒气、气力、关系值等数值动作必须先由组件事件进入独立结果节点，再由该节点 sourcePillarActionId 对应的 at 结算应用 effect 与飘字；源界面事件不得直接改数值。',
    '生命归零、资源阈值和后续门槛必须由 state/watch 结算读取并进入对应分支。',
    '同一决策的不同选项必须产生可感知差异，不能无后果地立即合流。',
    '关键状态变化必须有界面或剧情反馈，让玩家能理解动作、结果与下一步之间的因果。',
    '每个条件、时间点或状态变化触发的结算都说明触发时机、动作和后续去向。',
    '每个互动节拍必须同时说明玩家可见信息、状态变化、即时反馈和下游视频如何呈现结果。',
    '每个动作与结算使用稳定 ID 逐项追溯到支柱，反馈用 feedbackSpec 编译成真实组件或隐藏动作。',
    '每个结算使用 triggerSpec 声明精确的 at/watch/state 运行时触发器。',
    '每条互动边必须声明 component-event、settlement 或 lifecycle producer，并追溯到支柱节拍 ID。',
    '每条互动边必须有 outcomeEvidenceId，目标节点用同一 ID 和 sourceEdgeId 证明下游视频结果。',
    '重要状态必须有写入方、读取方、可见反馈和消费/重置位置。',
    '战斗循环必须包含信息、决策、反馈、进展和退出条件，不能只是一组打斗视频。',
    '循环必须有退出条件，胜利、失败和其它终局必须可达且互相自洽。',
    '每个动作用 requiredRole 声明承载它的组件角色：player-choice / combat-command / timed-input。',
    '目录里没有任何角色能承载该动作时，不要用 capabilityGap 顶过门；改设计或换已有角色。',
  ],
} as const satisfies BlueprintAuthoringCapabilityContract

export const BLUEPRINT_CAPABILITY_DESIGN_GUIDE = '蓝图能力契约是玩法设计边界：界面负责呈现与接收玩家事件，'
  + '界面事件负责选择既有出边，目标结果节点的时间轴结算负责数值与反馈，条件结算负责阈值分支。支柱先设计可实现的互动节拍；总脉络再把每个节拍'
  + '落实为真实 component/event、状态后果、结构化反馈/结算触发、出口和目标节点结果证据；outline 完成后冻结设计，'
  + '整装只负责执行已经确认的计划，不得重新发明玩法或修改节点与连线。'
