import { createHash } from 'node:crypto'
import { Script } from 'node:vm'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { parse } from 'acorn'
import { analyze } from 'eslint-scope'
import type { GameGraph, GraphLibraryDocument, Overlay, OverlayChild, Trigger } from '@/runtime/core/schema/graph-schema'
import { getSubProcess } from '@/runtime/core/schema/graph-schema'
import { normalizeDocument, validateDocument } from '@/authoring/blueprint/blueprint-project'
import {
  readDocumentRevision,
  nextDocumentRevision,
  readMutationReceipts,
  stampDocumentRevision,
} from './document-revision'
import { componentContracts } from './component-catalog'
import { GRAPH_SAVE_LOCK } from './locks'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const COMPONENT_DEFINITIONS_DIR = 'components/definitions'
const COMPONENT_MODULE_FILE = 'components/index.js'
const COMPONENT_WRITE_LOCK = 'game-video-component-authoring'
const BLUEPRINT_FILE = 'blueprint.json'
const COMPONENT_ID = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/u
const VALUE_TYPES = new Set(['string', 'number', 'boolean', 'color', 'bind', 'json'])
const COLOR_HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu
const COLOR_RGB = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/iu
const INPUT_COMPONENTS = new Set([
  'textStyle',
  'effects',
  'events',
  'hotspotEvents',
  'qteCues',
  'entity',
  'attr',
  'color',
  'numberExpr',
])
const REACT_RUNTIME_SYMBOL = 'forgeax.game-video.react'
const ALLOWED_IMPLEMENTATION_GLOBALS = new Set([
  'React',
  'Array',
  'AbortController',
  'AbortSignal',
  'BigInt',
  'Boolean',
  'CustomEvent',
  'Date',
  'Error',
  'Event',
  'EventTarget',
  'FormData',
  'Headers',
  'Infinity',
  'Intl',
  'JSON',
  'Map',
  'Math',
  'NaN',
  'Number',
  'Object',
  'Promise',
  'RegExp',
  'Request',
  'Response',
  'Set',
  'String',
  'Symbol',
  'TypeError',
  'URL',
  'URLSearchParams',
  'WebSocket',
  'cancelAnimationFrame',
  'clearInterval',
  'clearTimeout',
  'console',
  'decodeURI',
  'decodeURIComponent',
  'document',
  'encodeURI',
  'encodeURIComponent',
  'fetch',
  'globalThis',
  'isFinite',
  'isNaN',
  'localStorage',
  'navigator',
  'parseFloat',
  'parseInt',
  'performance',
  'queueMicrotask',
  'requestAnimationFrame',
  'sessionStorage',
  'setInterval',
  'setTimeout',
  'undefined',
  'window',
])

type AuthoredInput = {
  key: string
  label?: string
  valueType: string
  required?: boolean
  default?: unknown
  options?: Array<{ value: string; label: string }>
  min?: number
  step?: number
  component?: string
}

type AuthoredEvent = { id: string; label?: string }

type AuthoredComponentDefinition = {
  schemaVersion: 1
  manifest: {
    id: string
    label?: string
    inputs?: AuthoredInput[]
    events: AuthoredEvent[]
    /** 面向 AI 的摆放位置与潜规则提示。 */
    prompt?: string
  }
  implementation: string
}

export type UpsertComponentResult = {
  ok: true
  componentId: string
  created: boolean
  componentCount: number
  definitionPath: string
  modulePath: typeof COMPONENT_MODULE_FILE
  revision: string
}

export type DeleteComponentResult = {
  ok: true
  componentId: string
  deleted: boolean
  componentCount: number
  definitionPath: string
  modulePath: typeof COMPONENT_MODULE_FILE
  revision: string
}

export class ComponentAuthoringInputError extends TypeError {
  readonly code = 'invalid_component_input'
}

export class ComponentAuthoringConflictError extends Error {
  readonly code = 'component_in_use'

