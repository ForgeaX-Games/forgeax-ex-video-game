import type { ActivityContract, ProductPhase, VideoGameActivity, PageLocation } from './contracts'
import { COMPILED_VIDEO_GAME_ACTIVITIES } from './contracts'
import {
  BLUEPRINT_AUTHORING_CAPABILITIES,
  BLUEPRINT_CAPABILITY_DESIGN_GUIDE,
} from './blueprint-authoring-capabilities'
import { gameVideoMcpToolName as tool } from './mcp-tool-name'

const COMMON = [
  tool('get-workflow-state'),
  tool('await-user'),
  tool('complete-activity'),
  tool('report-blocker'),
  tool('focus-page'),
]

export const ACTIVITY_PHASE: Record<VideoGameActivity, ProductPhase> = {
  'brief.collecting': 'requirements-collection',
  'document.inquiry': 'requirements-collection',
  'document.core': 'planning-design',
  'document.pillar': 'planning-design',
  'blueprint.outline': 'feature-development',
  'characters.modeling': 'feature-development',
  'characters.previewing': 'feature-development',
  'scenes.modeling': 'feature-development',
  'scenes.previewing': 'feature-development',
  'rules.catalog': 'feature-development',
  'rules.binding': 'feature-development',
  'ui.authoring': 'feature-development',
  'game.finalizing': 'feature-development',
  'assets.character': 'asset-generation',
  'assets.scene': 'asset-generation',
  'video.presets.binding': 'asset-generation',
  'video.presets.validating': 'asset-generation',
  'playtest.validating': 'feature-development',
}

export const ACTIVITY_FOCUS: Record<VideoGameActivity, PageLocation | undefined> = {
  'brief.collecting': undefined,
  'document.inquiry': undefined,
  'document.core': { kind: 'document', documentType: 'core' },
  'document.pillar': { kind: 'document', documentType: 'pillar' },
  'blueprint.outline': { kind: 'blueprint' },
  'characters.modeling': { kind: 'asset', root: 'character' },
  'characters.previewing': { kind: 'asset', root: 'character' },
  'scenes.modeling': { kind: 'asset', root: 'scene' },
  'scenes.previewing': { kind: 'asset', root: 'scene' },
  'rules.catalog': { kind: 'rule', section: 'variables' },
  'rules.binding': { kind: 'rule', section: 'variables' },
  'ui.authoring': { kind: 'ui' },
  'game.finalizing': { kind: 'blueprint' },
  'assets.character': { kind: 'asset', root: 'character' },
  'assets.scene': { kind: 'asset', root: 'scene' },
  'video.presets.binding': { kind: 'asset', root: 'video' },
  'video.presets.validating': { kind: 'asset', root: 'video' },
  'playtest.validating': { kind: 'blueprint' },
}

type ContractInput = Omit<ActivityContract, 'schemaVersion' | 'activity' | 'completionSchema'>

function contract(activity: VideoGameActivity, input: ContractInput): ActivityContract {
  return {
    schemaVersion: 1,
    activity,
    completionSchema: 'video-game-completion-report/v1',
    ...input,
  }
}

const DOC_TOOLS = [...COMMON, tool('upsert-document')]

/**
 * 编译阶段没有 agent 工具面。
 *
 * 在函数里统一剥掉而不是逐个改字面量：工具面是这条架构线的关键不变量
 * （「支柱是唯一创作面，下游全是编译」），靠约定维护迟早会被一次编辑破掉。
 * `hardChecks` 保留——编译产物仍然要过下游原本那套校验，只是现在由 Host 满足。
 */
function withCompilerOwnedStages(
  contracts: Record<VideoGameActivity, ActivityContract>,
): Record<VideoGameActivity, ActivityContract> {
  for (const activity of COMPILED_VIDEO_GAME_ACTIVITIES) {
    const base = contracts[activity]
    contracts[activity] = {
      ...base,
      allowedToolNames: [],
      mutationSequence: [],
      stopConditions: ['本阶段由 Host 编译产出，不派 peer、不接受 agent 写入'],
      domainGuide: '这一阶段是支柱的编译产物，由 Host 在支柱落盘时整体生成，没有可调用的工具。'
        + '不要 begin 本阶段。未确认支柱时的编译失败才改支柱；已确认后发现的蓝图缺口由 playtest.validating 自己修正。',
    }
  }
  return contracts
}

