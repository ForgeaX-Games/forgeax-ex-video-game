import { beforeEach, describe, expect, it } from 'vitest'
import type { ProductionProjection } from '../../../workflow/contracts'
import { useDocumentNav } from '../documentNavStore'
import { useGraphView } from '../graphViewStore'
import {
  activeAncestors,
  hasSelectableProductionContent,
  isConcurrentGroup,
  useProductionProjection,
} from '../productionProjectionStore'
import {
  applyProductionProjection as applyPageProjection,
  resumeProductionFollow,
} from '../pageNavigation'
import { applyProductionProjection, type NavNode } from '../../shell/NewSidebar'
import { visibleCatalogTabKinds } from '../../shell/AssetCatalogSection'
import { EMPTY_ASSET_CATALOG, VISIBLE_CATALOG_TAB_KINDS } from '@/editor/assets/asset-catalog'

function projection(overrides: Partial<ProductionProjection> = {}): ProductionProjection {
  return {
    schemaVersion: 1,
    gameId: 'game-projection',
    workflowRevision: 1,
    phase: 'requirements-collection',
    phaseRevision: 1,
    phaseStatus: 'working',
    activity: 'document.core',
    activityRevision: 1,
    activityStatus: 'working',
    activeActivities: ['document.core'],
    group: { id: 'doc.core', status: 'working', revision: 1 },
    phases: {
      'requirements-collection': { revision: 1, status: 'working' },
      'planning-design': { revision: 0, status: 'not-started' },
      'feature-development': { revision: 0, status: 'not-started' },
      'asset-generation': { revision: 0, status: 'not-started' },
    },
    modules: {
      documents: { availability: 'working' },
      'document.core': { availability: 'working' },
      'document.pillar': { availability: 'hidden' },
      blueprint: { availability: 'hidden' },
      rules: { availability: 'hidden' },
      ui: { availability: 'hidden' },
      assets: { availability: 'hidden' },
    },
    gates: {},
    artifacts: [],
    focus: {
      location: { kind: 'document', documentType: 'core' },
      reason: 'activity-started',
      revision: 1,
    },
    ...overrides,
  }
}

beforeEach(() => {
  useProductionProjection.setState({ projection: null, expanded: new Set(), followMode: true })
})