  constructor(
    readonly componentId: string,
    readonly references: readonly string[],
  ) {
    super(`component ${componentId} is still referenced at: ${references.join(', ')}`)
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ComponentAuthoringInputError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function assertOnlyKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const keys = new Set(allowed)
  const unsupported = Object.keys(input).find((key) => !keys.has(key))
  if (unsupported) {
    throw new ComponentAuthoringInputError(`${label}.${unsupported} is not supported`)
  }
}

function requiredString(value: unknown, label: string, maxLength = 120): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new ComponentAuthoringInputError(`${label} must be a non-empty string up to ${maxLength} characters`)
  }
  return value
}

function optionalString(value: unknown, label: string, maxLength = 120): string | undefined {
  if (value === undefined) return undefined
  return requiredString(value, label, maxLength)
}

function isColorPickerValue(value: string): boolean {
  if (COLOR_HEX.test(value.trim())) return true
  const rgb = COLOR_RGB.exec(value.trim())
  if (!rgb) return false
  const channels = rgb.slice(1, 4).map(Number)
  if (channels.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255)) return false
  if (rgb[4] === undefined) return true
  const alpha = Number(rgb[4])
  return Number.isFinite(alpha) && alpha >= 0 && alpha <= 1
}

function isJsonSafe(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonSafe)
  if (typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return (prototype === Object.prototype || prototype === null)
    && Object.values(value as Record<string, unknown>).every(isJsonSafe)
}

function validateInputDefault(
  value: unknown,
  valueType: string,
  options: AuthoredInput['options'],
  label: string,
): void {
  if (valueType === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ComponentAuthoringInputError(`${label} must be a finite number for valueType "number"`)
    }
  } else if (valueType === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new ComponentAuthoringInputError(`${label} must be a boolean for valueType "boolean"`)
    }
  } else if (valueType === 'json') {
    if (!isJsonSafe(value)) {
      throw new ComponentAuthoringInputError(`${label} must be a JSON-safe value for valueType "json"`)
    }
  } else if (typeof value !== 'string') {
    throw new ComponentAuthoringInputError(`${label} must be a string for valueType "${valueType}"`)
  }

  if (valueType === 'color' && !isColorPickerValue(value as string)) {
    throw new ComponentAuthoringInputError(
      `${label} must be a ColorPicker-compatible #rgb, #rrggbb, rgb(r,g,b), or rgba(r,g,b,a) value`,
    )
  }
  if (options && !options.some((option) => option.value === value)) {
    throw new ComponentAuthoringInputError(`${label} must equal one of inputs options[].value`)
  }
}

function authoredInputs(value: unknown, requireDefaults: boolean): AuthoredInput[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 40) {
    throw new ComponentAuthoringInputError('inputs must be an array with at most 40 entries')
  }
  const seen = new Set<string>()
  return value.map((raw, index) => {
    const input = record(raw, `inputs[${index}]`)
    assertOnlyKeys(input, [
      'key', 'label', 'valueType', 'required', 'default', 'options', 'min', 'step', 'component',
    ], `inputs[${index}]`)
    const key = requiredString(input.key, `inputs[${index}].key`, 64)
    if (!COMPONENT_ID.test(key) || seen.has(key)) {
      throw new ComponentAuthoringInputError(`inputs[${index}].key must be a unique logical identifier`)
    }
    seen.add(key)
    const valueType = requiredString(input.valueType, `inputs[${index}].valueType`, 20)
    if (!VALUE_TYPES.has(valueType)) {
      throw new ComponentAuthoringInputError(`inputs[${index}].valueType is unsupported`)
    }
    if (input.required !== undefined && typeof input.required !== 'boolean') {
      throw new ComponentAuthoringInputError(`inputs[${index}].required must be a boolean`)
    }
    for (const numericKey of ['min', 'step'] as const) {
      if (input[numericKey] !== undefined && (
        typeof input[numericKey] !== 'number' || !Number.isFinite(input[numericKey])
      )) {
        throw new ComponentAuthoringInputError(`inputs[${index}].${numericKey} must be finite`)
      }
    }
    const component = optionalString(input.component, `inputs[${index}].component`, 32)
    if (component !== undefined && !INPUT_COMPONENTS.has(component)) {
      throw new ComponentAuthoringInputError(`inputs[${index}].component is unsupported`)
    }
    let options: AuthoredInput['options']
    if (input.options !== undefined) {
      if (!Array.isArray(input.options) || input.options.length === 0 || input.options.length > 40) {
        throw new ComponentAuthoringInputError(`inputs[${index}].options must contain 1 to 40 entries`)
      }
      options = input.options.map((rawOption, optionIndex) => {
        const option = record(rawOption, `inputs[${index}].options[${optionIndex}]`)
        assertOnlyKeys(option, ['value', 'label'], `inputs[${index}].options[${optionIndex}]`)
        return {
          value: requiredString(option.value, `inputs[${index}].options[${optionIndex}].value`, 120),
          label: requiredString(option.label, `inputs[${index}].options[${optionIndex}].label`, 120),
        }
      })
    }
    const hasDefault = Object.hasOwn(input, 'default')
    if (requireDefaults && !hasDefault) {
      throw new ComponentAuthoringInputError(
        `inputs[${index}].default is required and must match valueType "${valueType}"`,
      )
    }
    if (hasDefault) validateInputDefault(input.default, valueType, options, `inputs[${index}].default`)
    return {
      key,
      ...(input.label === undefined ? {} : { label: optionalString(input.label, `inputs[${index}].label`) }),
      valueType,
      ...(input.required === undefined ? {} : { required: input.required }),
      ...(hasDefault ? { default: input.default } : {}),
      ...(options === undefined ? {} : { options }),
      ...(input.min === undefined ? {} : { min: input.min as number }),
      ...(input.step === undefined ? {} : { step: input.step as number }),
      ...(component === undefined ? {} : { component }),
    }
  })
}

