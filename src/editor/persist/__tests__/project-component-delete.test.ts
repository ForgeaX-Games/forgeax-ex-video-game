import { describe, expect, it } from 'vitest'
import type { GameGraph, GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import { removeProjectComponentReferences } from '../project-component-delete'

function document(): GraphLibraryDocument {
  const graph: GameGraph = {
    nodes: [{
      id: 'entry',
      type: 'perf',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: [],
      data: {
        name: 'Entry',
        overlayNodes: [
          { overlay: 'base:CountdownTimer' },
          {
            overlay: 'hud',
            added: [{ id: 'local-timer', component: 'CountdownTimer' }],
            overrides: {
              timer: { inputs: { duration: 3 } },
              keep: { inputs: { label: 'ok' } },
            },
            reactions: [
              { when: { type: 'event', id: 'timer:complete' }, do: [{ kind: 'advance', edgeId: 'next' }] },
            ],
          },
        ],
        reactions: [
          { when: { type: 'shown', of: 'local-timer' }, do: [{ kind: 'advance', edgeId: 'next' }] },
        ],
      },
    }],
    edges: [],
  }
  return {
    version: 'game-video.graph.v1',
    graph,
    ui: {
      overlays: {
        'base:CountdownTimer': {
          id: 'base:CountdownTimer',
          children: [{ id: 'CountdownTimer-0', component: 'CountdownTimer' }],
        },
        hud: {
          id: 'hud',
          children: [
            { id: 'timer', component: 'CountdownTimer' },
            { id: 'keep', component: 'StatusChip' },
          ],
          reactions: [
            { when: { type: 'event', id: 'timer:complete' }, do: [] },
          ],
        },
      },
    },
    uiTree: {
      root: [{
        kind: 'folder',
        id: 'ui-folder:basic',
        name: '控件',
        children: [
          { kind: 'scheme', id: 'ui-scheme:timer', overlayId: 'base:CountdownTimer' },
          { kind: 'scheme', id: 'ui-scheme:hud', overlayId: 'hud' },
        ],
      }],
    },
    manifest: {
      version: 'game-video.blueprint-manifest.v1',
      mainPackId: 'bp-main',
      packs: {
        'bp-main': { id: 'bp-main', title: 'Main', entry: 'entry', graph },
      },
    },
  }
}

describe('removeProjectComponentReferences', () => {
  it('removes base schemes and component uses throughout graph authoring state', () => {
    const next = removeProjectComponentReferences(document(), 'CountdownTimer')

    expect(next.ui?.overlays['base:CountdownTimer']).toBeUndefined()
    expect(next.ui?.overlays.hud?.children.map((child) => child.component)).toEqual(['StatusChip'])
    expect(JSON.stringify(next.uiTree)).not.toContain('base:CountdownTimer')
    const node = next.manifest.packs['bp-main']!.graph.nodes[0]!
    expect(node.data.overlayNodes?.map((mount) => mount.overlay)).toEqual(['hud'])
    expect(node.data.overlayNodes?.[0]?.added).toBeUndefined()
    expect(node.data.overlayNodes?.[0]?.overrides).toEqual({ keep: { inputs: { label: 'ok' } } })
    expect(node.data.overlayNodes?.[0]?.reactions).toBeUndefined()
    expect(node.data.reactions).toBeUndefined()
    expect(next.graph).toEqual(next.manifest.packs['bp-main']!.graph)
  })
})
