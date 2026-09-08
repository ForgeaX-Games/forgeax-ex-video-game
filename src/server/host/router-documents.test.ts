import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { createGameVideoRouter } from './router'
import { createInitialWorkflowState, VIDEO_GAME_WORKFLOW_FILE } from './workflow-state'

const decoder = new TextDecoder()
const encoder = new TextEncoder()

function contextFor(files: Record<string, string>): {
  context: ExtensionContext
  files: Record<string, string>
} {
  const store = { ...files }
  return {
    files: store,
    context: {
      gameId: 'game-1',
      files: {
        list: async (directory: string) => {
          const prefix = `${directory.replace(/\/+$/u, '')}/`
          return [...new Set(
            Object.keys(store)
              .filter((path) => path.startsWith(prefix))
              .map((path) => path.slice(prefix.length).split('/', 1)[0]!)
              .filter(Boolean),
          )].sort()
        },
        read: async (path: string) => {
          const value = store[path]
          return value === undefined ? null : encoder.encode(value)
        },
        write: async (path: string, contents: Uint8Array) => {
          store[path] = decoder.decode(contents)
        },
        withLocks: async <T>(_keys: readonly string[], operation: () => Promise<T>) => (
          operation()
        ),
      },
    } as unknown as ExtensionContext,
  }
}

function request(path: string) {
  return {
    gameId: 'game-1',
    runtimeId: 'runtime-1',
    method: 'GET',
    path,
    headers: {},
    query: {},
    body: new Uint8Array(),
  } as const
}

function completedPillarWorkflow(gameId: string) {
  const state = createInitialWorkflowState(gameId)
  return {
    ...state,
    revision: 12,
    productPhase: 'planning-design',
    phaseRevision: 2,
    phaseStatus: 'complete',
    activity: 'document.pillar',
    activityRevision: 1,
    activityStatus: 'complete',
    activities: {
      ...state.activities,
      'document.pillar': {
        revision: 1,
        status: 'complete',
        artifactRefs: [],
        evidence: [],
      },
    },
  }
}