function authoredEvents(value: unknown): AuthoredEvent[] {
  if (!Array.isArray(value) || value.length > 40) {
    throw new ComponentAuthoringInputError('events must be an array with at most 40 entries')
  }
  const seen = new Set<string>()
  return value.map((raw, index) => {
    const event = record(raw, `events[${index}]`)
    assertOnlyKeys(event, ['id', 'label'], `events[${index}]`)
    const id = requiredString(event.id, `events[${index}].id`, 64)
    if (!COMPONENT_ID.test(id) || seen.has(id)) {
      throw new ComponentAuthoringInputError(`events[${index}].id must be a unique logical identifier`)
    }
    seen.add(id)
    const label = optionalString(event.label, `events[${index}].label`)
    return { id, ...(label === undefined ? {} : { label }) }
  })
}

function validateImplementation(value: unknown): string {
  const implementation = requiredString(value, 'implementation', 50_000)
  const source = `const __authoredComponent = (${implementation});`
  try {
    new Script(`"use strict";(${implementation})`, { filename: 'authored-component.js' })
    const program = parse(source, {
      ecmaVersion: 'latest',
      locations: true,
      ranges: true,
      sourceType: 'module',
    })
    const scope = analyze(program as unknown as Parameters<typeof analyze>[0], {
      ecmaVersion: 2022,
      sourceType: 'module',
    })
    const pendingScopes = scope.globalScope ? [scope.globalScope] : []
    let shadowedReact: (typeof pendingScopes)[number]['variables'][number] | undefined
    while (pendingScopes.length > 0 && !shadowedReact) {
      const current = pendingScopes.pop()!
      shadowedReact = current.variables.find((variable) => variable.name === 'React')
      pendingScopes.push(...current.childScopes)
    }
    if (shadowedReact) {
      const identifier = shadowedReact.identifiers[0]
      const location = identifier?.loc
        ? ` at line ${identifier.loc.start.line}, column ${identifier.loc.start.column + 1}`
        : ''
      throw new ComponentAuthoringInputError(
        `implementation declares or shadows the injected React runtime${location}; `
        + 'use the React binding already in lexical scope and do not redeclare it as a variable, function, class, parameter, destructuring target, or catch binding',
      )
    }
    const unresolved = scope.globalScope?.through.find(
      (reference) => !ALLOWED_IMPLEMENTATION_GLOBALS.has(reference.identifier.name),
    )
    if (unresolved) {
      const { name, loc } = unresolved.identifier
      const location = loc ? ` at line ${loc.start.line}, column ${loc.start.column + 1}` : ''
      throw new ComponentAuthoringInputError(
        `implementation references undeclared identifier "${name}"${location}; `
        + 'use component props, locally declared values, React, or approved JavaScript globals',
      )
    }
  } catch (cause) {
    if (cause instanceof ComponentAuthoringInputError) throw cause
    const message = cause instanceof Error ? cause.message : String(cause)
    throw new ComponentAuthoringInputError(`implementation is not a valid JavaScript expression: ${message}`)
  }
  return implementation
}

