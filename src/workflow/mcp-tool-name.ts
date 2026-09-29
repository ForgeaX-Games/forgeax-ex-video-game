const TOOL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/u

/**
 * 与 agentic_mate workbench-host 的 MCP 注册规则相同：稳定 tool ID 是输入，
 * `workbench__<extension>__<operation>` 是唯一 transport 名称。
 */
export function toMcpName(toolId: string): string {
  if (!TOOL_ID_PATTERN.test(toolId)) {
    throw new TypeError(`Invalid or ambiguous Workbench tool id: ${toolId}`)
  }
  const separator = toolId.indexOf(':')
  const extensionId = toolId.slice(0, separator)
  const operationId = toolId.slice(separator + 1)
  return `workbench__${extensionId.replaceAll('-', '_')}__${operationId.replaceAll('-', '_')}`
}

export function qualifyAsMateMcpName(name: string): string {
  return `mcp__as-mate-tools__${name}`
}

export function gameVideoToolId(operationId: string): `game-video:${string}` {
  const toolId = `game-video:${operationId}` as const
  if (!TOOL_ID_PATTERN.test(toolId)) {
    throw new TypeError(`Invalid game-video operation id: ${operationId}`)
  }
  return toolId
}

export function gameVideoMcpToolName(operationId: string): string {
  return qualifyAsMateMcpName(toMcpName(gameVideoToolId(operationId)))
}