describe('production sidebar projection', () => {
  it('brief.collecting 只有空文档目录时没有可选内容模块', () => {
    const brief = projection({
      activity: 'brief.collecting',
      activeActivities: ['brief.collecting'],
      focus: undefined,
      modules: {
        documents: { availability: 'working' },
        'document.core': { availability: 'hidden' },
        'document.pillar': { availability: 'hidden' },
        blueprint: { availability: 'hidden' },
        rules: { availability: 'hidden' },
        ui: { availability: 'hidden' },
        assets: { availability: 'hidden' },
      },
    })
    const projected = applyProductionProjection([
      {
        id: 'documents',
        label: '文档',
        kind: 'entry',
        view: 'documents',
        children: [
          { id: 'document:core', label: '核心设计', kind: 'leaf', documentType: 'core' },
          { id: 'document:pillar', label: '支柱设计', kind: 'leaf', documentType: 'pillar' },
        ],
      },
    ], brief)

    expect(hasSelectableProductionContent(brief)).toBe(false)
    expect(projected).toEqual([
      expect.objectContaining({ id: 'documents', view: undefined, children: [] }),
    ])
    expect(hasSelectableProductionContent(projection())).toBe(true)
  })

  it('fully hides modules and document leaves that have not started', () => {
    const tree: NavNode[] = [
      { id: 'documents', label: '文档', kind: 'entry', children: [
        { id: 'document:core', label: '核心', kind: 'leaf', documentType: 'core' },
        { id: 'document:pillar', label: '支柱', kind: 'leaf', documentType: 'pillar' },
      ] },
      { id: 'graph', label: '蓝图', kind: 'entry' },
      { id: 'rule', label: '规则', kind: 'entry' },
      { id: 'assets', label: '资产库', kind: 'entry' },
    ]
    expect(applyProductionProjection(tree, projection())).toEqual([
      expect.objectContaining({
        id: 'documents',
        productionAvailability: 'working',
        children: [expect.objectContaining({ id: 'document:core' })],
      }),
    ])
  })

  it('ignores stale projections and expands the semantic focus while follow is on', () => {
    const store = useProductionProjection.getState()
    expect(store.setProjection(projection({ workflowRevision: 5 }))).toBe(true)
    expect(useProductionProjection.getState().expanded.has('documents')).toBe(true)
    expect(useProductionProjection.getState().setProjection(projection({ workflowRevision: 4 }))).toBe(false)
    expect(useProductionProjection.getState().projection?.workflowRevision).toBe(5)
  })

  it('expands every concurrent track instead of only the focused one', () => {
    const concurrent = projection({
      activity: 'characters.modeling',
      activeActivities: ['characters.modeling', 'scenes.modeling', 'rules.catalog'],
      group: { id: 'modeling', status: 'working', revision: 1 },
      focus: {
        location: { kind: 'asset', root: 'character' },
        reason: 'activity-started',
        revision: 1,
      },
    })
    expect(new Set(activeAncestors(concurrent))).toEqual(new Set([
      'assets',
      'asset-root:settings',
      'asset-root:scene',
      'rule',
      'rule-entities',
    ]))
    expect(isConcurrentGroup(concurrent)).toBe(true)
  })

  it('keeps precise focus navigation for serial activities', () => {
    const serial = projection()
    expect(isConcurrentGroup(serial)).toBe(false)
    expect(activeAncestors(serial)).toEqual(['documents'])
  })

  it('does not steal the viewport while a concurrent group is running', () => {
    useDocumentNav.getState().setDocumentType('core')
    applyPageProjection(projection({
      activity: 'scenes.modeling',
      activeActivities: ['characters.modeling', 'scenes.modeling'],
      focus: {
        location: { kind: 'document', documentType: 'pillar' },
        reason: 'activity-started',
        revision: 9,
      },
    }))
    expect(useDocumentNav.getState().documentType).toBe('core')
    expect(useProductionProjection.getState().expanded.has('assets')).toBe(true)
  })

  it('projects concurrent asset tracks through the unified asset-library status', () => {
    const tree: NavNode[] = [
      { id: 'assets', label: '资产库', kind: 'entry' },
      { id: 'rule', label: '规则', kind: 'entry' },
    ]
    const projected = applyProductionProjection(tree, projection({
      activity: 'scenes.modeling',
      activeActivities: ['characters.modeling', 'scenes.modeling', 'rules.catalog'],
      modules: {
        assets: { availability: 'working' },
        character: { availability: 'working' },
        scene: { availability: 'blocked', blockerCode: 'scenes.catalog.invalid' },
        rules: { availability: 'working' },
      },
    }))
    expect(projected.find((node) => node.id === 'assets')?.productionAvailability)
      .toBe('working')
    expect(projected.find((node) => node.id === 'rule')?.productionAvailability)
      .toBe('working')
  })

  it('资产库一级入口解锁时一次显示全部二级分类', () => {
    const assetStage = projection({
      modules: {
        assets: { availability: 'working' },
        character: { availability: 'working' },
        scene: { availability: 'working' },
        video: { availability: 'ready' },
        image: { availability: 'ready' },
        audio: { availability: 'ready' },
        font: { availability: 'ready' },
      },
    })
    expect(visibleCatalogTabKinds(assetStage, EMPTY_ASSET_CATALOG)).toEqual(VISIBLE_CATALOG_TAB_KINDS)
  })

  it('聚焦场景时打开统一资产库，由目录位置继续定位场景', () => {
    applyPageProjection(projection({
      activity: 'scenes.modeling',
      activeActivities: ['scenes.modeling'],
      focus: {
        location: { kind: 'asset', root: 'scene' },
        reason: 'activity-started',
        revision: 4,
      },
    }))

    expect(useGraphView.getState().view).toBe('assets')
  })

  it('manual navigation suspends automatic following until explicitly resumed', () => {
    useProductionProjection.getState().setProjection(projection())
    useDocumentNav.getState().setDocumentType('core')
    useProductionProjection.getState().markManualNavigation()
    expect(useProductionProjection.getState().followMode).toBe(false)
    expect(resumeProductionFollow()).toBe(true)
    expect(useProductionProjection.getState().followMode).toBe(true)
    expect(useDocumentNav.getState().documentType).toBe('core')
  })
})
