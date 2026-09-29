---
name: game-video:author-guide
description: 视频游戏（玩法优先）蓝图编辑、素材生成与运行时调用指南
trigger: /game-video
---

# 视频游戏工坊 · AI Skill

`@forgeax-extension/game-video` 编辑和运行 `GraphLibraryDocument`。根 `graph` 是运行入口，`manifest.mainPackId` 指向主蓝图，`manifest.packs` 保存主/子蓝图。修改后应通过 `src/runtime/validate/validate.ts` 校验。

## 工具

| tool id | 用途 |
|---|---|
| `game-video:get-graph` | 读取当前游戏的完整蓝图；无文件时返回 `project: null` |
| `game-video:save-graph` | 仅供编辑器 UI 覆盖写入 `blueprint.json`；不向 AI 暴露 |
| `game-video:patch-graph` | AI 增量改图；顺序应用 `ops`，失败时整批不写盘 |
| `game-video:configure-blueprint-node` | 按人工配置语义，一次原子增删改某节点的界面、组件属性、事件响应、连线与结算 |
| `game-video:patch-rules` | 批量维护实体 / 属性 / 变量 / 公式；与改图共享文档锁和 revision |
| `game-video:generate-character-previews` | 无需用户确认，按屏幕 cast 自动批量生成并绑定角色参考图 |
| `game-video:list-videos` | 列出扩展内置演出视频；当前无内置库，返回空列表 |
| `game-video:generate-shot-script` | 为节点生成镜头脚本文本 |
| `game-video:generate-keyframe` | 生成关键帧或分镜图并登记素材 |
| `game-video:generate-video` | 生成不超过 15 秒的单段视频 |
| `game-video:generate-video-clip` | 直接生成不绑定节点的视频素材 |
| `game-video:generate-node-video` | 为长节点拆段并连续生成视频 |
| `game-video:list-assets` | 按类型、生产方式或节点查询共享素材 |
| `game-video:get-asset` | 查询一条素材的状态、文件或错误 |
| `game-video:import-character-refs` | 只读导入角色参考图 |
| `game-video:import-scene-refs` | 只读导入场景参考图 |
| `game-video:upsert-component` | 在当前真实游戏项目中生成或更新基础控件代码与 manifest |

## 编辑闭环

```text
game-video:get-graph({})            // 返回 { project, assetEntities, revision }
  → list-ui-components 确认组件 inputs / events
  → configure-blueprint-node 原子增删改每个节点的界面、事件连线与结算
  → patch-graph 只补图拓扑和聚合工具未覆盖的字段
```

### 文档修订号（乐观锁）

`get-graph` 返回服务端权威 `revision`（旧蓝图未戳过时为 `0`）。写入时把它作为
`expectedRevision` 传回：

- 文档在你读取之后被别人改过 → 整批不写盘，返回 `ok: false`、`errorCode: "revision.conflict"`
  和当前 `revision`。此时必须重新 `get-graph`，基于最新内容重建 ops，**不要**原样重试，
  否则会覆盖用户刚做的修改。
- 成功时返回写入后的 `revision`，可直接作为下一批的 `expectedRevision`。
- 省略 `expectedRevision` 等于盲写；只在确知没有并发编辑（例如刚初始化的空壳）时才这样做。
- Agent mutation 同时传稳定 `idempotencyKey`。同 key + 同内容会重放原成功结果且不再次递增
  revision；同 key + 不同内容返回 `idempotency.conflict`，必须换新 key，不能覆盖旧 receipt。
- mutation 成功结果统一带 `schemaVersion`、`artifactRef`、`validation` 和语义 `uiHint`；
  `patch-rules` 的最终 rule ids 位于 `results`（兼容字段）与 `data.results`。

如果 `get-graph` 返回 `project: null`，说明 Host 尚未初始化 empty library seed。向编排层报错并停止——你无法 `save-graph`，不得编造整本 `GraphLibraryDocument` 或 Write/Edit `blueprint.json`。搭建最小可玩骨架的前提是盘上已有 Host empty seed（单 `entry` 节点）。
AI 改图只使用 `configure-blueprint-node`、`patch-graph` 等专用 mutation 工具，不要拼接整本 `project`
调用 `save-graph`。游戏身份始终来自宿主绑定；
所有 AI 工具都不接受 `gameSlug` 或其它游戏选择参数。

