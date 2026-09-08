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
| `game-video:patch-rules` | 批量维护实体 / 属性 / 变量 / 公式；与改图共享文档锁和 revision |
| `game-video:generate-character-previews` | 无需用户确认，按屏幕 cast 自动批量生成并绑定角色参考图 |
| `game-video:list-videos` | 列出扩展内置视频的 `media.ref` |
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
  → 根据现有节点、边和蓝图 id 构造增量 ops
  → game-video:patch-graph({ blueprintId?, expectedRevision, ops })
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

如果 `get-graph` 返回 `project: null`，说明 Host 尚未初始化 empty library seed。向编排层报错并停止——你无法 `save-graph`，不得编造整本 `GraphLibraryDocument` 或 Write/Edit `blueprint.json`。搭建最小可玩骨架的前提是盘上已有 Host empty seed（单 `entry` 节点）。Nodia demo 只用于用户显式重置。
AI 改图只使用 `patch-graph`，不要拼接整本 `project` 调用 `save-graph`。游戏身份始终来自宿主绑定；
所有 AI 工具都不接受 `gameSlug` 或其它游戏选择参数。

## 生成基础控件

用户要求新增基础界面控件时，调用 `game-video:upsert-component`。传入稳定 `id`、用于右栏配置的
`inputs`、用于事件编辑器的 `events`，以及一个 JavaScript React 组件表达式。`implementation`
中 `React` 已在词法作用域内，必须使用 `React.createElement` 和 React hooks，且不得用变量、函数、类、参数、解构目标或 catch 绑定重新声明或遮蔽 `React`；不要写 import、export、
JSX、TypeScript、外部包引用或未声明变量。所有事件回调、定时器回调和 state updater 只能引用 props、局部声明值、
`React` 或标准 JavaScript / 浏览器全局；不得假设存在 `ctx` 等隐藏上下文。运行时把 inputs 作为扁平 props 传入，组件交互通过
`props.emit(eventId)` 发出 manifest 中已声明的事件。

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
- 节点/边上的 condition、effect、reaction 仍然用 `patch-graph` 挂，引用这里建好的 id。

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
