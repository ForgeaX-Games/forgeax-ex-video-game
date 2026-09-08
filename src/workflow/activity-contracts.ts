import type { ActivityContract, ProductPhase, VideoGameActivity, PageLocation } from './contracts'

const EXTENSION_TOOL_PREFIX = 'mcp__as-mate-tools__extension__game_video__'
const COMMON = [`${EXTENSION_TOOL_PREFIX}get_workflow_state`, `${EXTENSION_TOOL_PREFIX}await_user`, `${EXTENSION_TOOL_PREFIX}complete_activity`, `${EXTENSION_TOOL_PREFIX}report_blocker`, `${EXTENSION_TOOL_PREFIX}focus_page`]

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
  'rules.catalog': { kind: 'rule', section: 'entities' },
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

const DOC_TOOLS = [...COMMON, `${EXTENSION_TOOL_PREFIX}upsert_document`]

export const ACTIVITY_CONTRACTS: Record<VideoGameActivity, ActivityContract> = {
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
    hardChecks: ['document.design-options.ready', 'document.design-options.options'], stopConditions: ['写出三个方向后停止；选择门由进入 pillar 时的外部 Author Gate 证据校验'], domainGuide: '以 design-options 协议写入三个方向；三个方向必须在核心循环和叙事冲突上可辨别。',
  }),
  'document.pillar': contract('document.pillar', {
    objective: '形成可驱动总脉络、规则、角色、场景与界面的游戏支柱。', requiredInputs: [{ kind: 'core' }, { kind: 'brief' }, { kind: 'inquiry' }],
    allowedToolNames: DOC_TOOLS, mutationSequence: ['upsert-document', 'await-pillar-gate', 'complete-activity'],
    hardChecks: ['document.pillar.ready'], stopConditions: ['文档 ready 后停止；批准门由进入 blueprint.outline 时的外部 Author Gate 证据校验'], domainGuide: '支柱必须明确叙事、互动、规则和界面契约。'
      + '每个互动节拍都要写清玩家动作、可选分支、状态变化或后果去处；不要只写“这里有战斗/选择”。'
      + '这些是下游 blueprint.outline 的唯一玩法来源，不能让总脉络或整装自行补写作者未确认的分支。',
  }),
  'blueprint.outline': contract('blueprint.outline', {
    objective: '依据支柱与故事剧本定出游戏总脉络：蓝图树（节点、边、抉择、章节梗概）。',
    requiredInputs: [{ kind: 'pillar' }],
    // 只写蓝图树：角色、场景、规则都是下游产物，节点上的引用由汇总整装回填。
    // 这样总脉络不必等下游分配内容，下游也不必等它分配 ID。
    allowedToolNames: [...COMMON, `${EXTENSION_TOOL_PREFIX}get_graph`, `${EXTENSION_TOOL_PREFIX}list_ui_components`, `${EXTENSION_TOOL_PREFIX}patch_graph`, `${EXTENSION_TOOL_PREFIX}validate_project`],
    mutationSequence: ['get-graph', 'list-ui-components', 'patch-graph', 'validate-project', 'complete-activity'],
    hardChecks: [
      'outline.graph-connected',
      'outline.choice-consequence',
      'outline.node-summary-complete',
      'outline.node-count-matches-scale',
      'outline.declarations-complete',
      'outline.declaration-budget',
      // 玩法契约：每个节点都要表态观众能做什么，这是三条线唯一的共享设计。
      'outline.interaction-plan',
    ],
    stopConditions: ['不得生成任何图片或视频', '声明规模超过系统上限时停止并报告'],
    // 不在这里碰角色与场景：节点 cast / scenes 的绑定属于汇总整装。
    // 真跑证据：一次性又要出树又要出声明，会让模型连续三轮纯推理不落笔。
    domainGuide: '只写骨架：节点、边、抉择、章节梗概。节点 ID 在这里分配并保证稳定。'
      + '规划分支前先 `list_ui_components`：节点除 default 外的每个出口 handle 都来自挂载元件的事件或者结算的出边，'
      + '边的 sourceHandle 必须对齐某个元件事件 id，否则这条分支玩家永远走不到。'
      + '先从支柱逐节点转录互动节拍：每个玩家动作都写入 interaction.actions，填真实 component/event、作者语言 intent，'
      + '并至少声明 effect 或 exit 一个后果；如果支柱没有确认动作与后果，先停下报告缺口，不要等整装猜。'
      + '你只定“这里要玩家做什么、走向哪个节点”，元件的挂载与绑数据是汇总整装的活。',
  }),
  'characters.modeling': contract('characters.modeling', {
    objective: '把总脉络声明的角色补成完整定义：外观描述与预览 Prompt。',
    requiredInputs: [{ kind: 'outline' }],
    allowedToolNames: [...COMMON, `${EXTENSION_TOOL_PREFIX}get_graph`, `${EXTENSION_TOOL_PREFIX}patch_characters`, `${EXTENSION_TOOL_PREFIX}validate_project`],
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
    allowedToolNames: [...COMMON, `${EXTENSION_TOOL_PREFIX}get_graph`, `${EXTENSION_TOOL_PREFIX}list_assets`, `${EXTENSION_TOOL_PREFIX}generate_character_previews`, `${EXTENSION_TOOL_PREFIX}validate_project`],
    mutationSequence: ['get-graph', 'list-assets', 'generate-character-previews', 'validate-project', 'complete-activity'],
    hardChecks: ['characters.references.ready'],
    stopConditions: ['角色目录、节点 cast 或活动 revision 不匹配时停止', '超过系统自动生成上限时停止并报告建模异常', '生成失败时保留已成功角色并报告缺口'],
    domainGuide: '不需要用户确认。只为至少一个节点 cast 中 onScreen !== false 的角色出图；纯规则实体不出图。'
      + '目标集合由 Host 从蓝图引用推导，不得自行扩大。',
  }),
  'scenes.modeling': contract('scenes.modeling', {
    objective: '把总脉络声明的场景补成完整定义：视觉描述与图片 Prompt。',
    requiredInputs: [{ kind: 'outline' }],
    allowedToolNames: [...COMMON, `${EXTENSION_TOOL_PREFIX}get_graph`, `${EXTENSION_TOOL_PREFIX}patch_scenes`, `${EXTENSION_TOOL_PREFIX}validate_project`],
    mutationSequence: ['get-graph', 'patch-scenes', 'validate-project', 'complete-activity'],
    hardChecks: ['scenes.catalog.valid', 'scenes.count-matches-scale'],
    stopConditions: ['场景引用无效时停止', '不得新增总脉络未声明的场景'],
    domainGuide: '只写场景目录，不碰节点与边。场景与角色完全对称：这里只做设定，出图在 scenes.previewing。'
      + '图片 Prompt 使用作者语言。',
  }),
  'scenes.previewing': contract('scenes.previewing', {
    objective: '为节点实际引用的场景自动生成并绑定参考图。',
    requiredInputs: [{ kind: 'scenes' }, { kind: 'outline' }],
    allowedToolNames: [...COMMON, `${EXTENSION_TOOL_PREFIX}get_graph`, `${EXTENSION_TOOL_PREFIX}list_assets`, `${EXTENSION_TOOL_PREFIX}generate_scene_previews`, `${EXTENSION_TOOL_PREFIX}validate_project`],
    mutationSequence: ['get-graph', 'list-assets', 'generate-scene-previews', 'validate-project', 'complete-activity'],
    hardChecks: ['scenes.references.ready'],
    stopConditions: ['场景目录或节点引用不匹配时停止', '超过系统自动生成上限时停止并报告', '生成失败时保留已成功场景并报告缺口'],
    domainGuide: '不需要用户确认。只为蓝图节点 scenes[] 实际引用的场景出图；目标集合由 Host 推导。'
      + '不得改用关键帧或视频工具绕过场景专用入口。',
  }),
  'rules.catalog': contract('rules.catalog', {
    objective: '把总脉络声明的实体与变量补成完整规则目录，并设计战斗与检定数值。',
    requiredInputs: [{ kind: 'outline' }],
    allowedToolNames: [...COMMON, `${EXTENSION_TOOL_PREFIX}get_graph`, `${EXTENSION_TOOL_PREFIX}list_ui_components`, `${EXTENSION_TOOL_PREFIX}patch_rules`, `${EXTENSION_TOOL_PREFIX}validate_project`],
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
  }),
  'rules.binding': contract('rules.binding', {
    objective: '配置结算点：把规则目录绑定到节点和边的条件、效果、reaction 与结算时机。', requiredInputs: [{ kind: 'blueprint' }, { kind: 'rules' }],
    allowedToolNames: [...COMMON, `${EXTENSION_TOOL_PREFIX}get_graph`, `${EXTENSION_TOOL_PREFIX}patch_graph`, `${EXTENSION_TOOL_PREFIX}list_ui_components`, `${EXTENSION_TOOL_PREFIX}validate_project`], mutationSequence: ['get-graph', 'patch-graph', 'validate-project', 'complete-activity'],
    hardChecks: ['rules.bindings.valid'],
    stopConditions: ['缺失规则引用时停止'],
    domainGuide: '只引用稳定规则 ID；不得复制或另建平行规则目录。明确每处结算的时机、参与变量与写回目标。'
      + 'ui.authoring 先挂载 base:* 原型；本活动可以在已有挂载上写 overlay reactions，把规则 effect 接到 UI 事件，'
      + '但不得新增自定义控件或改变 Overlay 目录结构。',
  }),
  'ui.authoring': contract('ui.authoring', {
    objective: '制作节点界面：挂载 Host 已有的 base:* 控件或自定义模板，必要时先造缺失控件再组装成模板。', requiredInputs: [{ kind: 'blueprint' }, { kind: 'rules' }],
    allowedToolNames: [...COMMON, `${EXTENSION_TOOL_PREFIX}get_graph`, `${EXTENSION_TOOL_PREFIX}patch_graph`, `${EXTENSION_TOOL_PREFIX}list_ui_components`, `${EXTENSION_TOOL_PREFIX}upsert_component`, `${EXTENSION_TOOL_PREFIX}validate_project`], mutationSequence: ['get-graph', 'upsert-component', 'patch-graph', 'validate-project', 'complete-activity'],
    hardChecks: ['ui.reuses-existing-overlays', 'ui.interactions.reachable'], stopConditions: ['交互入口不可达时停止', '基础目录缺少契约要求的能力时报告 blocker'],
    domainGuide: '挂载目录里任何 overlay（base:* 控件 / scheme:* 自定义模板）都可；不得创建 node:*、节点本地 child 或写 added/removed，不得写 children。'
      + '只用 set-node-data 写完整 overlayNodes，每个引用必须是 get_graph 已返回的 overlay；'
      + '拆分界面时先把需求拆成组件清单，再对照 list_ui_components 判断哪些已有、哪些要新建：'
      + '例：战斗 HUD = 我方血条 + 敌方血条 + 技能条 + 回合倒计时，前三个已有内置控件直接复用，只有回合倒计时需 upsert-component 新建；'
      + '凡目录里已有功能等价的控件，一律直接复用，不得询问作者是否复用、不得另行造一个同功能新控件；'
      + '只有确无可用控件时才用 upsert-component 单控件形式造它，再用 upsert-component 的 compose 组装成模板；'
      + '原型子组件使用 width:1,height:1 的舞台型挂载必须显式写 { left:0, top:0, width:1, height:1 }，已有锚点或尺寸不得覆盖。'
      + '有 interaction.actions 时不得标记 not-required；基础目录缺能力就报告 blocker。'
      + '对照支柱与 interaction.actions：玩法用到的事件接 reaction 或 sourceHandle，玩法不用的事件按元件 prompt 真正置灰；'
      + 'event-unbound 是 warning，但看到后必须返工修掉。',
  }),
  'game.finalizing': contract('game.finalizing', {
    objective: '把蓝图逻辑配置成真正可玩的整体：结算点、界面入口、实体绑定，'
      + '并按这些配置调整节点连线与出边。',
    requiredInputs: [{ kind: 'pillar' }, { kind: 'outline' }, { kind: 'rules' }],
    allowedToolNames: [...COMMON, `${EXTENSION_TOOL_PREFIX}inspect_project`, `${EXTENSION_TOOL_PREFIX}get_graph`, `${EXTENSION_TOOL_PREFIX}get_node_production_context`, `${EXTENSION_TOOL_PREFIX}patch_graph`, `${EXTENSION_TOOL_PREFIX}patch_rules`, `${EXTENSION_TOOL_PREFIX}list_ui_components`, `${EXTENSION_TOOL_PREFIX}validate_project`],
    mutationSequence: ['get-workflow-state', 'inspect-project', 'get-graph', 'patch-graph-step', 'patch-rules-step', 'validate-project', 'complete-activity'],
    hardChecks: [
      'finalization.settlements-complete',
      'finalization.terminal-outcomes-valid',
      'finalization.rule-bindings-valid',
      'finalization.expressions-compile',
      'finalization.required-ui-complete',
      'finalization.interactions-reachable',
      'finalization.no-unresolved-placeholder',
      'finalization.work-scale-budget',
      // 整装会调整出边；调整后仍必须保证每个非 default 分支有路径或状态后果。
      'graph.choice-consequence',
      // 契约落地：每条动作的元件挂了没、结算接了没、出口在不在、终局判了没。
      'finalization.plan-wired',
      // warn 级：语言漂移与「设计了但没接上的公式」在这里被看见，但不阻塞完成。
      'content.language-consistency',
      'content.formula-usage',
      'content.ending-presence',
    ],
    stopConditions: ['不得生成图片、关键帧或视频', '仅图片/视频生成、作者决策或控件源码缺口时报告 blocker'],
    domainGuide: '这是可玩 blueprint.json 逻辑的最终组装活动：可以直接配置 graph 的逻辑节点、边与节点字段，'
      + '配置 ui 的 overlay 目录、挂载、子组件与 reactions，并通过 patch_rules 修正 entities / variables / formulas。'
      + '闭合终局与失败分支、统一润色章节文案，然后跑蓝图逻辑校验。'
      + '角色/场景目录、参考图与节点视频预设属于独立资产支线，不得作为本活动完成条件。缺口一次性取全，不要逐轮试探。'
      + '总脉络给的连线是结构初稿：结算时机、界面入口与实体绑定都会牵动出边，'
      + '需要改连线就直接改（写域含 graph、ui、rules），但所有非 default 出口仍必须产生不同目标，'
      + '或写入会被后续逻辑消费的状态后果；多个出口立即合流且无后果时必须返工。'
      + '这一步过了才是真正可玩的蓝图。',
  }),
  'assets.character': contract('assets.character', {
    objective: '核对必需角色参考图，并补齐缺失或因角色设定返工而过期的预览。', requiredInputs: [{ kind: 'characters' }],
    allowedToolNames: [...COMMON, `${EXTENSION_TOOL_PREFIX}get_graph`, `${EXTENSION_TOOL_PREFIX}list_assets`, `${EXTENSION_TOOL_PREFIX}import_character_refs`, `${EXTENSION_TOOL_PREFIX}generate_character_previews`, `${EXTENSION_TOOL_PREFIX}validate_project`], mutationSequence: ['inspect', 'import-or-generate-gaps', 'validate-project', 'complete-activity'],
    hardChecks: ['characters.references.ready'], stopConditions: ['角色目录或节点 cast 不完整时停止', '生成失败时报告 blocker'], domainGuide: '不需要用户确认。首次批量生成应已在 characters.previewing 完成；这里只自动补缺口或过期项，节点成片仍不得由 Agent 提交。',
  }),
  'assets.scene': contract('assets.scene', {
    objective: '核对必需场景参考图，并补齐缺失或因场景设定返工而过期的预览；交付后也可新建仅资产库场景并出图。', requiredInputs: [{ kind: 'scenes' }],
    allowedToolNames: [...COMMON, `${EXTENSION_TOOL_PREFIX}get_graph`, `${EXTENSION_TOOL_PREFIX}list_assets`, `${EXTENSION_TOOL_PREFIX}patch_scenes`, `${EXTENSION_TOOL_PREFIX}import_scene_refs`, `${EXTENSION_TOOL_PREFIX}generate_scene_previews`, `${EXTENSION_TOOL_PREFIX}validate_project`], mutationSequence: ['inspect', 'import-or-generate-gaps', 'validate-project', 'complete-activity'],
    hardChecks: ['scenes.references.ready'], stopConditions: ['场景目录或节点引用不完整时停止', '生成失败时报告 blocker'], domainGuide: '不需要用户确认。只补缺口或 sourcePromptHash 已变的过期项；交付后可用 patch_scenes 新建 source=catalog 的仅资产库场景并出图，不得改蓝图节点。',
  }),
  'video.presets.binding': contract('video.presets.binding', {
    objective: '依据总脉络蓝图节点结构与剧情梗概，为各节点绑定视频生成预设与提示词。',
    requiredInputs: [{ kind: 'outline' }],
    allowedToolNames: [...COMMON, `${EXTENSION_TOOL_PREFIX}get_graph`, `${EXTENSION_TOOL_PREFIX}get_node_production_context`, `${EXTENSION_TOOL_PREFIX}patch_node_media`, `${EXTENSION_TOOL_PREFIX}validate_project`],
    mutationSequence: ['get-graph', 'get-node-production-context', 'patch-node-media', 'validate-project', 'complete-activity'],
    hardChecks: ['video.presets.bound', 'video.presets.binding-receipt'],
    stopConditions: ['蓝图总脉络未完成时停止', '不得创建 Kino job'],
    domainGuide: '只用 patch_node_media 写 node.data.media.prompt / generation / provider-neutral references。'
      + '请求必须绑定 get_graph 返回的 graph revision/snapshot 与幂等键，不依赖角色/场景出图与汇总整装；'
      + '不得用 patch_graph 写媒体预设，不得创建 Kino job。',
  }),
  'video.presets.validating': contract('video.presets.validating', {
    objective: '逐节点校验已写入蓝图的视频预设，确认参数完整可用。', requiredInputs: [{ kind: 'video-preset-bindings' }],
    allowedToolNames: [...COMMON, `${EXTENSION_TOOL_PREFIX}get_node_production_context`, `${EXTENSION_TOOL_PREFIX}validate_project`], mutationSequence: ['get-node-production-context', 'validate-project', 'complete-activity'],
    hardChecks: ['video.presets.ready-to-submit'], stopConditions: ['引用未就绪时返回可导航缺口'], domainGuide: '只准备预设，不创建 Kino job。',
  }),
  'playtest.validating': contract('playtest.validating', {
    objective: '执行蓝图可玩性审查：快速复核交互路径、规则结算与基础合法性，再把可玩蓝图交还作者。',
    requiredInputs: [{ kind: 'blueprint' }, { kind: 'video-presets', optional: true }],
    // 审查期间固定聚焦蓝图；不给 focus_page，避免模型把“模拟运行”解释为打开试玩页。
    allowedToolNames: [
      `${EXTENSION_TOOL_PREFIX}get_workflow_state`,
      `${EXTENSION_TOOL_PREFIX}complete_activity`,
      `${EXTENSION_TOOL_PREFIX}report_blocker`,
      `${EXTENSION_TOOL_PREFIX}get_graph`,
      `${EXTENSION_TOOL_PREFIX}inspect_project`,
      `${EXTENSION_TOOL_PREFIX}validate_project`,
    ],
    mutationSequence: ['get-graph', 'inspect-project', 'validate-project', 'complete-activity'],
    // 生成终点的权威可玩性硬门：数据合法性 + 玩法合理性（见 validation-check-groups.ts），
    // 由 validate_project / complete_activity 展开为叶子 check 取证并硬拦截。
    hardChecks: [
      'blueprint.data.valid',
      'playtest.playability.valid',
    ],
    stopConditions: ['不得在本活动内改内容', '不得打开试玩页', '不得提交节点视频'],
    domainGuide: '这是 Agent 创作流程的终点。'
      + '本阶段调用 validate_project 做一次权威可玩性校验（blueprint.data.valid：结构/出边/形状；'
      + 'playtest.playability.valid：路径不非法卡死 + 规则可执行 + 数值合理），'
      + '通过后再 complete_activity 交付可玩蓝图；校验不过时按 failedChecks 修复后重试，不得跳过。'
      + '若 complete_activity 连续因硬门被拒超过 2 次，Host 会在下一次放行（waivedAfterRetries）以便下游继续验证，'
      + '此时仍须如实报告 evidence 中的未通过项，不得声称蓝图已完全合法。'
      + '通过后只可表达「可玩蓝图已交付，节点视频可由作者逐个制作或上传」，不得声称所有视频或完整影游已经完成。',
  }),
}

export function activityContract(activity: VideoGameActivity): ActivityContract {
  return ACTIVITY_CONTRACTS[activity]
}
