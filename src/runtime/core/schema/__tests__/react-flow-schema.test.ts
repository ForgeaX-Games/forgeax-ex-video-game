import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GRAPH_NODE_POSITION,
  GRAPH_NODE_COL_W,
  isPosition,
  normalizeGraphNodePosition,
  positionAfter,
  readNodePosition,
} from '../react-flow-schema'

describe('react-flow-schema position', () => {
  it('isPosition accepts finite x/y', () => {
    expect(isPosition({ x: 80, y: 80 })).toBe(true)
    expect(isPosition(undefined)).toBe(false)
    expect(isPosition({ x: '80', y: 80 })).toBe(false)
    expect(isPosition({ x: 0, y: NaN })).toBe(false)
  })

  it('normalizeGraphNodePosition fills fallback', () => {
    expect(normalizeGraphNodePosition<{ id: string; position?: unknown }>({ id: 'a' }).position).toEqual(DEFAULT_GRAPH_NODE_POSITION)
    expect(normalizeGraphNodePosition<{ id: string; position?: unknown }>({ id: 'a', position: { x: 320, y: 80 } }).position)
      .toEqual({ x: 320, y: 80 })
  })

  it('positionAfter increments by column width', () => {
    expect(positionAfter({ x: 80, y: 80 })).toEqual({ x: 80 + GRAPH_NODE_COL_W, y: 80 })
  })

  it('readNodePosition returns undefined for invalid', () => {
    expect(readNodePosition({})).toBeUndefined()
    expect(readNodePosition({ position: { x: 1, y: 2 } })).toEqual({ x: 1, y: 2 })
  })
})
