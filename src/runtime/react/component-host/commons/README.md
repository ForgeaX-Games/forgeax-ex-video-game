# component-host/commons

预留：**真正跨游戏共享的公共组件**放这里（现为空，且当前未接入默认 catalog）。

- `components/` 是当前仓内内建 catalog，条目形状统一为 `{ component, manifest }`。
- `commons/` 仅是未来公共 catalog 的预留位置；只新增文件不会自动注册，也不会自动同步到游戏仓。
- 公共 manifest 同样使用 `components/manifest.ts` 的本地契约，不得直接依赖平台 schema；平台
  `ComponentDef` / `ComponentManifest` 转换只发生在 `component-host/index.ts`。

将来启用 `commons/` 时，应导出与 `components/index.ts` 相同形状的 catalog，并在
`bootComponents()` / `ensureBuiltins()` 的内建注册路径中显式合并。
