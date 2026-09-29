import { normalizeDocument } from '@/authoring/blueprint/blueprint-project'
import {
  removeMountEventAction,
  removeMountEventResponse,
  routeMountEventToNode,
  setMountEventActions,
  type EventResponseRemovalScope,
} from '@/authoring/graph/event-response-edit'
import {
  disconnect,
  removeSettlementSpawn,
  setSettlementAdvanceTarget,
  settlementReactionAbsoluteIndex,
  updateEventRouteTiming,
} from '@/authoring/graph/graph-edit'
import {
  mountOverlay,
  patchOverlayChildInMount,
  patchOverlayMount,
  unmountOverlay,
} from '@/authoring/graph/overlay-edit'
import {
  appendSettlementReaction,
  createSettlementReaction,
  removeSettlementAction,
  removeSettlementReaction,
  replaceSettlementReaction,
  type SettlementTrigger,
} from '@/authoring/graph/settlement-edit'
import type {
  ComponentOutput,
  EdgeTransition,
  GameScenario,
  GraphCondition,
  GraphEffect,
  GraphLibraryDocument,
  Layout,
  RoutingSettlement,
} from '@/runtime/core/schema/graph-schema'
import type { NodeAction, OverlayChild, OverlayEventRef } from '@/runtime/core/schema/node-config-schema'
import { isSettlementReaction, overlayMountId } from '@/runtime/core/schema/node-config-schema'
import { resolveMountChildren } from '@/runtime/core/schema/expand-overlay'
import { eventsFromParams, resolveEventReactionDo } from '@/runtime/core/schema/overlay-events'

export interface BlueprintNodeComponentContract {
  id: string
  events: ReadonlyArray<{ id: string; outputs?: readonly ComponentOutput[] }>
  inputs: ReadonlyArray<{ key: string }>
}

export interface SpawnInterfaceConfiguration {
  overlayId: string
  childId: string
  inputs?: Record<string, unknown>
  layout?: Layout
  ttlMs?: number
}

export interface ComponentConfiguration {
  childId: string
  inputs?: Record<string, unknown>
  layout?: Layout
  window?: OverlayChild['window']
  note?: string
}

export interface EventResponseConfiguration {
  childId: string
  eventId: string
  effects?: GraphEffect[]
  targetNodeId?: string
  spawns?: SpawnInterfaceConfiguration[]
  hideMountIds?: string[]
  transition?: EdgeTransition
  routingSettlement?: RoutingSettlement
}

export interface InterfaceConfiguration {
  overlayId: string
  /** Omit to add a new mount; provide an existing id to reconfigure it. */
  mountId?: string
  layout?: Layout
  components?: ComponentConfiguration[]
  eventResponses?: EventResponseConfiguration[]
}

export type SettlementTriggerConfiguration =
  | { type: 'at'; ms: number }
  | { type: 'watch'; of: string; on?: 'change' | 'inc' | 'dec' }
  | { type: 'state'; condition: GraphCondition }

export interface SettlementConfiguration {
  trigger: SettlementTriggerConfiguration
  effects?: GraphEffect[]
  targetNodeId?: string
  /** 总脉络已规划的精确边；提供后禁止按 source/target 猜边或临时造边。 */
  edgeId?: string
  spawns?: SpawnInterfaceConfiguration[]
  hideMountIds?: string[]
}

export interface SettlementUpdateConfiguration extends SettlementConfiguration {
  settlementIndex: number
}

export interface BlueprintNodeRemovalConfiguration {
  interfaces?: Array<{ mountId: string }>
  eventResponses?: Array<{
    mountId: string
    childId: string
    eventId: string
    scope?: EventResponseRemovalScope
  }>
  eventActions?: Array<{
    mountId: string
    childId: string
    eventId: string
    actionIndex: number
    expectedKind: NodeAction['kind']
  }>
  settlements?: Array<{ settlementIndex: number }>
  settlementActions?: Array<{
    settlementIndex: number
    actionIndex: number
    expectedKind: NodeAction['kind']
  }>
  edges?: Array<{ edgeId: string }>
}

