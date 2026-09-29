import type { WriteScope } from './contracts'

export type AuthoringCapabilityDomain = 'blueprint-library' | 'topology' | 'node-configuration'
export type AuthoringCapabilityTool = 'patch_graph' | 'configure_blueprint_node'
export type AuthoringCapabilityParitySuite = 'blueprint-library' | 'topology' | 'node-configuration'

export interface CapabilityEntryPoint {
  /** 仓库根目录相对路径；CI 会检查文件和 symbols。 */
  file: string
  symbols: readonly string[]
}

export interface AuthoringCapabilityRegistryEntry {
  id: string
  title: string
  intent: string
  domain: AuthoringCapabilityDomain
  writeScopes: readonly WriteScope[]
  transactionUnit: string
  domainPrimitives: readonly string[]
  ui: {
    status: 'available'
    entryPoints: readonly CapabilityEntryPoint[]
  }
  agent: {
    status: 'available'
    tool: AuthoringCapabilityTool
    /** patch_graph op；节点事务使用 schemaPaths。兼容 alias 必须一起登记。 */
    operations?: readonly string[]
    schemaPaths?: readonly string[]
    entryPoints: readonly CapabilityEntryPoint[]
  }
  paritySuite: AuthoringCapabilityParitySuite
}

const ui = (file: string, ...symbols: string[]): AuthoringCapabilityRegistryEntry['ui'] => ({
  status: 'available',
  entryPoints: [{ file, symbols }],
})

const patchGraph = (
  operations: readonly string[],
  ...symbols: string[]
): AuthoringCapabilityRegistryEntry['agent'] => ({
  status: 'available',
  tool: 'patch_graph',
  operations,
  entryPoints: [{ file: 'src/server/host/patch-graph-ops.ts', symbols }],
})

const nodeTransaction = (
  schemaPaths: readonly string[],
  ...symbols: string[]
): AuthoringCapabilityRegistryEntry['agent'] => ({
  status: 'available',
  tool: 'configure_blueprint_node',
  schemaPaths,
  entryPoints: [{ file: 'src/authoring/commands/configure-blueprint-node.ts', symbols }],
})

/**
 * 蓝图持久化能力的单一事实源。
 *
 * 新增前端持久化操作时必须先登记能力；CI 会强制它同时声明 Agent 路由、共享领域原语和 parity suite。
 * UI 草稿、焦点、预览等非持久化手势不进入本表。
 */