function parseAuthoredComponentDefinition(
  value: unknown,
  requireInputDefaults: boolean,
): AuthoredComponentDefinition {
  const input = record(value, 'input')
  assertOnlyKeys(input, ['id', 'label', 'inputs', 'events', 'implementation', 'prompt'], 'input')
  const id = requiredString(input.id, 'id', 64)
  if (!COMPONENT_ID.test(id)) {
    throw new ComponentAuthoringInputError('id must start with a letter and contain only letters, numbers, dot, underscore, or hyphen')
  }
  const label = optionalString(input.label, 'label')
  const prompt = optionalString(input.prompt, 'prompt', 2000)
  const inputs = authoredInputs(input.inputs, requireInputDefaults)
  return {
    schemaVersion: 1,
    manifest: {
      id,
      ...(label === undefined ? {} : { label }),
      ...(inputs === undefined || inputs.length === 0 ? {} : { inputs }),
      events: authoredEvents(input.events),
      ...(prompt === undefined ? {} : { prompt }),
    },
    implementation: validateImplementation(input.implementation),
  }
}

export function parseAuthoredComponent(value: unknown): AuthoredComponentDefinition {
  return parseAuthoredComponentDefinition(value, true)
}

function parseStoredDefinition(bytes: Uint8Array, path: string): AuthoredComponentDefinition {
  let value: unknown
  try {
    value = JSON.parse(decoder.decode(bytes))
  } catch {
    throw new ComponentAuthoringInputError(`${path} is not valid JSON`)
  }
  const stored = record(value, path)
  if (stored.schemaVersion !== 1) {
    throw new ComponentAuthoringInputError(`${path} has an unsupported schemaVersion`)
  }
  const manifest = record(stored.manifest, `${path}.manifest`)
  return parseAuthoredComponentDefinition({
    ...manifest,
    implementation: stored.implementation,
  }, false)
}

function buildComponentModule(definitions: readonly AuthoredComponentDefinition[]): string {
  const lines = [
    '// Generated by game-video component authoring. Edit components/definitions/*.json instead.',
    `const React = globalThis[Symbol.for(${JSON.stringify(REACT_RUNTIME_SYMBOL)})]`,
    `if (!React) throw new Error(${JSON.stringify('game-video React runtime is unavailable')})`,
  ]
  definitions.forEach((definition, index) => {
    lines.push(`const component${index} = (${definition.implementation})`)
  })
  lines.push('export default [')
  definitions.forEach((definition, index) => {
    lines.push(`  { component: component${index}, manifest: ${JSON.stringify(definition.manifest)} },`)
  })
  lines.push(']', '')
  return lines.join('\n')
}

/** Seed a valid empty/project catalog without overwriting an existing module. */
export async function ensureAuthoredComponentModule(
  context: ExtensionContext,
): Promise<boolean> {
  return context.files.withLocks([COMPONENT_WRITE_LOCK], async () => {
    if (await context.files.read(COMPONENT_MODULE_FILE)) return false
    const moduleSource = buildComponentModule(await readDefinitions(context))
    new Script(moduleSource.replace(/export default/u, 'void'), {
      filename: COMPONENT_MODULE_FILE,
    })
    await context.files.write(COMPONENT_MODULE_FILE, encoder.encode(moduleSource))
    return true
  })
}

