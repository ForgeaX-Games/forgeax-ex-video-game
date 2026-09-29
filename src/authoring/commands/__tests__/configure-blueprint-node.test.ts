import { describe, expect, test } from 'vitest'
import { documentFromBlueprints } from '@/authoring/blueprint/blueprint-project'
import {
  configureBlueprintNode,
  type BlueprintNodeComponentContract,
} from '../configure-blueprint-node'
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'

function fixture(): GraphLibraryDocument {
  return documentFromBlueprints({
    'bp-main': {
      id: 'bp-main',
      title: 'Main',
      entry: 'entry',
      graph: {
        nodes: [
          { id: 'entry', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: 'Entry' } },
          { id: 'next', type: 'perf', position: { x: 240, y: 0 }, inputs: [], outputs: [], data: { name: 'Next' } },
        ],
        edges: [],
      },
    },
  }, 'bp-main', {
    variables: { score: { id: 'score', initial: 0 } },
    ui: {
      overlays: {
        'base:choice': {
          id: 'base:choice',
          children: [{
            id: 'choice',
            component: 'test.choice',
            layout: { left: 0, top: 0, width: 1, height: 1 },
            inputs: { label: 'Original' },
          }],
        },
      },
    },
  })
}

const contracts = new Map<string, BlueprintNodeComponentContract>([[
  'test.choice',
  {
    id: 'test.choice',
    inputs: [{ key: 'label' }],
    events: [{ id: 'confirm' }],
  },
]])

