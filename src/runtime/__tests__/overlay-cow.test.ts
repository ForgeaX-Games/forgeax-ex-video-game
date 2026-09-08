/**
 * overlay 稀疏覆盖（prototype + sparse override）—— 节点挂共享方案后，编辑改写挂载上的
 * `overrides`/`added`/`removed` 差量；未改组件持续跟随共享方案（改方案即同步），已改组件可
 * 单个或整体「回连」。空节点/历史遗留的 `node:<id>` 本地副本仍走直改 children 老路径。
 */
import { describe, expect, it } from 'vitest'
import type { GameScenario, Overlay } from '../core/schema/graph-schema'
import { expandNodeChildren, resolveMountChildren } from '../core/schema/expand-overlay'
import { node, scnOf } from './test-fixtures'
import {
  addOverlayChild,
  countOverlayReferences,
  dropOverlayIfUnreferenced,
  ensureNodeOverlay,
  forkSchemeForEdit,
  isOverlayReferenced,
  nodeOverlayId,
  overriddenChildIds,
  patchOverlayCatalogChild,
  patchOverlayChild,
  patchOverlayChildParams,
  relinkScheme,
  removeOverlayChild,
  resetOverride,
} from '@/authoring/graph/overlay-edit'

const SCHEME: Overlay = {
  id: 'scheme-static',
  title: '静态组件方案',
  children: [
    { id: 'line', component: 'test.dialogue', trigger: { when: 'enter' }, inputs: { text: 'orig' } },
    { id: 'hp', component: 'battleHpBar', trigger: { when: 'enter' }, inputs: { bind: 'ent-player' } },
  ],
}
const HUD: Overlay = {
  id: 'battleHud',
  title: 'HUD',
  children: [{ id: 'bar', component: 'battleHpBar', trigger: { when: 'enter' }, inputs: { bind: 'ent-boss' } }],
}

/** 两个节点 a/b 都挂共享方案 scheme-static。 */
function seedShared(over: Record<string, unknown> = {}): GameScenario {
  const a = node('a', { overlayNodes: [{ overlay: 'scheme-static' }], ...over })
  const b = node('b', { overlayNodes: [{ overlay: 'scheme-static' }] })
  return scnOf({ nodes: [a, b], edges: [] }, { ui: { overlays: { 'scheme-static': structuredClone(SCHEME), battleHud: structuredClone(HUD) } } })
}

function mountsOf(s: GameScenario, id: string) {
  return s.graph.nodes.find((n) => n.id === id)!.data.overlayNodes ?? []
}

function textOf(c: { inputs?: Record<string, unknown> } | undefined): string | undefined {
  return c?.inputs?.text as string | undefined
}