## 节点原子整装

同一节点的“添加界面 → 配置组件属性 → 配置事件响应”和“添加时间轴/条件结算 → 配置动作”是完整领域事务；
移除界面、事件响应/动作/连线、整条结算或结算动作也属于同一个事务入口。优先用一次
`configure-blueprint-node` 同时提交该节点的 `interfaces[]`、`settlements[]`、`settlementUpdates[]` 与 `removals`：Host 会生成 mount/edge id，
复用前端 authoring 原子方法维护 reaction/advance/edge 引用，并在同一锁、revision、幂等 receipt 和整本校验中落盘。
不要为了读取中间 mountId 或 edgeId 把这段流程拆成多轮调用；成功结果会返回 mounts、metrics 和 reusedPrimitives。

### 策划到执行的能力认知

`get-workflow-state` / `begin-activity` 返回的 `activityContract.blueprintCapabilities` 是各阶段共享的蓝图能力边界。
它描述平台能表达的图拓扑、界面事件、状态效果、跳转时机、时间轴/条件结算和节点事务，不代表当前阶段都有写权限。
每轮必须读取其中的 `registryVersion` 与完整 `operations[]`：按用户意图匹配稳定 capability `id`，再使用该项
发布的 `agent.tool`、`agent.operations` 或 `agent.schemaPaths`。这是当前能力的唯一事实源；不要依赖旧对话或
本 Skill 的示例 op 清单覆盖运行时契约。找不到匹配 capability 时报告能力缺口，不得编造 op 或整体 patch 数组。
支柱与总脉络还要读取 `interactionPatterns`、`nodeTransaction.settlementPatterns` 和
`list-ui-components.components[].gameplaySemantics`；它们说明控件与结算如何组合成状态、反馈和剧情因果。

支柱必须产出 `pillar-interaction-contract`。总脉络的非叙事节点用 `sourcePillarBeatId` 追踪 beat，每条 action / settlement
还必须写 `sourcePillarActionId` / `sourcePillarSettlementId`；动作与结算用 `feedbackSpec` 指定真实反馈组件/绑定/隐藏动作，
结算再用 `triggerSpec` 给出精确 runtime trigger。

新支柱契约使用 `schemaVersion: 3`，每个 action 以 `stateMutationOwner: "settlement" | "none"` 明确是否修改持久状态，
并以 `requiredRole` 或 `capabilityGap` 声明组件承载能力。
提交前按「有动作的节拍数 + 已配对 settlement 动作数」核算最小主图节点；超过篇幅上限或短篇/中篇/长篇没有 `combat-command` 时，`upsert_document` / `document.pillar.ready` 会失败，不要把不可执行的支柱交给作者确认。
数值玩法固定按以下因果链施工：组件事件只隐藏/锁定输入并沿既有边进入独立结果视频节点；目标节点使用
`sourcePillarActionId` 对应的 `at` 结算，在命中/恢复帧应用生命、怒气、气力、关系值等 effect 与伤害/增益飘字；
生命归零、资源阈值和后续门槛用 `state/watch` 结算。支柱 settlement 用 `sourceActionId` 关联动作，总脉络 Host
会物化为 `sourcePillarActionId`。禁止把数值 effect 直接放进源界面的 event response，也禁止用自环节点冒充下游结果视频。
总脉络先向 `create-blueprint-outline-skeleton` 一次提交全部节点的稳定 ID、支柱节拍和类型，让完整节点树立即在
画布可见；随后按 `pendingNodeIds` 逐个调用 `configure-blueprint-outline-node`，每次只提交一个节点的玩法契约和
outgoingRoutes。Host 根据 producer 自动生成 `edge.data.design`、action/settlement target 和目标节点
`outcomeEvidence`。失败只重试当前节点，不得重建骨架或重发已成功节点。旧 `compile-blueprint-outline` 仅保留
兼容，不属于新活动路径。工具参数不提供完整 nodes/edges，schema 会直接拒绝此类输入。
只有 `blueprint.outline` 可以写这些设计字段；完成时 Host 冻结节点与边设计。
`game.finalizing` 只能将其编译成界面、reaction、settlement 和既有边引用，缺设计时返工上游。