export const AUTHORING_CAPABILITY_REGISTRY = [
  {
    id: 'blueprint.library.create',
    title: '新建蓝图',
    intent: '创建带单一入口节点的独立蓝图并加入蓝图库。',
    domain: 'blueprint-library',
    writeScopes: ['graph'],
    transactionUnit: '一个蓝图库事务',
    domainPrimitives: ['createBlueprint'],
    ui: ui('src/editor/persist/graphScenarioStore.ts', 'createBlueprintInLibrary'),
    agent: patchGraph(['create-blueprint', 'make-empty-sub-flow-pack'], 'createBlueprintInLibrary'),
    paritySuite: 'blueprint-library',
  },
  {
    id: 'blueprint.library.rename',
    title: '重命名蓝图',
    intent: '按 trim 后不区分大小写的标题唯一性规则重命名蓝图。',
    domain: 'blueprint-library',
    writeScopes: ['graph'],
    transactionUnit: '一个蓝图库事务',
    domainPrimitives: ['renameBlueprint'],
    ui: ui('src/editor/persist/graphScenarioStore.ts', 'renameBlueprintInLibrary'),
    agent: patchGraph(['rename-blueprint'], 'renameBlueprintInLibrary'),
    paritySuite: 'blueprint-library',
  },
  {
    id: 'blueprint.library.delete',
    title: '删除蓝图',
    intent: '删除非主蓝图；主蓝图或仍被引用的蓝图必须拒绝。',
    domain: 'blueprint-library',
    writeScopes: ['graph'],
    transactionUnit: '一个蓝图库事务',
    domainPrimitives: ['deleteBlueprint'],
    ui: ui('src/editor/persist/graphScenarioStore.ts', 'deleteBlueprintInLibrary'),
    agent: patchGraph(['delete-blueprint'], 'deleteBlueprintInLibrary'),
    paritySuite: 'blueprint-library',
  },
  {
    id: 'blueprint.library.set-main',
    title: '设为主蓝图',
    intent: '把现有蓝图设为运行入口，并同步根 graph 镜像。',
    domain: 'blueprint-library',
    writeScopes: ['graph'],
    transactionUnit: '一个蓝图库事务',
    domainPrimitives: ['setMainBlueprint'],
    ui: ui('src/editor/persist/graphScenarioStore.ts', 'setMainBlueprintInLibrary'),
    agent: patchGraph(['set-main-blueprint'], 'setMainBlueprintInLibrary'),
    paritySuite: 'blueprint-library',
  },
  {
    id: 'blueprint.node.create',
    title: '新增节点',
    intent: '在蓝图中新增演出节点。',
    domain: 'topology',
    writeScopes: ['graph'],
    transactionUnit: '一个标准拓扑命令；Agent 可在同一事务批量提交',
    domainPrimitives: ['executeBlueprintGraphCommands', 'addNode'],
    ui: ui('src/editor/shell/GraphStudio.tsx', 'executeBlueprintGraphCommand'),
    agent: patchGraph(['add-node'], 'executeTopologyCommand'),
    paritySuite: 'topology',
  },
  {
    id: 'blueprint.node.delete',
    title: '删除节点',
    intent: '删除节点、全部入边出边和相应 advance 引用。',
    domain: 'topology',
    writeScopes: ['graph'],
    transactionUnit: '一个标准拓扑命令；Agent 可在同一事务批量提交',
    domainPrimitives: ['executeBlueprintGraphCommands', 'removeNode'],
    ui: ui('src/editor/graph/canvas/GraphCanvas.tsx', 'executeBlueprintGraphCommand'),
    agent: patchGraph(['remove-node'], 'executeTopologyCommand'),
    paritySuite: 'topology',
  },
  {
    id: 'blueprint.node.insert-before',
    title: '在节点前插入',
    intent: '插入节点并自动改接原入边。',
    domain: 'topology',
    writeScopes: ['graph'],
    transactionUnit: '一个 patch_graph 批次',
    domainPrimitives: ['insertNodeBefore'],
    ui: ui('src/editor/graph/canvas/GraphCanvas.tsx', 'insertNodeBefore'),
    agent: patchGraph(['insert-node-before'], 'insertNodeBefore'),
    paritySuite: 'topology',
  },
  {
    id: 'blueprint.node.insert-after',
    title: '在节点后插入',
    intent: '从指定出口插入节点并自动改接原下游。',
    domain: 'topology',
    writeScopes: ['graph'],
    transactionUnit: '一个 patch_graph 批次',
    domainPrimitives: ['insertNodeAfter'],
    ui: ui('src/editor/graph/canvas/GraphCanvas.tsx', 'insertNodeAfter'),
    agent: patchGraph(['insert-node-after'], 'insertNodeAfter'),
    paritySuite: 'topology',
  },
  {
    id: 'blueprint.node.duplicate',
    title: '复制节点组',
    intent: '复制节点与内部连线，并重写副本中的节点和边引用。',
    domain: 'topology',
    writeScopes: ['graph'],
    transactionUnit: '一个 patch_graph 批次',
    domainPrimitives: ['duplicateNodes'],
    ui: ui('src/editor/graph/canvas/GraphCanvas.tsx', 'duplicateNodes'),
    agent: patchGraph(['duplicate-nodes'], 'duplicateNodes'),
    paritySuite: 'topology',
  },
  {
    id: 'blueprint.node.move',
    title: '移动节点',
    intent: '修改节点在画布上的持久化坐标。',
    domain: 'topology',
    writeScopes: ['graph'],
    transactionUnit: '一个标准拓扑命令；Agent 可在同一事务批量提交',
    domainPrimitives: ['executeBlueprintGraphCommands', 'setNodePosition'],
    ui: ui('src/editor/graph/canvas/GraphCanvas.tsx', 'executeBlueprintGraphCommand'),
    agent: patchGraph(['set-node-field'], 'executeTopologyCommand'),
    paritySuite: 'topology',
  },
  {
    id: 'blueprint.edge.connect',
    title: '新增连线',
    intent: '新增真实图边并绑定事件 advance。',
    domain: 'topology',
    writeScopes: ['graph'],
    transactionUnit: '一个标准拓扑命令；Agent 可在同一事务批量提交',
    domainPrimitives: ['executeBlueprintGraphCommands', 'connect', 'upsertBranchEdge'],
    ui: ui('src/editor/graph/canvas/GraphCanvas.tsx', 'executeBlueprintGraphCommand'),
    agent: patchGraph(['connect'], 'executeTopologyCommand'),
    paritySuite: 'topology',
  },
  {
    id: 'blueprint.edge.disconnect',
    title: '删除连线',
    intent: '删除边并清理所有引用该 edgeId 的 advance。',
    domain: 'topology',
    writeScopes: ['graph'],
    transactionUnit: '一个标准拓扑命令；Agent 可在同一事务批量提交',
    domainPrimitives: ['executeBlueprintGraphCommands', 'disconnect'],
    ui: ui('src/editor/graph/canvas/GraphCanvas.tsx', 'executeBlueprintGraphCommand'),
    agent: patchGraph(['disconnect'], 'executeTopologyCommand'),
    paritySuite: 'topology',
  },
  {
    id: 'blueprint.edge.reconnect',
    title: '修改连线端点',
    intent: '保留 edgeId 修改连线的源、目标或 handle。',
    domain: 'topology',
    writeScopes: ['graph'],
    transactionUnit: '一个标准拓扑命令；Agent 可在同一事务批量提交',
    domainPrimitives: ['executeBlueprintGraphCommands', 'reconnect'],
    ui: ui('src/editor/shell/node-inspector/EdgeSection.tsx', 'executeBlueprintGraphCommand'),
    agent: patchGraph(['reconnect'], 'executeTopologyCommand'),
    paritySuite: 'topology',
  },
  {
    id: 'blueprint.edge.update-routing',
    title: '修改连线路由条件',
    intent: '在保留 edgeId 的前提下修改条件、权重或转场数据。',
    domain: 'topology',
    writeScopes: ['graph'],
    transactionUnit: '一个标准拓扑命令；Agent 可在同一事务批量提交',
    domainPrimitives: ['executeBlueprintGraphCommands', 'updateEdgeData'],
    ui: ui('src/editor/shell/node-inspector/EdgeSection.tsx', 'executeBlueprintGraphCommand'),
    agent: patchGraph(['update-edge-data'], 'executeTopologyCommand'),
    paritySuite: 'topology',
  },
  {
    id: 'blueprint.interface.mount',
    title: '添加界面',
    intent: '选择目录界面并挂载到节点。',
    domain: 'node-configuration',
    writeScopes: ['graph', 'ui'],
    transactionUnit: '一个完整节点一次 configure_blueprint_node',
    domainPrimitives: ['mountOverlayOnGraph', 'mountOverlay'],
    ui: ui('src/editor/shell/node-inspector/OverlaySection.tsx', 'mountOverlayOnGraph'),
    agent: nodeTransaction(['interfaces'], 'mountOverlay'),
    paritySuite: 'node-configuration',
  },
  {
    id: 'blueprint.interface.configure-component',
    title: '配置界面组件',
    intent: '按挂载实例修改组件 inputs、布局和时间窗。',
    domain: 'node-configuration',
    writeScopes: ['graph', 'ui'],
    transactionUnit: '一个完整节点一次 configure_blueprint_node',
    domainPrimitives: ['patchOverlayChildInMount', 'patchOverlayMount'],
    ui: ui('src/editor/shell/NodeInspector.tsx', 'setChildInputs'),
    agent: nodeTransaction(['interfaces.components'], 'patchOverlayChildInMount'),
    paritySuite: 'node-configuration',
  },
  {
    id: 'blueprint.interface.unmount',
    title: '移除界面',
    intent: '卸载界面并级联删除该挂载的事件响应、advance 和出口边。',
    domain: 'node-configuration',
    writeScopes: ['graph', 'ui'],
    transactionUnit: '一个完整节点一次 configure_blueprint_node',
    domainPrimitives: ['unmountOverlay'],
    ui: ui('src/editor/video/graphMaterialOps.ts', 'unmountOverlay'),
    agent: nodeTransaction(['removals.interfaces'], 'unmountOverlay'),
    paritySuite: 'node-configuration',
  },
  {
    id: 'blueprint.event.configure-response',
    title: '配置事件响应',
    intent: '给界面事件配置效果、目标节点、界面动作和跳转时机。',
    domain: 'node-configuration',
    writeScopes: ['graph', 'ui'],
    transactionUnit: '一个完整节点一次 configure_blueprint_node',
    domainPrimitives: ['upsertEventReaction', 'routeMountEventToNode', 'updateEventRouteTiming'],
    ui: ui(
      'src/editor/shell/node-inspector/OverlaySection.tsx',
      'upsertEventReaction',
      'routeMountEventToNode',
    ),
    agent: nodeTransaction(
      ['interfaces.eventResponses'],
      'setMountEventActions',
      'routeMountEventToNode',
    ),
    paritySuite: 'node-configuration',
  },
  {
    id: 'blueprint.event.remove-response',
    title: '删除事件响应',
    intent: '删除事件动作、路由或完整响应并执行连线级联清理。',
    domain: 'node-configuration',
    writeScopes: ['graph', 'ui'],
    transactionUnit: '一个完整节点一次 configure_blueprint_node',
    domainPrimitives: ['removeMountEventResponse', 'removeMountEventAction'],
    ui: ui('src/editor/shell/node-inspector/OverlaySection.tsx', 'removeMountEventAction'),
    agent: nodeTransaction(
      ['removals.eventResponses', 'removals.eventActions'],
      'removeMountEventResponse',
      'removeMountEventAction',
    ),
    paritySuite: 'node-configuration',
  },
  {
    id: 'blueprint.settlement.create',
    title: '添加结算',
    intent: '添加时间轴或条件结算及其完整动作。',
    domain: 'node-configuration',
    writeScopes: ['graph'],
    transactionUnit: '一个完整节点一次 configure_blueprint_node',
    domainPrimitives: ['createSettlementReaction', 'appendSettlementReaction'],
    ui: ui('src/editor/shell/node-inspector/SettlementSection.tsx', 'createSettlementReaction'),
    agent: nodeTransaction(['settlements'], 'appendSettlementReaction'),
    paritySuite: 'node-configuration',
  },
  {
    id: 'blueprint.settlement.update',
    title: '修改结算',
    intent: '整体更新已有结算的触发条件、效果、目标和界面动作。',
    domain: 'node-configuration',
    writeScopes: ['graph'],
    transactionUnit: '一个完整节点一次 configure_blueprint_node',
    domainPrimitives: [
      'replaceSettlementReaction',
      'setSettlementAdvanceTarget',
      'patchSettlementSpawnLayout',
      'setRoutingSettlementMs',
      'setSettlementReactionMs',
      'setSettlementSpawnTtlMs',
    ],
    ui: ui('src/editor/shell/node-inspector/SettlementSection.tsx', 'setSettlementAdvanceTarget'),
    agent: nodeTransaction(
      ['settlementUpdates'],
      'replaceSettlementReaction',
      'setSettlementAdvanceTarget',
    ),
    paritySuite: 'node-configuration',
  },
  {
    id: 'blueprint.settlement.remove',
    title: '删除结算或结算动作',
    intent: '删除结算、效果、连线或界面动作，并清理孤立的结算专用边。',
    domain: 'node-configuration',
    writeScopes: ['graph'],
    transactionUnit: '一个完整节点一次 configure_blueprint_node',
    domainPrimitives: [
      'removeSettlementReaction',
      'removeSettlementAction',
      'removeSettlementSpawn',
    ],
    ui: ui(
      'src/editor/shell/node-inspector/SettlementSection.tsx',
      'removeSettlementReaction',
      'removeSettlementAction',
      'removeSettlementSpawn',
    ),
    agent: nodeTransaction(
      ['removals.settlements', 'removals.settlementActions'],
      'removeSettlementReaction',
      'removeSettlementAction',
      'removeSettlementSpawn',
    ),
    paritySuite: 'node-configuration',
  },
] as const satisfies readonly AuthoringCapabilityRegistryEntry[]