describe('overlay sparse override（prototype + override）', () => {
  describe('resolveMountChildren（解析器）', () => {
    it('base ⊕ override：未改组件原样跟随，改过的字段级合并', () => {
      const overlays = { 'scheme-static': SCHEME }
      const mount = { overlay: 'scheme-static', overrides: { line: { inputs: { text: 'edited' } } } }
      const resolved = resolveMountChildren(overlays, mount)
      expect(resolved.map((c) => c.id)).toEqual(['line', 'hp'])
      expect(textOf(resolved.find((c) => c.id === 'line'))).toBe('edited')
      expect(resolved.find((c) => c.id === 'hp')).toBe(SCHEME.children[1]) // 未改组件：同引用跟随原型
    })

    it('added：追加到末尾，不影响原型 children', () => {
      const overlays = { 'scheme-static': SCHEME }
      const extra = { id: 'c1', component: 'test.dialogue', inputs: { text: 'new' } }
      const resolved = resolveMountChildren(overlays, { overlay: 'scheme-static', added: [extra] })
      expect(resolved.map((c) => c.id)).toEqual(['line', 'hp', 'c1'])
    })

    it('removed：屏蔽原型里的该 childId，不物理删除原型', () => {
      const overlays = { 'scheme-static': SCHEME }
      const resolved = resolveMountChildren(overlays, { overlay: 'scheme-static', removed: ['line'] })
      expect(resolved.map((c) => c.id)).toEqual(['hp'])
      expect(overlays['scheme-static']!.children).toHaveLength(2) // 原型不变
    })

    it('孤儿 override/removed（原型已无该 childId）静默忽略，不报错、不影响其它组件', () => {
      const overlays = { 'scheme-static': SCHEME }
      const resolved = resolveMountChildren(overlays, {
        overlay: 'scheme-static',
        overrides: { ghost: { inputs: { text: 'x' } } },
        removed: ['ghost2'],
      })
      expect(resolved.map((c) => c.id)).toEqual(['line', 'hp'])
    })

    it('兼容历史挂载上的 inline children，QTE 时序以节点副本为准而不是模板默认值', () => {
      const inline = [{
        ...SCHEME.children[0]!,
        component: 'BattleParry',
        trigger: { when: 'at' as const, atMs: 2000 },
        window: { startMs: 2000, endMs: 4000 },
      }]
      const resolved = resolveMountChildren(
        { 'scheme-static': SCHEME },
        { overlay: 'scheme-static', children: inline } as never,
      )

      expect(resolved).toEqual(inline)
      expect(resolved[0]!.window).toEqual({ startMs: 2000, endMs: 4000 })
    })
  })

  describe('写路径：共享方案节点改一个组件，其余组件持续跟随', () => {
    it('patchOverlayChild：只写 mount.overrides，不切挂载、不改共享方案', () => {
      const s = seedShared()
      const next = patchOverlayChild(s, 'a', 'line', { inputs: { text: 'edited' } })

      const mount = mountsOf(next, 'a')[0]!
      expect(mount.overlay).toBe('scheme-static') // 未切换挂载（无 fork）
      expect(mount.overrides).toEqual({ line: { inputs: { text: 'edited' } } })

      // 共享方案本体不变。
      expect(textOf(next.ui!.overlays!['scheme-static']!.children.find((c) => c.id === 'line'))).toBe('orig')
    })

    it('未改的组件继续跟随共享方案：之后改方案本体，未 override 的组件同步，已 override 的不受影响', () => {
      let s = patchOverlayChild(seedShared(), 'a', 'line', { inputs: { text: 'edited' } })
      s = patchOverlayCatalogChild(s, 'scheme-static', 'hp', { inputs: { bind: 'ent-new' } })

      const mount = mountsOf(s, 'a')[0]!
      const resolved = resolveMountChildren(s.ui?.overlays, mount)
      expect(textOf(resolved.find((c) => c.id === 'line'))).toBe('edited') // 已覆盖：不同步
      expect(resolved.find((c) => c.id === 'hp')!.inputs).toEqual({ bind: 'ent-new' }) // 未覆盖：跟随方案
    })

    it('两节点挂同方案，各自 override 互不影响，共享方案不变（核心防污染）', () => {
      let s = seedShared()
      s = patchOverlayChild(s, 'a', 'line', { inputs: { text: 'A改' } })
      s = patchOverlayChild(s, 'b', 'line', { inputs: { text: 'B改' } })

      const ra = resolveMountChildren(s.ui?.overlays, mountsOf(s, 'a')[0]!)
      const rb = resolveMountChildren(s.ui?.overlays, mountsOf(s, 'b')[0]!)
      expect(textOf(ra.find((c) => c.id === 'line'))).toBe('A改')
      expect(textOf(rb.find((c) => c.id === 'line'))).toBe('B改')
      expect(textOf(s.ui!.overlays!['scheme-static']!.children.find((c) => c.id === 'line'))).toBe('orig')
    })

    it('连续两次 patch 同一组件的不同字段 → overrides 累积，不互相覆盖', () => {
      let s = patchOverlayChild(seedShared(), 'a', 'line', { note: 'N1' })
      s = patchOverlayChild(s, 'a', 'line', { inputs: { text: 't2' } })
      const resolved = resolveMountChildren(s.ui?.overlays, mountsOf(s, 'a')[0]!)
      const line = resolved.find((c) => c.id === 'line')!
      expect(line.note).toBe('N1')
      expect(textOf(line)).toBe('t2')
    })

    it('patchOverlayChildParams：按当前解析值累积 inputs，而不是整份覆盖', () => {
      let s = patchOverlayChild(seedShared(), 'a', 'line', { inputs: { a: 1 } })
      s = patchOverlayChildParams(s, 'a', 'line', { b: 2 })
      const resolved = resolveMountChildren(s.ui?.overlays, mountsOf(s, 'a')[0]!)
      expect(resolved.find((c) => c.id === 'line')!.inputs).toEqual({ text: 'orig', a: 1, b: 2 })
    })

    it('patchOverlayChild 不清掉挂载上已有的 reactions，也不切换挂载', () => {
      const reactions = [{ when: { type: 'event' as const, id: 'pass' }, do: [{ kind: 'effect' as const, effects: [] }] }]
      const s = seedShared({ overlayNodes: [{ overlay: 'scheme-static', reactions }] })
      const next = patchOverlayChild(s, 'a', 'line', { inputs: { text: 'edited' } })
      const mount = mountsOf(next, 'a')[0]!
      expect(mount.overlay).toBe('scheme-static')
      expect(mount.reactions).toHaveLength(1)
    })

    it('addOverlayChild：共享方案节点新增组件 → 落 mount.added，不写回共享方案', () => {
      const out = addOverlayChild(seedShared(), 'a', { id: 'c1', component: 'test.dialogue', trigger: { when: 'enter' }, inputs: { text: 'hi' } })
      const mount = mountsOf(out, 'a')[0]!
      expect(mount.added?.map((c) => c.id)).toEqual(['c1'])
      expect(out.ui!.overlays!['scheme-static']!.children).toHaveLength(2) // 共享方案不变
      const resolved = resolveMountChildren(out.ui?.overlays, mount)
      expect(resolved.map((c) => c.id)).toEqual(['line', 'hp', 'c1'])
    })

    it('removeOverlayChild：删共享方案节点的基底组件 → tombstone(removed)，不动共享方案', () => {
      const next = removeOverlayChild(seedShared(), 'a', 'line')
      const mount = mountsOf(next, 'a')[0]!
      expect(mount.removed).toEqual(['line'])
      expect(next.ui!.overlays!['scheme-static']!.children.map((c) => c.id)).toEqual(['line', 'hp']) // 共享方案不变
      expect(resolveMountChildren(next.ui?.overlays, mount).map((c) => c.id)).toEqual(['hp'])
    })

    it('removeOverlayChild：删本地新增(added)组件 → 直接从 added 摘除，不留 tombstone', () => {
      let s = addOverlayChild(seedShared(), 'a', { id: 'c1', component: 'test.dialogue', trigger: { when: 'enter' }, inputs: {} })
      s = removeOverlayChild(s, 'a', 'c1')
      const mount = mountsOf(s, 'a')[0]!
      expect(mount.added ?? []).toHaveLength(0)
      expect(mount.removed ?? []).not.toContain('c1')
    })

    it('patchOverlayChild 命中 added 组件时改 added 本身，而不是写 overrides', () => {
      let s = addOverlayChild(seedShared(), 'a', { id: 'c1', component: 'test.dialogue', trigger: { when: 'enter' }, inputs: { text: 'v0' } })
      s = patchOverlayChild(s, 'a', 'c1', { inputs: { text: 'v1' } })
      const mount = mountsOf(s, 'a')[0]!
      expect(textOf(mount.added?.find((c) => c.id === 'c1'))).toBe('v1')
      expect(mount.overrides).toBeUndefined()
    })

    it('多挂载：只写内容挂载(mounts[0])的差量，HUD 挂载保持共享引用不动', () => {
      const s = seedShared({ overlayNodes: [{ overlay: 'scheme-static' }, { overlay: 'battleHud' }] })
      const next = patchOverlayChild(s, 'a', 'line', { inputs: { text: 'edited' } })
      const mounts = mountsOf(next, 'a')
      expect(mounts[0]!.overlay).toBe('scheme-static')
      expect(mounts[0]!.overrides).toBeDefined()
      expect(mounts[1]!.overlay).toBe('battleHud')
      expect(mounts[1]!.overrides).toBeUndefined()
      expect(next.ui!.overlays!['battleHud']).toBe(s.ui!.overlays!['battleHud']) // 引用未被复制/改动
    })
  })

  describe('回连（resetOverride / relinkScheme）', () => {
    it('resetOverride：单组件回连，其它差量不受影响', () => {
      let s = patchOverlayChild(seedShared(), 'a', 'line', { inputs: { text: 'A改' } })
      s = patchOverlayChild(s, 'a', 'hp', { inputs: { bind: 'ent-x' } })
      s = resetOverride(s, 'a', 'line')
      const mount = mountsOf(s, 'a')[0]!
      expect(mount.overrides).toEqual({ hp: { inputs: { bind: 'ent-x' } } })
      const resolved = resolveMountChildren(s.ui?.overlays, mount)
      expect(textOf(resolved.find((c) => c.id === 'line'))).toBe('orig') // 回连：跟随原型
    })

    it('resetOverride：无该 childId 的 override 时是空操作（同引用）', () => {
      const s = seedShared()
      expect(resetOverride(s, 'a', 'line')).toBe(s)
    })

    it('relinkScheme：整体回连，清空 overrides/added/removed，内容完全跟随方案', () => {
      let s = patchOverlayChild(seedShared(), 'a', 'line', { inputs: { text: 'A改' } })
      s = addOverlayChild(s, 'a', { id: 'c1', component: 'test.dialogue', trigger: { when: 'enter' }, inputs: {} })
      s = removeOverlayChild(s, 'a', 'hp')
      s = relinkScheme(s, 'a')
      const mount = mountsOf(s, 'a')[0]!
      expect(mount.overrides).toBeUndefined()
      expect(mount.added).toBeUndefined()
      expect(mount.removed).toBeUndefined()
      expect(resolveMountChildren(s.ui?.overlays, mount).map((c) => c.id)).toEqual(['line', 'hp'])
    })

    it('overriddenChildIds：统计已覆盖 / 新增 / 屏蔽的 childId', () => {
      let s = patchOverlayChild(seedShared(), 'a', 'line', { inputs: { text: 'A改' } })
      s = addOverlayChild(s, 'a', { id: 'c1', component: 'test.dialogue', trigger: { when: 'enter' }, inputs: {} })
      s = removeOverlayChild(s, 'a', 'hp')
      const { overridden, added, removed } = overriddenChildIds(mountsOf(s, 'a')[0])
      expect(overridden).toEqual(['line'])
      expect(added).toEqual(['c1'])
      expect(removed).toEqual(['hp'])
    })
  })

  describe('节点本地 overlay（node:<id>，空节点 / 历史整张 fork 数据）', () => {
    it('空节点新增素材：建 node:<id> 并直写其 children（不产生 overrides/added/removed）', () => {
      const e = node('e')
      const s = scnOf({ nodes: [e], edges: [] })
      const out = addOverlayChild(s, 'e', { id: 'c1', component: 'test.dialogue', trigger: { when: 'enter' }, inputs: { text: 'hi' } })
      expect(out.ui!.overlays![nodeOverlayId('e')]!.children).toHaveLength(1)
      const mount = mountsOf(out, 'e')[0]!
      expect(mount.overlay).toBe(nodeOverlayId('e'))
      expect(mount.added).toBeUndefined()
    })

    it('历史遗留的 node:<id> 本地副本：编辑直改其 children，不产生差量字段', () => {
      const a = node('a', { overlayNodes: [{ overlay: nodeOverlayId('a') }] })
      const s = scnOf({ nodes: [a], edges: [] }, { ui: { overlays: { [nodeOverlayId('a')]: structuredClone(SCHEME) } } })
      const next = patchOverlayChild(s, 'a', 'line', { inputs: { text: 'edited' } })
      const mount = mountsOf(next, 'a')[0]!
      expect(mount.overlay).toBe(nodeOverlayId('a'))
      expect(mount.overrides).toBeUndefined()
      expect(textOf(next.ui!.overlays![nodeOverlayId('a')]!.children.find((c) => c.id === 'line'))).toBe('edited')
    })
  })

  describe('ensureNodeOverlay / forkSchemeForEdit（幂等，克隆分支已退休）', () => {
    it('已有挂载（共享或本地）的节点：空操作，返回同引用', () => {
      const s = seedShared()
      expect(ensureNodeOverlay(s, 'a')).toBe(s)
      expect(forkSchemeForEdit(s, 'a')).toBe(s)
    })

    it('无挂载的空节点：用节点中文名创建 node:<id> title 并挂上', () => {
      const e = node('e', { name: '废墟信号' })
      const s = scnOf({ nodes: [e], edges: [] })
      const out = ensureNodeOverlay(s, 'e')
      expect(mountsOf(out, 'e')).toEqual([{ overlay: nodeOverlayId('e') }])
      expect(out.ui!.overlays![nodeOverlayId('e')]).toEqual({ id: nodeOverlayId('e'), title: '废墟信号', children: [] })
    })

    it('已有节点本地 overlay 但缺 title 时补上节点中文名', () => {
      const e = node('e', { name: '废墟信号', overlayNodes: [{ overlay: nodeOverlayId('e') }] })
      const s = scnOf({ nodes: [e], edges: [] }, { ui: { overlays: { [nodeOverlayId('e')]: { id: nodeOverlayId('e'), children: [] } } } })
      const out = ensureNodeOverlay(s, 'e')
      expect(out.ui!.overlays![nodeOverlayId('e')]).toEqual({ id: nodeOverlayId('e'), title: '废墟信号', children: [] })
    })

    it('已有节点本地 overlay title 时保留手动命名并保持幂等', () => {
      const e = node('e', { name: '废墟信号', overlayNodes: [{ overlay: nodeOverlayId('e') }] })
      const s = scnOf({ nodes: [e], edges: [] }, { ui: { overlays: { [nodeOverlayId('e')]: { id: nodeOverlayId('e'), title: '自定义界面', children: [] } } } })
      expect(ensureNodeOverlay(s, 'e')).toBe(s)
      expect(s.ui!.overlays![nodeOverlayId('e')]!.title).toBe('自定义界面')
    })
  })

  describe('运行态展开（expandNodeChildren）反映 override', () => {
    it('共享方案节点改 1 个组件后，运行态展开的对应 child 反映新值，其余组件仍来自方案', () => {
      const s = patchOverlayChild(seedShared(), 'a', 'line', { inputs: { text: 'edited' } })
      const a = s.graph.nodes.find((n) => n.id === 'a')!
      const children = expandNodeChildren(s, a)
      const line = children.find((c) => c.source.childId === 'line')!
      const hp = children.find((c) => c.source.childId === 'hp')!
      expect(textOf(line)).toBe('edited')
      expect(hp.inputs).toEqual({ bind: 'ent-player' })
    })
  })

  describe('孤儿清理（isOverlayReferenced / dropOverlayIfUnreferenced，不受 override 模型影响）', () => {
    it('引用计数覆盖主蓝图与全部子蓝图', () => {
      const main = {
        nodes: [node('main-a', { overlayNodes: [{ overlay: 'fixture:float-a' }] })],
        edges: [],
      }
      const childA = {
        nodes: [node('child-a', { overlayNodes: [{ overlay: 'fixture:float-a' }, { overlay: 'fixture:float-b' }] })],
        edges: [],
      }
      const childB = {
        nodes: [node('child-b', { overlayNodes: [{ overlay: 'fixture:float-a' }] })],
        edges: [],
      }

      expect(countOverlayReferences([main, childA, childB])).toEqual({
        'fixture:float-a': 3,
        'fixture:float-b': 1,
      })
    })

    it('卸载后清孤儿，仍被引用则保留，且不碰共享方案', () => {
      const e = node('e')
      const seed = scnOf({ nodes: [e], edges: [] })
      const forked = ensureNodeOverlay(seed, 'e')
      expect(isOverlayReferenced(forked, nodeOverlayId('e'))).toBe(true)
      expect(dropOverlayIfUnreferenced(forked, nodeOverlayId('e')).ui!.overlays![nodeOverlayId('e')]).toBeDefined()

      const unmounted: GameScenario = {
        ...forked,
        graph: {
          ...forked.graph,
          nodes: forked.graph.nodes.map((n) => (n.id === 'e' ? { ...n, data: { ...n.data, overlayNodes: undefined } } : n)),
        },
      }
      expect(dropOverlayIfUnreferenced(unmounted, nodeOverlayId('e')).ui!.overlays![nodeOverlayId('e')]).toBeUndefined()

      // 非 node: 前缀（共享方案）永不删，返回同引用。
      const shared = seedShared()
      expect(dropOverlayIfUnreferenced(shared, 'scheme-static')).toBe(shared)
    })

    it('引用判断覆盖子蓝图：仅被 manifest.packs 图引用的副本不误删', () => {
      const packNode = node('p', { overlayNodes: [{ overlay: nodeOverlayId('p') }] })
      const s = {
        version: 't',
        graph: { nodes: [], edges: [] },
        manifest: {
          version: 'game-video.blueprint-manifest.v1' as const,
          mainPackId: 'bp-main',
          packs: {
            'bp-main': {
              id: 'bp-main',
              title: 'main',
              entry: 'x',
              graph: { nodes: [], edges: [] },
            },
            pk: {
              id: 'pk',
              title: 'pk',
              entry: 'p',
              graph: { nodes: [packNode], edges: [] },
            },
          },
        },
        ui: { overlays: { [nodeOverlayId('p')]: { id: nodeOverlayId('p'), children: [] } } },
      } as GameScenario
      expect(isOverlayReferenced(s, nodeOverlayId('p'))).toBe(true)
      expect(dropOverlayIfUnreferenced(s, nodeOverlayId('p'))).toBe(s)
    })
  })
})