export const ACTIVITY_CONTRACTS: Record<VideoGameActivity, ActivityContract> = withCompilerOwnedStages({
  'brief.collecting': contract('brief.collecting', {
    objective: '收集并记录视觉风格与五项基础需求及其来源。', requiredInputs: [],
    allowedToolNames: COMMON, mutationSequence: ['await-user', 'ask-author', 'complete-activity'],
    hardChecks: ['brief.required-dimensions'], stopConditions: ['等待用户回答时停止', '需求字段缺失时不得推进'],
    domainGuide: '视觉风格与基础需求保留原有收集流程。默认值和推断值必须记录来源。需求契约由 Host 落到生产平面，不写文档。',
  }),
  'document.inquiry': contract('document.inquiry', {
    objective: '在生成核心方案前，一次性确认五项会改变方案与支柱的题材相关取舍。', requiredInputs: [{ kind: 'brief' }],
    allowedToolNames: COMMON, mutationSequence: ['await-user', 'ask-author', 'complete-activity'],
    hardChecks: [], stopConditions: ['等待用户回答时停止', '五项补充问询未收齐时不得推进'],
    domainGuide: '只问一次，不落文档、不显示侧边栏入口或 Toast。问题必须基于需求契约且不重复基础需求；答案随 complete_activity 的 inquiryContract 写入生产平面。',
  }),
  'document.core': contract('document.core', {
    objective: '产出三个互斥核心方向并等待结构化选择。', requiredInputs: [{ kind: 'brief' }, { kind: 'inquiry' }],
    allowedToolNames: DOC_TOOLS, mutationSequence: ['upsert-document', 'await-core-selection', 'complete-activity'],
    hardChecks: ['document.design-options.ready', 'document.design-options.options'], stopConditions: ['写出三个方向后停止；选择门由进入 pillar 时的外部 Author Gate 证据校验'], domainGuide: '以 design-options 协议写入三个方向；三个方向必须在核心循环和叙事冲突上可辨别。upsert_document 会自动完成文档硬校验，但不能替代收尾：必须再调用 complete_activity 并确认 accepted（已完成时允许 alreadyComplete），或在不可恢复时调用 report_blocker；Agent 不调用 validate_project。',
  }),
  'document.pillar': contract('document.pillar', {
    objective: '形成可驱动总脉络、规则、角色、场景与界面的游戏支柱。', requiredInputs: [{ kind: 'core' }, { kind: 'brief' }, { kind: 'inquiry' }],
    allowedToolNames: [...DOC_TOOLS, tool('list-ui-components')], mutationSequence: ['get-workflow-state', 'list-ui-components', 'upsert-document', 'await-pillar-gate', 'complete-activity'],
    hardChecks: ['document.pillar.ready'], stopConditions: ['文档 ready 后停止；批准门由进入 blueprint.outline 时的外部 Author Gate 证据校验'],     domainGuide: '支柱必须明确叙事、互动、规则和界面契约。upsert_document 已自动完成文档硬校验，Agent 不调用 validate_project。'
      + BLUEPRINT_CAPABILITY_DESIGN_GUIDE
      + '先用 list_ui_components 了解当前平台真实可用的组件 inputs/events 和 gameplaySemantics.roles，再设计主循环；优先组合已有能力。'
      + '每个动作必须用 requiredRole 声明承载它的组件角色（player-choice / combat-command / timed-input）；'
      + '目录里没有任何角色能承载时不要用 capabilityGap 顶过门：改设计或换已有角色，未解决的缺口会让 document.pillar.ready 失败。'
      + '本阶段只写支柱文档，不调用 patch_graph 或 configure_blueprint_node，不分配节点、规则或挂载 ID。'
      + '每个互动节拍都要写清玩家动作、可选分支、状态变化或后果去处；不要只写“这里有战斗/选择”。'
      + '这些是下游 blueprint.outline 的唯一玩法来源，不能让总脉络或整装自行补写作者未确认的分支。'
      + '短篇支柱必须先规划主图章节预算：默认 10 个、最多 15 个，并且至少 1 个 combat-command 动作。'
      + '提交前先算最小节点数：每个有动作的节拍 1 个互动节点，外加每个含配对 settlement 动作的节拍 1 个同节拍结果节点（同一拍的多个选项共用）。'
      + '最小节点数超过篇幅上限、或短篇/中篇/长篇没有任何 combat-command 时，upsert_document 和 document.pillar.ready 会失败——不要把不可执行的支柱交给作者确认。'
      + 'Host 在落盘时编译蓝图，并立刻对编译产物做与审查同源的可玩性检查：假选择、死循环、数值区间颠倒、元件点了没反应、结算写不回去，都会返回 document.pillar.not-buildable。'
      + '这些是策划图纸的问题，必须在本阶段改 IR 再提交；不要等作者确认后让审查环节再发现。'
      + '试画失败会返回 document.pillar.role-unsupported / document.pillar.not-buildable 并附带总脉络的原始报错，按报错改支柱即可，不要绕过。'
      + '战斗回合可以拆成多个连续主图节点，所有战斗节点都计入总数；例如战斗占 5 个节点时，其余剧情最多 5 个节点。'
      + '正文必须包含角色、场景、主循环、互动节拍，并提供 schemaVersion 4 的 pillar-interaction-contract：'
      + '复用 get_workflow_state.pillarSkeleton 的节拍 ID 与 kind；slug 用 pillarSource.documentSlug。'
      + '用 upsert_document.contract 提交 IR，不要写作者 Markdown；Host 渲染作者文档。'
      + '优先一次原子提交覆盖完整骨架的 IR；Host 校验、编译并推进状态，不要求 Agent 维护多轮写入协议。'
      + '仅当 Host 返回超长时，才读取 writeGuide.nextBeatIds 并按该批次补交。'
      + '支柱就是游戏策划，下游资产 / 视频 / 编译全是执行者：cast[].summary 必须写清外形、服饰、面孔与气质，'
      + 'settings[].summary 必须写清地点、时段、光影与空间层次，每个节拍还要写 staging（这一拍的场面调度），'
      + '下游角色预设和视频 prompt 直接引用这些策划原文，写短了产出就是空壳。'
      + '有独立对象、多属性（角色/敌人生命）时声明 entities[]，效果写 entity.<id>.attr.<attr>；'
      + '全局进度、旗标、信任度用 variables[]。两者都可以声明，用到的引用必须先声明。'
      + '每个节拍都要规划界面运用：列出该节点挂哪些覆盖物组件。'
      + '一个节点通常不挂两份相同组件的覆盖物（多个选项共用一个 ChoicePanel 的不同事件）；'
      + '确需两份时才声明 allowDuplicateOverlays。瞬时飘字不算常驻挂载。'
      + 'kind=pass 过场只写一个 none 动作；kind=branch / combat 才写 effect、feedbackSpec、配对 settlement、exit。'
      + '支柱之后没有 LLM，Host 直接按契约挂元件、绑数值、接结算、画分支：'
      + '分叉和战斗的数值动作必须写 effect 与配对 settlement，玩家要看见的变化必须写 feedbackSpec，'
      + '分叉必须写 exit，数值必须在 variables 或 entities 里声明（血条需要 max），多结局用 endings[].when 分流。'
      + '省略这些字段会被兜底成平庸缺省（出口一律下一拍、数值无人读取），产出不可玩的蓝图。'
      + 'pillar 的 upsert_document 必须携带刚刚读取到的 activityRevision；完整 contract 不超过 32000 字。'
      + '只有 Host 返回 incomplete 时，beats[].id 才必须是 writeGuide.nextBeatIds 的子集。',
    blueprintCapabilities: BLUEPRINT_AUTHORING_CAPABILITIES,
  }),
  'blueprint.outline': contract('blueprint.outline', {
    objective: '依据支柱与故事剧本定出游戏总脉络：蓝图树（节点、边、抉择、章节梗概）。',
    requiredInputs: [{ kind: 'pillar' }],
    // 只写蓝图设计：角色、场景、规则内容属于下游，但稳定引用、节点和因果边必须在这里完整冻结。
    allowedToolNames: [
      ...COMMON,
      tool('get-graph'),
      tool('list-ui-components'),
      tool('create-blueprint-outline-skeleton'),
      tool('configure-blueprint-outline-node'),
      tool('validate-project'),
    ],
    mutationSequence: [
      'get-graph',
      'list-ui-components',
      'create-blueprint-outline-skeleton',
      'configure-blueprint-outline-node',
      'complete-activity',
    ],
    hardChecks: [
      'outline.graph-connected',
      'outline.choice-consequence',
      'outline.node-summary-complete',
      'outline.node-count-matches-scale',
      'outline.declarations-complete',
      'outline.declaration-budget',
      // 玩法契约：每个节点都要表态观众能做什么，这是三条线唯一的共享设计。
      'outline.interaction-plan',
      'outline.causal-chain',
      'outline.downstream-contract',
    ],
    stopConditions: ['不得生成任何图片或视频', '声明规模超过系统上限时停止并报告'],
    domainGuide: '只写骨架与 ID 级资产计划：节点、边、抉择、章节梗概，以及 cast[].characterId / scenes[].sceneId。'
      + BLUEPRINT_CAPABILITY_DESIGN_GUIDE
      + '首次生成或完整返工必须先调用 create_blueprint_outline_skeleton，一次提交所有节点的 id/name/pillarBeatId/beat 和 ID 级 cast/scenes；骨架成功后画布必须已经出现全部节点，但允许暂时没有边、未通过完成门。'
      + '排骨架时先按支柱算出节点数：每个有动作的节拍 1 个互动节点，外加每个 stateMutationOwner=settlement 的动作 1 个结果节点。结果节点的 pillarBeatId 必须等于它所结算动作所在的节拍，beat 填 narrative；它属于那个动作的节拍，不是剧情推进到的下一个节拍，也不能拿下一章顶替。'
      + 'Host 在 create_blueprint_outline_skeleton 就会按这个算式拦截：最小节点数或提交章节数超过篇幅上限时直接失败，错误码是 outline.pillar-budget-exceeded / outline.node-count-exceeds-scale，不要自己发明 outline.skeleton-wrong-nodes。'
      + '随后按 pendingNodeIds 逐个调用 configure_blueprint_outline_node。每次只提交一个已存在节点的 actions/settlements/resolvesActions/loop/terminals 与 outgoingRoutes；Host 只替换该节点和它的出边，并返回 configuredNodeIds/pendingNodeIds。失败只修当前节点，禁止重建骨架或重发其它已成功节点。'
      + '配置时若 Host 报某个 action/settlement 属于别的节拍，说明这个节点当初绑错了节拍：在 configure_blueprint_outline_node 里带上 pillarBeatId 就地改绑即可，节点 ID、入边和章节名都保留，绝不要为此重建骨架或报 blocker。'
      + 'Host 自动生成章节摘要、pillar 语义、action target、边 ID/handle/design、目标 outcomeEvidence 和结果 settlement。Agent 不得手写完整 nodes/edges 或这些机械派生字段。所有 pendingNodeIds 清零且 readyToComplete=true 后才调用 complete_activity。'
      + '不要调用旧 compile_blueprint_outline 或 patch_graph；它们不属于新总脉络生产路径。支柱或设计无法满足单节点契约时调用 report_blocker 交回上游。交付后的作者维护才使用 patch_graph。'
      + '角色外观、场景视觉描述、previewPrompt、当前资产 ID、参考资源与 media.generation 视频预设都不得写入。'
      + '节点 ID、角色 ID、场景 ID 在这里分配并保证稳定。'
      + '规划分支前先 `list_ui_components`：节点除 default 外的每个出口 handle 都来自挂载元件的事件或者结算的出边，'
      + '边的 sourceHandle 必须对齐某个元件事件 id，否则这条分支玩家永远走不到。'
      + '先从支柱逐节点转录互动节拍：beat、action、settlement 分别填写 sourcePillarBeatId、sourcePillarActionId、sourcePillarSettlementId，语义字段逐字继承；每个玩家动作填真实 component/event，并至少声明 effect 或 exit 一个后果。'
      + 'v2 支柱 action.stateMutationOwner 必须原样物化：settlement 必须给 effect 并沿组件事件边进入非自身 targetNodeId，none 禁止添加 effect；目标结果节点保留同一 sourcePillarBeatId，并规划 sourcePillarActionId 对应的 at 结算。界面事件只选路，命中/恢复数值和飘字由结果节点结算；生命归零和资源阈值用 state/watch 结算。'
      + '条件终局写入 interaction.terminals，回合回路写入 interaction.loop；每个结算除 trigger/source 外必须给 triggerSpec，明确 at 毫秒、watch 表达式或 state condition，禁止让整装从自然语言猜。'
      + '你只定“这里要玩家做什么、何时结算、走向哪个节点”，元件挂载和数据绑定是汇总整装的活；本阶段不得调用 configure_blueprint_node。'
      + '每条 outgoingRoute 必须引用当前节点的支柱 action/settlement 或 lifecycle producer；edge.data.design、action/settlement target 和目标节点 outcomeEvidence 由 Host 派生。活动完成后这些节点与边设计会被 Host 冻结。',
    blueprintCapabilities: BLUEPRINT_AUTHORING_CAPABILITIES,
  }),
  'characters.modeling': contract('characters.modeling', {
    objective: '把总脉络声明的角色补成完整定义：外观描述与预览 Prompt。',
    requiredInputs: [{ kind: 'outline' }],
    allowedToolNames: [...COMMON, tool('get-graph'), tool('patch-characters'), tool('validate-project')],
    mutationSequence: ['get-graph', 'patch-characters', 'validate-project', 'complete-activity'], hardChecks: [
      'characters.catalog.valid',
      'characters.count-matches-scale',
    ],
    stopConditions: ['角色引用或实体引用无效时停止', '不得新增总脉络未声明的角色'],
    domainGuide: '只写角色目录，不碰节点与边。屏幕角色和规则实体分离；纯规则实体不自动生成角色。所有自然语言使用作者语言。',
  }),
  'characters.previewing': contract('characters.previewing', {
    objective: '为节点 cast 中的屏幕角色自动生成并绑定预览参考图。',
    requiredInputs: [{ kind: 'characters' }, { kind: 'outline' }],
    allowedToolNames: [...COMMON, tool('get-graph'), tool('list-assets'), tool('generate-character-previews'), tool('validate-project')],
    mutationSequence: ['get-graph', 'list-assets', 'generate-character-previews', 'validate-project', 'complete-activity'],
    hardChecks: ['characters.references.ready'],
    stopConditions: ['角色目录、节点 cast 或活动 revision 不匹配时停止', '超过系统自动生成上限时停止并报告建模异常', '生成失败时保留已成功角色并报告缺口'],
    domainGuide: '不需要用户确认。只为至少一个节点 cast 中 onScreen !== false 的角色出图；纯规则实体不出图。'
      + '目标集合由 Host 从蓝图引用推导，不得自行扩大。',
  }),
  'scenes.modeling': contract('scenes.modeling', {
    objective: '把总脉络声明的场景补成完整定义：视觉描述与图片 Prompt。',
    requiredInputs: [{ kind: 'outline' }],
    allowedToolNames: [...COMMON, tool('get-graph'), tool('patch-scenes'), tool('validate-project')],
    mutationSequence: ['get-graph', 'patch-scenes', 'validate-project', 'complete-activity'],
    hardChecks: ['scenes.catalog.valid', 'scenes.count-matches-scale'],
    stopConditions: ['场景引用无效时停止', '不得新增总脉络未声明的场景'],
    domainGuide: '只写场景目录，不碰节点与边。场景与角色完全对称：这里只做设定，出图在 scenes.previewing。'
      + '图片 Prompt 使用作者语言。',
  }),
  'scenes.previewing': contract('scenes.previewing', {
    objective: '为节点实际引用的场景自动生成并绑定参考图。',
    requiredInputs: [{ kind: 'scenes' }, { kind: 'outline' }],
    allowedToolNames: [...COMMON, tool('get-graph'), tool('list-assets'), tool('generate-scene-previews'), tool('validate-project')],
    mutationSequence: ['get-graph', 'list-assets', 'generate-scene-previews', 'validate-project', 'complete-activity'],
    hardChecks: ['scenes.references.ready'],
    stopConditions: ['场景目录或节点引用不匹配时停止', '超过系统自动生成上限时停止并报告', '生成失败时保留已成功场景并报告缺口'],
    domainGuide: '不需要用户确认。只为蓝图节点 scenes[] 实际引用的场景出图；目标集合由 Host 推导。'
      + '不得改用关键帧或视频工具绕过场景专用入口。',
  }),
  'rules.catalog': contract('rules.catalog', {
    objective: '把总脉络声明的实体与变量补成完整规则目录，并设计战斗与检定数值。',
    requiredInputs: [{ kind: 'outline' }],
    allowedToolNames: [...COMMON, tool('get-graph'), tool('list-ui-components'), tool('patch-rules'), tool('validate-project')],
    mutationSequence: ['get-graph', 'list-ui-components', 'patch-rules', 'validate-project', 'complete-activity'],
    hardChecks: ['rules.catalog.valid', 'rules.plan-formulas'],
    stopConditions: ['revision 冲突时重读', '引用无效时停止'],
    domainGuide: '先 `get_graph` 读每个节点的 `interaction` 玩法契约：它点名了要哪些公式、改哪个属性。'
      + '你的活就是把契约点名的公式与目标造出来（名字必须一致），再补它们依赖的实体属性与变量。'
      + '再 `list_ui_components` 确认这些数值会被哪个元件消费——'
      + '技能条的资源与消耗、血条的当前值与上限、QTE 的判定窗口，都要有对应的变量或公式承接。'
      + '没有任何元件或结算会用到的公式就是废稿（实测一局写了 43 个公式只用上 3 个）。'
      + '只写规则目录，不碰节点与边。一次相关变更使用一个原子 patch-rules。'
      + '新建变量 ID 只允许字母、数字与下划线且不能以数字开头；公式只能使用运行时支持的八个函数。',
    blueprintCapabilities: BLUEPRINT_AUTHORING_CAPABILITIES,
  }),
  'rules.binding': contract('rules.binding', {
    objective: '配置结算点：把规则目录绑定到节点和边的条件、效果、reaction 与结算时机。', requiredInputs: [{ kind: 'blueprint' }, { kind: 'rules' }],
    allowedToolNames: [...COMMON, tool('get-graph'), tool('configure-blueprint-node'), tool('patch-graph'), tool('list-ui-components'), tool('validate-project')], mutationSequence: ['get-graph', 'configure-blueprint-node', 'patch-graph', 'validate-project', 'complete-activity'],
    hardChecks: ['rules.bindings.valid', 'rules.settlement-ownership'],
    stopConditions: ['缺失规则引用时停止'],
    domainGuide: '先 get_graph 和 validate_project 审计 ui.authoring 已提交的界面路由与时间轴/条件结算；正常路径不得重复提交已完整节点。'
      + '界面事件负责隐藏/锁定输入并沿既有边进入结果视频，禁止直接修改数值。每个 interaction.actions[].effect 必须由 targetNodeId 结果节点中 sourcePillarActionId 对应的 at 结算应用；生命归零、资源阈值和后续门槛用 state/watch 结算。'
      + '只对校验确认存在缺口或错误绑定的节点调用 configure_blueprint_node：把该节点缺失的 trigger、effects、目标、界面动作，以及需要删除的旧事件 effect、旧动作、旧连线或旧结算，通过 additions/updates/removals 一次提交，不要逐动作调用。'
      + '只引用稳定规则 ID；不得复制或另建平行规则目录，不得新增自定义控件或改变 Overlay 目录结构。',
    blueprintCapabilities: BLUEPRINT_AUTHORING_CAPABILITIES,
  }),
  'ui.authoring': contract('ui.authoring', {
    objective: '制作节点界面：挂载 Host 已有的 base:* 控件或自定义模板，必要时先造缺失控件再组装成模板。', requiredInputs: [{ kind: 'blueprint' }, { kind: 'rules' }],
    allowedToolNames: [...COMMON, tool('get-graph'), tool('configure-blueprint-node'), tool('patch-graph'), tool('list-ui-components'), tool('upsert-component'), tool('validate-project')], mutationSequence: ['get-graph', 'upsert-component', 'configure-blueprint-node', 'patch-graph', 'validate-project', 'complete-activity'],
    hardChecks: ['ui.reuses-existing-overlays', 'ui.interactions.reachable', 'ui.event-routing-only'], stopConditions: ['交互入口不可达时停止', '基础目录缺少契约要求的能力时报告 blocker'],
    domainGuide: '挂载目录里任何 overlay（base:* 控件 / scheme:* 自定义模板）都可；不得创建 node:*、节点本地 child 或写 added/removed，不得写 children。'
      + 'rules.catalog 已经完成；每个节点的界面选择、组件属性、全部事件响应和已规划结算必须用一次 configure_blueprint_node 合并提交 interfaces、settlements、settlementUpdates 与 removals。不要逐组件、逐事件或逐结算调用，也不要用 set-node-data 拼完整或过滤后的 overlayNodes/reactions。每个引用必须是 get_graph 已返回的 overlay；'
      + '拆分界面时先把需求拆成组件清单，再对照 list_ui_components 判断哪些已有、哪些要新建：'
      + '例：战斗 HUD = 我方血条 + 敌方血条 + 技能条 + 回合倒计时，前三个已有内置控件直接复用，只有回合倒计时需 upsert-component 新建；'
      + '凡目录里已有功能等价的控件，一律直接复用，不得询问作者是否复用、不得另行造一个同功能新控件；'
      + '只有确无可用控件时才用 upsert-component 单控件形式造它，再用 upsert-component 的 compose 组装成模板；'
      + '原型子组件使用 width:1,height:1 的舞台型挂载必须显式写 { left:0, top:0, width:1, height:1 }，已有锚点或尺寸不得覆盖。'
      + '有 interaction.actions 时不得标记 not-required；基础目录缺能力就报告 blocker。'
      + '对照支柱与 interaction.actions：玩法用到的事件只接隐藏/锁定动作与既有 sourceHandle 出边，数值 effect 和伤害/增益飘字必须配置在 targetNodeId 结果节点的 at 结算；玩法不用的事件按元件 prompt 真正置灰；'
      + '删除或纠错时先从 get_graph 读取精确 mountId、edgeId、结算/动作序号与 expectedKind，再在 removals 中表达；卸载界面、移除事件动作/连线、删除结算或解除结算界面绑定都必须走这个事务，以复用节点面板的级联清理语义。'
      + 'event-unbound 是 warning，但看到后必须返工修掉。',
    blueprintCapabilities: BLUEPRINT_AUTHORING_CAPABILITIES,
  }),
  'game.finalizing': contract('game.finalizing', {
    objective: '把蓝图逻辑配置成真正可玩的整体：结算点、界面入口、实体绑定，'
      + '并把总脉络冻结的节点与出边设计编译成真实 reaction。',
    requiredInputs: [{ kind: 'pillar' }, { kind: 'outline' }, { kind: 'rules' }],
    allowedToolNames: [...COMMON, tool('inspect-project'), tool('get-graph'), tool('get-node-production-context'), tool('configure-blueprint-node'), tool('patch-graph'), tool('patch-rules'), tool('list-ui-components'), tool('validate-project')],
    mutationSequence: ['get-workflow-state', 'inspect-project', 'get-graph', 'list-ui-components', 'patch-rules-step', 'configure-blueprint-node', 'patch-non-design-fields', 'validate-project', 'complete-activity'],
    hardChecks: [
      'finalization.settlements-complete',
      'finalization.terminal-outcomes-valid',
      'finalization.rule-bindings-valid',
      'finalization.expressions-compile',
      'finalization.required-ui-complete',
      'finalization.interactions-reachable',
      'finalization.no-unresolved-placeholder',
      'finalization.work-scale-budget',
      // 复核总脉络冻结的每个非 default 分支都有路径或状态后果。
      'graph.choice-consequence',
      // 契约落地：每条动作的元件挂了没、结算接了没、出口在不在、终局判了没。
      'finalization.plan-wired',
      'finalization.state-lifecycle',
      'finalization.outcome-proof',
      'finalization.causal-quality',
      // warn 级：语言漂移与「设计了但没接上的公式」在这里被看见，但不阻塞完成。
      'content.language-consistency',
      'content.formula-usage',
      'content.ending-presence',
    ],
    stopConditions: ['不得生成图片、关键帧或视频', '不得写 interaction 或 edge.data.design', '玩法或故事因果缺口必须返工支柱/总脉络'],
    domainGuide: '这是可玩 blueprint.json 逻辑的最终组装活动。先 get_workflow_state、inspect_project、get_graph 和 list_ui_components，建立逐节点覆盖清单：界面挂载、组件绑定、事件出口、结算、终局/失败结果。'
      + '调用节点事务前先核对 outlineDesignSnapshot；节点、目标节点、主干边、事件边、edge.data.design 和 outcomeEvidence 必须已由 blueprint.outline 完整给出。缺失时返工总脉络，不得在整装补造。再用 patch_rules 补齐 effect 将引用的实体、变量与公式 ID。'
      + 'interaction 与 edge.data.design 是作者确认设计，不属于整装写域；本阶段只把它们编译成真实界面、reaction、settlement 和边引用。'
      + '每个节点的新增、修改和删除意图全部规划完整后，只调用一次 configure_blueprint_node，合并提交 interfaces、settlements、settlementUpdates 与 removals；不得逐组件、逐事件或逐结算拆调用，不得用 patch_graph 写完整或过滤后的 overlayNodes/reactions。'
      + '纠错删除前必须从最新 get_graph 读取 mountId、edgeId、结算/动作序号与 expectedKind；卸载界面、删除事件响应/动作/连线、删除结算、解除结算界面绑定都走 removals。结算更新与结算/动作删除不要放在同一请求，提交后重读再做下一笔。'
      + '多节点可以并行规划，但写同一蓝图必须串行提交；每次成功沿用响应中的最新 revision，revision 冲突后重新 get_graph 并重建尚未提交的节点事务。'
      + '全部节点提交后调用 validate_project，按 failedPath 或校验问题定点修复；只有该事务未覆盖且不属于冻结设计面的字段才用 patch_graph。'
      + '闭合终局与失败分支、统一润色章节文案，然后跑蓝图逻辑校验。'
      + '角色/场景目录、参考图与节点视频预设属于独立资产支线，不得作为本活动完成条件。缺口一次性取全，不要逐轮试探。'
      + '总脉络给的节点和连线是已确认设计，不是整装草稿；整装只把 producer 绑定到既有边。若真实界面或结算能力无法编译某条边，必须返工支柱或总脉络。'
      + '所有非 default 出口仍必须产生不同目标，或写入会被后续逻辑消费的状态后果；多个出口立即合流且无后果时必须返工。'
      + '这一步过了才是真正可玩的蓝图。',
    blueprintCapabilities: BLUEPRINT_AUTHORING_CAPABILITIES,
  }),
  'assets.character': contract('assets.character', {
    objective: '核对必需角色参考图，并补齐缺失或因角色设定返工而过期的预览。', requiredInputs: [{ kind: 'characters' }],
    allowedToolNames: [...COMMON, tool('get-graph'), tool('list-assets'), tool('import-character-refs'), tool('generate-character-previews'), tool('validate-project')], mutationSequence: ['inspect', 'import-or-generate-gaps', 'validate-project', 'complete-activity'],
    hardChecks: ['characters.references.ready'], stopConditions: ['角色目录或节点 cast 不完整时停止', '生成失败时报告 blocker'], domainGuide: '不需要用户确认。首次批量生成应已在 characters.previewing 完成；这里只自动补缺口或过期项，节点成片仍不得由 Agent 提交。',
  }),
  'assets.scene': contract('assets.scene', {
    objective: '核对必需场景参考图，并补齐缺失或因场景设定返工而过期的预览；交付后也可新建仅资产库场景并出图。', requiredInputs: [{ kind: 'scenes' }],
    allowedToolNames: [...COMMON, tool('get-graph'), tool('list-assets'), tool('patch-scenes'), tool('import-scene-refs'), tool('generate-scene-previews'), tool('validate-project')], mutationSequence: ['inspect', 'import-or-generate-gaps', 'validate-project', 'complete-activity'],
    hardChecks: ['scenes.references.ready'], stopConditions: ['场景目录或节点引用不完整时停止', '生成失败时报告 blocker'], domainGuide: '不需要用户确认。只补缺口或 sourcePromptHash 已变的过期项；交付后可用 patch_scenes 新建 source=catalog 的仅资产库场景并出图，不得改蓝图节点。',
  }),
  'video.presets.binding': contract('video.presets.binding', {
    objective: '依据总脉络蓝图节点结构与剧情梗概，为各节点绑定视频生成预设与提示词。',
    requiredInputs: [{ kind: 'outline' }],
    allowedToolNames: [...COMMON, tool('get-graph'), tool('get-node-production-context'), tool('patch-node-media'), tool('validate-project')],
    mutationSequence: ['get-graph', 'get-node-production-context', 'patch-node-media', 'validate-project', 'complete-activity'],
    hardChecks: ['video.presets.bound', 'video.presets.binding-receipt'],
    stopConditions: ['蓝图总脉络未完成时停止', '不得创建 Kino job'],
    domainGuide: '只用 patch_node_media 写 node.data.media.prompt / generation / provider-neutral references。'
      + '请求必须绑定 get_graph 返回的 graph revision/snapshot 与幂等键，不依赖角色/场景出图与汇总整装；'
      + '参考图尚未 ready 时用 t2v、references 可空，禁止为此改角色/场景目录或 patch_graph。'
      + 'prompt 必须是可拍摄的多句镜头词（出场、动作、机位、光影），不得只复述章节名；Host 已编译的 video.prompt / suggestedPrompt 应沿用或加长。'
      + '不得用 patch_graph 写媒体预设，不得创建 Kino job。',
  }),
  'video.presets.validating': contract('video.presets.validating', {
    objective: '逐节点校验已写入蓝图的视频预设，确认参数完整可用。', requiredInputs: [{ kind: 'video-preset-bindings' }],
    allowedToolNames: [...COMMON, tool('get-node-production-context'), tool('validate-project')], mutationSequence: ['get-node-production-context', 'validate-project', 'complete-activity'],
    hardChecks: ['video.presets.ready-to-submit'], stopConditions: ['引用未就绪时返回可导航缺口'], domainGuide: '只准备预设，不创建 Kino job。',
  }),
  'playtest.validating': contract('playtest.validating', {
    objective: '对编译产出的蓝图做只读可玩性复核：通过即交付，不通过即报告缺口，不在本活动内改图。',
    requiredInputs: [{ kind: 'blueprint' }, { kind: 'video-presets', optional: true }],
    // 只读：蓝图是支柱的确定性编译产物，手改它会让编译器保证过的连通性与结算失效。
    // 实测一局里 140 次 configure_blueprint_node + 40 次 patch_graph 把一张 21 边
    // 全可达的图改成 14 边、仅入口可达，审查随即报出 50 条错误。
    // 审查期间固定聚焦蓝图；不给 focus_page，避免模型把“模拟运行”解释为打开试玩页。
    allowedToolNames: [
      tool('get-workflow-state'),
      tool('complete-activity'),
      tool('report-blocker'),
      tool('get-graph'),
      tool('inspect-project'),
      tool('validate-project'),
      tool('list-ui-components'),
    ],
    mutationSequence: ['get-graph', 'inspect-project', 'validate-project', 'complete-activity'],
    // 生成终点的权威可玩性硬门：数据合法性 + 玩法合理性（见 validation-check-groups.ts），
    // 由 validate_project / complete_activity 展开为叶子 check 取证并硬拦截。
    hardChecks: [
      'blueprint.data.valid',
      'playtest.playability.valid',
    ],
    stopConditions: ['不得打开试玩页', '不得提交节点视频', '不得手工改写蓝图'],
    domainGuide: '这是只读复核，不是修复面。蓝图是支柱的确定性编译产物，'
      + '同一套可玩性检查在支柱确认门已经跑过一遍；本阶段只确认交付物仍与那次通过的编译结果一致。'
      + '调用 validate_project 取证（blueprint.data.valid：结构/出边/形状；'
      + 'playtest.playability.valid：路径不非法卡死 + 规则可执行 + 数值合理），通过就 complete_activity 交付。'
      + '你没有 patch_graph / configure_blueprint_node / patch_rules，不要尝试调用：'
      + '手改编译产物会让编译器保证过的连通性和结算失效，产生的新错误远多于修掉的。'
      + '校验失败说明编译输入或编译器有缺陷，不是这一关能补的：调用 report_blocker 交回上游，'
      + '由作者决定是否重做支柱并整份重编译。禁止 begin 编译阶段。'
      + '通过后只可表达「可玩蓝图已交付，节点视频可由作者逐个制作或上传」，不得声称所有视频或完整影游已经完成。',
    blueprintCapabilities: BLUEPRINT_AUTHORING_CAPABILITIES,
  }),
})

export function activityContract(activity: VideoGameActivity): ActivityContract {
  return ACTIVITY_CONTRACTS[activity]
}
