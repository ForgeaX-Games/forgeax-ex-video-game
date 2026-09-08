# game-video Prompt Skills

本目录是**喂给 LLM（Claude Opus 4.6）的"元提示词"**集合。每个 skill 是一个**规范目录**
（对齐 Anthropic / Cursor Agent Skill 结构），核心指令写在 `SKILL.md`：

```
src/llm/skills/<skill-name>/
  ├── SKILL.md      # 核心指令（必需，顶部带 name/description frontmatter）
  ├── references/   # 参考资料 / few-shot（可选）
  └── assets/       # 模板 / 静态资源（可选）
```

`index.ts` 用 Vite `?raw` 把每个 `SKILL.md` 读成字符串，并用 `body()` **剥掉 frontmatter**
后作为纯净 system prompt 喂给模型——frontmatter 只服务于目录规范与人读，不进提示词。

| Skill 目录 | 用途 | 谁会调用 | 喂给 |
|-------|------|---------|------|
| `cinema-image-prompt/` | 把作者意图扩成电影级画面提示词 | `forgeImagePrompt` / PromptTabs scene tab | **GPT-Image-2** |
| `cinema-video-prompt/` | 把场景画面+动作意图扩成时间码视频提示词 | `forgeVideoPrompt` / PromptTabs video tab | **即梦 seedance / sora** |
| `dialogue-craft/` | 中文台词节制感、悬念、子文本 | `forgeDialogue` | （直出） |
| `scenario-architect/` | 一句想法 → 整棵剧本树 | `forgeScenarioFromIdea` / IdeaForge | （结构化 JSON） |

> 完整 22 个 skill 的登记见 `index.ts` 的 `SKILLS` 字典（每个键都带 JSDoc 说明）。

## 设计原则

1. **元提示词 ≠ 程序拼接字符串**。一份 skill 是一封"给资深创作者的工作简报"，
   讲清楚**身份 / 任务 / 美学约束 / 反例 / few-shot 案例 / 输出格式**。
2. **少而真的案例 > 大堆 if-else**。我们已固化作者亲手提供的"高质量视频提示词"
   作为 anchor example，模型会在能力范围内对齐这种密度。
3. **Markdown 可独立阅读**。任何编辑（人或 agent）都能直接打开 `SKILL.md`
   修改美学口味，不必碰 TS。Vite 用 `?raw` 把文件导入为字符串。
4. **frontmatter 只做登记，不进提示词**。`SKILL.md` 顶部 `--- name / description ---`
   服务于目录规范与人读；`index.ts` 的 `body()` 会在喂模型前剥掉它。
5. **不要在 skill 里写代码 / JSON schema 文字**。结构格式留给调用侧的 user prompt
   末尾说明（比如 scenario-architect 在 JSON 输出前的"返回格式"块）。
6. **超长 / 多流程再拆**。单个 `SKILL.md` 超 ~500 行或含多条互不依赖的工作流时，
   把可选参考料下沉到 `references/`，或拆成独立 skill 目录。

## 修改流程

1. 改对应目录的 `SKILL.md`（保持中文 + 留白克制风格；勿动 frontmatter 语义）
2. `npm test --filter skillHygiene`（skill 文档卫生 + 风格 marker 检查）
3. dev 浏览器里跑一次 IdeaForge / PromptTabs 对应按钮，目测产物质量
4. 提交时同 commit 带上"prompt: ..."前缀

## 新增 skill

1. 建目录 `<skill-name>/SKILL.md`，顶部写 `--- name / description ---` frontmatter
2. 在 `index.ts` 里 `import ... from './<skill-name>/SKILL.md?raw'`，用 `body()` 包一层加进 `SKILLS`
3. 让 promptForge 里对应的 `forgeXxx()` 把它当 systemPrompt 喂给模型

## 安全注意

skill 文件**只能**包含教学内容、示例、风格规范。
**严禁**写入：
- 任何 API key / token / 私链
- 真实人物可识别面部数据
- 内部商业机密 / 未发布产品名