function componentReferencesInGraph(
  graph: GameGraph,
  componentId: string,
  graphPath: string,
): string[] {
  const references: string[] = []
  for (const node of graph.nodes) {
    const nodePath = `${graphPath}.nodes[${node.id}]`
    for (const [mountIndex, mount] of (node.data.overlayNodes ?? []).entries()) {
      for (const [childIndex, child] of (mount.added ?? []).entries()) {
        if (child.component === componentId) {
          references.push(`${nodePath}.overlayNodes[${mountIndex}].added[${childIndex}]`)
        }
      }
      for (const [childId, patch] of Object.entries(mount.overrides ?? {})) {
        if (patch.component === componentId) {
          references.push(`${nodePath}.overlayNodes[${mountIndex}].overrides[${childId}]`)
        }
      }
    }
    const process = getSubProcess(node.data)
    if (process) {
      references.push(...componentReferencesInGraph(
        process.graph,
        componentId,
        `${nodePath}.subProcess.graph`,
      ))
    }
  }
  return references
}

export function findAuthoredComponentReferences(
  document: GraphLibraryDocument,
  componentId: string,
): string[] {
  const references: string[] = []
  for (const [overlayId, overlay] of Object.entries(document.ui?.overlays ?? {})) {
    for (const [childIndex, child] of overlay.children.entries()) {
      if (child.component === componentId) {
        references.push(`ui.overlays[${overlayId}].children[${childIndex}]`)
      }
    }
  }
  for (const [packId, pack] of Object.entries(document.manifest.packs)) {
    references.push(...componentReferencesInGraph(
      pack.graph,
      componentId,
      `manifest.packs[${packId}].graph`,
    ))
  }
  return references
}

function parseBlueprint(bytes: Uint8Array | null): GraphLibraryDocument | null {
  if (!bytes) return null
  try {
    const value = JSON.parse(decoder.decode(bytes)) as Partial<GraphLibraryDocument>
    return value?.manifest?.packs && typeof value.manifest.packs === 'object'
      ? value as GraphLibraryDocument
      : null
  } catch {
    throw new ComponentAuthoringInputError('blueprint.json is not valid JSON')
  }
}

async function readDefinitions(
  context: ExtensionContext,
  replacingId?: string,
): Promise<AuthoredComponentDefinition[]> {
  const names = (await context.files.list(COMPONENT_DEFINITIONS_DIR))
    .filter((name) => COMPONENT_ID.test(name.replace(/\.json$/u, '')) && name.endsWith('.json'))
    .sort()
  const definitions: AuthoredComponentDefinition[] = []
  for (const name of names) {
    if (name === `${replacingId}.json`) continue
    const path = `${COMPONENT_DEFINITIONS_DIR}/${name}`
    const bytes = await context.files.read(path)
    if (bytes) definitions.push(parseStoredDefinition(bytes, path))
  }
  return definitions
}

/** 读游戏已 authored 组件的结构化 manifest（含 prompt/简介），供 list-ui-components 合并进组件契约。 */
export async function listAuthoredComponentManifests(
  context: ExtensionContext,
): Promise<AuthoredComponentDefinition['manifest'][]> {
  return (await readDefinitions(context)).map((definition) => definition.manifest)
}

export async function listAuthoredComponentIds(context: ExtensionContext): Promise<Set<string>> {
  return new Set((await readDefinitions(context)).map((definition) => definition.manifest.id))
}

/** All component ids the server can currently resolve: built-ins + game-authored. */
export async function knownComponentIds(context: ExtensionContext): Promise<Set<string>> {
  const ids = new Set(componentContracts().map((contract) => contract.id))
  for (const id of await listAuthoredComponentIds(context)) ids.add(id)
  return ids
}

type ParsedCompose = {
  overlayId: string | undefined
  title: string | undefined
  prompt: string | undefined
  children: OverlayChild[]
}

/**
 * Validate the optional `compose` block of upsert-component. Every child must
 * reference a component that is already resolvable (built-in, game-authored,
 * or the brand-new component this same call creates), and child ids must be
 * unique within the template. The overlay id, when provided, must not collide
 * with the reserved `base:` / `node:` namespaces.
 */