| 阶段 | 如何使用能力契约 | 权限边界 |
| --- | --- | --- |
| `document.pillar` | 先 `list-ui-components`，按真实组件事件设计主循环、互动节拍、状态后果、循环退出和终局 | 只写支柱文档；不得 `patch-graph` 或 `configure-blueprint-node` |
| `blueprint.outline` | 先创建完整节点骨架，再逐节点表达真实 component/event、effect、独立结果节点、结果 trigger、循环和终局路由 | 只调用骨架与单节点 outline 工具；不得上传完整 nodes/edges，不得调用整装节点事务 |
| `rules.catalog` | 按互动计划创建确实会被组件或结算消费的实体、变量和公式 | 只写规则目录 |
| `ui.authoring` | 规则目录已就绪；按节点把界面、事件响应和结算一次合并提交 | 可以调用节点事务，但不能重新设计支柱未确认的玩法 |
| `rules.binding` | 审计上一阶段的规则绑定，只修补校验确认的缺口节点 | 不重复提交已经完整的节点 |
| `game.finalizing` | 检查上游计划完整性并将每个节点编译成一次聚合事务 | 执行节点事务、规则及非设计字段补齐；不得增删/重连 outline 节点与边 |
| 交付后对话维护 | 按作者明确指令评审或增量修改当前蓝图 | 不重开 activity；拓扑用 `patch-graph`，节点配置用 `configure-blueprint-node`，规则用 `patch-rules` |

支柱和总脉络看到的是产品能力，不需要知道 `mountOverlayOnGraph`、`upsertEventReaction` 等内部函数名。
这些下层原子方法用于保证人工面板与 AI 事务语义一致；AI 的稳定调用面是 `configure-blueprint-node`。

### 整装阶段工具路由

| 当前意图 | 工具 | 边界 |
| --- | --- | --- |
| 读取活动、项目缺口和权威蓝图 | `get-workflow-state`、`inspect-project`、`get-graph` | 写入前先建立逐节点覆盖清单 |
| 查询已有组件的 inputs/events | `list-ui-components` | 不猜组件字段或事件名 |
| 总脉络新建节点、目标节点、主干边、子蓝图；整装补非设计字段 | `patch-graph` | 节点/边拓扑只由 `blueprint.outline` 设计；整装不得改冻结面，也不写完整 `overlayNodes` / `reactions` |
| 新建实体、变量和公式 | `patch-rules` | 先建立节点配置将引用的稳定规则 ID |
| 增删改节点界面、属性、事件响应、连线和结算 | `configure-blueprint-node` | 节点全部意图规划完整后，每个节点调用一次；删除走结构化 `removals` |
| 检查蓝图完整性 | `validate-project` | 全部节点提交后统一校验并按问题定点修复 |

调用 `configure-blueprint-node` 前必须满足：当前节点和所有目标节点已存在；effect 引用的规则 ID 已存在；
所有目标边已由总脉络创建（结算优先传精确 `edgeId`）；overlay、child、组件 input 和 event 已通过
`get-graph` / `list-ui-components` 确认。整装缺节点、边、triggerSpec 或 outcomeEvidence 时返工总脉络，
不要依赖 `configure-blueprint-node` 猜测或创建它们。

整装顺序：读取活动与蓝图 → 建立逐节点覆盖清单 → 核对 outline 冻结设计 → 补规则 ID → 按节点原子整装 →
`validate-project` → 定点修复 → `complete-activity`。覆盖清单至少记录每个节点的界面挂载、组件绑定、
事件出口、结算、终局/失败结果是否完成。

多节点可以并行规划，但不能基于同一个旧 revision 并发写同一份蓝图。提交必须串行：每次成功后把响应中的
最新 `revision` 作为下一次 mutation 的 `expectedRevision`；遇到 `revision.conflict` 时重新 `get-graph`，
只基于最新蓝图重建尚未提交的节点事务，不得原样重放旧请求。

### 拓扑事务操作

`patch-graph` 的一个 `ops` 数组是一批拓扑事务，不是让 AI 直接增删 `blueprint.json` 数组。以下操作与画布
共用 `src/authoring/graph/graph-edit.ts` 的领域方法：

