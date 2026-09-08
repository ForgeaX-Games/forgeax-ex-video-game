import { describe, expect, it } from 'vitest'
import type { ComponentManifest } from '@/runtime/core/schema/node-config-schema'
import { initState } from '@/runtime/core/engine/engine-init'
import type { SkinCtx } from '../rendererRegistry'
import { resolveComponentInputs } from '../resolveComponentInputs'

const manifest: ComponentManifest = {
  id: 'test.hud',
  inputs: [
    { key: 'label', label: '显示名', valueType: 'string', default: '敌方', component: 'numberExpr' },
    { key: 'current', label: '血量', valueType: 'number', required: true, component: 'numberExpr' },
    { key: 'max', label: '最大血量', valueType: 'number', required: true, component: 'numberExpr' },
  ],
  events: [],
}

const ctx: SkinCtx = {
  hud: {
    entities: {
      'ent-boss': {
        name: '小怪',
        hp: 650,
        maxHp: 700,
        attrs: { hp: 650, hpMax: 700 },
        attrMax: { hp: 700, hpMax: 700 },
      },
    },
    vars: {},
    textVars: { chapterTitle: '序章' },
    flags: {},
    score: 0,
  },
}

describe('resolveComponentInputs', () => {
  it('resolves numberExpr inputs into flat props', () => {
    const resolved = resolveComponentInputs(
      manifest,
      {
        label: '小怪',
        current: { expr: 'entity.ent-boss.attr.hp' },
        max: 700,
      },
      ctx,
    )

    expect(resolved.label).toBe('小怪')
    expect(resolved.current).toBe(650)
    expect(resolved.max).toBe(700)
  })

  it('resolves numeric value formulas and duration defaults', () => {
    const floatManifest: ComponentManifest = {
      id: 'test.float',
      inputs: [
        { key: 'value', valueType: 'number', component: 'numberExpr' },
        { key: 'durationMs', valueType: 'number', default: 1100 },
      ],
      events: [],
    }
    const resolved = resolveComponentInputs(
      floatManifest,
      { value: { expr: 'entity.ent-boss.attr.hp - 600' } },
      ctx,
    )
    expect(resolved.value).toBe(50)
    expect(resolved.durationMs).toBe(1100)
  })

  it('resolves formula references from the live runtime state', () => {
    const state = initState({
      version: 'game-video.graph.v1',
      graph: { nodes: [], edges: [] },
      entities: { 'ent-boss': { id: 'ent-boss', attrs: { hp: 650 } } },
      formulas: {
        visible_damage: {
          id: 'visible_damage',
          ast: {
            t: 'bin',
            id: 'root',
            op: '-',
            a: { t: 'ref', id: 'hp', ref: { kind: 'entityAttr', entityId: 'ent-boss', attr: 'hp' } },
            b: { t: 'num', id: 'baseline', v: 600 },
          },
        },
      },
    })
    const resolved = resolveComponentInputs(
      manifest,
      { current: { expr: 'formula.visible_damage' }, max: 100 },
      { ...ctx, condition: { state, visited: new Set() } },
    )

    expect(resolved.current).toBe(50)
  })

  it('resolves numeric text inputs without adding a sign', () => {
    const textManifest: ComponentManifest = {
      id: 'test.notice',
      inputs: [
        { key: 'text', valueType: 'string', component: 'numberExpr', default: '' },
      ],
      events: [],
    }
    const resolved = resolveComponentInputs(
      textManifest,
      { text: { expr: 'entity.ent-boss.attr.hp - 600' } },
      ctx,
    )

    expect(resolved.text).toBe('-50')
  })

  it('resolves text variable references from the text runtime bucket', () => {
    const textManifest: ComponentManifest = {
      id: 'test.text-variable',
      inputs: [{ key: 'text', valueType: 'string', component: 'numberExpr', default: '' }],
      events: [],
    }
    const resolved = resolveComponentInputs(
      textManifest,
      { text: { ref: 'var.chapterTitle' } },
      ctx,
    )
    expect(resolved.text).toBe('序章')
  })

  it('fills ordinary defaults without changing explicit values', () => {
    const resolved = resolveComponentInputs(manifest, { current: 35, max: 70 }, ctx)
    expect(resolved).toMatchObject({ label: '敌方', current: 35, max: 70 })
  })
})
