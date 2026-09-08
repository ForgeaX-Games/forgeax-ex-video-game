import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import tools from './tool-handlers'

const root = resolve(import.meta.dirname, '../..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const manifest = JSON.parse(
  readFileSync(resolve(root, 'forgeax-extension.json'), 'utf8'),
)
const expectedTools = [
  'game-video:get-graph',
  'game-video:save-graph',
  'game-video:patch-graph',
  'game-video:patch-node-media',
  'game-video:patch-rules',
  'game-video:patch-characters',
  'game-video:generate-character-previews',
  'game-video:patch-scenes',
  'game-video:generate-scene-previews',
  'game-video:get-workflow-state',
  'game-video:begin-activity',
  'game-video:await-user',
  'game-video:complete-activity',
  'game-video:report-blocker',
  'game-video:focus-page',
  'game-video:inspect-project',
  'game-video:preflight-activity',
  'game-video:list-ui-components',
  'game-video:validate-project',
  'game-video:simulate-pass-a',
  'game-video:get-node-production-context',
  'game-video:list-videos',
  'game-video:generate-shot-script',
  'game-video:generate-keyframe',
  'game-video:generate-video',
  'game-video:generate-video-clip',
  'game-video:list-video-visual-styles',
  'game-video:generate-node-video',
  'game-video:list-assets',
  'game-video:get-asset',
  'game-video:import-character-refs',
  'game-video:import-scene-refs',
  'game-video:upsert-document',
  'game-video:upsert-component',
]
const reviewedExtensionHostSpec = '0.3.0'
let compiledBackendUrl: string

const forbiddenLegacyHostRoutes = [
  '/__gva__',
  '/__ce-api__',
  '/api/game-host',
  '__video-upload-proxy',
  'FORGEAX_SERVER_PORT',
  '.forgeax/active-game.json',
]

function containsForbiddenLegacyRoute(source: string, route: string): boolean {
  return source.includes(route)
}

// These routes belong to the current main-branch runtime/builders. They are
// intentionally not part of the migration surface being gated here.
const mainOwnedRuntimeFiles = new Set([
  'scripts/build-game-components.mjs',
  'src/runtime/react/component-host/index.ts',
  'src/runtime/react/play/GamePlayer.tsx',
])
const releaseGuardFiles = new Set([
  'scripts/check-release.mjs',
])

function productionSourceFiles(directory = root, relativeDirectory = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name
    const absolutePath = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      if (
        ['.git', '.worktrees', 'dist', 'docs', 'node_modules', '.superpowers'].includes(entry.name)
        || entry.name.startsWith('.check-release-')
      ) {
        return []
      }
      return productionSourceFiles(absolutePath, relativePath)
    }
    if (
      !entry.isFile()
      || !/\.(?:[cm]?[jt]sx?)$/.test(entry.name)
      || /(?:^|\/)__tests__\//.test(relativePath)
      || /\.test\.[cm]?[jt]sx?$/.test(relativePath)
      || ['src/server/dev-host.ts', 'vite.config.ts'].includes(relativePath)
      || relativePath.startsWith('src/player/')
      || mainOwnedRuntimeFiles.has(relativePath)
      || releaseGuardFiles.has(relativePath)
    ) {
      return []
    }
    return [relativePath]
  })
}

beforeAll(() => {
  const backendPath = resolve(root, 'dist/server/host.js')
  execFileSync('bun', ['run', 'build:backend'], { cwd: root, stdio: 'pipe' })
  compiledBackendUrl = pathToFileURL(backendPath).href
}, 60_000)