| 作者意图 | op | 领域方法 | 关键语义 |
| --- | --- | --- | --- |
| 新建蓝图 | `create-blueprint` | `createBlueprint` | 与左侧蓝图库相同的标题唯一性和默认入口；调用方应提供稳定 id |
| 重命名蓝图 | `rename-blueprint` | `renameBlueprint` | trim 后按中文 locale 不区分大小写判重 |
| 删除蓝图 | `delete-blueprint` | `deleteBlueprint` | 拒绝主蓝图和仍被引用的蓝图 |
| 设为主蓝图 | `set-main-blueprint` | `setMainBlueprint` | 切换运行入口并同步根 graph 镜像 |
| 新建节点 | `add-node` | `addNode` | 规范化位置后追加节点 |
| 删除节点 | `remove-node` | `removeNode` | 删除所有入边、出边及其 `advance` 引用 |
| 在节点后插入 | `insert-node-after` | `insertNodeAfter` | 自动改接指定出口原有下游 |
| 在节点前插入 | `insert-node-before` | `insertNodeBefore` | 自动改接所有原入边 |
| 复制节点组 | `duplicate-nodes` | `duplicateNodes` | 显式指定副本 ID；复制内部边并重写 `nodeId` / `edgeId` 引用 |
| 移动节点 | `set-node-field(position)` | `setNodePosition` | 只改变持久化画布坐标 |
| 新增连线 | `connect` | `connect` | 拒绝自环并按端点去重，必要时绑定 `advance` |
| 删除连线 | `disconnect` | `disconnect` | 删除边并清理所有 `advance(edgeId)` |
| 修改连线端点 | `reconnect` | `reconnect` | 保留原 `edgeId`；改变 source/handle 时重新绑定 reaction |

事件响应或结算中的“添加/修改连线”仍优先放进 `configure-blueprint-node`，因为它需要同时维护界面事件或结算
action。只有独立的画布拓扑指令，例如“把 A 到 B 的边改指向 C”，才直接使用 `patch-graph reconnect`。
批量删除可在同一个 `ops` 中放多个 `remove-node` / `disconnect`，无需为 UI 的框选手势增加新工具。

### 交付后对话式维护

当 workflow 已完成时，作者仍可用自然语言评审和修改当前蓝图。只评审时不得写入；“删除 / 新增 / 修改 /
移动 / 改成”这类明确命令本身就是写入授权。先 `get-graph` 将名称唯一解析成真实 nodeId、mountId、childId、
settlement/action 索引或 edgeId；同名多对象必须澄清，不能猜测。

交付后不调用 `begin-activity`、`complete-activity` 或 `report-blocker`，也不改变 workflow 完成态。写入工具、
revision、snapshot、幂等和级联规则与生产期完全相同；写后重新读取目标并显式调用
`validate-project(activity="game.finalizing", checkIds=[...])`，让 Host 对当前 blueprint revision 重跑相关检查，
不得复用交付时的旧 evidence。

典型对话式拓扑修改：

- “删除结局节点” -> 唯一解析节点 ID -> `remove-node`。
- “在审判节点前插入一个回忆节点” -> `insert-node-before`，不要手工拆成删边、加节点、重连。
- “复制挑战 A/B 及其内部路径” -> `duplicate-nodes`，为每个副本提供稳定 `targetId`。
- “把选择 A 的目标从失败改成隐藏结局” -> 若是界面事件或结算连线，用节点事务；若是独立画布边，用
  `reconnect` 保留 `edgeId`。

### 删除与解绑

删除前必须用 `get-graph` 读取当前 `mountId`、结算子集序号、动作序号/类型和 edgeId。禁止用
`patch-graph set-node-data` 过滤或整体替换 `overlayNodes` / `reactions`；那会绕过节点配置面板的级联清理。

```jsonc
{
  "nodeId": "choice-1",
  "expectedRevision": 18,
  "idempotencyKey": "configure:choice-1:remove:v1",
  "removals": {
    "interfaces": [{ "mountId": "base:InkYingMo" }],
    "settlements": [{ "settlementIndex": 1 }],
    "settlementActions": [{ "settlementIndex": 0, "actionIndex": 1, "expectedKind": "spawn" }],
    "edges": [{ "edgeId": "edge-obsolete" }]
  }
}
```