describe('game-video document routing', () => {
  it('records pillar approval without coupling it to character-preview confirmation', async () => {
    const workflow = completedPillarWorkflow('game-1')
    const { context, files } = contextFor({
      [VIDEO_GAME_WORKFLOW_FILE]: JSON.stringify(workflow),
      'assets/manifest.json': JSON.stringify({
        version: 2,
        assets: [{
          id: 'doc-pillar',
          kind: 'document',
          name: '支柱',
          status: 'ready',
          mimeType: 'text/markdown',
          provider: { kind: 'local', ref: 'docs/demo_pillar.md' },
          createdAt: 1,
          updatedAt: 2,
          meta: { documentType: 'pillar' },
        }],
      }),
      'docs/demo_pillar.md': [
        '# 游戏支柱',
        'character_preview_estimate:',
        '  character_count: 4',
        '  image_count: 4',
      ].join('\n'),
    })
    const router = createGameVideoRouter(context)

    const proposal = await router.handle(request('author-gates/pillar/proposal'))
    expect(proposal.status).toBe(200)
    const proposalBody = JSON.parse(decoder.decode(proposal.body))
    expect(proposalBody).toMatchObject({
      gateRevision: 0,
      alreadyApproved: false,
    })

    const confirmed = await router.handle({
      ...request('author-gates/pillar/confirm'),
      method: 'POST',
      headers: { 'content-type': ['application/json'] },
      body: encoder.encode(JSON.stringify({
        expectedWorkflowRevision: proposalBody.workflowRevision,
        productionId: 'production:pillar:7',
      })),
    })
    expect(confirmed.status).toBe(200)
    const body = JSON.parse(decoder.decode(confirmed.body))
    expect(body.evidenceRef).toMatch(/^author:pillar:/)
    expect(body.state.gates.pillar).toMatchObject({
      status: 'approved', evidenceRef: body.evidenceRef,
    })
    expect(body.state.gates['character-cost']).toBeUndefined()
    expect(JSON.parse(files[VIDEO_GAME_WORKFLOW_FILE]!).gates['character-cost']).toBeUndefined()

    const repeated = await router.handle({
      ...request('author-gates/pillar/confirm'),
      method: 'POST',
      headers: { 'content-type': ['application/json'] },
      body: encoder.encode(JSON.stringify({ productionId: 'production:pillar:7' })),
    })
    expect(repeated.status).toBe(200)
    expect(JSON.parse(decoder.decode(repeated.body))).toMatchObject({
      accepted: true,
      alreadyApproved: true,
      evidenceRef: body.evidenceRef,
      state: { revision: body.state.revision },
    })
  })

  it('rejects obsolete browser-supplied character image ceilings', async () => {
    const workflow = completedPillarWorkflow('game-1')
    const { context, files } = contextFor({
      [VIDEO_GAME_WORKFLOW_FILE]: JSON.stringify(workflow),
      'assets/manifest.json': JSON.stringify({
        version: 2,
        assets: [{
          id: 'doc-pillar', kind: 'document', name: '支柱', status: 'ready',
          mimeType: 'text/markdown', provider: { kind: 'local', ref: 'docs/demo_pillar.md' },
          createdAt: 1, updatedAt: 2, meta: { documentType: 'pillar' },
        }],
      }),
      'docs/demo_pillar.md': '预计屏幕角色 3 个 / 角色预览图 3 张',
    })
    const router = createGameVideoRouter(context)

    const response = await router.handle({
      ...request('author-gates/pillar/confirm'),
      method: 'POST',
      headers: { 'content-type': ['application/json'] },
      body: encoder.encode(JSON.stringify({
        expectedWorkflowRevision: 12,
        maxImages: 30,
        productionId: 'production:pillar:7',
      })),
    })

    expect(response.status).toBe(400)
    expect(JSON.parse(decoder.decode(response.body)).error.code).toBe('invalid_input')
    expect(JSON.parse(files[VIDEO_GAME_WORKFLOW_FILE]!).gates.pillar.status).toBe('pending')
  })

  it('returns an empty document list for a new project', async () => {
    const { context } = contextFor({})
    const router = createGameVideoRouter(context)

    const response = await router.handle(request('documents'))

    expect(response.status).toBe(200)
    expect(JSON.parse(decoder.decode(response.body))).toEqual({ documents: [] })
  })

  it('returns an empty list while an orphan design-options document is still streaming', async () => {
    const { context, files } = contextFor({
      'assets/manifest.json': JSON.stringify({ version: 2, assets: [] }),
      'docs/demo_design_options.md': '[{"id":"A","title":"still writing"',
    })
    const router = createGameVideoRouter(context)

    const response = await router.handle(request('documents'))

    expect(response.status).toBe(200)
    expect(JSON.parse(decoder.decode(response.body))).toEqual({ documents: [] })
    expect(JSON.parse(files['assets/manifest.json']!).assets).toEqual([])
  })

  it('lists a docs/ intake record and reads its body from game root', async () => {
    const files = {
      'assets/manifest.json': JSON.stringify({
        version: 2,
        assets: [{
          id: 'doc-intake',
          kind: 'document',
          name: '需求',
          status: 'ready',
          mimeType: 'text/markdown',
          provider: { kind: 'local', ref: 'docs/demo_intake.md' },
          createdAt: 1,
          updatedAt: 2,
          meta: { documentType: 'intake' },
        }],
      }),
      'docs/demo_intake.md': '# Intake',
    }
    const { context } = contextFor(files)
    const router = createGameVideoRouter(context)

    const list = await router.handle(request('documents'))
    expect(JSON.parse(decoder.decode(list.body))).toEqual({
      documents: [{ id: 'doc-intake', name: '需求', documentType: 'intake', updatedAt: 2 }],
    })

    const one = await router.handle(request('documents/doc-intake'))
    expect(JSON.parse(decoder.decode(one.body))).toEqual({
      document: { id: 'doc-intake', name: '需求', documentType: 'intake', updatedAt: 2 },
      content: '# Intake',
    })
  })

  it('GET documents auto-registers orphan docs/*_<type>.md files', async () => {
    const { context, files } = contextFor({
      'assets/manifest.json': JSON.stringify({ version: 2, assets: [] }),
      'docs/black_myth_core.md': '# Core',
    })
    const router = createGameVideoRouter(context)

    const list = await router.handle(request('documents'))

    expect(list.status).toBe(200)
    expect(JSON.parse(decoder.decode(list.body))).toEqual({
      documents: [
        expect.objectContaining({ id: 'doc-core', documentType: 'core' }),
      ],
    })
    expect(JSON.parse(files['assets/manifest.json']!).assets).toEqual([
      expect.objectContaining({
        id: 'doc-core',
        provider: { kind: 'local', ref: 'docs/black_myth_core.md' },
        meta: { documentType: 'core' },
      }),
    ])
  })

  it('GET documents preserves the filename when matching document types case-insensitively', async () => {
    const { context, files } = contextFor({
      'assets/manifest.json': JSON.stringify({ version: 2, assets: [] }),
      'docs/black_myth_CORE.md': '# Core',
    })
    const router = createGameVideoRouter(context)

    const list = await router.handle(request('documents'))

    expect(list.status).toBe(200)
    expect(JSON.parse(files['assets/manifest.json']!).assets).toEqual([
      expect.objectContaining({
        id: 'doc-core',
        provider: { kind: 'local', ref: 'docs/black_myth_CORE.md' },
      }),
    ])
  })

  it('GET documents skips orphan docs files that are not bounded document paths', async () => {
    const { context, files } = contextFor({
      'assets/manifest.json': JSON.stringify({ version: 2, assets: [] }),
      'docs/black myth_core.md': '# Core',
    })
    const router = createGameVideoRouter(context)

    const list = await router.handle(request('documents'))

    expect(list.status).toBe(200)
    expect(JSON.parse(decoder.decode(list.body))).toEqual({ documents: [] })
    expect(JSON.parse(files['assets/manifest.json']!).assets).toEqual([])
  })

  it('upserts markdown under docs/ and registers doc-<type>', async () => {
    const { context, files } = contextFor({
      'assets/manifest.json': JSON.stringify({ version: 2, assets: [] }),
    })
    const router = createGameVideoRouter(context)

    const res = await router.handle({
      ...request('documents/upsert'),
      method: 'POST',
      headers: { 'content-type': ['application/json'] },
      body: encoder.encode(JSON.stringify({
        documentType: 'core',
        slug: 'demo',
        name: '核心方案',
        content: '# Core\n',
      })),
    })

    expect(res.status).toBe(200)
    const body = JSON.parse(decoder.decode(res.body))
    expect(body.document).toMatchObject({
      id: 'doc-core',
      documentType: 'core',
      name: '核心方案',
    })
    expect(files['docs/demo_core.md']).toBe('# Core\n')
    const manifest = JSON.parse(files['assets/manifest.json']!)
    expect(manifest.assets).toEqual([
      expect.objectContaining({
        id: 'doc-core',
        kind: 'document',
        name: '核心方案',
        provider: { kind: 'local', ref: 'docs/demo_core.md' },
        meta: { documentType: 'core' },
      }),
    ])
  })

  it('applies a selected design option from the registered Slide JSON into core', async () => {
    const options = [
      {
        id: 'A', title: '奈何', recommended: true,
        tags: ['赛虹废墟', '记忆流患', '阶层档格', '残缺人性'],
        markdown: '### 方案 A\n\n#### 项目介绍\nA 项目\n\n#### 主题表达\nA 主题',
        genre: '东方奇幻 / 悬疑', visualStyle: '游戏 CG', scale: '短篇 · 25 分钟',
        projectIntroduction: 'A 项目', themeExpression: 'A 主题', mainLoop: 'A 循环',
        deliveryPromise: 'A 承诺', pillarStance: { narrative: 'core' },
      },
      {
        id: 'B', title: '回响', recommended: false,
        tags: ['记忆', '回合', '雨夜', '抉择'],
        markdown: '### 方案 B\n\n#### 项目介绍\nB 项目\n\n#### 主题表达\nB 主题',
        genre: '悬疑 / 回合战斗', visualStyle: '3D 写实化风', scale: '短篇 · 25 分钟',
        projectIntroduction: 'B 项目', themeExpression: 'B 主题', mainLoop: 'B 循环',
        deliveryPromise: 'B 承诺', pillarStance: { narrative: 'support', combat: 'core' },
      },
      {
        id: 'C', title: '归潮', recommended: false,
        tags: ['潮汐', '旧城', '线索', '团圆'],
        markdown: '### 方案 C\n\n#### 项目介绍\nC 项目\n\n#### 主题表达\nC 主题',
        genre: '探索 / 叙事', visualStyle: '游戏 CG', scale: '短篇 · 25 分钟',
        projectIntroduction: 'C 项目', themeExpression: 'C 主题', mainLoop: 'C 循环',
        deliveryPromise: 'C 承诺', pillarStance: { narrative: 'core', exploration: 'support' },
      },
    ]
    const { context, files } = contextFor({
      'assets/manifest.json': JSON.stringify({ version: 2, assets: [{
        id: 'doc-design-options', kind: 'document', name: '核心方案候选', status: 'ready',
        mimeType: 'text/markdown', provider: { kind: 'local', ref: 'docs/demo_design_options.md' },
        createdAt: 1, updatedAt: 2, meta: { documentType: 'design-options' },
      }] }),
      'docs/demo_design_options.md': JSON.stringify(options),
    })
    const router = createGameVideoRouter(context)

    const res = await router.handle({
      ...request('documents/design-options/apply'),
      method: 'POST',
      headers: { 'content-type': ['application/json'] },
      body: encoder.encode(JSON.stringify({ optionId: 'B' })),
    })

    expect(res.status).toBe(200)
    expect(JSON.parse(decoder.decode(res.body))).toMatchObject({
      selectedOptionId: 'B',
      document: { id: 'doc-core', documentType: 'core' },
    })
    expect(files['docs/demo_core.md']).toContain('selected_option: B')
    expect(files['docs/demo_core.md']).toContain('B 项目')
    expect(files['docs/demo_core.md']).not.toContain('A 项目')
  })

  it('registers existing file when content omitted', async () => {
    const { context, files } = contextFor({
      'assets/manifest.json': JSON.stringify({ version: 2, assets: [] }),
      'docs/demo_pillar.md': '# Pillar',
    })
    const router = createGameVideoRouter(context)

    const res = await router.handle({
      ...request('documents/upsert'),
      method: 'POST',
      headers: { 'content-type': ['application/json'] },
      body: encoder.encode(JSON.stringify({
        documentType: 'pillar',
        slug: 'demo',
      })),
    })

    expect(res.status).toBe(200)
    const body = JSON.parse(decoder.decode(res.body))
    expect(body.document).toMatchObject({
      id: 'doc-pillar',
      name: '支柱',
      documentType: 'pillar',
    })
    expect(files['docs/demo_pillar.md']).toBe('# Pillar')
    const manifest = JSON.parse(files['assets/manifest.json']!)
    expect(manifest.assets).toEqual([
      expect.objectContaining({
        id: 'doc-pillar',
        kind: 'document',
        name: '支柱',
        status: 'ready',
        mimeType: 'text/markdown',
        provider: { kind: 'local', ref: 'docs/demo_pillar.md' },
        meta: { documentType: 'pillar' },
      }),
    ])
  })

  it('overwrites same documentType while preserving createdAt', async () => {
    const { context, files } = contextFor({
      'assets/manifest.json': JSON.stringify({
        version: 2,
        assets: [{
          id: 'doc-core',
          kind: 'document',
          name: '旧核心',
          status: 'ready',
          mimeType: 'text/markdown',
          provider: { kind: 'local', ref: 'docs/demo_core.md' },
          createdAt: 100,
          updatedAt: 200,
          meta: { documentType: 'core' },
        }],
      }),
      'docs/demo_core.md': '# Old core',
    })
    const router = createGameVideoRouter(context)

    const res = await router.handle({
      ...request('documents/upsert'),
      method: 'POST',
      headers: { 'content-type': ['application/json'] },
      body: encoder.encode(JSON.stringify({
        documentType: 'core',
        slug: 'demo',
        name: '核心方案',
        content: '# New core\n',
      })),
    })

    expect(res.status).toBe(200)
    const body = JSON.parse(decoder.decode(res.body))
    expect(body.document).toMatchObject({
      id: 'doc-core',
      name: '核心方案',
      documentType: 'core',
    })
    expect(body.document.updatedAt).toBeGreaterThan(200)
    expect(files['docs/demo_core.md']).toBe('# New core\n')
    const manifest = JSON.parse(files['assets/manifest.json']!)
    expect(manifest.assets).toHaveLength(1)
    expect(manifest.assets[0]).toMatchObject({
      id: 'doc-core',
      name: '核心方案',
      createdAt: 100,
      provider: { kind: 'local', ref: 'docs/demo_core.md' },
      meta: { documentType: 'core' },
    })
    expect(manifest.assets[0].updatedAt).toBe(body.document.updatedAt)
  })

  it('returns structured error when register-only upsert targets a missing file', async () => {
    const { context } = contextFor({
      'assets/manifest.json': JSON.stringify({ version: 2, assets: [] }),
    })
    const router = createGameVideoRouter(context)

    const res = await router.handle({
      ...request('documents/upsert'),
      method: 'POST',
      headers: { 'content-type': ['application/json'] },
      body: encoder.encode(JSON.stringify({
        documentType: 'inquiry',
        slug: 'demo',
      })),
    })

    expect(res.status).toBe(200)
    const body = JSON.parse(decoder.decode(res.body))
    expect(body.document).toBeNull()
    expect(body.error).toMatch(/Document file missing/)
  })

  it('rejects an omitted slug instead of inferring one from project.json', async () => {
    const { context, files } = contextFor({
      'assets/manifest.json': JSON.stringify({ version: 2, assets: [] }),
      'project.json': JSON.stringify({ slug: 'my-game', name: 'My Game', id: 'my-game-id' }),
    })
    const router = createGameVideoRouter(context)

    const res = await router.handle({
      ...request('documents/upsert'),
      method: 'POST',
      headers: { 'content-type': ['application/json'] },
      body: encoder.encode(JSON.stringify({
        documentType: 'intake',
        content: '# Intake\n',
      })),
    })

    expect(res.status).toBe(400)
    const body = JSON.parse(decoder.decode(res.body))
    expect(body.error).toMatchObject({ code: 'invalid_input' })
    expect(body.error.message).toMatch(/slug/)
    expect(Object.keys(files).filter((path) => path.startsWith('docs/'))).toEqual([])
    expect(JSON.parse(files['assets/manifest.json']!).assets).toEqual([])
  })

  it('rejects a blank slug', async () => {
    const { context, files } = contextFor({
      'assets/manifest.json': JSON.stringify({ version: 2, assets: [] }),
    })
    const router = createGameVideoRouter(context)

    const res = await router.handle({
      ...request('documents/upsert'),
      method: 'POST',
      headers: { 'content-type': ['application/json'] },
      body: encoder.encode(JSON.stringify({
        documentType: 'core',
        slug: '   ',
        content: '# Core\n',
      })),
    })

    expect(res.status).toBe(400)
    expect(JSON.parse(decoder.decode(res.body)).error.message).toMatch(/slug/)
    expect(Object.keys(files).filter((path) => path.startsWith('docs/'))).toEqual([])
  })

  it('rejects illegal slug characters instead of sanitizing them', async () => {
    const { context, files } = contextFor({
      'assets/manifest.json': JSON.stringify({ version: 2, assets: [] }),
    })
    const router = createGameVideoRouter(context)

    for (const slug of ['my game', '../evil', 'demo/nested', '_leading']) {
      const res = await router.handle({
        ...request('documents/upsert'),
        method: 'POST',
        headers: { 'content-type': ['application/json'] },
        body: encoder.encode(JSON.stringify({
          documentType: 'core',
          slug,
          content: '# Core\n',
        })),
      })

      expect(res.status, slug).toBe(400)
      expect(JSON.parse(decoder.decode(res.body)).error.message, slug).toMatch(/slug/)
    }
    expect(Object.keys(files).filter((path) => path.startsWith('docs/'))).toEqual([])
    expect(JSON.parse(files['assets/manifest.json']!).assets).toEqual([])
  })
})