export function parseComposedOverlay(
  value: unknown,
  resolvableIds: ReadonlySet<string>,
  newlyCreatedComponentId?: string,
): ParsedCompose {
  const compose = record(value, 'compose')
  assertOnlyKeys(compose, ['id', 'title', 'prompt', 'children'], 'compose')
  const overlayId = optionalString(compose.id, 'compose.id', 64)
  if (overlayId !== undefined && !COMPONENT_ID.test(overlayId)) {
    // COMPONENT_ID 只允许字母/数字/点/下划线/连字符，天然排除 base:/node: 命名空间。
    throw new ComponentAuthoringInputError('compose.id must be a logical identifier (letters, numbers, dot, underscore, hyphen)')
  }
  const title = optionalString(compose.title, 'compose.title')
  const prompt = optionalString(compose.prompt, 'compose.prompt', 2000)

  if (!Array.isArray(compose.children) || compose.children.length === 0 || compose.children.length > 40) {
    throw new ComponentAuthoringInputError('compose.children must contain 1 to 40 entries')
  }
  const seen = new Set<string>()
  const resolvable = new Set(resolvableIds)
  if (newlyCreatedComponentId) resolvable.add(newlyCreatedComponentId)
  const children = compose.children.map((raw, index) => {
    const child = record(raw, `compose.children[${index}]`)
    assertOnlyKeys(child, ['id', 'component', 'inputs', 'layout', 'trigger', 'window', 'note'], `compose.children[${index}]`)
    const id = requiredString(child.id, `compose.children[${index}].id`, 64)
    if (!COMPONENT_ID.test(id) || seen.has(id)) {
      throw new ComponentAuthoringInputError(`compose.children[${index}].id must be a unique logical identifier`)
    }
    seen.add(id)
    const component = requiredString(child.component, `compose.children[${index}].component`, 64)
    if (!resolvable.has(component)) {
      throw new ComponentAuthoringInputError(
        `compose.children[${index}].component '${component}' is not a known control; `
        + 'create it first with upsert-component (single-control form), then compose',
      )
    }
    if (child.inputs !== undefined && record(child.inputs, `compose.children[${index}].inputs`) === undefined) {
      throw new ComponentAuthoringInputError(`compose.children[${index}].inputs must be an object`)
    }
    if (child.layout !== undefined && record(child.layout, `compose.children[${index}].layout`) === undefined) {
      throw new ComponentAuthoringInputError(`compose.children[${index}].layout must be an object`)
    }
    return {
      id,
      component,
      ...(child.inputs !== undefined ? { inputs: child.inputs as Record<string, unknown> } : {}),
      ...(child.layout !== undefined ? { layout: child.layout as OverlayChild['layout'] } : {}),
      ...(child.trigger !== undefined ? { trigger: child.trigger as Trigger } : {}),
      ...(child.window !== undefined ? { window: child.window as OverlayChild['window'] } : {}),
      ...(child.note !== undefined ? { note: optionalString(child.note, `compose.children[${index}].note`, 500) } : {}),
    } satisfies OverlayChild
  })

  return { overlayId, title, prompt, children }
}

/** Derive a collision-free overlay id when the caller did not supply one. */
function deriveOverlayId(
  existing: ReadonlySet<string>,
  parsed: ParsedCompose,
): string {
  if (parsed.overlayId) return parsed.overlayId
  const firstComponent = parsed.children[0]!.component
  const base = `scheme-${firstComponent}`
  let id = base
  let suffix = 2
  while (existing.has(id)) id = `${base}-${suffix++}`
  return id
}

/**
 * Persist a composed template into `ui.overlays`. Shares the graph save lock,
 * document revision and mutation receipts with saveGraph / patchGraph so a
 * concurrent write cannot clobber the template.
 */