export interface ConfigureBlueprintNodeInput {
  blueprintId?: string
  nodeId: string
  interfaces?: InterfaceConfiguration[]
  settlements?: SettlementConfiguration[]
  settlementUpdates?: SettlementUpdateConfiguration[]
  removals?: BlueprintNodeRemovalConfiguration
}

export interface ConfigureBlueprintNodeMetrics {
  interfacesConfigured: number
  mountsCreated: number
  componentOverrides: number
  eventResponsesConfigured: number
  settlementsCreated: number
  settlementsUpdated: number
  edgesCreatedOrReused: number
  interfacesRemoved: number
  eventResponsesRemoved: number
  eventActionsRemoved: number
  settlementsRemoved: number
  settlementActionsRemoved: number
  edgesRemoved: number
}

export type ConfigureBlueprintNodeResult =
  | {
      ok: true
      document: GraphLibraryDocument
      blueprintId: string
      nodeId: string
      applied: number
      mounts: Array<{ overlayId: string; mountId: string; created: boolean }>
      metrics: ConfigureBlueprintNodeMetrics
      reusedPrimitives: string[]
    }
  | { ok: false; errors: string[]; failedPath?: string }

class CommandInputError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`)
  }
}

function fail(path: string, message: string): never {
  throw new CommandInputError(path, message)
}

function nodeOf(scenario: GameScenario, nodeId: string) {
  return scenario.graph.nodes.find((candidate) => candidate.id === nodeId)
}

function mountOf(scenario: GameScenario, nodeId: string, mountId: string) {
  return nodeOf(scenario, nodeId)?.data.overlayNodes?.find(
    (mount) => overlayMountId(mount) === mountId,
  )
}

function childOf(scenario: GameScenario, nodeId: string, mountId: string, childId: string) {
  const mount = mountOf(scenario, nodeId, mountId)
  return mount
    ? resolveMountChildren(scenario.ui?.overlays, mount).find((child) => child.id === childId)
    : undefined
}

function validateTarget(scenario: GameScenario, nodeId: string, targetId: string, path: string): void {
  if (targetId === nodeId) fail(path, 'self-loop targets are not supported')
  if (!nodeOf(scenario, targetId)) fail(path, `target node not found: ${targetId}`)
}

function spawnAction(
  scenario: GameScenario,
  input: SpawnInterfaceConfiguration,
  contracts: ReadonlyMap<string, BlueprintNodeComponentContract>,
  path: string,
): Extract<NodeAction, { kind: 'spawn' }> {
  const overlay = scenario.ui?.overlays?.[input.overlayId]
  if (!overlay) fail(`${path}.overlayId`, `overlay not found: ${input.overlayId}`)
  const child = overlay.children.find((candidate) => candidate.id === input.childId)
  if (!child) {
    fail(`${path}.childId`, `child ${input.childId} is not part of ${input.overlayId}`)
  }
  validateComponentInputs(child, input.inputs, contracts, `${path}.inputs`)
  return {
    kind: 'spawn',
    from: `${input.overlayId}/${input.childId}`,
    ...(input.inputs ? { inputs: structuredClone(input.inputs) } : {}),
    ...(input.layout ? { layout: structuredClone(input.layout) } : {}),
    ...(input.ttlMs === undefined ? {} : { ttlMs: input.ttlMs }),
  }
}

function eventRef(
  scenario: GameScenario,
  nodeId: string,
  contracts: ReadonlyMap<string, BlueprintNodeComponentContract>,
  child: OverlayChild,
  mountId: string,
  eventId: string,
): OverlayEventRef {
  // 与 aggregateOverlayEvents 一致的稳定 event id 命名空间：
  // 多挂载 → `${mountId}:${local}`；多交互 child → `${childId}:${eventId}`。
  // localEventId 保持组件 emit 的裸 key，供运行时 resolveEventReactions 别名回退。
  const multi = (nodeOf(scenario, nodeId)?.data.overlayNodes?.length ?? 0) > 1
  const mount = mountOf(scenario, nodeId, mountId)
  const children = mount ? resolveMountChildren(scenario.ui?.overlays, mount) : [child]
  const childNs = children.filter((candidate) => {
    const dynamic = eventsFromParams(candidate.inputs)
    const events = dynamic.length > 0 ? dynamic : (contracts.get(candidate.component)?.events ?? [])
    return events.length > 0
  }).length > 1
  const local = childNs ? `${child.id}:${eventId}` : eventId
  return {
    eventId: multi ? `${mountId}:${local}` : local,
    localEventId: eventId,
    mountId,
    childId: child.id,
    componentId: child.component,
  }
}

function validateComponentInputs(
  child: OverlayChild,
  inputs: Record<string, unknown> | undefined,
  contracts: ReadonlyMap<string, BlueprintNodeComponentContract>,
  path: string,
): void {
  if (!inputs) return
  const contract = contracts.get(child.component)
  if (!contract) fail(path, `component contract not found: ${child.component}; call list_ui_components first`)
  const allowed = new Set(contract.inputs.map((input) => input.key))
  for (const key of Object.keys(inputs)) {
    if (!allowed.has(key)) fail(`${path}.${key}`, `unknown input for ${child.component}`)
  }
}

function validateComponentEvent(
  child: OverlayChild,
  eventId: string,
  contracts: ReadonlyMap<string, BlueprintNodeComponentContract>,
  path: string,
): void {
  const dynamic = eventsFromParams(child.inputs).map((event) => event.id)
  const contract = contracts.get(child.component)
  const allowed = dynamic.length > 0 ? dynamic : (contract?.events.map((event) => event.id) ?? [])
  if (!contract && dynamic.length === 0) {
    fail(path, `component contract not found: ${child.component}; call list_ui_components first`)
  }
  if (!allowed.includes(eventId)) {
    fail(path, `event ${eventId} is not declared by ${child.component}; expected ${allowed.join(', ') || '(none)'}`)
  }
}

function responseActions(
  scenario: GameScenario,
  response: EventResponseConfiguration,
  contracts: ReadonlyMap<string, BlueprintNodeComponentContract>,
  path: string,
): NodeAction[] {
  const actions: NodeAction[] = []
  if (response.effects?.length) {
    actions.push({ kind: 'effect', effects: structuredClone(response.effects) })
  }
  for (const [index, spawn] of (response.spawns ?? []).entries()) {
    actions.push(spawnAction(scenario, spawn, contracts, `${path}.spawns[${index}]`))
  }
  for (const mountId of response.hideMountIds ?? []) {
    actions.push({ kind: 'hideOverlay', mountId })
  }
  return actions
}

function settlementTrigger(input: SettlementTriggerConfiguration, path: string): SettlementTrigger {
  if (input.type === 'at') {
    if (!Number.isFinite(input.ms) || input.ms < 0) fail(`${path}.ms`, 'must be a non-negative number')
    return { type: 'at', ms: Math.round(input.ms) }
  }
  if (input.type === 'watch') {
    if (!input.of.trim()) fail(`${path}.of`, 'must be non-empty')
    return { type: 'watch', of: input.of, ...(input.on ? { on: input.on } : {}) }
  }
  return { type: 'state', condition: structuredClone(input.condition) }
}

function hasRemovals(removals: BlueprintNodeRemovalConfiguration | undefined): boolean {
  return !!removals && Object.values(removals).some((entries) => entries && entries.length > 0)
}

function settlementOf(scenario: GameScenario, nodeId: string, settlementIndex: number) {
  return nodeOf(scenario, nodeId)?.data.reactions?.filter(isSettlementReaction)[settlementIndex]
}

function mountEventIds(
  scenario: GameScenario,
  nodeId: string,
  mountId: string,
  contracts: ReadonlyMap<string, BlueprintNodeComponentContract>,
): string[] {
  const mount = mountOf(scenario, nodeId, mountId)
  if (!mount) return []
  const ids = new Set<string>()
  for (const child of resolveMountChildren(scenario.ui?.overlays, mount)) {
    const dynamic = eventsFromParams(child.inputs)
    const events = dynamic.length > 0 ? dynamic : (contracts.get(child.component)?.events ?? [])
    for (const event of events) ids.add(event.id)
  }
  return [...ids]
}

function settlementActions(
  scenario: GameScenario,
  nodeId: string,
  config: SettlementConfiguration,
  contracts: ReadonlyMap<string, BlueprintNodeComponentContract>,
  path: string,
): { actions: NodeAction[], advanceActionIndex?: number } {
  if (config.targetNodeId) validateTarget(scenario, nodeId, config.targetNodeId, `${path}.targetNodeId`)
  if (config.edgeId) {
    if (!config.targetNodeId) fail(`${path}.edgeId`, 'edgeId requires targetNodeId')
    const edge = scenario.graph.edges.find((candidate) => candidate.id === config.edgeId)
    if (!edge) fail(`${path}.edgeId`, `planned edge not found: ${config.edgeId}`)
    if (edge.source !== nodeId || edge.target !== config.targetNodeId) {
      fail(`${path}.edgeId`, `planned edge ${config.edgeId} must be ${nodeId} -> ${config.targetNodeId}`)
    }
  }
  for (const [hideIndex, mountId] of (config.hideMountIds ?? []).entries()) {
    if (!mountOf(scenario, nodeId, mountId)) {
      fail(`${path}.hideMountIds[${hideIndex}]`, `mount not found: ${mountId}`)
    }
  }
  const actions: NodeAction[] = []
  if (config.effects?.length) actions.push({ kind: 'effect', effects: structuredClone(config.effects) })
  for (const [spawnIndex, spawn] of (config.spawns ?? []).entries()) {
    actions.push(spawnAction(scenario, spawn, contracts, `${path}.spawns[${spawnIndex}]`))
  }
  for (const mountId of config.hideMountIds ?? []) actions.push({ kind: 'hideOverlay', mountId })
  const advanceActionIndex = config.targetNodeId ? actions.length : undefined
  if (config.targetNodeId) actions.push({ kind: 'advance', edgeId: '' })
  if (actions.length === 0) fail(path, 'settlement must contain an effect, connection, spawn, or hide action')
  return { actions, advanceActionIndex }
}

/** Configure one node's interfaces and settlements as one pure aggregate command. */
export function configureBlueprintNode(
  inputDocument: GraphLibraryDocument,
  input: ConfigureBlueprintNodeInput,
  componentContracts: ReadonlyMap<string, BlueprintNodeComponentContract>,
): ConfigureBlueprintNodeResult {
  try {
    const document = normalizeDocument(structuredClone(inputDocument))
    const blueprintId = input.blueprintId ?? document.manifest.mainPackId
    const pack = document.manifest.packs[blueprintId]
    if (!pack) fail('blueprintId', `blueprint not found: ${blueprintId}`)
    if (!input.nodeId) fail('nodeId', 'must be non-empty')
    if (!(
      input.interfaces?.length
      || input.settlements?.length
      || input.settlementUpdates?.length
      || hasRemovals(input.removals)
    )) {
      fail('request', 'at least one interface, settlement, settlement update, or removal is required')
    }
    if (
      input.settlementUpdates?.length
      && (input.removals?.settlements?.length || input.removals?.settlementActions?.length)
    ) {
      fail('request', 'settlementUpdates cannot be combined with settlement or settlement-action removals')
    }

    let scenario: GameScenario = { ...document, graph: pack.graph }
    if (!nodeOf(scenario, input.nodeId)) fail('nodeId', `node not found: ${input.nodeId}`)
    const mounts: Array<{ overlayId: string; mountId: string; created: boolean }> = []
    const reused = new Set<string>()
    const metrics: ConfigureBlueprintNodeMetrics = {
      interfacesConfigured: 0,
      mountsCreated: 0,
      componentOverrides: 0,
      eventResponsesConfigured: 0,
      settlementsCreated: 0,
      settlementsUpdated: 0,
      edgesCreatedOrReused: 0,
      interfacesRemoved: 0,
      eventResponsesRemoved: 0,
      eventActionsRemoved: 0,
      settlementsRemoved: 0,
      settlementActionsRemoved: 0,
      edgesRemoved: 0,
    }

    const eventActionRemovals = (input.removals?.eventActions ?? []).map(
      (removal, originalIndex) => ({ removal, originalIndex }),
    ).sort(
      (left, right) => right.removal.actionIndex - left.removal.actionIndex,
    )
    for (const { removal, originalIndex } of eventActionRemovals) {
      const path = `removals.eventActions[${originalIndex}]`
      const mount = mountOf(scenario, input.nodeId, removal.mountId)
      if (!mount) fail(`${path}.mountId`, `mount not found: ${removal.mountId}`)
      const child = childOf(scenario, input.nodeId, removal.mountId, removal.childId)
      if (!child) fail(`${path}.childId`, `child not found in mount ${removal.mountId}: ${removal.childId}`)
      validateComponentEvent(child, removal.eventId, componentContracts, `${path}.eventId`)
      const action = resolveEventReactionDo(
        mount.reactions,
        removal.eventId,
        removal.childId,
        removal.mountId,
      )?.[removal.actionIndex]
      if (!action) fail(`${path}.actionIndex`, `event action not found: ${removal.actionIndex}`)
      if (action.kind !== removal.expectedKind) {
        fail(`${path}.expectedKind`, `expected ${removal.expectedKind}, found ${action.kind}`)
      }
      const beforeEdges = scenario.graph.edges.length
      scenario = {
        ...scenario,
        graph: removeMountEventAction(
          scenario.graph,
          input.nodeId,
          removal.mountId,
          eventRef(scenario, input.nodeId, componentContracts, child, removal.mountId, removal.eventId),
          removal.actionIndex,
        ),
      }
      metrics.eventActionsRemoved += 1
      metrics.edgesRemoved += beforeEdges - scenario.graph.edges.length
      reused.add('removeMountEventAction')
    }

    for (const [removalIndex, removal] of (input.removals?.eventResponses ?? []).entries()) {
      const path = `removals.eventResponses[${removalIndex}]`
      const mount = mountOf(scenario, input.nodeId, removal.mountId)
      if (!mount) fail(`${path}.mountId`, `mount not found: ${removal.mountId}`)
      const child = childOf(scenario, input.nodeId, removal.mountId, removal.childId)
      if (!child) fail(`${path}.childId`, `child not found in mount ${removal.mountId}: ${removal.childId}`)
      validateComponentEvent(child, removal.eventId, componentContracts, `${path}.eventId`)
      const beforeEdges = scenario.graph.edges.length
      scenario = {
        ...scenario,
        graph: removeMountEventResponse(
          scenario.graph,
          input.nodeId,
          removal.mountId,
          eventRef(scenario, input.nodeId, componentContracts, child, removal.mountId, removal.eventId),
          removal.scope,
        ),
      }
      metrics.eventResponsesRemoved += 1
      metrics.edgesRemoved += beforeEdges - scenario.graph.edges.length
      reused.add('removeMountEventResponse')
    }

    for (const [removalIndex, removal] of (input.removals?.edges ?? []).entries()) {
      const path = `removals.edges[${removalIndex}]`
      const edge = scenario.graph.edges.find((candidate) => candidate.id === removal.edgeId)
      if (!edge) fail(`${path}.edgeId`, `edge not found: ${removal.edgeId}`)
      if (edge.source !== input.nodeId) {
        fail(`${path}.edgeId`, `edge ${removal.edgeId} is not owned by node ${input.nodeId}`)
      }
      scenario = { ...scenario, graph: disconnect(scenario.graph, removal.edgeId) }
      metrics.edgesRemoved += 1
      reused.add('disconnect')
    }

    const settlementActionRemovals = (input.removals?.settlementActions ?? []).map(
      (removal, originalIndex) => ({ removal, originalIndex }),
    ).sort(
      (left, right) => right.removal.settlementIndex - left.removal.settlementIndex
        || right.removal.actionIndex - left.removal.actionIndex,
    )
    for (const { removal, originalIndex } of settlementActionRemovals) {
      const path = `removals.settlementActions[${originalIndex}]`
      const settlement = settlementOf(scenario, input.nodeId, removal.settlementIndex)
      if (!settlement) fail(`${path}.settlementIndex`, `settlement not found: ${removal.settlementIndex}`)
      const action = settlement.do[removal.actionIndex]
      if (!action) fail(`${path}.actionIndex`, `settlement action not found: ${removal.actionIndex}`)
      if (action.kind !== removal.expectedKind) {
        fail(`${path}.expectedKind`, `expected ${removal.expectedKind}, found ${action.kind}`)
      }
      const beforeEdges = scenario.graph.edges.length
      scenario = {
        ...scenario,
        graph: action.kind === 'spawn'
          ? removeSettlementSpawn(
            scenario.graph,
            input.nodeId,
            removal.settlementIndex,
            removal.actionIndex,
          )
          : removeSettlementAction(
            scenario.graph,
            input.nodeId,
            removal.settlementIndex,
            removal.actionIndex,
          ),
      }
      metrics.settlementActionsRemoved += 1
      metrics.edgesRemoved += beforeEdges - scenario.graph.edges.length
      reused.add(action.kind === 'spawn' ? 'removeSettlementSpawn' : 'removeSettlementAction')
    }

    const settlementRemovals = (input.removals?.settlements ?? []).map(
      (removal, originalIndex) => ({ removal, originalIndex }),
    ).sort(
      (left, right) => right.removal.settlementIndex - left.removal.settlementIndex,
    )
    for (const { removal, originalIndex } of settlementRemovals) {
      const path = `removals.settlements[${originalIndex}]`
      if (!settlementOf(scenario, input.nodeId, removal.settlementIndex)) {
        fail(`${path}.settlementIndex`, `settlement not found: ${removal.settlementIndex}`)
      }
      const beforeEdges = scenario.graph.edges.length
      scenario = {
        ...scenario,
        graph: removeSettlementReaction(scenario.graph, input.nodeId, removal.settlementIndex),
      }
      metrics.settlementsRemoved += 1
      metrics.edgesRemoved += beforeEdges - scenario.graph.edges.length
      reused.add('removeSettlementReaction')
    }

    for (const [removalIndex, removal] of (input.removals?.interfaces ?? []).entries()) {
      const path = `removals.interfaces[${removalIndex}]`
      if (!mountOf(scenario, input.nodeId, removal.mountId)) {
        fail(`${path}.mountId`, `mount not found: ${removal.mountId}`)
      }
      const beforeEdges = scenario.graph.edges.length
      scenario = unmountOverlay(
        scenario,
        input.nodeId,
        removal.mountId,
        mountEventIds(scenario, input.nodeId, removal.mountId, componentContracts),
      )
      metrics.interfacesRemoved += 1
      metrics.edgesRemoved += beforeEdges - scenario.graph.edges.length
      reused.add('unmountOverlay')
      reused.add('disconnect')
    }

    for (const [interfaceIndex, config] of (input.interfaces ?? []).entries()) {
      const path = `interfaces[${interfaceIndex}]`
      if (!scenario.ui?.overlays?.[config.overlayId]) {
        fail(`${path}.overlayId`, `overlay not found: ${config.overlayId}`)
      }
      let mountId = config.mountId
      let created = false
      if (mountId) {
        const existing = mountOf(scenario, input.nodeId, mountId)
        if (!existing) fail(`${path}.mountId`, `mount not found: ${mountId}`)
        if (existing.overlay !== config.overlayId) {
          fail(`${path}.overlayId`, `mount ${mountId} uses ${existing.overlay}, not ${config.overlayId}`)
        }
      } else {
        const mounted = mountOverlay(scenario, input.nodeId, config.overlayId, config.layout)
        if (!mounted.mountId) fail(path, 'failed to mount interface')
        scenario = mounted.scenario
        mountId = mounted.mountId
        created = true
        metrics.mountsCreated += 1
        reused.add('mountOverlay')
        reused.add('mountOverlayOnGraph')
      }
      if (!created && config.layout) {
        scenario = patchOverlayMount(scenario, input.nodeId, mountId, {
          layout: structuredClone(config.layout),
        })
        reused.add('patchOverlayMount')
      }
      mounts.push({ overlayId: config.overlayId, mountId, created })
      metrics.interfacesConfigured += 1

      for (const [componentIndex, component] of (config.components ?? []).entries()) {
        const componentPath = `${path}.components[${componentIndex}]`
        const child = childOf(scenario, input.nodeId, mountId, component.childId)
        if (!child) fail(`${componentPath}.childId`, `child not found in mount ${mountId}: ${component.childId}`)
        validateComponentInputs(child, component.inputs, componentContracts, `${componentPath}.inputs`)
        const patch: Partial<OverlayChild> = {
          ...(component.inputs ? { inputs: structuredClone(component.inputs) } : {}),
          ...(component.layout ? { layout: structuredClone(component.layout) } : {}),
          ...(component.window ? { window: structuredClone(component.window) } : {}),
          ...(component.note === undefined ? {} : { note: component.note }),
        }
        scenario = patchOverlayChildInMount(scenario, input.nodeId, mountId, component.childId, patch)
        reused.add('patchOverlayChildInMount')
        metrics.componentOverrides += 1
      }

      for (const [responseIndex, response] of (config.eventResponses ?? []).entries()) {
        const responsePath = `${path}.eventResponses[${responseIndex}]`
        const child = childOf(scenario, input.nodeId, mountId, response.childId)
        if (!child) fail(`${responsePath}.childId`, `child not found in mount ${mountId}: ${response.childId}`)
        validateComponentEvent(child, response.eventId, componentContracts, `${responsePath}.eventId`)
        if (response.targetNodeId) {
          validateTarget(scenario, input.nodeId, response.targetNodeId, `${responsePath}.targetNodeId`)
        }
        if (response.transition && !response.targetNodeId) {
          fail(`${responsePath}.transition`, 'requires targetNodeId')
        }
        if (response.routingSettlement && response.transition !== 'onSettlement') {
          fail(`${responsePath}.routingSettlement`, 'requires transition "onSettlement"')
        }
        for (const [hideIndex, hideMountId] of (response.hideMountIds ?? []).entries()) {
          if (!mountOf(scenario, input.nodeId, hideMountId)) {
            fail(`${responsePath}.hideMountIds[${hideIndex}]`, `mount not found: ${hideMountId}`)
          }
        }
        const actions = responseActions(scenario, response, componentContracts, responsePath)
        if (!actions.length && !response.targetNodeId) {
          fail(responsePath, 'event response must contain an effect, connection, spawn, or hide action')
        }
        const event = eventRef(scenario, input.nodeId, componentContracts, child, mountId, response.eventId)
        scenario = {
          ...scenario,
          graph: setMountEventActions(scenario.graph, input.nodeId, mountId, event, actions),
        }
        reused.add('setMountEventActions')
        if (response.targetNodeId) {
          scenario = {
            ...scenario,
            graph: routeMountEventToNode(
              scenario.graph,
              input.nodeId,
              mountId,
              event,
              response.targetNodeId,
            ),
          }
          reused.add('routeMountEventToNode')
          metrics.edgesCreatedOrReused += 1
          if (response.transition) {
            scenario = {
              ...scenario,
              graph: updateEventRouteTiming(
                scenario.graph,
                input.nodeId,
                event.eventId,
                response.transition,
                response.routingSettlement,
              ),
            }
            reused.add('updateEventRouteTiming')
          }
        }
        metrics.eventResponsesConfigured += 1
      }
    }

    for (const [updateIndex, config] of (input.settlementUpdates ?? []).entries()) {
      const path = `settlementUpdates[${updateIndex}]`
      if (!settlementOf(scenario, input.nodeId, config.settlementIndex)) {
        fail(`${path}.settlementIndex`, `settlement not found: ${config.settlementIndex}`)
      }
      const { actions, advanceActionIndex } = settlementActions(
        scenario,
        input.nodeId,
        config,
        componentContracts,
        path,
      )
      const beforeEdges = scenario.graph.edges.length
      scenario = {
        ...scenario,
        graph: replaceSettlementReaction(
          scenario.graph,
          input.nodeId,
          config.settlementIndex,
          createSettlementReaction(settlementTrigger(config.trigger, `${path}.trigger`), actions),
        ),
      }
      metrics.edgesRemoved += beforeEdges - scenario.graph.edges.length
      reused.add('createSettlementReaction')
      reused.add('replaceSettlementReaction')
      if (config.targetNodeId && advanceActionIndex !== undefined) {
        scenario = {
          ...scenario,
          graph: setSettlementAdvanceTarget(
            scenario.graph,
            input.nodeId,
            config.settlementIndex,
            advanceActionIndex,
            config.targetNodeId,
            config.edgeId,
          ),
        }
        reused.add('setSettlementAdvanceTarget')
        metrics.edgesCreatedOrReused += 1
      }
      metrics.settlementsUpdated += 1
    }

    for (const [settlementIndex, config] of (input.settlements ?? []).entries()) {
      const path = `settlements[${settlementIndex}]`
      const { actions, advanceActionIndex } = settlementActions(
        scenario,
        input.nodeId,
        config,
        componentContracts,
        path,
      )
      const appended = appendSettlementReaction(
        scenario.graph,
        input.nodeId,
        createSettlementReaction(settlementTrigger(config.trigger, `${path}.trigger`), actions),
      )
      if (appended.settlementIndex === undefined) fail(path, 'failed to append settlement')
      scenario = { ...scenario, graph: appended.graph }
      reused.add('createSettlementReaction')
      reused.add('appendSettlementReaction')
      if (config.targetNodeId && advanceActionIndex !== undefined) {
        scenario = {
          ...scenario,
          graph: setSettlementAdvanceTarget(
            scenario.graph,
            input.nodeId,
            appended.settlementIndex,
            advanceActionIndex,
            config.targetNodeId,
            config.edgeId,
          ),
        }
        reused.add('setSettlementAdvanceTarget')
        metrics.edgesCreatedOrReused += 1
      }
      metrics.settlementsCreated += 1
    }

    const packs = {
      ...document.manifest.packs,
      [blueprintId]: { ...pack, graph: scenario.graph },
    }
    const nextDocument = normalizeDocument({
      ...scenario,
      manifest: { ...document.manifest, packs },
    } as GraphLibraryDocument)
    return {
      ok: true,
      document: nextDocument,
      blueprintId,
      nodeId: input.nodeId,
      applied: metrics.interfacesConfigured
        + metrics.settlementsCreated
        + metrics.settlementsUpdated
        + metrics.interfacesRemoved
        + metrics.eventResponsesRemoved
        + metrics.eventActionsRemoved
        + metrics.settlementsRemoved
        + metrics.settlementActionsRemoved
        + (input.removals?.edges?.length ?? 0),
      mounts,
      metrics,
      reusedPrimitives: [...reused],
    }
  } catch (error) {
    if (error instanceof CommandInputError) {
      return { ok: false, errors: [error.message], failedPath: error.path }
    }
    throw error
  }
}
