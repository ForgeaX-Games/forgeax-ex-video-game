import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'
import {
  AUTHORING_CAPABILITY_REGISTRY,
  PATCH_GRAPH_OPERATION_EXEMPTIONS,
  UI_AUTHORING_PRIMITIVE_EXEMPTIONS,
} from '../src/workflow/authoring-capability-registry'
import { ACTIVITY_CONTRACTS } from '../src/workflow/activity-contracts'
import { qualifyAsMateMcpName, toMcpName } from '../src/workflow/mcp-tool-name'
import {
  COMPONENT_GAMEPLAY_SEMANTICS,
  INTERACTION_GAMEPLAY_PATTERNS,
  SETTLEMENT_GAMEPLAY_PATTERNS,
} from '../src/workflow/gameplay-semantics'
import { localComponentManifests } from '../src/runtime/core/component-catalog'

type JsonSchema = Record<string, unknown>

const root = process.cwd()
const errors: string[] = []

const settlementPatternIds = new Set(SETTLEMENT_GAMEPLAY_PATTERNS.map((pattern) => pattern.id))
const interactionPatternIds = new Set(INTERACTION_GAMEPLAY_PATTERNS.map((pattern) => pattern.id))
if (settlementPatternIds.size !== SETTLEMENT_GAMEPLAY_PATTERNS.length) errors.push('结算玩法模式 ID 重复')
if (interactionPatternIds.size !== INTERACTION_GAMEPLAY_PATTERNS.length) errors.push('互动玩法模式 ID 重复')
for (const manifest of localComponentManifests) {
  const semantics = COMPONENT_GAMEPLAY_SEMANTICS[manifest.id]
  if (!semantics) {
    errors.push(`内置控件 ${manifest.id} 缺少 gameplaySemantics`)
    continue
  }
  const eventIds = new Set(manifest.events.map((event) => event.id))
  for (const event of semantics.eventSemantics) {
    if (!eventIds.has(event.event)) errors.push(`${manifest.id} gameplaySemantics 引用了未知事件 ${event.event}`)
  }
  for (const patternId of semantics.recommendedSettlements) {
    if (!settlementPatternIds.has(patternId)) errors.push(`${manifest.id} 引用了未知结算模式 ${patternId}`)
  }
}

async function readJson(path: string): Promise<JsonSchema> {
  try {
    return JSON.parse(await readFile(resolve(root, path), 'utf8')) as JsonSchema
  } catch (error) {
    errors.push(`${path} 无法读取为 JSON：${String(error)}`)
    return {}
  }
}

function dereference(schema: JsonSchema, node: unknown): JsonSchema {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return {}
  const value = node as JsonSchema
  const ref = value.$ref
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return value
  const target = ref.slice(2).split('/').reduce<unknown>((cursor, segment) => {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined
    return (cursor as JsonSchema)[segment.replaceAll('~1', '/').replaceAll('~0', '~')]
  }, schema)
  return target && typeof target === 'object' && !Array.isArray(target)
    ? target as JsonSchema
    : {}
}

function collectOperationNames(schema: JsonSchema, node: unknown, output = new Set<string>()): Set<string> {
  const value = dereference(schema, node)
  const properties = value.properties
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    const operation = (properties as JsonSchema).op
    if (operation && typeof operation === 'object' && !Array.isArray(operation)) {
      const opSchema = operation as JsonSchema
      if (typeof opSchema.const === 'string') output.add(opSchema.const)
      if (Array.isArray(opSchema.enum)) {
        for (const item of opSchema.enum) if (typeof item === 'string') output.add(item)
      }
    }
  }
  for (const branchKey of ['oneOf', 'anyOf', 'allOf'] as const) {
    const branches = value[branchKey]
    if (Array.isArray(branches)) {
      for (const branch of branches) collectOperationNames(schema, branch, output)
    }
  }
  return output
}