/**
 * schema 中仍保留但不代表独立“前端持久化能力”的兼容/逃生 op。
 * 新 op 未进入注册表且未带原因写进这里时，治理检查会失败。
 */
export const PATCH_GRAPH_OPERATION_EXEMPTIONS = {
  'set-node-data': '通用逃生口；具体产品能力必须另行登记，不能用它替代领域事务。',
  'patch-node-bgm': 'BGM 使用独立 authoring 契约，待纳入媒体能力注册表。',
  'ensure-node-overlay': '旧节点本地界面兼容 op；Agent 正常路径使用 configure_blueprint_node。',
  'add-overlay-child': '旧节点本地界面兼容 op；自定义组件通过 upsert_component 管理。',
  'remove-overlay-child': '旧节点本地界面兼容 op；Agent 正常路径使用结构化 removals。',
  'patch-overlay-child': '旧节点本地界面兼容 op；Agent 正常路径使用 configure_blueprint_node。',
  'patch-overlay-child-params': '旧节点本地界面兼容 op；Agent 正常路径使用 configure_blueprint_node。',
  'patch-overlay-mount': '旧节点本地界面兼容 op；Agent 正常路径使用 configure_blueprint_node。',
  'reset-overlay-override': '旧节点本地界面兼容 op；Agent 正常路径使用 configure_blueprint_node。',
  'set-formula': '旧兼容 op；规则目录的正常入口是 patch_rules。',
  'remove-formula': '旧兼容 op；规则目录的正常入口是 patch_rules。',
  'attach-sub-process': '内嵌私有子流程能力，不对应蓝图库 CRUD。',
  'set-sub-flow-pack': '节点绑定可复用子蓝图能力；已共享 graph-edit 原语，后续单独补 UI parity。',
} as const satisfies Record<string, string>