- `interfaces`：卸载整张界面，并级联删除该挂载事件的 reaction、advance 和事件出口边；默认主干边不受影响。
- `eventResponses`：按 `actions` / `route` / `all` 删除事件动作、事件连线或完整响应。
- `eventActions`：按动作序号和 `expectedKind` 删除单个事件动作；删除 `advance` 时同步断边。
- `settlements`：删除整条时间轴/条件结算，并清理无人引用的结算专用边。
- `settlementActions`：删除单个效果、连线、绑定界面或隐藏界面动作；删除 `spawn` 等价于面板“解除界面绑定”。
- `edges`：只允许删除 `source` 为当前 `nodeId` 的边，并同步清理引用该 edgeId 的 `advance`。

## 生成基础控件

用户要求新增基础界面控件时，调用 `game-video:upsert-component`。传入稳定 `id`、用于右栏配置的
`inputs`、用于事件编辑器的 `events`，以及一个 JavaScript React 组件表达式。`implementation`
中 `React` 已在词法作用域内，必须使用 `React.createElement` 和 React hooks，且不得用变量、函数、类、参数、解构目标或 catch 绑定重新声明或遮蔽 `React`；不要写 import、export、
JSX、TypeScript、外部包引用或未声明变量。所有事件回调、定时器回调和 state updater 只能引用 props、局部声明值、
`React` 或标准 JavaScript / 浏览器全局；不得假设存在 `ctx` 等隐藏上下文。运行时把 inputs 作为扁平 props 传入，组件交互通过
`props.emit(eventId, payload)` 发出 manifest 中已声明的事件。需要让节点 reaction 使用 payload 时，
必须在对应 `events[].outputs` 声明每个字段的 `key` 与 `valueType`；数值字段通过
`{ "expr": "eventPayload.<key>" }` 使用，字符串和布尔字段通过 `{ "ref": "eventPayload.<key>" }` 使用。

新建原子控件还必须提供 `gameplaySemantics`：说明该控件的玩法角色与目的、哪些 inputs 绑定状态、
每个 event 必须产生哪些 feedback/advance、`stateMutationOwner: "settlement"`、下游视频如何兑现结果、推荐哪些结算、需要哪些搭档，
以及应避免的合法但无意义配置。缺少这份语义时 Host 会拒绝创建，避免目录再次出现“能渲染但不会玩”的控件。

每个 `inputs[]` 都必须显式提供与 `valueType` 匹配的 `default`，即使合理默认值是空字符串、`0`、
`false`、空数组或空对象也不能省略。有 `options` 时，默认值必须等于某个 `options[].value`。颜色属性使用
`valueType: "color"`，默认值使用 `#rgb`、`#rrggbb`、`rgb(...)` 或 `rgba(...)`；右栏会据此显示
ColorPicker，不需要再填写 `component: "color"`。

工具会在当前宿主绑定游戏内维护 `components/definitions/*.json`，并重新生成
`components/index.js`。工具返回校验错误时，根据错误中的变量名修复 implementation 后重试；校验失败不会覆盖当前可用控件。
不要用 `write_file` 绕过这个工具，也不要在扩展源码内预置用户要求的具体控件。

### 需求消歧

不要为了使用问答工具而提问。用户已经明确控件的用途、可配置字段和事件语义时，直接调用
`upsert-component`。颜色、字号、间距、默认文案等低风险表现细节可采用可配置的合理默认值，不得单独打断用户。

只有当答案会改变控件的公开契约或运行语义，且无法从当前对话或现有控件定义推导时，才先向用户消歧。
典型关键歧义包括：纯展示还是可开始/暂停/重置；归零后是停止、循环还是发出 gameplay 事件；时长是固定实现还是右栏 `input`。
一次集中询问所有关键歧义，给出 2–4 个可直接选择的互斥方案；用户回答后再调用
`upsert-component`。如果当前 Agent 不能直接调用问答工具，必须把缺失决策和候选项交回拥有问答能力的编排层并停止写入；
不得猜测，也不得用普通文字伪装成问答卡。

## Bootstrap · 最小可玩骨架