describe('configureBlueprintNode', () => {
  test('configures interface content, event response, and settlement in one transaction', () => {
    const result = configureBlueprintNode(fixture(), {
      nodeId: 'entry',
      interfaces: [{
        overlayId: 'base:choice',
        components: [{ childId: 'choice', inputs: { label: 'Continue' } }],
        eventResponses: [{
          childId: 'choice',
          eventId: 'confirm',
          effects: [{ kind: 'var', varId: 'score', op: 'add', value: 1 }],
          targetNodeId: 'next',
        }],
      }],
      settlements: [{
        trigger: { type: 'at', ms: 3200 },
        effects: [{ kind: 'var', varId: 'score', op: 'add', value: 2 }],
        spawns: [{ overlayId: 'base:choice', childId: 'choice', ttlMs: 800 }],
        targetNodeId: 'next',
      }],
    }, contracts)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.metrics).toEqual({
      interfacesConfigured: 1,
      mountsCreated: 1,
      componentOverrides: 1,
      eventResponsesConfigured: 1,
      settlementsCreated: 1,
      settlementsUpdated: 0,
      edgesCreatedOrReused: 2,
      interfacesRemoved: 0,
      eventResponsesRemoved: 0,
      eventActionsRemoved: 0,
      settlementsRemoved: 0,
      settlementActionsRemoved: 0,
      edgesRemoved: 0,
    })
    expect(result.reusedPrimitives).toEqual(expect.arrayContaining([
      'mountOverlay',
      'patchOverlayChildInMount',
      'setMountEventActions',
      'routeMountEventToNode',
      'createSettlementReaction',
      'appendSettlementReaction',
      'setSettlementAdvanceTarget',
    ]))

    const node = result.document.graph.nodes.find((candidate) => candidate.id === 'entry')!
    expect(node.data.overlayNodes).toHaveLength(1)
    expect(node.data.overlayNodes![0]).toMatchObject({
      overlay: 'base:choice',
      layout: { left: 0, top: 0, width: 1, height: 1 },
      overrides: { choice: { inputs: { label: 'Continue' } } },
    })
    const eventReaction = node.data.overlayNodes![0]!.reactions?.find(
      (reaction) => reaction.when.type === 'event' && reaction.when.id === 'confirm',
    )
    expect(eventReaction?.do.map((action) => action.kind)).toEqual(['effect', 'advance'])
    expect(node.data.reactions?.[0]).toMatchObject({
      when: { type: 'at', ms: 3200 },
      do: [
        { kind: 'effect' },
        { kind: 'spawn', from: 'base:choice/choice', ttlMs: 800 },
        { kind: 'advance' },
      ],
    })
    expect(result.document.graph.edges.some(
      (edge) => edge.source === 'entry' && edge.target === 'next',
    )).toBe(true)
  })

  test('returns a precise path and leaves the input untouched when a later step fails', () => {
    const document = fixture()
    const before = JSON.stringify(document)
    const result = configureBlueprintNode(document, {
      nodeId: 'entry',
      interfaces: [
        { overlayId: 'base:choice' },
        { overlayId: 'base:missing' },
      ],
    }, contracts)

    expect(result).toMatchObject({
      ok: false,
      failedPath: 'interfaces[1].overlayId',
    })
    expect(JSON.stringify(document)).toBe(before)
  })

  test('binds a settlement to the exact outline edge and rejects endpoint drift', () => {
    const document = fixture()
    const edge = {
      id: 'outline-settlement-edge',
      source: 'entry',
      sourceHandle: 'timeout',
      target: 'next',
      targetHandle: 'in',
    }
    document.graph.edges.push(edge)

    const configured = configureBlueprintNode(document, {
      nodeId: 'entry',
      settlements: [{
        trigger: { type: 'at', ms: 1200 },
        targetNodeId: 'next',
        edgeId: 'outline-settlement-edge',
      }],
    }, contracts)

    expect(configured.ok).toBe(true)
    if (!configured.ok) return
    const advance = configured.document.graph.nodes[0]!.data.reactions?.[0]?.do
      .find((action) => action.kind === 'advance')
    expect(advance).toEqual({ kind: 'advance', edgeId: 'outline-settlement-edge' })
    expect(configured.document.graph.edges).toHaveLength(1)

    const rejected = configureBlueprintNode(document, {
      nodeId: 'entry',
      settlements: [{
        trigger: { type: 'at', ms: 1200 },
        targetNodeId: 'next',
        edgeId: 'missing-edge',
      }],
    }, contracts)
    expect(rejected).toMatchObject({ ok: false, failedPath: 'settlements[0].edgeId' })
  })

  test('rejects undeclared component inputs and events before producing a document', () => {
    const badInput = configureBlueprintNode(fixture(), {
      nodeId: 'entry',
      interfaces: [{
        overlayId: 'base:choice',
        components: [{ childId: 'choice', inputs: { guessedKey: true } }],
      }],
    }, contracts)
    expect(badInput).toMatchObject({
      ok: false,
      failedPath: 'interfaces[0].components[0].inputs.guessedKey',
    })

    const badEvent = configureBlueprintNode(fixture(), {
      nodeId: 'entry',
      interfaces: [{
        overlayId: 'base:choice',
        eventResponses: [{ childId: 'choice', eventId: 'guessed', targetNodeId: 'next' }],
      }],
    }, contracts)
    expect(badEvent).toMatchObject({
      ok: false,
      failedPath: 'interfaces[0].eventResponses[0].eventId',
    })

    const badSpawnInput = configureBlueprintNode(fixture(), {
      nodeId: 'entry',
      settlements: [{
        trigger: { type: 'at', ms: 1000 },
        spawns: [{
          overlayId: 'base:choice',
          childId: 'choice',
          inputs: { guessedKey: true },
        }],
      }],
    }, contracts)
    expect(badSpawnInput).toMatchObject({
      ok: false,
      failedPath: 'settlements[0].spawns[0].inputs.guessedKey',
    })
  })

  test('rejects routing settlement metadata unless the event route is deferred', () => {
    const result = configureBlueprintNode(fixture(), {
      nodeId: 'entry',
      interfaces: [{
        overlayId: 'base:choice',
        eventResponses: [{
          childId: 'choice',
          eventId: 'confirm',
          targetNodeId: 'next',
          transition: 'immediate',
          routingSettlement: { type: 'complete' },
        }],
      }],
    }, contracts)

    expect(result).toMatchObject({
      ok: false,
      failedPath: 'interfaces[0].eventResponses[0].routingSettlement',
    })
  })

  test('unmounts an interface and cascades every event route from that mount', () => {
    const configured = configureBlueprintNode(fixture(), {
      nodeId: 'entry',
      interfaces: [{
        overlayId: 'base:choice',
        eventResponses: [{ childId: 'choice', eventId: 'confirm', targetNodeId: 'next' }],
      }],
    }, contracts)
    expect(configured.ok).toBe(true)
    if (!configured.ok) return

    const removed = configureBlueprintNode(configured.document, {
      nodeId: 'entry',
      removals: { interfaces: [{ mountId: 'base:choice' }] },
    }, contracts)
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(removed.document.graph.nodes.find((node) => node.id === 'entry')?.data.overlayNodes)
      .toBeUndefined()
    expect(removed.document.graph.edges.filter((edge) => edge.source === 'entry')).toEqual([])
    expect(removed.metrics).toMatchObject({ interfacesRemoved: 1, edgesRemoved: 1 })
    expect(removed.reusedPrimitives).toEqual(expect.arrayContaining(['unmountOverlay', 'disconnect']))
  })

  test('removes a settlement interface binding, then removes the settlement and its dedicated edge', () => {
    const configured = configureBlueprintNode(fixture(), {
      nodeId: 'entry',
      settlements: [{
        trigger: { type: 'at', ms: 1200 },
        effects: [{ kind: 'var', varId: 'score', op: 'add', value: 1 }],
        spawns: [{ overlayId: 'base:choice', childId: 'choice', ttlMs: 600 }],
        targetNodeId: 'next',
      }],
    }, contracts)
    expect(configured.ok).toBe(true)
    if (!configured.ok) return
    const edgeId = configured.document.graph.edges[0]?.id

    const unbound = configureBlueprintNode(configured.document, {
      nodeId: 'entry',
      removals: {
        settlementActions: [{ settlementIndex: 0, actionIndex: 1, expectedKind: 'spawn' }],
      },
    }, contracts)
    expect(unbound.ok).toBe(true)
    if (!unbound.ok) return
    const unboundSettlement = unbound.document.graph.nodes.find((node) => node.id === 'entry')
      ?.data.reactions?.find((reaction) => reaction.when.type === 'at')
    expect(unboundSettlement?.do.map((action) => action.kind)).toEqual(['effect', 'advance'])
    expect(unbound.document.graph.edges.some((edge) => edge.id === edgeId)).toBe(true)
    expect(unbound.metrics.settlementActionsRemoved).toBe(1)

    const removed = configureBlueprintNode(unbound.document, {
      nodeId: 'entry',
      removals: { settlements: [{ settlementIndex: 0 }] },
    }, contracts)
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(removed.document.graph.nodes.find((node) => node.id === 'entry')?.data.reactions)
      .toBeUndefined()
    expect(removed.document.graph.edges).toEqual([])
    expect(removed.metrics).toMatchObject({ settlementsRemoved: 1, edgesRemoved: 1 })
  })

  test('removes an explicit edge without deleting the event effect, then removes the whole response', () => {
    const configured = configureBlueprintNode(fixture(), {
      nodeId: 'entry',
      interfaces: [{
        overlayId: 'base:choice',
        eventResponses: [{
          childId: 'choice',
          eventId: 'confirm',
          effects: [{ kind: 'var', varId: 'score', op: 'add', value: 1 }],
          targetNodeId: 'next',
        }],
      }],
    }, contracts)
    expect(configured.ok).toBe(true)
    if (!configured.ok) return
    const edgeId = configured.document.graph.edges[0]!.id

    const disconnected = configureBlueprintNode(configured.document, {
      nodeId: 'entry',
      removals: { edges: [{ edgeId }] },
    }, contracts)
    expect(disconnected.ok).toBe(true)
    if (!disconnected.ok) return
    const mount = disconnected.document.graph.nodes.find((node) => node.id === 'entry')
      ?.data.overlayNodes?.[0]
    expect(disconnected.document.graph.edges).toEqual([])
    expect(mount?.reactions?.[0]?.do.map((action) => action.kind)).toEqual(['effect'])

    const responseRemoved = configureBlueprintNode(disconnected.document, {
      nodeId: 'entry',
      removals: {
        eventResponses: [{
          mountId: 'base:choice',
          childId: 'choice',
          eventId: 'confirm',
        }],
      },
    }, contracts)
    expect(responseRemoved.ok).toBe(true)
    if (!responseRemoved.ok) return
    expect(responseRemoved.document.graph.nodes.find((node) => node.id === 'entry')
      ?.data.overlayNodes?.[0]?.reactions).toBeUndefined()
  })

  test('updates an existing settlement and removes its obsolete dedicated edge', () => {
    const configured = configureBlueprintNode(fixture(), {
      nodeId: 'entry',
      settlements: [{
        trigger: { type: 'at', ms: 1200 },
        effects: [{ kind: 'var', varId: 'score', op: 'add', value: 1 }],
        targetNodeId: 'next',
      }],
    }, contracts)
    expect(configured.ok).toBe(true)
    if (!configured.ok) return

    const updated = configureBlueprintNode(configured.document, {
      nodeId: 'entry',
      settlementUpdates: [{
        settlementIndex: 0,
        trigger: { type: 'watch', of: 'var.score', on: 'inc' },
        effects: [{ kind: 'var', varId: 'score', op: 'add', value: 2 }],
      }],
    }, contracts)
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(updated.document.graph.edges).toEqual([])
    expect(updated.document.graph.nodes.find((node) => node.id === 'entry')?.data.reactions?.[0])
      .toMatchObject({ when: { type: 'watch', of: 'var.score', on: 'inc' }, do: [{ kind: 'effect' }] })
    expect(updated.metrics).toMatchObject({ settlementsUpdated: 1, edgesRemoved: 1 })
  })
})