describe('release identity', () => {
  it('bundles component validation dependencies into the published backend', () => {
    const backend = readFileSync(resolve(root, 'dist/server/host.js'), 'utf8')
    expect(backend).not.toMatch(/from ["'](?:acorn|eslint-scope)["']/u)
  })

  it('bundles the extension host for unpacked directory loading', () => {
    const backend = readFileSync(resolve(root, 'dist/server/host.js'), 'utf8')
    expect(backend).not.toMatch(/from ["']@forgeax\/extension-host(?:\/[^"']*)?["']/u)
  })

  it('keeps legacy Vite-owned host routes out of production runtime source', () => {
    const violations = productionSourceFiles().flatMap((file) => {
      const source = readFileSync(resolve(root, file), 'utf8')
      return forbiddenLegacyHostRoutes
        .filter((route) => containsForbiddenLegacyRoute(source, route))
        .map((route) => `${file}: ${route}`)
    })

    expect(violations).toEqual([])
  })

  it('uses one package, manifest, extension, skill, and tool namespace', () => {
    expect(pkg.name).toBe('@forgeax-extension/game-video')
    expect(pkg.private).not.toBe(true)
    expect(manifest.id).toBe(pkg.name)
    expect(manifest.version).toBe(pkg.version)
    expect(manifest.schemaVersion).toBe(2)
    expect(manifest.contributes.pages.map((page: { id: string }) => page.id)).toContain('game-video')
    expect(manifest.contributes.skills.every(
      (entry: { id: string }) => entry.id.startsWith('game-video:'),
    )).toBe(true)
    expect(manifest.contributes.tools.map(
      (entry: { id: string }) => entry.id,
    )).toEqual(expectedTools)
    expect(Object.keys(tools)).toEqual(expectedTools)
  })

  it('declares every panel type referenced by a page layout', () => {
    const panelTypeIds = new Set(
      manifest.contributes.panelTypes.map((panel: { id: string }) => panel.id),
    )
    const referencedPanelTypeIds = manifest.contributes.pages.flatMap(
      (page: { panels: Array<{ panelType: { extension: string; id: string } }> }) => (
        page.panels
          .filter((panel) => panel.panelType.extension === 'self')
          .map((panel) => panel.panelType.id)
      ),
    )

    expect([...new Set(referencedPanelTypeIds)].sort()).toEqual([...panelTypeIds].sort())
  })

  it('exposes visual-style selection but keeps paid clip generation user-only', () => {
    const toolById = new Map(
      manifest.contributes.tools.map((entry: { id: string }) => [entry.id, entry]),
    )
    expect(toolById.get('game-video:list-video-visual-styles')).toMatchObject({
      exposedToAI: true,
    })
    expect(toolById.get('game-video:generate-video-clip')).toMatchObject({
      exposedToAI: false,
    })
  })

  it('pins the exact host dependency and installed extension URL API', () => {
    expect(pkg.peerDependencies['@forgeax/extension-platform']).toBe('0.0.3')
    expect(pkg.devDependencies['@forgeax/extension-platform']).toBe('0.0.3')
    expect(pkg.peerDependencies['@forgeax/extension-host']).toBe('^0.3.0')
    expect(pkg.devDependencies['@forgeax/extension-host']).toBe(reviewedExtensionHostSpec)
    expect(pkg.overrides?.['@forgeax/extension-host']).toBeUndefined()
  })

  it('resolves the reviewed extension host package', () => {
    const lock = readFileSync(resolve(root, 'bun.lock'), 'utf8')

    expect(lock).toContain('"@forgeax/extension-host@0.3.0"')
    expect(lock).not.toContain('git+ssh://git@github.com/ForgeaX-Games/forgeax-extension-host')
    expect(lock).not.toMatch(/file:vendor\/forgeax-extension-host/)
    expect(lock).not.toMatch(/@forgeax\/extension-host[^\n]*\/Users\//)
  })

  it('declares the Host video-generation capability for both generation tools', () => {
    const requiredCapability = [{ id: 'media.video.generate', version: 1 }]
    for (const toolId of [
      'game-video:generate-video',
      'game-video:generate-node-video',
    ]) {
      const tool = manifest.contributes.tools.find(
        (entry: { id: string }) => entry.id === toolId,
      )
      expect(tool?.requiresCapabilities).toEqual(requiredCapability)
    }
  })

  it('keeps paid media tools user-only and distinct from character references', () => {
    const paidMediaToolIds = [
      'game-video:generate-keyframe',
      'game-video:generate-video',
      'game-video:generate-node-video',
    ]
    for (const toolId of paidMediaToolIds) {
      const tool = manifest.contributes.tools.find(
        (entry: { id: string }) => entry.id === toolId,
      )
      expect(tool?.exposedToAI, toolId).toBe(false)
      expect(JSON.stringify(tool?.description), toolId).toMatch(/User-only|仅供用户/)
      expect(JSON.stringify(tool?.description), toolId).toMatch(/character_ref/)
    }
    const characterPreview = manifest.contributes.tools.find(
      (entry: { id: string }) => entry.id === 'game-video:generate-character-previews',
    )
    expect(characterPreview?.exposedToAI).toBe(true)
    expect(JSON.stringify(characterPreview?.description)).toMatch(/无需用户确认|without user confirmation/)
    const characterPreviewSchema = JSON.parse(readFileSync(
      resolve(root, 'schemas/generate-character-previews.args.json'),
      'utf8',
    ))
    expect(characterPreviewSchema.required).not.toContain('authorizationRef')
    expect(characterPreviewSchema.properties).not.toHaveProperty('authorizationRef')
  })

  it('exports the compiled host module with the declared tool map', async () => {
    expect(pkg.exports['.']).toBe('./dist/index.js')
    expect(pkg.exports['./host']).toBe('./dist/server/host.js')
    expect(pkg.exports['./standalone']).toBe('./dist/player/index.html')
    expect(manifest.entry.backend).toBe('./dist/server/host.js')

    const backend = await import(compiledBackendUrl)
    expect(backend.host).toBeDefined()
    expect(Object.keys(backend.tools)).toEqual(expectedTools)
  })

  it('loads the compiled host module in Node ESM', () => {
    expect(() => execFileSync('node', [
      '--input-type=module',
      '--eval',
      `await import(${JSON.stringify(compiledBackendUrl)})`,
    ], { cwd: root, stdio: 'pipe' })).not.toThrow()
  })

  it('excludes the vendored development bootstrap from the published package', () => {
    expect(pkg.files).toEqual([
      'dist',
      'forgeax-extension.json',
      'schemas',
      'README.md',
      'SKILL.md',
      '!dist/**/*.mp4',
      'dist/assets/placeholder-video.mp4',
      '!**/*.map',
      '!dist/**/*.map',
    ])
    expect(pkg.files).not.toContain('vendor')
  })

  it('publishes the canonical independent repository URL', () => {
    expect(pkg.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/ForgeaX-Games/forgeax-ex-video-game.git',
    })
  })

  it('keeps public persistence and generation documentation aligned with runtime behavior', () => {
    const surfaces = [
      'README.md',
      'SKILL.md',
      'AGENTS.md',
      'forgeax-extension.json',
      'schemas/save-graph.args.json',
      'schemas/save-graph.returns.json',
      'src/server/tool-handlers.ts',
    ]
    const contract = surfaces
      .map((file) => readFileSync(resolve(root, file), 'utf8'))
      .join('\n')

    expect(contract).not.toMatch(/scenarios\.graph\.json/)
    expect(contract).not.toMatch(/版本快照|version snapshot|keep-10|留\s*10|up to 10/i)
    expect(contract).not.toMatch(/\.forgeax\/games\/<slug>\/game-video/)
    expect(contract).not.toMatch(/(视频生成|video generation|generation).{0,24}(已删|deleted)/i)
    expect(contract).not.toContain('.forgeax/games/<slug>/blueprint.json')
    expect(contract).toContain('blueprint.json')
    expect(contract).toContain('game-video:generate-node-video')
    expect(contract).toContain('game-video:import-scene-refs')
  })

  it('derives game identity from the host binding for every public tool', () => {
    expect(manifest.contributes.tools).toHaveLength(34)

    for (const tool of manifest.contributes.tools) {
      const schemaPath = resolve(root, tool.args)
      const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
      expect(schema.properties ?? {}, tool.id).not.toHaveProperty('gameSlug')
      expect(schema.required ?? [], tool.id).not.toContain('gameSlug')
    }
  })

  it('declares logical game-root access and only runtime-used env keys', () => {
    const fsPermissions = manifest.permissions.filter((entry: string) =>
      entry.startsWith('fs:'),
    )
    expect(fsPermissions).toEqual([
      'fs:read:{gameRoot}/blueprint.json',
      'fs:write:{gameRoot}/blueprint.json',
      'fs:read:{gameRoot}/project.json',
      'fs:write:{gameRoot}/project.json',
      'fs:read:{gameRoot}/assets/**',
      'fs:write:{gameRoot}/assets/**',
      'fs:read:{gameRoot}/docs/**',
      'fs:write:{gameRoot}/docs/**',
      'fs:read:{gameRoot}/characters/**',
      'fs:read:{gameRoot}/textures/**',
      'fs:read:{gameRoot}/components/**',
      'fs:write:{gameRoot}/components/**',
    ])
    expect(manifest.permissions.some((entry: string) => entry.startsWith('emit:')))
      .toBe(false)
    expect(manifest.requestedEnv).toEqual([])
  })
})