function propertyAtPath(schema: JsonSchema, node: unknown, segments: readonly string[]): boolean {
  if (segments.length === 0) return true
  const value = dereference(schema, node)
  if (value.type === 'array' || value.items) {
    return propertyAtPath(schema, value.items, segments)
  }
  const properties = value.properties
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    const child = (properties as JsonSchema)[segments[0]!]
    if (child) return propertyAtPath(schema, child, segments.slice(1))
  }
  for (const branchKey of ['oneOf', 'anyOf', 'allOf'] as const) {
    const branches = value[branchKey]
    if (Array.isArray(branches) && branches.some((branch) => propertyAtPath(schema, branch, segments))) {
      return true
    }
  }
  return false
}

async function checkEntryPoint(file: string, symbols: readonly string[], label: string): Promise<void> {
  const path = resolve(root, file)
  try {
    const info = await stat(path)
    if (!info.isFile()) throw new Error('不是文件')
    const source = await readFile(path, 'utf8')
    for (const symbol of symbols) {
      const escaped = symbol.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (!new RegExp(`\\b${escaped}\\b`).test(source)) {
        errors.push(`${label} 入口 ${file} 缺少登记符号 ${symbol}`)
      }
    }
  } catch (error) {
    errors.push(`${label} 入口不存在：${file}（${String(error)}）`)
  }
}

async function governedEditorModuleNames(): Promise<Set<string>> {
  const modules = new Set<string>()
  for (const domain of ['blueprint', 'graph']) {
    for (const entry of await readdir(resolve(root, `src/authoring/${domain}`), { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('-edit.ts')) {
        modules.add(`@/authoring/${domain}/${entry.name.slice(0, -3)}`)
      }
    }
  }
  return modules
}

async function productionFiles(directory: string): Promise<string[]> {
  const output: string[] = []
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') output.push(...await productionFiles(relative))
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
      output.push(relative)
    }
  }
  return output
}

async function editorAuthoringPrimitiveImports(): Promise<Map<string, string[]>> {
  const imports = new Map<string, string[]>()
  const governedEditorModules = await governedEditorModuleNames()
  for (const file of await productionFiles('src/editor')) {
    const source = await readFile(resolve(root, file), 'utf8')
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      if (!governedEditorModules.has(statement.moduleSpecifier.text)) continue
      const clause = statement.importClause
      const bindings = clause?.namedBindings
      if (!bindings || !ts.isNamedImports(bindings) || clause?.isTypeOnly) continue
      for (const element of bindings.elements) {
        if (element.isTypeOnly) continue
        const primitive = element.propertyName?.text ?? element.name.text
        imports.set(primitive, [...(imports.get(primitive) ?? []), file])
      }
    }
  }
  return imports
}

const paritySuites: Record<string, string> = {
  'blueprint-library': 'src/server/host/blueprint-library-parity.test.ts',
  topology: 'src/server/host/patch-graph-parity.test.ts',
  'node-configuration': 'src/authoring/commands/__tests__/configure-blueprint-node.test.ts',
}

const patchSchema = await readJson('schemas/patch-graph.args.json')
const nodeSchema = await readJson('schemas/configure-blueprint-node.args.json')
const manifest = await readJson('forgeax-extension.json')
const activityContractSource = await readFile(
  resolve(root, 'src/workflow/activity-contracts.ts'),
  'utf8',
)
if (/mcp__as-mate-tools__|(?:workbench|extension)__game_video__/.test(activityContractSource)) {
  errors.push('ActivityContract 禁止手写 MCP transport 名；必须从 game-video tool ID 调用统一 mapper')
}
const tools = ((manifest.contributes as JsonSchema | undefined)?.tools ?? []) as unknown[]
const toolById = new Map(tools.flatMap((tool) => {
  if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return []
  const value = tool as JsonSchema
  return typeof value.id === 'string' ? [[value.id, value] as const] : []
}))
const exposedActivityToolNames = new Set(
  [...toolById.entries()]
    .filter(([, tool]) => tool.exposedToAI === true)
    .map(([toolId]) => qualifyAsMateMcpName(toMcpName(toolId))),
)

for (const [activity, contract] of Object.entries(ACTIVITY_CONTRACTS)) {
  for (const toolName of contract.allowedToolNames) {
    if (!exposedActivityToolNames.has(toolName)) {
      errors.push(`${activity} 授权了未由 manifest 暴露的 MCP transport 工具：${toolName}`)
    }
  }
}