export async function writeComposedOverlay(
  context: ExtensionContext,
  parsed: ParsedCompose,
): Promise<{ overlayId: string; title: string | undefined; revision: number }> {
  return context.files.withLocks([GRAPH_SAVE_LOCK], async () => {
    const bytes = await context.files.read(BLUEPRINT_FILE)
    if (!bytes) throw new ComponentAuthoringInputError('blueprint.json is missing; a game must be initialized first')
    const current = parseBlueprint(bytes)
    if (!current) throw new ComponentAuthoringInputError('blueprint.json is not a valid library document')

    const overlays = current.ui?.overlays ?? {}
    const overlayId = deriveOverlayId(new Set(Object.keys(overlays)), parsed)
    const overlay: Overlay = {
      id: overlayId,
      ...(parsed.title ? { title: parsed.title } : {}),
      ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
      children: parsed.children,
    }
    const next = normalizeDocument({
      ...current,
      ui: { ...(current.ui ?? {}), overlays: { ...overlays, [overlayId]: overlay } },
    })
    const errors = validateDocument(next)
    if (errors.length) {
      throw new ComponentAuthoringInputError(errors.join('; '))
    }
    const revision = nextDocumentRevision(readDocumentRevision(bytes))
    await context.files.write(
      BLUEPRINT_FILE,
      encoder.encode(JSON.stringify(stampDocumentRevision(next, revision, readMutationReceipts(bytes)), null, 2)),
    )
    return { overlayId, title: parsed.title, revision }
  })
}

export async function upsertAuthoredComponent(
  context: ExtensionContext,
  value: unknown,
): Promise<UpsertComponentResult> {
  const definition = parseAuthoredComponent(value)
  const definitionPath = `${COMPONENT_DEFINITIONS_DIR}/${definition.manifest.id}.json`
  return context.files.withLocks([COMPONENT_WRITE_LOCK], async () => {
    const created = await context.files.read(definitionPath) === null
    const definitions = await readDefinitions(context, definition.manifest.id)
    definitions.push(definition)
    definitions.sort((left, right) => left.manifest.id.localeCompare(right.manifest.id))
    const moduleSource = buildComponentModule(definitions)
    new Script(moduleSource.replace(/export default/u, 'void'), {
      filename: COMPONENT_MODULE_FILE,
    })
    await context.files.write(
      definitionPath,
      encoder.encode(`${JSON.stringify(definition, null, 2)}\n`),
    )
    await context.files.write(COMPONENT_MODULE_FILE, encoder.encode(moduleSource))
    return {
      ok: true,
      componentId: definition.manifest.id,
      created,
      componentCount: definitions.length,
      definitionPath,
      modulePath: COMPONENT_MODULE_FILE,
      revision: createHash('sha256').update(moduleSource).digest('hex').slice(0, 16),
    }
  })
}

/** UI-only project component deletion. This is intentionally not an AI tool. */
export async function deleteAuthoredComponent(
  context: ExtensionContext,
  componentId: string,
): Promise<DeleteComponentResult> {
  const id = requiredString(componentId, 'id', 64)
  if (!COMPONENT_ID.test(id)) {
    throw new ComponentAuthoringInputError('id must be a logical component identifier')
  }
  const definitionPath = `${COMPONENT_DEFINITIONS_DIR}/${id}.json`
  return context.files.withLocks([COMPONENT_WRITE_LOCK, GRAPH_SAVE_LOCK], async () => {
    const existing = await context.files.read(definitionPath)
    const definitions = await readDefinitions(context, id)
    const moduleSource = buildComponentModule(definitions)
    const revision = createHash('sha256').update(moduleSource).digest('hex').slice(0, 16)
    if (!existing) {
      return {
        ok: true,
        componentId: id,
        deleted: false,
        componentCount: definitions.length,
        definitionPath,
        modulePath: COMPONENT_MODULE_FILE,
        revision,
      }
    }
    const blueprint = parseBlueprint(await context.files.read('blueprint.json'))
    const references = blueprint ? findAuthoredComponentReferences(blueprint, id) : []
    if (references.length) throw new ComponentAuthoringConflictError(id, references)

    new Script(moduleSource.replace(/export default/u, 'void'), {
      filename: COMPONENT_MODULE_FILE,
    })
    // Publish the reduced catalog before deleting its structured source. A retry
    // remains possible if either durable operation fails.
    await context.files.write(COMPONENT_MODULE_FILE, encoder.encode(moduleSource))
    await context.files.delete(definitionPath)
    return {
      ok: true,
      componentId: id,
      deleted: true,
      componentCount: definitions.length,
      definitionPath,
      modulePath: COMPONENT_MODULE_FILE,
      revision,
    }
  })
}
