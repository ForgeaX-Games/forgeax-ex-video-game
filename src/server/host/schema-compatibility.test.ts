import Ajv2020 from 'ajv/dist/2020.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import extensionManifest from '../../../forgeax-extension.json'
import getGraphReturnsSchema from '../../../schemas/get-graph.returns.json'
import patchGraphSchema from '../../../schemas/patch-graph.args.json'
import configureBlueprintNodeSchema from '../../../schemas/configure-blueprint-node.args.json'
import compileBlueprintOutlineSchema from '../../../schemas/compile-blueprint-outline.args.json'
import upsertComponentSchema from '../../../schemas/upsert-component.args.json'

const WORKBENCH_MCP_UNSUPPORTED_KEYS = new Set(['allOf', 'minProperties'])

function unsupportedMcpSchemaPaths(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => unsupportedMcpSchemaPaths(entry, `${path}[${index}]`))
  }
  if (value === null || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  return [
    ...(Array.isArray(record.required) && record.type !== 'object'
      ? [`${path}.required-without-object-type`]
      : []),
    ...Object.keys(record)
      .filter((key) => WORKBENCH_MCP_UNSUPPORTED_KEYS.has(key))
      .map((key) => `${path}.${key}`),
    ...Object.entries(record).flatMap(([key, entry]) =>
      unsupportedMcpSchemaPaths(entry, `${path}.${key}`),
    ),
  ]
}

function refSiblingPaths(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => refSiblingPaths(entry, `${path}[${index}]`))
  }
  if (value === null || typeof value !== 'object') return []

  const record = value as Record<string, unknown>
  const ownKeys = Object.keys(record)
  const offenders = typeof record.$ref === 'string' && ownKeys.length > 1 ? [path] : []
  return [
    ...offenders,
    ...Object.entries(record).flatMap(([key, entry]) =>
      refSiblingPaths(entry, `${path}.${key}`),
    ),
  ]
}

describe('Workbench Host schema compatibility', () => {
  it('keeps every AI-exposed tool schema inside the Workbench MCP converter subset', () => {
    const issues = extensionManifest.contributes.tools
      .filter((tool) => tool.exposedToAI)
      .flatMap((tool) => {
        const schemaPath = resolve(tool.args.replace(/^\.\//u, ''))
        const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as unknown
        return unsupportedMcpSchemaPaths(schema).map((path) => `${tool.id}: ${path}`)
      })

    expect(issues).toEqual([])
  })

  it('keeps patch-graph references free of unsupported sibling keywords', () => {
    expect(refSiblingPaths(patchGraphSchema)).toEqual([])
  })

  it('publishes configure-blueprint-node as a structural MCP object instead of a root composition', () => {
    expect(configureBlueprintNodeSchema).toMatchObject({
      type: 'object',
      properties: {
        expectedRevision: { type: 'integer' },
        interfaces: {
          type: 'array',
          items: { $ref: '#/$defs/interface' },
        },
      },
    })
    expect('anyOf' in configureBlueprintNodeSchema).toBe(false)
    expect('oneOf' in configureBlueprintNodeSchema).toBe(false)
  })

  it('exposes event outputs to component authoring and eventPayload expressions to node configuration', () => {
    const ajv = new Ajv2020({ strict: true })
    const validateUpsert = ajv.compile(upsertComponentSchema)
    expect(validateUpsert({
      id: 'QuantityButton',
      events: [{ id: 'buy', outputs: [{ key: 'count', valueType: 'number' }] }],
      implementation: "function QuantityButton() { return React.createElement('button') }",
    })).toBe(true)

    const validateConfigure = ajv.compile(configureBlueprintNodeSchema)
    expect(validateConfigure({
      nodeId: 'shop',
      interfaces: [{
        overlayId: 'shop-ui',
        eventResponses: [{
          childId: 'buy-button',
          eventId: 'buy',
          effects: [
            { kind: 'item', itemId: 'apple', op: 'give', count: { expr: 'eventPayload.count' } },
            { kind: 'flag', varId: 'discounted', value: { ref: 'eventPayload.discounted' } },
          ],
        }],
      }],
    })).toBe(true)
  })

  it('publishes only compact outline intents and rejects complete graph fields', () => {
    expect(compileBlueprintOutlineSchema).toMatchObject({
      type: 'object',
      required: ['entry', 'idempotencyKey', 'chapters', 'routes'],
      properties: {
        planId: { type: 'string' },
        batchIndex: { type: 'integer' },
        batchCount: { type: 'integer' },
        commit: { type: 'boolean' },
        chapters: { type: 'array' },
        routes: { type: 'array' },
      },
    })
    expect('anyOf' in compileBlueprintOutlineSchema).toBe(false)
    expect('oneOf' in compileBlueprintOutlineSchema).toBe(false)
    expect(compileBlueprintOutlineSchema.properties).not.toHaveProperty('nodes')
    expect(compileBlueprintOutlineSchema.properties).not.toHaveProperty('edges')

    const validate = new Ajv2020({ strict: true }).compile(compileBlueprintOutlineSchema)
    expect(validate({
      entry: 'entry',
      idempotencyKey: 'outline:no-full-graph',
      chapters: [{ id: 'entry', name: '开场', pillarBeatId: 'B01', beat: 'narrative' }],
      routes: [],
      nodes: [],
    })).toBe(false)
  })

  it('declares video entities in the get-graph return projection', () => {
    const validate = new Ajv2020({ strict: true }).compile(getGraphReturnsSchema)

    expect(validate({
      project: null,
      assetEntities: {
        characters: {},
        scenes: {},
        videos: {},
      },
      revision: 0,
      assetRevision: 0,
    })).toBe(true)
  })
})