新游戏 Host 初始化后的盘面是**空壳**：主包 `bp-main`、唯一 `perf` 节点 `entry`、无边、无 Nodia demo。
AI **不得**假设存在 demo 节点；**不得**用 `save-graph`；只用：

```text
get-graph →（可选 Load 本 Skill）→ 多批 patch-graph → get-graph 自检
```

### 最小可玩骨架完成标准

1. 从 `entry` 到结局的主路径连通
2. ≥1 个抉择点：≥2 条选项出边（不同 `sourceHandle`，如 `opt_a` / `opt_b`），下游合流或分结局
3. 主路径每个叙事节点 `data.storyText` 非空（字段名是 **storyText**，不是 scriptText）
4. 每个新建叙事/演出节点都写 `data.media: { kind: "video", prompt: "<基础视频 prompt>" }`；
   prompt 至少描述主体、动作、镜头、光线和氛围，供后续 Kino 生成直接复用
5. 每个新建叙事/演出节点还要写 `data.chapterSummary`（章节概览）、`data.cast`（出场角色）
   和 `data.media.generation`（生成预设）；见下方「节点生产契约」
6. 本轮不做战斗子图 / 探索枢纽 / 成片生成；未生成成片时可省略 `media.ref`，`game.finalizing` 完成时 Host 会给所有未绑定节点回填同一份项目内占位视频；作者后续生成成片时再替换该 `media.ref`

### 节点生产契约

一个定稿的视频演出节点在**同一个蓝图 revision 内**同时具备：

| 字段 | 含义 |
|---|---|
| `data.chapterSummary` | 章节 / 节拍概览 |
| `data.storyText` | 作者可读正文：演出描述 + 台词 + 内心独白 + 选项 |
| `data.cast[]` | `{ characterId, role?, onScreen? }`；只引用角色 id，**不复制**角色名或外观正文 |
| `data.media.prompt` | 基础视频 prompt 的唯一真相源 |
| `data.media.generation` | provider-resource-neutral 生成预设 |

`generation` 保存 duration、audio、mode 和适用的 size / resolution / model / style，以及
`references` 里的**平台 asset id**。它**不保存** Kino resource id、任务状态或成片 URL——
那些只在用户点击生成的提交边界由宿主解析。写节点**不会**创建任何生成任务。

`cast[].characterId` 必须命中资产目录（`get-graph.assetEntities.characters` 的 key）；角色名字符串
不是隐式引用，未知 id 会导致校验失败。manifest 角色资产实体保存叙事与视觉身份，可选通过 `entityId`
关联运行规则实体——屏幕角色不必有数值实体，纯数值实体也不该被强制生成头像。

旧节点只有 `media.prompt` 时，读取层会用 Kino 默认生成选项拼一份兼容 draft 且**不改写盘上文件**；
新工作流要求显式写入 `generation` 才算过关。

### 拓扑草图

```text
entry → beat_1 → choice → path_a → merge → ending
                       ↘ path_b ↗
```

### 分支语义约束

分支按图结构判断，不依赖具体事件名。对同一节点的所有非 `default` 出口：

- 至少两个不同出口必须连接到不同目标，形成真实路径差异；或
- 如果多个出口最终合流，每条选择必须产生会被后续条件、规则、文本或结局消费的状态后果。

仅使用不同的 `sourceHandle` 名称、随后立即进入同一节点、且没有有效状态后果的图是无效的，
`patch-graph` 和活动完成门都会拒绝它。创建分支连线与对应后果时应放在同一个原子批次中。

### 推荐 ops（示意）

1. `set-node-data` 写 `entry` 的 `chapterSummary` / `storyText` / `cast` /
   `media: { kind:"video", prompt:"…", generation:{ … } }`
2. `add-node` 增加 `type:"perf"` 节点，
   `data: { name, chapterSummary, storyText, cast, media:{ kind:"video", prompt:"…", generation:{ … } } }`
3. `connect`：线性边用 `sourceHandle:"default"`；抉择边用 `opt_a` / `opt_b`
4. 一批失败整批不写盘 → 读 `errors` / `failedOpIndex` 后重试

可点击的 choice overlay（`ensure-node-overlay` / `add-overlay-child`）**不是**最小可玩骨架的硬门槛；拓扑选项边 + `storyText` 写清选项即可。需要可玩 UI 时在后续的交互界面完善任务中补充 overlay。