/**
 * 编辑器仍在使用、但属于读取 helper、目录编辑或通用旧逃生口的 authoring primitive。
 * 治理脚本会反向扫描 editor 的生产 import；未登记能力且未在这里解释的新增 primitive 会失败。
 */
export const UI_AUTHORING_PRIMITIVE_EXEMPTIONS = {
  addOverlayChild: '界面目录/旧节点本地 overlay 编辑，Agent 侧由 upsert_component 与节点事务分工承接。',
  addOverlayChildToMount: '界面目录/旧节点本地 overlay 编辑，尚不作为独立蓝图能力发布。',
  attachSubProcess: '内嵌私有子流程兼容能力；Agent 已有 attach-sub-process，待补专门 parity 后再转正式登记。',
  countOverlayReferences: '只读引用计数，不改变持久化结果。',
  dropOverlayIfUnreferenced: '界面目录删除后的内部垃圾回收，不是独立用户意图。',
  ensureNodeOverlay: '旧节点本地 overlay 兼容入口，正常节点挂载使用 configure_blueprint_node。',
  eventHandleEdges: '只读事件边查询 helper，不改变持久化结果。',
  findMountOwningChild: '只读挂载定位 helper，不改变持久化结果。',
  forkSchemeForEdit: '界面目录写时复制策略，属于 UI 模板治理域。',
  makeEmptySubFlowPack: '节点面板旧子蓝图工厂；蓝图库创建已经改用 createBlueprint，待清理旧入口。',
  newElementId: 'ID 分配 helper，不是独立产品能力。',
  overriddenChildIds: '只读 override 查询 helper，不改变持久化结果。',
  patchOverlayChild: '旧节点本地 overlay 兼容入口，挂载实例属性使用 patchOverlayChildInMount。',
  primaryOverlayMount: '只读默认挂载定位 helper，不改变持久化结果。',
  removeOverlayChild: '界面目录/旧节点本地 overlay 编辑，节点卸载使用结构化 removals。',
  resetOverride: '界面目录/旧节点本地 overlay 编辑，尚未作为独立蓝图能力发布。',
  updateNodeData: '前端通用字段逃生口；具体新增产品能力不得继续复用它绕过注册表。',
} as const satisfies Record<string, string>

export const AUTHORING_CAPABILITY_REGISTRY_VERSION = 2

export function publicAuthoringCapabilities() {
  return AUTHORING_CAPABILITY_REGISTRY.map((capability) => ({
    id: capability.id,
    title: capability.title,
    intent: capability.intent,
    domain: capability.domain,
    writeScopes: capability.writeScopes,
    transactionUnit: capability.transactionUnit,
    agent: {
      tool: capability.agent.tool,
      ...(capability.agent.operations ? { operations: capability.agent.operations } : {}),
      ...(capability.agent.schemaPaths ? { schemaPaths: capability.agent.schemaPaths } : {}),
    },
  }))
}
