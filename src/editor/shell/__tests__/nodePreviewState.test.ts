import { describe, expect, it } from 'vitest'
import { node, scnOf } from '../../../runtime/__tests__/test-fixtures'
import { NodePreviewRuntimeProjector, projectNodePreviewState } from '../nodePreviewState'

describe('projectNodePreviewState', () => {
  it('applies an at settlement at its configured playhead and resets when scrubbing backward', () => {
    const current = node('entry', {
      reactions: [{
        when: { type: 'at', ms: 3500 },
        do: [{
          kind: 'effect',
          effects: [{ kind: 'attr', entityId: 'ent-player', attr: 'hp', op: 'add', value: -80 }],
        }],
      }],
    })
    const scenario = scnOf(
      { nodes: [current], edges: [] },
      {
        entities: {
          'ent-player': {
            id: 'ent-player',
            kind: 'player',
            attrs: { hp: 100 },
            attrMeta: { hp: { initial: 100, min: 0, max: 100 } },
          },
        },
      },
    )

    expect(projectNodePreviewState(scenario, current, 3499, 15_100).entities['ent-player']?.attrs.hp).toBe(100)
    expect(projectNodePreviewState(scenario, current, 3500, 15_100).entities['ent-player']?.attrs.hp).toBe(20)
    expect(projectNodePreviewState(scenario, current, 2000, 15_100).entities['ent-player']?.attrs.hp).toBe(100)
  })

  it('applies enter immediately and complete then exit at the node end', () => {
    const current = node('entry', {
      reactions: [
        { when: { type: 'enter' }, do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'qi', op: 'add', value: 1 }] }] },
        { when: { type: 'complete' }, do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'qi', op: 'add', value: 2 }] }] },
        { when: { type: 'exit' }, do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'qi', op: 'add', value: 3 }] }] },
      ],
    })
    const scenario = scnOf({ nodes: [current], edges: [] })

    expect(projectNodePreviewState(scenario, current, 0, 1000).vars.qi).toBe(1)
    expect(projectNodePreviewState(scenario, current, 1000, 1000).vars.qi).toBe(6)
  })

  it('projects a condition settlement spawn at the triggering time and expires it by ttl', () => {
    const current = node('entry', {
      reactions: [
        {
          when: { type: 'at', ms: 300 },
          do: [{
            kind: 'effect',
            effects: [{ kind: 'attr', entityId: 'ent-0', attr: 'nuqi', op: 'add', value: 80 }],
          }],
        },
        {
          when: { type: 'watch', of: 'entity.ent-0.attr.nuqi', on: 'inc' },
          do: [{ kind: 'spawn', from: 'float/rage', ttlMs: 1200, inputs: { value: { expr: 'delta' } } }],
        },
      ],
    })
    const scenario = scnOf(
      { nodes: [current], edges: [] },
      {
        entities: {
          'ent-0': { id: 'ent-0', kind: 'enemy', attrs: { nuqi: 10 } },
        },
        ui: {
          overlays: {
            float: {
              id: 'float',
              children: [{ id: 'rage', component: 'test.float', inputs: { value: 0 } }],
            },
          },
        },
      },
    )
    const projector = new NodePreviewRuntimeProjector(scenario, current)

    expect(projector.project(299)).toEqual([])
    expect(projector.project(300)).toMatchObject([{
      startedAtMs: 300,
      mount: { children: [{ component: 'test.float', inputs: { value: 80 } }] },
    }])
    expect(projector.project(1499)).toHaveLength(1)
    expect(projector.project(1500)).toEqual([])
    expect(projector.project(300)).toHaveLength(1)
  })

  it('replays condition-controlled hiding of an existing interface while scrubbing the preview', () => {
    const current = node('entry', {
      overlayNodes: [{ id: 'rage-mount', overlay: 'rage' }],
      reactions: [
        { when: { type: 'at', ms: 600 }, do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'bull', attr: 'rage', op: 'add', value: -10 }] }] },
        { when: { type: 'watch', of: 'entity.bull.attr.rage', on: 'dec' }, do: [{ kind: 'hideOverlay', mountId: 'rage-mount' }] },
      ],
    })
    const scenario = scnOf(
      { nodes: [current], edges: [] },
      {
        entities: { bull: { id: 'bull', attrs: { rage: 10 } } },
        ui: { overlays: { rage: { id: 'rage', children: [{ id: 'value', component: 'test.float', trigger: { when: 'enter' } }] } } },
      },
    )
    const projector = new NodePreviewRuntimeProjector(scenario, current)

    projector.project(299)
    expect(projector.visibleConfiguredMountIds()).toEqual(['rage-mount'])
    projector.project(599)
    expect(projector.visibleConfiguredMountIds()).toEqual(['rage-mount'])
    projector.project(600)
    expect(projector.visibleConfiguredMountIds()).toEqual([])
    projector.project(300)
    expect(projector.visibleConfiguredMountIds()).toEqual(['rage-mount'])
  })
})
