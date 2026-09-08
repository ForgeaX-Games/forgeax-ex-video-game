import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import type { GameGraph, GameNodeData } from '@/runtime/core/schema/graph-schema'
import { NodeInspector } from '../NodeInspector'

function graphWithWeight(weight?: number): GameGraph {
  const node = (id: string): GameGraph['nodes'][number] => ({
    id,
    type: 'perf',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [],
    data: { name: id } as GameNodeData,
  })
  return {
    nodes: [node('source'), node('target')],
    edges: [{
      id: 'edge-1',
      source: 'source',
      target: 'target',
      sourceHandle: 'default',
      targetHandle: 'target:in',
      data: weight === undefined ? {} : { weight },
    }],
  }
}

function renderControlled(initial: GameGraph): () => GameGraph {
  let current = initial
  function Host(): JSX.Element {
    const [graph, setGraph] = useState(initial)
    current = graph
    return <NodeInspector graph={graph} nodeId="source" onChange={setGraph} />
  }
  render(<Host />)
  return () => current
}

afterEach(cleanup)

describe('NodeInspector · 边权重', () => {
  it('未设置时保持空白，不强制显示默认数字', () => {
    renderControlled(graphWithWeight())
    expect(screen.getByTitle(/留空表示未设/)).toHaveValue(null)
  })

  it('可以删掉最后一个数字，然后重新输入权重', () => {
    const current = renderControlled(graphWithWeight(1))
    const input = screen.getByTitle(/留空表示未设/) as HTMLInputElement

    fireEvent.change(input, { target: { value: '' } })
    expect(input.value).toBe('')
    expect(current().edges[0]?.data?.weight).toBeUndefined()

    fireEvent.change(input, { target: { value: '3' } })
    expect(input.value).toBe('3')
    expect(current().edges[0]?.data?.weight).toBe(3)
  })
})