const capabilityIds = new Set<string>()
const registeredPatchOps = new Set<string>()
const registeredPrimitives = new Set<string>()
for (const capability of AUTHORING_CAPABILITY_REGISTRY) {
  if (capabilityIds.has(capability.id)) errors.push(`能力 ID 重复：${capability.id}`)
  capabilityIds.add(capability.id)
  if (capability.domainPrimitives.length === 0) errors.push(`${capability.id} 未登记共享领域原语`)
  for (const primitive of capability.domainPrimitives) registeredPrimitives.add(primitive)
  if (capability.ui.status !== 'available') errors.push(`${capability.id} 没有可用的前端入口`)
  if (capability.agent.status !== 'available') errors.push(`${capability.id} 没有可用的 Agent 入口`)
  for (const entry of capability.ui.entryPoints) {
    await checkEntryPoint(entry.file, entry.symbols, `${capability.id} 前端`)
  }
  for (const entry of capability.agent.entryPoints) {
    await checkEntryPoint(entry.file, entry.symbols, `${capability.id} Agent`)
  }
  const suite = paritySuites[capability.paritySuite]
  if (!suite) {
    errors.push(`${capability.id} 使用未知 parity suite：${capability.paritySuite}`)
  } else {
    try {
      const source = await readFile(resolve(root, suite), 'utf8')
      if (!/\b(?:describe|test|it)\s*\(/.test(source)) errors.push(`${suite} 不含可识别测试`)
    } catch {
      errors.push(`${capability.id} 缺少 parity suite：${suite}`)
    }
  }

  const toolId = capability.agent.tool === 'patch_graph'
    ? 'game-video:patch-graph'
    : 'game-video:configure-blueprint-node'
  const tool = toolById.get(toolId)
  if (!tool || tool.exposedToAI !== true) errors.push(`${capability.id} 的工具 ${toolId} 未 exposedToAI`)
  if (capability.agent.tool === 'patch_graph') {
    for (const operation of capability.agent.operations ?? []) registeredPatchOps.add(operation)
  } else {
    for (const path of capability.agent.schemaPaths ?? []) {
      if (!propertyAtPath(nodeSchema, nodeSchema, path.split('.'))) {
        errors.push(`${capability.id} 登记的节点事务路径不存在：${path}`)
      }
    }
  }
}

const editorPrimitives = await editorAuthoringPrimitiveImports()
for (const [primitive, files] of editorPrimitives) {
  if (!registeredPrimitives.has(primitive) && !(primitive in UI_AUTHORING_PRIMITIVE_EXEMPTIONS)) {
    errors.push(`前端新增 authoring primitive ${primitive} 未登记双端能力或豁免（${files.join(', ')}）`)
  }
}
for (const [primitive, reason] of Object.entries(UI_AUTHORING_PRIMITIVE_EXEMPTIONS)) {
  if (!editorPrimitives.has(primitive)) errors.push(`过期的前端 authoring primitive 豁免：${primitive}`)
  if (!reason.trim()) errors.push(`前端 authoring primitive 豁免 ${primitive} 缺少原因`)
}

const opsNode = (((patchSchema.properties as JsonSchema | undefined)?.ops as JsonSchema | undefined)?.items)
const schemaPatchOps = collectOperationNames(patchSchema, opsNode)
for (const operation of schemaPatchOps) {
  if (!registeredPatchOps.has(operation) && !(operation in PATCH_GRAPH_OPERATION_EXEMPTIONS)) {
    errors.push(`patch_graph op ${operation} 未登记能力，也没有带理由的豁免`)
  }
}
for (const operation of registeredPatchOps) {
  if (!schemaPatchOps.has(operation)) errors.push(`注册表引用了不存在的 patch_graph op：${operation}`)
}
for (const [operation, reason] of Object.entries(PATCH_GRAPH_OPERATION_EXEMPTIONS)) {
  if (!schemaPatchOps.has(operation)) errors.push(`过期的 patch_graph 豁免：${operation}`)
  if (!reason.trim()) errors.push(`patch_graph 豁免 ${operation} 缺少原因`)
}

if (errors.length > 0) {
  console.error('作者能力治理检查失败：')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(`作者能力治理检查通过：${capabilityIds.size} 项能力，${schemaPatchOps.size} 个 patch_graph op。`)
