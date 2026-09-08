import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import getGraphReturnsSchema from '../../../schemas/get-graph.returns.json'
import patchGraphSchema from '../../../schemas/patch-graph.args.json'

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
  it('keeps patch-graph references free of unsupported sibling keywords', () => {
    expect(refSiblingPaths(patchGraphSchema)).toEqual([])
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