## 规则目录（实体 / 变量 / 公式）

用 `patch-rules` 一次提交一组相关规则对象，**不要**用 `patch-graph` 建实体或变量，
也不要用 `Write` / `Edit` 直接改 `blueprint.json`：

```text
game-video:patch-rules({ expectedRevision, ops: [
  { op: "upsert-entity",      entityId: "ent-wukong", name: "孙悟空" },
  { op: "upsert-entity-attr", entityId: "ent-wukong", attrId: "insight", value: 1,
                              meta: { min: 0, max: 5 } },
  { op: "upsert-variable",    variableId: "var-clues", name: "线索数", initial: 0 },
  { op: "upsert-formula",     formulaId: "formula-truth", name: "真相深度",
                              expressionText: "var.var-clues + entity.ent-wukong.attr.insight" }
]})
```

- 整批原子：任一 op、引用校验或 revision 检查失败 → 原样不写盘，返回 `errorCode` 与 `failedOpIndex`。
- 公式提交 `expressionText`，服务端用共享 parser 生成规范 AST 并校验每个引用；
  **同一批里可以引用刚建的实体/变量**。
- 省略 id 时由服务端按编辑器同一套规则分配，Agent 建的对象与用户手建的不可区分。
- 移除仍被公式引用的实体/属性/变量会被拒绝（`rules.*.in-use`）；把公式一起删掉即可，
  两个 op 的先后顺序不影响结果。
- 这里写的是**作者态初值模板**，不是正在运行的 `GraphSession`。每次「从此试玩」都会从这些
  初值创建隔离的运行状态，本局的 effect 不回写作者配置。
- 节点界面事件路由、结果节点/条件结算里的 effect/reaction 优先用 `configure-blueprint-node`；普通边 condition 和其它未覆盖字段仍用
  `patch-graph`，引用这里建好的 id。

## 视频生产闭环

蓝图里的 `node.data.media.prompt` 是该节点视频的基础 prompt SSOT。生成该节点视频时，将它传给
`generate-video-clip.prompt`（或作为 `generate-shot-script` / `generate-video` 的内容基础）；生成成功后只补
`media.ref = asset.id`，不得删除或改写原 prompt。`generate-video-clip` 的默认参数为 `durationSeconds: 8`、
`generateAudio: false`、`mode: "t2v"`；参考图模式按工具 schema 补对应 asset id。

```text
import-character-refs + import-scene-refs
  → generate-shot-script
  → generate-keyframe
  → generate-video 或 generate-node-video
  → 把返回的 asset.id 绑定到节点 media.ref
```

素材写入宿主绑定工作区的逻辑目录 `assets/`。蓝图写入 `blueprint.json`，首次保存补
`project.json`；物理目录布局由宿主决定。

本扩展不替代纯叙事影片、BGM、低模 3D 或 ECS 游戏工具；它专注于视频承载的玩法交互。

## 宿主契约

发布时需要 `@forgeax/extension-platform@0.0.2` 与
`/extension-host.2.3`。宿主加载 `@forgeax-extension/game-video/host` 的 `host`
导出，并注入游戏工作区、版本、媒体、模型、视频生成与服务 capability。所有工具和扩展 HTTP 路由共享同一
`ExtensionContext`；不支持根据 URL、进程环境、全局 active game 或工具参数选择游戏。
浏览器必须等待 nonce-bound handshake，并只使用 handshake 返回的游戏身份和端点。版本与游戏
组件是可选 capability；缺失时不得猜测或拼接备用 URL。

### 支柱作者门

- 支柱确认只要求 `document.pillar` 已完成且支柱文档存在；角色参考图数量不是作者门输入，
  不存在 `character-cost` 门。
- `author-gates/pillar/confirm` 直接消费作者操作，不要求浏览器提交全局 workflow revision。
  第一次确认生成不可预测的 evidence；重复请求幂等返回同一 evidence。
- 支柱正文真实变化时，Host 重新执行 `document.pillar` 校验并把 pillar gate 重置为 `pending`。
  已确认后再重做会按返工范围使下游活动失效，最新支柱必须由作者再次确认。
